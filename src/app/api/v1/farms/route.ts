import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { farms } from "@/db/schema";
import { requireUser } from "@/server/auth";
import { accessibleFarms } from "@/server/access";
import { conflict, handle, json, parseBody } from "@/server/http";
import { logActivity } from "@/server/services/support";
import { farmInput } from "@/server/validators";

export const dynamic = "force-dynamic";

/** GET /api/v1/farms?archived=1 — farms the user owns or is a member of. */
export const GET = handle(async (req: Request) => {
  const user = await requireUser();
  const archived = new URL(req.url).searchParams.get("archived") === "1";
  const list = await accessibleFarms(user, archived);
  return json({ farms: list });
});

/** POST /api/v1/farms — idempotent when `clientId` is supplied (offline queue replays). */
export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const body = await parseBody(req, farmInput);
  if (body.clientId) {
    const [dup] = await db.select().from(farms).where(and(eq(farms.ownerId, user.id), eq(farms.clientId, body.clientId))).limit(1);
    if (dup) return json({ farm: dup, duplicate: true }, 200);
  }
  const [farm] = await db
    .insert(farms)
    .values({
      ownerId: user.id,
      name: body.name,
      locationName: body.locationName ?? null,
      latitude: body.latitude.toFixed(6),
      longitude: body.longitude.toFixed(6),
      size: String(body.size),
      areaUnit: body.areaUnit,
      soilType: body.soilType ?? null,
      irrigation: body.irrigation,
      elevationM: body.elevationM != null ? String(body.elevationM) : null,
      clientId: body.clientId ?? null,
    })
    .onConflictDoNothing()
    .returning();
  if (!farm && body.clientId) {
    const [dup] = await db.select().from(farms).where(and(eq(farms.ownerId, user.id), eq(farms.clientId, body.clientId))).limit(1);
    if (dup) return json({ farm: dup, duplicate: true }, 200);
  }
  if (!farm) throw conflict("Could not create farm");
  await logActivity(farm.id, user.id, "farm", `Farm "${farm.name}" registered`);
  return json({ farm }, 201);
});
