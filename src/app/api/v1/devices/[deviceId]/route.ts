import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { deviceLogs, iotDevices, sensorReadings } from "@/db/schema";
import { randomToken, requireUser, sha256 } from "@/server/auth";
import { getDeviceForUser, getFarmForUser } from "@/server/access";
import { handle, json, notFound, parseBody } from "@/server/http";
import { audit, logActivity } from "@/server/services/support";
import { deviceStatus, SENSOR_CODES } from "@/modules/iot/validation";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ deviceId: string }> };

const view = (d: typeof iotDevices.$inferSelect) => {
  const { apiKeyHash: _h, ...rest } = d;
  return { ...rest, status: deviceStatus(d.lastSeenAt, d.intervalSec) };
};

export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const { device, farm } = await getDeviceForUser(user, (await ctx.params).deviceId);
  const logs = await db.select().from(deviceLogs).where(eq(deviceLogs.deviceId, device.id)).orderBy(desc(deviceLogs.createdAt)).limit(50);
  return json({ device: { ...view(device), farmName: farm.name }, logs });
});

export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const { device } = await getDeviceForUser(user, (await ctx.params).deviceId, "write");
  const body = await parseBody(
    req,
    z.object({
      name: z.string().trim().min(2).max(80).optional(),
      intervalSec: z.number().int().min(60).max(86400).optional(),
      active: z.boolean().optional(),
      farmId: z.string().uuid().optional(),
      sensors: z.array(z.enum(SENSOR_CODES as [string, ...string[]])).optional(),
    }),
  );
  if (body.farmId && body.farmId !== device.farmId) await getFarmForUser(user, body.farmId, "write"); // reassignment requires access to target farm
  const [updated] = await db.transaction(async (tx) => {
    const [row] = await tx.update(iotDevices).set(body).where(eq(iotDevices.id, device.id)).returning();
    // Historical readings carry a farm_id copy — keep them with the device.
    if (body.farmId && body.farmId !== device.farmId) {
      await tx.update(sensorReadings).set({ farmId: body.farmId }).where(eq(sensorReadings.deviceId, device.id));
    }
    return [row];
  });
  await logActivity(updated.farmId, user.id, "device", `Device "${updated.name}" settings updated`);
  return json({ device: view(updated) });
});

/** POST { action: "rotate-key" } — issues a new device credential and invalidates the old one. */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const { device } = await getDeviceForUser(user, (await ctx.params).deviceId, "write");
  const body = await parseBody(req, z.object({ action: z.literal("rotate-key") }));
  if (body.action !== "rotate-key") throw notFound();
  const apiKey = `ask_${randomToken(24)}`;
  await db.update(iotDevices).set({ apiKeyHash: sha256(apiKey) }).where(eq(iotDevices.id, device.id));
  await audit(user.id, "device.rotate_key", "iot_device", device.id);
  return json({ apiKey });
});

export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const { device } = await getDeviceForUser(user, (await ctx.params).deviceId, "write");
  await db.delete(iotDevices).where(eq(iotDevices.id, device.id));
  await logActivity(device.farmId, user.id, "device", `Device "${device.name}" removed`);
  await audit(user.id, "device.delete", "iot_device", device.id);
  return json(null, 204);
});
