import { and, count, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { sensorReadings } from "@/db/schema";
import { requireUser } from "@/server/auth";
import { getDeviceForUser } from "@/server/access";
import { handle, json, pageParams } from "@/server/http";
import { readingSeries } from "@/server/services/sensors";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ deviceId: string }> };

/**
 * GET /api/v1/devices/{id}/readings?page=1&limit=50&sensorType=soil_moisture — paginated raw readings
 * GET /api/v1/devices/{id}/readings?series=soil_moisture&hours=24 — downsampled chart series (valid only)
 */
export const GET = handle(async (req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const { device } = await getDeviceForUser(user, (await ctx.params).deviceId);
  const url = new URL(req.url);
  const series = url.searchParams.get("series");
  if (series) {
    const hours = Math.min(24 * 90, Math.max(1, Math.round(Number(url.searchParams.get("hours")) || 24)));
    return json({ sensorType: series, hours, series: await readingSeries({ deviceId: device.id, sensorType: series, hours }) });
  }
  const { limit, offset, page } = pageParams(url, 50, 200);
  const sensorType = url.searchParams.get("sensorType");
  const where = sensorType ? and(eq(sensorReadings.deviceId, device.id), eq(sensorReadings.sensorType, sensorType)) : eq(sensorReadings.deviceId, device.id);
  const [rows, [{ total }]] = await Promise.all([
    db.select().from(sensorReadings).where(where).orderBy(desc(sensorReadings.measuredAt)).limit(limit).offset(offset),
    db.select({ total: count() }).from(sensorReadings).where(where),
  ]);
  return json({ readings: rows, page, limit, total });
});
