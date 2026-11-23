import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { cropVarieties, crops, farmRisks, iotDevices, plantings, predictions, recommendations, sensorReadings, soilProfiles } from "@/db/schema";
import { requireUser } from "@/server/auth";
import { getFarmForUser } from "@/server/access";
import { ApiError, badRequest, handle, json, notFound } from "@/server/http";
import { latestReadings } from "@/server/services/sensors";
import { getHistory } from "@/server/services/weather";
import { addDays } from "@/modules/shared/units";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ farmId: string }> };

const esc = (v: unknown) => {
  if (v === null || v === undefined) return "";
  let s = v instanceof Date ? v.toISOString() : String(v);
  // Prevent spreadsheet formula injection from user-controlled fields.
  if (/^[=+@\t\r]/.test(s) || /^-[^0-9]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Parse a YYYY-MM-DD query parameter, returning 400 instead of a DB error. */
function dateParam(raw: string | null, fallback: string): string {
  if (raw === null) return fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw badRequest("Dates must use YYYY-MM-DD format.");
  const d = new Date(`${raw}T00:00:00Z`);
  if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw) throw badRequest("Invalid date.");
  return raw;
}

function csv(name: string, title: string, header: string[], rows: unknown[][]) {
  const lines = [`# AgriSense ${title}`, `# Generated ${new Date().toISOString()} (UTC). Units are given per column.`, header.join(","), ...rows.map((r) => r.map(esc).join(","))];
  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.csv"` },
  });
}

/**
 * GET /api/v1/reports/farms/{id}?type=summary|readings|weather|plantings|predictions&format=csv|json&from=&to=
 * summary (JSON) powers the printable PDF report page.
 */
export const GET = handle(async (req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const farm = await getFarmForUser(user, (await ctx.params).farmId);
  const url = new URL(req.url);
  const type = url.searchParams.get("type") ?? "summary";
  const slug = farm.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const today = new Date().toISOString().slice(0, 10);

  switch (type) {
    case "summary": {
      const [plist, preds, risks, recs, latest, devices] = await Promise.all([
        db.select({ p: plantings, cropName: crops.name, varietyName: cropVarieties.name }).from(plantings).innerJoin(crops, eq(crops.id, plantings.cropId)).leftJoin(cropVarieties, eq(cropVarieties.id, plantings.varietyId)).where(eq(plantings.farmId, farm.id)).orderBy(desc(plantings.plantingDate)),
        db.select().from(predictions).where(eq(predictions.farmId, farm.id)).orderBy(desc(predictions.createdAt)).limit(20),
        db.select().from(farmRisks).where(eq(farmRisks.farmId, farm.id)).orderBy(desc(farmRisks.detectedAt)).limit(30),
        db.select().from(recommendations).where(eq(recommendations.farmId, farm.id)).orderBy(desc(recommendations.createdAt)).limit(20),
        latestReadings(farm.id),
        db.select({ name: iotDevices.name, uid: iotDevices.deviceUid, lastSeenAt: iotDevices.lastSeenAt }).from(iotDevices).where(eq(iotDevices.farmId, farm.id)),
      ]);
      const [soil] = await db.select().from(soilProfiles).where(eq(soilProfiles.cacheKey, `soil:${Number(farm.latitude).toFixed(3)}:${Number(farm.longitude).toFixed(3)}`));
      return json({
        generatedAt: new Date().toISOString(),
        farm,
        plantings: plist.map((r) => ({ ...r.p, cropName: r.cropName, varietyName: r.varietyName })),
        predictions: preds,
        risks,
        recommendations: recs,
        latestReadings: latest,
        devices,
        soil: soil ?? null,
      });
    }
    case "readings": {
      const from = dateParam(url.searchParams.get("from"), addDays(today, -30));
      const to = dateParam(url.searchParams.get("to"), today);
      const rows = await db
        .select({ r: sensorReadings, device: iotDevices.name })
        .from(sensorReadings)
        .innerJoin(iotDevices, eq(iotDevices.id, sensorReadings.deviceId))
        .where(and(eq(sensorReadings.farmId, farm.id), gte(sensorReadings.measuredAt, new Date(from + "T00:00:00Z")), lte(sensorReadings.measuredAt, new Date(to + "T23:59:59Z"))))
        .orderBy(asc(sensorReadings.measuredAt))
        .limit(100_000);
      return csv(`${slug}-sensor-readings`, `sensor readings for ${farm.name} (${from} to ${to})`, ["measured_at_utc", "received_at_utc", "device", "sensor_type", "value", "unit", "quality", "quality_note"], rows.map(({ r, device }) => [r.measuredAt, r.receivedAt, device, r.sensorType, r.value, r.unit, r.quality, r.qualityNote]));
    }
    case "weather": {
      const days = Math.min(365, Math.max(1, Math.floor(Number(url.searchParams.get("days")) || 90)));
      const end = addDays(today, -6);
      try {
        const h = await getHistory(Number(farm.latitude), Number(farm.longitude), addDays(end, -days), end);
        return csv(`${slug}-weather-history`, `historical weather for ${farm.name} — Open-Meteo archive (modelled, retrieved ${h.retrievedAt})`, ["date", "t_max_c", "t_min_c", "precipitation_mm", "wind_max_kmh", "et0_mm", "data_type"], h.daily.map((d) => [d.date, d.tMax, d.tMin, d.precipMm, d.windMaxKmh, d.et0Mm, "modelled"]));
      } catch (e) {
        throw new ApiError(503, `Weather provider unavailable: ${(e as Error).message}`);
      }
    }
    case "plantings": {
      const rows = await db.select({ p: plantings, cropName: crops.name, varietyName: cropVarieties.name }).from(plantings).innerJoin(crops, eq(crops.id, plantings.cropId)).leftJoin(cropVarieties, eq(cropVarieties.id, plantings.varietyId)).where(eq(plantings.farmId, farm.id)).orderBy(asc(plantings.plantingDate));
      return csv(`${slug}-plantings`, `planting & harvest records for ${farm.name}`, ["crop", "variety", "season", "planting_date", "planted_area", "area_unit", "irrigation", "status", "actual_harvest_date", "actual_yield", "yield_unit"], rows.map(({ p, cropName, varietyName }) => [cropName, varietyName, p.season, p.plantingDate, p.plantedArea, p.areaUnit, p.irrigation, p.status, p.actualHarvestDate, p.actualYield, p.actualYieldUnit]));
    }
    case "predictions": {
      const rows = await db.select().from(predictions).where(eq(predictions.farmId, farm.id)).orderBy(asc(predictions.createdAt));
      return csv(`${slug}-predictions`, `yield predictions for ${farm.name}`, ["generated_at_utc", "crop", "yield_min", "yield_max", "yield_unit", "total_min", "total_max", "total_unit", "harvest_start", "harvest_end", "data_quality_score", "method_version"], rows.map((p) => [p.createdAt, p.cropName, p.yieldMin, p.yieldMax, p.yieldUnit, p.totalMin, p.totalMax, p.totalUnit, p.harvestStart, p.harvestEnd, p.dataQualityScore, p.methodVersion]));
    }
    default:
      throw notFound("Unknown report type");
  }
});
