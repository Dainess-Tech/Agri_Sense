import { asc, count, desc, eq, ilike, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { auditLogs, crops, farms, iotDevices, predictions, sensorReadings, users } from "@/db/schema";
import { publicUser, requireRole, requireUser } from "@/server/auth";
import { badRequest, handle, json, notFound, pageParams, parseBody } from "@/server/http";
import { notify } from "@/server/services/notifications";
import { audit } from "@/server/services/support";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ section: string }> };

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
    default:
      throw notFound();
  }
});

const cropPatch = z.object({
  cropId: z.string().uuid(),
  active: z.boolean().optional(),
  baseYieldMin: z.coerce.number().positive().optional(),
  baseYieldMax: z.coerce.number().positive().optional(),
  maturityDaysMin: z.coerce.number().int().positive().optional(),
  maturityDaysMax: z.coerce.number().int().positive().optional(),
  soilMoistureMin: z.coerce.number().min(0).max(100).optional(),
  soilMoistureMax: z.coerce.number().min(0).max(100).optional(),
  phMin: z.coerce.number().min(0).max(14).optional(),
  phMax: z.coerce.number().min(0).max(14).optional(),
  tempCriticalLow: z.coerce.number().optional(),
  tempCriticalHigh: z.coerce.number().optional(),
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
    const { cropId, ...rest } = await parseBody(req, cropPatch);
    const set: Record<string, unknown> = { updatedAt: new Date() };
    const intOrBool = ["active", "maturityDaysMin", "maturityDaysMax"];
    for (const [k, v] of Object.entries(rest)) if (v !== undefined) set[k] = intOrBool.includes(k) ? v : String(v);
    const [c] = await db.update(crops).set(set).where(eq(crops.id, cropId)).returning();
    if (!c) throw notFound("Crop not found");
    await audit(admin.id, "admin.crop_update", "crop", c.id, rest);
    return json({ crop: c });
  }
  throw notFound();
});

/** POST /api/v1/admin/announcements { title, body } — system announcement to all users. */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const admin = await requireUser();
  requireRole(admin, ["admin"]);
  if ((await ctx.params).section !== "announcements") throw notFound();
  const body = await parseBody(req, z.object({ title: z.string().trim().min(3).max(160), body: z.string().trim().min(3).max(2000) }));
  const all = await db.select({ id: users.id }).from(users);
  for (const u of all) await notify(u.id, { type: "system", severity: "info", title: body.title, body: body.body });
  await audit(admin.id, "admin.announcement", "notification", null, { title: body.title, recipients: all.length });
  return json({ sent: all.length }, 201);
});
