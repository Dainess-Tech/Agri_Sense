import { and, desc, eq, lt } from "drizzle-orm";
import { db } from "@/db";
import { plantings, predictionInputs, predictionRisks, predictionVersions, predictions } from "@/db/schema";
import { requireUser } from "@/server/auth";
import { getFarmForUser } from "@/server/access";
import { handle, json, notFound } from "@/server/http";
import { UUID_RE } from "@/server/validators";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ predictionId: string }> };

/** GET /api/v1/predictions/{id} — result, risks, immutable input snapshot, version and previous prediction for comparison. */
export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const id = (await ctx.params).predictionId;
  if (!UUID_RE.test(id)) throw notFound("Prediction not found");
  const [p] = await db.select().from(predictions).where(eq(predictions.id, id)).limit(1);
  if (!p) throw notFound("Prediction not found");
  const farm = await getFarmForUser(user, p.farmId);
  const [inputs] = await db.select().from(predictionInputs).where(eq(predictionInputs.predictionId, p.id));
  const risks = await db.select().from(predictionRisks).where(eq(predictionRisks.predictionId, p.id));
  const [version] = await db.select().from(predictionVersions).where(eq(predictionVersions.version, p.methodVersion));
  const [planting] = await db.select().from(plantings).where(eq(plantings.id, p.plantingId));
  const [previous] = await db
    .select({ id: predictions.id, yieldMin: predictions.yieldMin, yieldMax: predictions.yieldMax, createdAt: predictions.createdAt, methodVersion: predictions.methodVersion })
    .from(predictions)
    .where(and(eq(predictions.plantingId, p.plantingId), lt(predictions.createdAt, p.createdAt)))
    .orderBy(desc(predictions.createdAt))
    .limit(1);
  return json({ prediction: p, farm: { id: farm.id, name: farm.name, latitude: farm.latitude, longitude: farm.longitude }, planting, risks, inputs, version, previous: previous ?? null });
});
