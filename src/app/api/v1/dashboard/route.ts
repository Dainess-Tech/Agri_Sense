import { and, count, desc, eq, inArray, isNull, notInArray } from "drizzle-orm";
import { db } from "@/db";
import { crops, farmActivities, farmRisks, iotDevices, notifications, plantings, predictions } from "@/db/schema";
import { requireUser } from "@/server/auth";
import { accessibleFarms } from "@/server/access";
import { handle, json } from "@/server/http";
import { evaluateFarm } from "@/server/services/intelligence";
import { latestReadings } from "@/server/services/sensors";
import { deviceStatus } from "@/modules/iot/validation";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/dashboard?farmId= — database-only overview (fast). Weather & soil are
 * loaded lazily by the client from /farms/{id}/weather and /farms/{id}/soil.
 */
export const GET = handle(async (req: Request) => {
  const user = await requireUser();
  const farmList = await accessibleFarms(user);
  const [{ unread }] = await db.select({ unread: count() }).from(notifications).where(and(eq(notifications.userId, user.id), isNull(notifications.readAt)));
  if (!farmList.length) return json({ farms: [], selectedFarmId: null, totals: { farms: 0, activePlantings: 0, devices: 0, devicesOnline: 0, activeRisks: 0, unread }, selected: null });

  const ids = farmList.map((f) => f.id);
  const requested = new URL(req.url).searchParams.get("farmId");
  const selected = farmList.find((f) => f.id === requested) ?? farmList[0];
  void evaluateFarm(selected.id).catch(() => {}); // lightweight scheduler: keeps risks & device status fresh

  const [activeRows, allDevices, [{ risks: activeRiskCount }]] = await Promise.all([
    db
      .select({ p: plantings, cropName: crops.name })
      .from(plantings)
      .innerJoin(crops, eq(crops.id, plantings.cropId))
      .where(and(inArray(plantings.farmId, ids), notInArray(plantings.status, ["planned", "harvested", "failed"])))
      .orderBy(desc(plantings.plantingDate)),
    db.select().from(iotDevices).where(inArray(iotDevices.farmId, ids)),
    db.select({ risks: count() }).from(farmRisks).where(and(inArray(farmRisks.farmId, ids), eq(farmRisks.active, true))),
  ]);

  const [latestPreds, risks, activities, latest] = await Promise.all([
    db.select().from(predictions).where(eq(predictions.farmId, selected.id)).orderBy(desc(predictions.createdAt)).limit(5),
    db.select().from(farmRisks).where(and(eq(farmRisks.farmId, selected.id), eq(farmRisks.active, true))).orderBy(desc(farmRisks.detectedAt)).limit(10),
    db.select().from(farmActivities).where(eq(farmActivities.farmId, selected.id)).orderBy(desc(farmActivities.occurredAt)).limit(8),
    latestReadings(selected.id),
  ]);

  const devices = allDevices.map(({ apiKeyHash: _h, ...d }) => ({ ...d, status: deviceStatus(d.lastSeenAt, d.intervalSec) }));
  const seasons = [...new Set(activeRows.map((r) => r.p.season).filter(Boolean))];
  return json({
    farms: farmList.map((f) => ({ id: f.id, name: f.name })),
    selectedFarmId: selected.id,
    totals: {
      farms: farmList.length,
      activePlantings: activeRows.length,
      devices: devices.length,
      devicesOnline: devices.filter((d) => d.status === "online").length,
      activeRisks: activeRiskCount,
      unread,
    },
    seasons,
    selected: {
      farm: selected,
      plantings: activeRows.filter((r) => r.p.farmId === selected.id).map((r) => ({ ...r.p, cropName: r.cropName })),
      predictions: latestPreds,
      risks,
      activities,
      latestReadings: latest,
      devices: devices.filter((d) => d.farmId === selected.id),
    },
  });
});
