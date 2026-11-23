import { asc, count, desc, eq, ilike, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { auditLogs, cropVarieties, crops, farms, iotDevices, predictions, sensorReadings, users } from "@/db/schema";
import { publicUser, requireRole, requireUser } from "@/server/auth";
import { badRequest, handle, json, notFound, pageParams, parseBody } from "@/server/http";
import { getSetting, listSettings, resetSetting, setSetting } from "@/server/services/settings";
import { notify } from "@/server/services/notifications";
import { runRetention } from "@/server/services/retention";
import { audit } from "@/server/services/support";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ section: string }> };

/** Pairs that must satisfy min <= max; protects the prediction engine from corrupt thresholds. */
const RANGE_PAIRS: [string, string][] = [
  ["baseYieldMin", "baseYieldMax"],
  ["maturityDaysMin", "maturityDaysMax"],
  ["tempOptMin", "tempOptMax"],
  ["tempCriticalLow", "tempCriticalHigh"],
  ["waterNeedMinMm", "waterNeedMaxMm"],
  ["soilMoistureMin", "soilMoistureMax"],
  ["phMin", "phMax"],
];

function assertRanges(current: Record<string, unknown>, patch: Record<string, unknown>) {
  for (const [lo, hi] of RANGE_PAIRS) {
    const a = patch[lo] !== undefined ? Number(patch[lo]) : Number(current[lo]);
    const b = patch[hi] !== undefined ? Number(patch[hi]) : Number(current[hi]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    if (a > b) throw badRequest(`${lo} (${a}) must not exceed ${hi} (${b})`);
  }
}

const cropFields = {
  name: z.string().trim().min(2).max(80),
  scientificName: z.string().trim().max(120).nullable().optional(),
  yieldUnit: z.string().trim().min(1).max(16),
  baseYieldMin: z.coerce.number().positive(),
  baseYieldMax: z.coerce.number().positive(),
  maturityDaysMin: z.coerce.number().int().positive(),
  maturityDaysMax: z.coerce.number().int().positive(),
  baseTempC: z.coerce.number(),
  gddToMaturity: z.coerce.number().int().positive(),
  tempOptMin: z.coerce.number(),
  tempOptMax: z.coerce.number(),
  tempCriticalLow: z.coerce.number(),
  tempCriticalHigh: z.coerce.number(),
  waterNeedMinMm: z.coerce.number().int().nonnegative(),
  waterNeedMaxMm: z.coerce.number().int().nonnegative(),
  soilMoistureMin: z.coerce.number().min(0).max(100),
  soilMoistureMax: z.coerce.number().min(0).max(100),
  phMin: z.coerce.number().min(0).max(14),
  phMax: z.coerce.number().min(0).max(14),
  active: z.boolean().optional(),
};

const NUMERIC_CROP_FIELDS = [
  "baseYieldMin", "baseYieldMax", "baseTempC", "gddToMaturity", "tempOptMin", "tempOptMax",
  "tempCriticalLow", "tempCriticalHigh", "waterNeedMinMm", "waterNeedMaxMm", "soilMoistureMin", "soilMoistureMax", "phMin", "phMax",
];

/** Converts numeric patch values to the string representation used by numeric DB columns. */
function cropDbValues(patch: Record<string, unknown>) {
  const set: Record<string, unknown> = { ...patch, updatedAt: new Date() };
  for (const key of NUMERIC_CROP_FIELDS) if (set[key] !== undefined) set[key] = String(set[key]);
  return set;
}

export const GET = handle(async (req: Request, ctx: Ctx) => {
  const user = await requireUser();
  requireRole(user, ["admin"]);
  const { section } = await ctx.params;
  const url = new URL(req.url);
  switch (section) {
    case "stats": {
      const [[u], [f], [d], [r], [p]] = await Promise.all([
        db.select({ n: count() }).from(users),
        db.select({ n: count() }).from(farms),
        db.select({ n: count() }).from(iotDevices),
        db.select({ n: count() }).from(sensorReadings),
        db.select({ n: count() }).from(predictions),
      ]);
      return json({ stats: { users: u.n, farms: f.n, devices: d.n, readings: r.n, predictions: p.n } });
    }
    case "users": {
      const { limit, offset, page } = pageParams(url, 50, 200);
      const q = url.searchParams.get("q")?.trim();
      const where = q ? or(ilike(users.email, `%${q}%`), ilike(users.fullName, `%${q}%`)) : undefined;
      const rows = await db.select().from(users).where(where).orderBy(desc(users.createdAt)).limit(limit).offset(offset);
      return json({ users: rows.map(publicUser), page, limit });
    }
    case "audit": {
      const rows = await db.select({ log: auditLogs, actor: users.email }).from(auditLogs).leftJoin(users, eq(users.id, auditLogs.actorId)).orderBy(desc(auditLogs.createdAt)).limit(100);
      return json({ logs: rows.map((r) => ({ ...r.log, actor: r.actor })) });
    }
    case "crops":
      return json({ crops: await db.select().from(crops).orderBy(asc(crops.name)) });
    case "varieties": {
      const cropId = url.searchParams.get("cropId");
      const rows = await db.select().from(cropVarieties).where(cropId ? eq(cropVarieties.cropId, cropId) : undefined).orderBy(asc(cropVarieties.name));
      return json({ varieties: rows });
    }
    case "settings": {
      const key = url.searchParams.get("key");
      if (key) return json({ setting: await getSetting(key as "risk_thresholds") });
      return json({ settings: await listSettings() });
    }
    default:
      throw notFound();
  }
});

export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  const admin = await requireUser();
  requireRole(admin, ["admin"]);
  const { section } = await ctx.params;
  if (section === "users") {
    const body = await parseBody(req, z.object({ userId: z.string().uuid(), role: z.enum(["farmer", "agronomist", "technician", "admin"]) }));
    if (body.userId === admin.id && body.role !== "admin") throw badRequest("You cannot remove your own admin role.");
    const [u] = await db.update(users).set({ role: body.role, updatedAt: new Date() }).where(eq(users.id, body.userId)).returning();
    if (!u) throw notFound("User not found");
    await audit(admin.id, "admin.user_role", "user", u.id, { role: body.role });
    return json({ user: publicUser(u) });
  }
  if (section === "crops") {
    const body = await parseBody(req, z.object({
      cropId: z.string().uuid(),
      ...Object.fromEntries(Object.entries(cropFields).map(([k, v]) => [k, v.optional()])),
    }));
    const { cropId, ...patch } = body;
    const [current] = await db.select().from(crops).where(eq(crops.id, cropId)).limit(1);
    if (!current) throw notFound("Crop not found");
    assertRanges(current, patch);
    const [c] = await db.update(crops).set(cropDbValues(patch)).where(eq(crops.id, cropId)).returning();
    await audit(admin.id, "admin.crop_update", "crop", c.id, patch);
    return json({ crop: c });
  }
  if (section === "varieties") {
    const body = await parseBody(req, z.object({
      varietyId: z.string().uuid(),
      name: z.string().trim().min(2).max(80).optional(),
      maturityFactor: z.coerce.number().min(0.5).max(2).optional(),
      yieldFactor: z.coerce.number().min(0.3).max(3).optional(),
      notes: z.string().max(500).nullable().optional(),
    }));
    const { varietyId, ...patch } = body;
    const values = {
      ...patch,
      ...(patch.maturityFactor !== undefined && { maturityFactor: String(patch.maturityFactor) }),
      ...(patch.yieldFactor !== undefined && { yieldFactor: String(patch.yieldFactor) }),
    };
    const [v] = await db.update(cropVarieties).set(values as Partial<typeof cropVarieties.$inferInsert>).where(eq(cropVarieties.id, varietyId)).returning();
    if (!v) throw notFound("Variety not found");
    await audit(admin.id, "admin.variety_update", "crop_variety", v.id, patch);
    return json({ variety: v });
  }
  if (section === "settings") {
    const body = await parseBody(req, z.object({ key: z.string().min(1), value: z.unknown() }));
    const setting = await setSetting(body.key, body.value);
    await audit(admin.id, "admin.setting_update", "system_setting", body.key, { value: body.value });
    return json({ setting });
  }
  throw notFound();
});

/** POST /api/v1/admin/crops|varieties|announcements */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const admin = await requireUser();
  requireRole(admin, ["admin"]);
  const { section } = await ctx.params;
  if (section === "crops") {
    const body = await parseBody(req, z.object({ ...cropFields, slug: z.string().trim().min(2).max(64).regex(/^[a-z0-9-]+$/, "Lowercase letters, digits and hyphens only") }));
    assertRanges({}, body);
    const [crop] = await db.insert(crops).values(cropDbValues({ ...body, active: body.active ?? true }) as typeof crops.$inferInsert).returning();
    await audit(admin.id, "admin.crop_create", "crop", crop.id, { slug: crop.slug });
    return json({ crop }, 201);
  }
  if (section === "varieties") {
    const body = await parseBody(req, z.object({
      cropId: z.string().uuid(),
      name: z.string().trim().min(2).max(80),
      maturityFactor: z.coerce.number().min(0.5).max(2).default(1),
      yieldFactor: z.coerce.number().min(0.3).max(3).default(1),
      notes: z.string().max(500).nullable().optional(),
    }));
    const [v] = await db.insert(cropVarieties).values({ ...body, maturityFactor: String(body.maturityFactor), yieldFactor: String(body.yieldFactor) }).returning();
    await audit(admin.id, "admin.variety_create", "crop_variety", v.id, { name: v.name });
    return json({ variety: v }, 201);
  }
  if (section === "maintenance") {
    const body = await parseBody(req, z.object({ action: z.literal("retention"), readingsDays: z.coerce.number().int().min(30).max(3650).default(365) }));
    const result = await runRetention(body.readingsDays);
    await audit(admin.id, "admin.retention", "system", null, result.deleted);
    return json({ result });
  }
  if (section === "announcements") {
    const body = await parseBody(req, z.object({ title: z.string().trim().min(3).max(160), body: z.string().trim().min(3).max(2000) }));
    const all = await db.select({ id: users.id }).from(users);
    for (const u of all) await notify(u.id, { type: "system", severity: "info", title: body.title, body: body.body });
    await audit(admin.id, "admin.announcement", "notification", null, { title: body.title, recipients: all.length });
    return json({ sent: all.length }, 201);
  }
  throw notFound();
});

/** DELETE /api/v1/admin/settings?key=… removes an override; DELETE crops/varieties deactivates/removes catalogue entries. */
export const DELETE = handle(async (req: Request, ctx: Ctx) => {
  const admin = await requireUser();
  requireRole(admin, ["admin"]);
  const { section } = await ctx.params;
  const url = new URL(req.url);
  if (section === "settings") {
    const key = url.searchParams.get("key") ?? "";
    const setting = await resetSetting(key);
    await audit(admin.id, "admin.setting_reset", "system_setting", key);
    return json({ setting });
  }
  if (section === "varieties") {
    const id = url.searchParams.get("id");
    if (!id) throw badRequest("id is required");
    const [v] = await db.delete(cropVarieties).where(eq(cropVarieties.id, id)).returning();
    if (!v) throw notFound("Variety not found");
    await audit(admin.id, "admin.variety_delete", "crop_variety", v.id);
    return json({ variety: v });
  }
  if (section === "crops") {
    const id = url.searchParams.get("id");
    if (!id) throw badRequest("id is required");
    // Soft-delete: existing plantings and predictions reference this crop.
    const [c] = await db.update(crops).set({ active: false, updatedAt: new Date() }).where(eq(crops.id, id)).returning();
    if (!c) throw notFound("Crop not found");
    await audit(admin.id, "admin.crop_deactivate", "crop", c.id);
    return json({ crop: c });
  }
  throw notFound();
});
