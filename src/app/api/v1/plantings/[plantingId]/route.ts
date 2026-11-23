import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { crops, plantings } from "@/db/schema";
import { requireUser, type User } from "@/server/auth";
import { getFarmForUser } from "@/server/access";
import { conflict, handle, json, notFound, parseBody } from "@/server/http";
import { logActivity } from "@/server/services/support";
import { plantingPatch, UUID_RE } from "@/server/validators";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ plantingId: string }> };

async function load(user: User, id: string, mode: "read" | "write") {
  if (!UUID_RE.test(id)) throw notFound("Planting not found");
  const [row] = await db.select({ p: plantings, cropName: crops.name }).from(plantings).innerJoin(crops, eq(crops.id, plantings.cropId)).where(eq(plantings.id, id)).limit(1);
  if (!row) throw notFound("Planting not found");
  const farm = await getFarmForUser(user, row.p.farmId, mode);
  return { ...row, farm };
}

export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const { p, cropName } = await load(user, (await ctx.params).plantingId, "read");
  return json({ planting: { ...p, cropName } });
});

/** PATCH with optimistic concurrency (`version`). Records harvest dates & quantities. */
export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const { p, cropName, farm } = await load(user, (await ctx.params).plantingId, "write");
  const body = await parseBody(req, plantingPatch);
  const { version, plantedArea, actualYield, ...rest } = body;
  const [updated] = await db
    .update(plantings)
    .set({
      ...rest,
      ...(plantedArea !== undefined && { plantedArea: String(plantedArea) }),
      ...(actualYield !== undefined && { actualYield: actualYield === null ? null : String(actualYield) }),
      version: sql`${plantings.version} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(plantings.id, p.id), eq(plantings.version, version)))
    .returning();
  if (!updated) {
    const [current] = await db.select().from(plantings).where(eq(plantings.id, p.id)).limit(1);
    throw conflict("This planting was changed elsewhere. Review the latest version.", { current });
  }
  const desc =
    body.status === "harvested" && body.actualYield != null
      ? `${cropName} harvested: ${body.actualYield} ${body.actualYieldUnit ?? "t"}`
      : body.status && body.status !== p.status
        ? `${cropName} status changed to ${body.status}`
        : `${cropName} planting updated`;
  await logActivity(farm.id, user.id, body.status === "harvested" ? "harvest" : "planting", desc, p.id);
  return json({ planting: updated });
});

export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const { p, cropName, farm } = await load(user, (await ctx.params).plantingId, "write");
  await db.delete(plantings).where(eq(plantings.id, p.id));
  await logActivity(farm.id, user.id, "planting", `${cropName} planting deleted`);
  return json(null, 204);
});
