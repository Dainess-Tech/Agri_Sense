import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { cropVarieties, crops, farms, plantings } from "@/db/schema";
import { requireUser } from "@/server/auth";
import { accessibleFarms, getFarmForUser } from "@/server/access";
import { conflict, handle, json, notFound, parseBody } from "@/server/http";
import { logActivity } from "@/server/services/support";
import { plantingInput } from "@/server/validators";

export const dynamic = "force-dynamic";

/** GET /api/v1/plantings?farmId= — plantings with crop + variety names. */
export const GET = handle(async (req: Request) => {
  const user = await requireUser();
  const farmId = new URL(req.url).searchParams.get("farmId");
  const farmIds = farmId ? [(await getFarmForUser(user, farmId)).id] : (await accessibleFarms(user)).map((f) => f.id);
  if (!farmIds.length) return json({ plantings: [] });
  const rows = await db
    .select({ p: plantings, cropName: crops.name, cropSlug: crops.slug, varietyName: cropVarieties.name, farmName: farms.name })
    .from(plantings)
    .innerJoin(crops, eq(crops.id, plantings.cropId))
    .innerJoin(farms, eq(farms.id, plantings.farmId))
    .leftJoin(cropVarieties, eq(cropVarieties.id, plantings.varietyId))
    .where(inArray(plantings.farmId, farmIds))
    .orderBy(desc(plantings.plantingDate));
  return json({ plantings: rows.map((r) => ({ ...r.p, cropName: r.cropName, cropSlug: r.cropSlug, varietyName: r.varietyName, farmName: r.farmName })) });
});

/** POST /api/v1/plantings — idempotent with `clientId` (safe for offline replay). */
export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const body = await parseBody(req, plantingInput);
  const farm = await getFarmForUser(user, body.farmId, "write");
  const [crop] = await db.select().from(crops).where(eq(crops.id, body.cropId)).limit(1);
  if (!crop) throw notFound("Crop not found");
  if (body.varietyId) {
    const [v] = await db.select().from(cropVarieties).where(and(eq(cropVarieties.id, body.varietyId), eq(cropVarieties.cropId, crop.id))).limit(1);
    if (!v) throw notFound("Variety not found for this crop");
  }
  if (body.clientId) {
    const [dup] = await db.select().from(plantings).where(and(eq(plantings.farmId, farm.id), eq(plantings.clientId, body.clientId))).limit(1);
    if (dup) return json({ planting: dup, duplicate: true });
  }
  const [p] = await db
    .insert(plantings)
    .values({ ...body, varietyId: body.varietyId ?? null, plantedArea: String(body.plantedArea), season: body.season ?? null, notes: body.notes ?? null, clientId: body.clientId ?? null })
    .onConflictDoNothing()
    .returning();
  if (!p && body.clientId) {
    const [dup] = await db.select().from(plantings).where(and(eq(plantings.farmId, farm.id), eq(plantings.clientId, body.clientId))).limit(1);
    if (dup) return json({ planting: dup, duplicate: true });
  }
  if (!p) throw conflict("Could not create planting");
  await logActivity(farm.id, user.id, "planting", `${crop.name} planting recorded (${body.plantedArea} ${body.areaUnit}, planted ${body.plantingDate})`, p.id);
  return json({ planting: p }, 201);
});
