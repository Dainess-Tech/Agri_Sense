import { desc, eq, inArray } from "drizzle-orm";
import { randomBytes } from "crypto";
import { db } from "@/db";
import { farms, iotDevices } from "@/db/schema";
import { randomToken, requireUser, sha256 } from "@/server/auth";
import { accessibleFarms, getFarmForUser } from "@/server/access";
import { conflict, handle, json, parseBody } from "@/server/http";
import { audit, logActivity } from "@/server/services/support";
import { deviceInput } from "@/server/validators";
import { deviceStatus } from "@/modules/iot/validation";

export const dynamic = "force-dynamic";

function serializeDevice(d: typeof iotDevices.$inferSelect, farmName?: string) {
  const { apiKeyHash: _hidden, ...rest } = d;
  return { ...rest, farmName, status: deviceStatus(d.lastSeenAt, d.intervalSec) };
}

/** GET /api/v1/devices?farmId= */
export const GET = handle(async (req: Request) => {
  const user = await requireUser();
  const farmId = new URL(req.url).searchParams.get("farmId");
  const farmIds = farmId ? [(await getFarmForUser(user, farmId)).id] : (await accessibleFarms(user)).map((f) => f.id);
  if (!farmIds.length) return json({ devices: [] });
  const rows = await db
    .select({ d: iotDevices, farmName: farms.name })
    .from(iotDevices)
    .innerJoin(farms, eq(farms.id, iotDevices.farmId))
    .where(inArray(iotDevices.farmId, farmIds))
    .orderBy(desc(iotDevices.createdAt));
  return json({ devices: rows.map((r) => serializeDevice(r.d, r.farmName)) });
});

/** POST /api/v1/devices — registers a device; the API key is returned ONCE and stored hashed. */
export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const body = await parseBody(req, deviceInput);
  const farm = await getFarmForUser(user, body.farmId, "write");
  const deviceUid = body.deviceUid ?? `as-${randomBytes(4).toString("hex")}`;
  const [exists] = await db.select({ id: iotDevices.id }).from(iotDevices).where(eq(iotDevices.deviceUid, deviceUid)).limit(1);
  if (exists) throw conflict("A device with this ID is already registered.");
  const apiKey = `ask_${randomToken(24)}`;
  const [device] = await db
    .insert(iotDevices)
    .values({ farmId: farm.id, name: body.name, deviceUid, apiKeyHash: sha256(apiKey), hardware: body.hardware, sensors: body.sensors, intervalSec: body.intervalSec })
    .onConflictDoNothing()
    .returning();
  if (!device) throw conflict("A device with this ID is already registered.");
  await logActivity(farm.id, user.id, "device", `IoT device "${device.name}" (${deviceUid}) registered`);
  await audit(user.id, "device.register", "iot_device", device.id, { farmId: farm.id });
  return json({ device: serializeDevice(device, farm.name), apiKey }, 201);
});
