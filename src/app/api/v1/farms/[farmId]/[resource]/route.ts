import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { crops, farmActivities, farmRisks, plantings, predictions, recommendations, users } from "@/db/schema";
import { requireUser } from "@/server/auth";
import { getFarmForUser } from "@/server/access";
import { ApiError, handle, json, notFound, pageParams, parseBody } from "@/server/http";
import { evaluateFarm } from "@/server/services/intelligence";
import { latestReadings, readingSeries } from "@/server/services/sensors";
import { getSoil, soilIsStale, SOIL_PROVIDER } from "@/server/services/soil";
import { getForecast, getHistory } from "@/server/services/weather";
import { addDays } from "@/modules/shared/units";
import { SENSOR_CODES } from "@/modules/iot/validation";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ farmId: string; resource: string }> };

export const GET = handle(async (req: Request, ctx: Ctx) => {
  const { farmId, resource } = await ctx.params;
  const user = await requireUser();
  const farm = await getFarmForUser(user, farmId, "read");
  const url = new URL(req.url);
  const lat = Number(farm.latitude);
  const lng = Number(farm.longitude);

  switch (resource) {
    case "weather": {
      const historyDays = Math.min(365, Number(url.searchParams.get("historyDays")) || 0);
      try {
        if (historyDays > 0) {
          const end = addDays(new Date().toISOString().slice(0, 10), -6);
          const h = await getHistory(lat, lng, addDays(end, -historyDays), end);
          return json({ provider: "Open-Meteo archive (ERA5)", dataType: "modelled", ...h });
        }
        return json({ ...(await getForecast(lat, lng)), dataTypes: { past: "modelled", future: "forecast" } });
      } catch (e) {
        throw new ApiError(503, `Weather provider unavailable: ${(e as Error).message}`, undefined, "provider_unavailable");
      }
    }
    case "soil": {
      try {
        const soil = await getSoil(lat, lng);
        return json({ soil, provider: SOIL_PROVIDER, dataType: "modelled", license: "CC BY 4.0", stale: soilIsStale(soil) });
      } catch (e) {
        throw new ApiError(503, `Soil data provider unavailable: ${(e as Error).message}`, undefined, "provider_unavailable");
      }
    }
    case "risks": {
      if (url.searchParams.get("refresh") === "1") await evaluateFarm(farm.id, { force: true });
      const includeResolved = url.searchParams.get("history") === "1";
      const rows = await db
        .select({ risk: farmRisks, cropName: crops.name })
        .from(farmRisks)
        .leftJoin(plantings, eq(plantings.id, farmRisks.plantingId))
        .leftJoin(crops, eq(crops.id, plantings.cropId))
        .where(includeResolved ? eq(farmRisks.farmId, farm.id) : and(eq(farmRisks.farmId, farm.id), eq(farmRisks.active, true)))
        .orderBy(desc(farmRisks.detectedAt))
        .limit(200);
      return json({ risks: rows.map((r) => ({ ...r.risk, cropName: r.cropName })) });
    }
    case "recommendations": {
      const status = url.searchParams.get("status");
      const rows = await db
        .select({ rec: recommendations, cropName: crops.name })
        .from(recommendations)
        .leftJoin(plantings, eq(plantings.id, recommendations.plantingId))
        .leftJoin(crops, eq(crops.id, plantings.cropId))
        .where(status ? and(eq(recommendations.farmId, farm.id), eq(recommendations.status, status)) : eq(recommendations.farmId, farm.id))
        .orderBy(desc(recommendations.createdAt))
        .limit(200);
      return json({ recommendations: rows.map((r) => ({ ...r.rec, cropName: r.cropName, farmName: farm.name })) });
    }
    case "activities": {
      const { limit, offset, page } = pageParams(url, 30, 100);
      const rows = await db
        .select({ a: farmActivities, userName: users.fullName })
        .from(farmActivities)
        .leftJoin(users, eq(users.id, farmActivities.userId))
        .where(eq(farmActivities.farmId, farm.id))
        .orderBy(desc(farmActivities.occurredAt))
        .limit(limit)
        .offset(offset);
      return json({ activities: rows.map((r) => ({ ...r.a, userName: r.userName })), page, limit });
    }
    case "readings": {
      const sensorType = url.searchParams.get("sensorType");
      if (!sensorType) return json({ latest: await latestReadings(farm.id) });
      if (!SENSOR_CODES.includes(sensorType)) throw new ApiError(422, "Unknown sensor type");
      const hours = Math.min(24 * 90, Math.max(1, Math.round(Number(url.searchParams.get("hours")) || 24)));
      return json({ sensorType, hours, series: await readingSeries({ farmId: farm.id, sensorType, hours }) });
    }
    case "predictions": {
      const rows = await db.select().from(predictions).where(eq(predictions.farmId, farm.id)).orderBy(desc(predictions.createdAt)).limit(100);
      return json({ predictions: rows });
    }
    case "summary": {
      const [stats] = (
        await db.execute<{ plantings: string; devices: string; readings: string }>(sql`
          select (select count(*) from plantings where farm_id = ${farm.id}) as plantings,
                 (select count(*) from iot_devices where farm_id = ${farm.id}) as devices,
                 (select count(*) from sensor_readings where farm_id = ${farm.id}) as readings`)
      ).rows;
      return json({ stats });
    }
    default:
      throw notFound();
  }
});

/** POST /api/v1/farms/{id}/activities — record a farm activity (offline-queue safe). */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const { farmId, resource } = await ctx.params;
  if (resource !== "activities") throw notFound();
  const user = await requireUser();
  const farm = await getFarmForUser(user, farmId, "write");
  const body = await parseBody(
    req,
    z.object({
      type: z.enum(["planting", "weeding", "fertilizer", "spraying", "irrigation", "scouting", "harvest", "other"]),
      description: z.string().trim().min(2).max(1000),
      plantingId: z.string().uuid().nullable().optional(),
      occurredAt: z.string().datetime({ offset: true }).optional(),
    }),
  );
  if (body.plantingId) {
    const [planting] = await db.select({ id: plantings.id }).from(plantings).where(and(eq(plantings.id, body.plantingId), eq(plantings.farmId, farm.id))).limit(1);
    if (!planting) throw new ApiError(422, "Planting does not belong to this farm.");
  }
  const [a] = await db
    .insert(farmActivities)
    .values({ farmId: farm.id, userId: user.id, type: body.type, description: body.description, plantingId: body.plantingId ?? null, occurredAt: body.occurredAt ? new Date(body.occurredAt) : new Date() })
    .returning();
  return json({ activity: a }, 201);
});
