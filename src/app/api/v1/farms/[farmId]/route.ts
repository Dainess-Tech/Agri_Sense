import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { farms } from "@/db/schema";
import { requireUser } from "@/server/auth";
import { canEditFarm, getFarmForUser } from "@/server/access";
import { conflict, forbidden, handle, json, parseBody } from "@/server/http";
import { audit, logActivity } from "@/server/services/support";
import { farmPatch } from "@/server/validators";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ farmId: string }> };

export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const farm = await getFarmForUser(user, (await ctx.params).farmId, "read");
  return json({ farm, canEdit: await canEditFarm(user, farm.id) });
});

/**
 * PATCH with optimistic concurrency: client must send the `version` it last saw.
 * If the record changed meanwhile → 409 with the current server copy (no silent overwrite).
 */
export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const farm = await getFarmForUser(user, (await ctx.params).farmId, "write");
  const body = await parseBody(req, farmPatch);
  const { version, archived, latitude, longitude, size, elevationM, ...rest } = body;
  const [updated] = await db
    .update(farms)
    .set({
      ...rest,
      ...(latitude !== undefined && { latitude: latitude.toFixed(6) }),
      ...(longitude !== undefined && { longitude: longitude.toFixed(6) }),
      ...(size !== undefined && { size: String(size) }),
      ...(elevationM !== undefined && { elevationM: elevationM === null ? null : String(elevationM) }),
      ...(archived !== undefined && { archivedAt: archived ? new Date() : null }),
      version: sql`${farms.version} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(farms.id, farm.id), eq(farms.version, version)))
    .returning();
  if (!updated) {
    const [current] = await db.select().from(farms).where(eq(farms.id, farm.id)).limit(1);
    throw conflict("This farm was changed elsewhere. Review the latest version before saving.", { current });
  }
  await logActivity(farm.id, user.id, "farm", archived === true ? "Farm archived" : archived === false ? "Farm restored" : "Farm details updated");
  return json({ farm: updated });
});

/** DELETE permanently removes the farm and all related records (owner/admin only). Prefer archiving. */
export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const farm = await getFarmForUser(user, (await ctx.params).farmId, "write");
  if (farm.ownerId !== user.id && user.role !== "admin") throw forbidden();
  await db.delete(farms).where(eq(farms.id, farm.id));
  await audit(user.id, "farm.delete", "farm", farm.id, { name: farm.name });
  return json(null, 204);
});
