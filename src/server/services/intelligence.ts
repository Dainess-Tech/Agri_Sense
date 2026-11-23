import "server-only";
import { and, desc, eq, inArray, notInArray } from "drizzle-orm";
import { db } from "@/db";
import {
  cropVarieties,
  crops,
  farmRisks,
  farms,
  iotDevices,
  plantings,
  predictionInputs,
  predictionRisks,
  predictions,
  recommendations,
} from "@/db/schema";
import { deviceStatus } from "@/modules/iot/validation";
import { predictYield, PredictionValidationError, type CropParams } from "@/modules/prediction-engine/engine";
import { evaluateRisks, type EngineRisk } from "@/modules/risk-engine/rules";
import { addDays, daysBetween } from "@/modules/shared/units";
import type { User } from "../auth";
import { getFarmForUser } from "../access";
import { ApiError, notFound } from "../http";
import { notify } from "./notifications";
import { summarizeSensors } from "./sensors";
import { getSoil, soilSummary, SOIL_PROVIDER, type SoilProfile } from "./soil";
import { getForecast, getSeasonWeather } from "./weather";
import { getRuleFor, ensureSeed } from "./seed";
import { getRiskThresholds } from "./settings";
import { logActivity } from "./support";

type CropRow = typeof crops.$inferSelect;
export function cropParams(c: CropRow): CropParams {
  const n = Number;
  return {
    slug: c.slug, name: c.name, yieldUnit: c.yieldUnit,
    baseYieldMin: n(c.baseYieldMin), baseYieldMax: n(c.baseYieldMax),
    maturityDaysMin: c.maturityDaysMin, maturityDaysMax: c.maturityDaysMax,
    baseTempC: n(c.baseTempC), gddToMaturity: c.gddToMaturity,
    tempOptMin: n(c.tempOptMin), tempOptMax: n(c.tempOptMax),
    tempCriticalLow: n(c.tempCriticalLow), tempCriticalHigh: n(c.tempCriticalHigh),
    waterNeedMinMm: c.waterNeedMinMm, waterNeedMaxMm: c.waterNeedMaxMm,
    soilMoistureMin: n(c.soilMoistureMin), soilMoistureMax: n(c.soilMoistureMax),
    phMin: n(c.phMin), phMax: n(c.phMax),
  };
}

const ACTIVE_STATUSES = ["planned", "harvested", "failed"] as const;
const lastEval = new Map<string, number>();
const inFlight = new Map<string, Promise<EvalResult>>();
type EvalResult = { skipped: boolean; created?: number; resolved?: number };

/** Coalesces concurrent evaluations and clears the throttle when a run fails. */
export async function evaluateFarm(farmId: string, opts: { force?: boolean } = {}): Promise<EvalResult> {
  const running = inFlight.get(farmId);
  if (running) return running;
  const run = runEvaluation(farmId, opts)
    .catch((e) => {
      lastEval.delete(farmId);
      throw e;
    })
    .finally(() => inFlight.delete(farmId));
  inFlight.set(farmId, run);
  return run;
}

/**
 * Evaluates crop-specific risk rules for every active planting on a farm,
 * maintains the farm_risks history, raises recommendations + notifications for
 * new risks, resolves risks that no longer apply, checks device connectivity
 * and harvest-window reminders. Throttled to once per 10 min unless forced.
 */
async function runEvaluation(farmId: string, opts: { force?: boolean } = {}): Promise<EvalResult> {
  const now = Date.now();
  if (!opts.force && now - (lastEval.get(farmId) ?? 0) < 10 * 60_000) return { skipped: true };
  await ensureSeed();
  const [farm] = await db.select().from(farms).where(eq(farms.id, farmId)).limit(1);
  if (!farm) return { skipped: true };
  const lat = Number(farm.latitude);
  const lng = Number(farm.longitude);
  const today = new Date().toISOString().slice(0, 10);

  // Device connectivity
  const devices = await db.select().from(iotDevices).where(and(eq(iotDevices.farmId, farmId), eq(iotDevices.active, true)));
  for (const d of devices) {
    if (deviceStatus(d.lastSeenAt, d.intervalSec) === "offline" && (!d.offlineNotifiedAt || (d.lastSeenAt && d.offlineNotifiedAt < d.lastSeenAt))) {
      await notify(farm.ownerId, { type: "device", severity: "medium", title: `Device "${d.name}" stopped reporting`, body: `No measurements received from ${d.name} since ${d.lastSeenAt?.toISOString().replace("T", " ").slice(0, 16)} UTC. Check power and Wi-Fi.`, link: `/devices`, farmId, dedupeKey: `device-offline:${d.id}:${d.lastSeenAt?.getTime()}`, dedupeHours: 24 * 30 });
      await db.update(iotDevices).set({ offlineNotifiedAt: new Date() }).where(eq(iotDevices.id, d.id));
    }
  }

  const rows = await db
    .select({ p: plantings, c: crops })
    .from(plantings)
    .innerJoin(crops, eq(crops.id, plantings.cropId))
    .where(and(eq(plantings.farmId, farmId), notInArray(plantings.status, [...ACTIVE_STATUSES])));

  const available = new Set<EngineRisk["source"]>();
  let daily: Awaited<ReturnType<typeof getForecast>>["daily"] = [];
  try {
    daily = (await getForecast(lat, lng)).daily;
    available.add("forecast").add("history");
  } catch (e) {
    console.warn("[risk] forecast unavailable", e);
  }
  let soil: SoilProfile | null = null;
  try {
    soil = await getSoil(lat, lng);
    available.add("soil");
  } catch (e) {
    console.warn("[risk] soil unavailable", e);
  }
  const sensors = await summarizeSensors(farmId);
  if (sensors) available.add("sensor");
  const thresholds = await getRiskThresholds();

  const seenKeys: string[] = [];
  let created = 0;
  for (const { p, c } of rows) {
    const risks = evaluateRisks({ crop: cropParams(c), irrigation: p.irrigation, plantingDate: p.plantingDate, asOf: today, daily, sensors, soil: soilSummary(soil) }, thresholds);
    for (const r of risks) {
      const key = `${farmId}:${p.id}:${r.category}`;
      seenKeys.push(key);
      const [existing] = await db.select().from(farmRisks).where(and(eq(farmRisks.dedupeKey, key), eq(farmRisks.active, true))).limit(1);
      if (existing) {
        await db.update(farmRisks).set({ severity: r.severity, title: r.title, explanation: r.explanation, lastSeenAt: new Date() }).where(eq(farmRisks.id, existing.id));
        continue;
      }
      created++;
      const [risk] = await db.insert(farmRisks).values({ farmId, plantingId: p.id, category: r.category, severity: r.severity, title: r.title, explanation: r.explanation, source: r.source, dedupeKey: key }).returning();
      const rule = await getRuleFor(r.category);
      if (rule?.active) {
        await db.insert(recommendations).values({ farmId, plantingId: p.id, riskId: risk.id, ruleCode: rule.code, title: rule.title, body: rule.body, reason: `${c.name}: ${r.explanation}`, severity: r.severity, requiresExpert: rule.requiresExpert });
      }
      await notify(farm.ownerId, { type: "risk", severity: r.severity, title: `${farm.name}: ${r.title}`, body: r.explanation, link: `/farms/${farmId}?tab=risks`, farmId, dedupeKey: key, dedupeHours: 48 });
    }
    // Harvest-window reminder from latest prediction
    const [pred] = await db.select().from(predictions).where(eq(predictions.plantingId, p.id)).orderBy(desc(predictions.createdAt)).limit(1);
    if (pred && daysBetween(today, pred.harvestStart) <= 7 && daysBetween(today, pred.harvestEnd) >= 0) {
      await notify(farm.ownerId, { type: "harvest", severity: "info", title: `${c.name} harvest window approaching`, body: `Estimated harvest window for ${c.name} on ${farm.name}: ${pred.harvestStart} to ${pred.harvestEnd}.`, link: `/predictions/${pred.id}`, farmId, dedupeKey: `harvest:${p.id}:${pred.harvestStart}`, dedupeHours: 24 * 14 });
    }
  }

  // Resolve active risks no longer detected — only where the underlying data source was available.
  const active = await db.select().from(farmRisks).where(and(eq(farmRisks.farmId, farmId), eq(farmRisks.active, true)));
  const toResolve = active.filter((r) => !seenKeys.includes(r.dedupeKey) && available.has(r.source as EngineRisk["source"]));
  if (toResolve.length) {
    await db.update(farmRisks).set({ active: false, resolvedAt: new Date() }).where(inArray(farmRisks.id, toResolve.map((r) => r.id)));
  }
  // Only mark the throttle as satisfied after a complete, successful run.
  lastEval.set(farmId, Date.now());
  return { skipped: false, created, resolved: toResolve.length };
}

/** Generates and persists a yield prediction for a planting, with a full input snapshot. */
export async function generatePrediction(user: User, plantingId: string) {
  await ensureSeed();
  const [row] = await db
    .select({ p: plantings, c: crops, v: cropVarieties })
    .from(plantings)
    .innerJoin(crops, eq(crops.id, plantings.cropId))
    .leftJoin(cropVarieties, eq(cropVarieties.id, plantings.varietyId))
    .where(eq(plantings.id, plantingId))
    .limit(1);
  if (!row) throw notFound("Planting not found");
  const farm = await getFarmForUser(user, row.p.farmId, "read");
  const lat = Number(farm.latitude);
  const lng = Number(farm.longitude);
  const asOf = new Date().toISOString().slice(0, 10);

  let season: Awaited<ReturnType<typeof getSeasonWeather>> | null = null;
  try {
    season = await getSeasonWeather(lat, lng, row.p.plantingDate);
  } catch (e) {
    console.warn("[prediction] weather unavailable", e);
  }
  if (!season) {
    throw new ApiError(503, "A new prediction cannot be generated right now because weather data is unavailable (provider offline or no internet). Previously generated predictions remain viewable.", undefined, "data_unavailable");
  }
  let soil: SoilProfile | null = null;
  let soilError: string | null = null;
  try {
    soil = await getSoil(lat, lng);
  } catch (e) {
    soilError = (e as Error).message;
  }
  const sensors = await summarizeSensors(farm.id);
  const thresholds = await getRiskThresholds();
  const crop = cropParams(row.c);
  const variety = row.v ? { name: row.v.name, maturityFactor: Number(row.v.maturityFactor), yieldFactor: Number(row.v.yieldFactor) } : null;
  const input = {
    crop,
    variety,
    plantingDate: row.p.plantingDate,
    asOf,
    plantedArea: Number(row.p.plantedArea),
    areaUnit: row.p.areaUnit,
    irrigation: row.p.irrigation,
    weather: season.daily.map(({ date, tMax, tMin, precipMm, kind }) => ({ date, tMax, tMin, precipMm, kind })),
    soil: soilSummary(soil),
    sensors,
    thresholds,
  };

  let result;
  try {
    result = predictYield(input);
  } catch (e) {
    if (e instanceof PredictionValidationError) throw new ApiError(422, e.message, undefined, "validation_failed");
    throw e;
  }
  if (soil && !soil.available) result.limitations.unshift("SoilGrids has no modelled soil data for this exact location (e.g. urban area or water body).");
  if (soilError) result.limitations.unshift(`Soil data provider unavailable: ${soilError}`);
  if (season.forecast.stale) result.limitations.unshift("Weather forecast came from an older cached copy because the provider was unreachable.");

  const pred = await db.transaction(async (tx) => {
    const [p] = await tx
      .insert(predictions)
      .values({
        farmId: farm.id, plantingId: row.p.id, userId: user.id, cropName: row.c.name,
        yieldMin: String(result.yieldMin), yieldMax: String(result.yieldMax), yieldUnit: result.yieldUnit,
        totalMin: String(result.totalMin), totalMax: String(result.totalMax), totalUnit: result.totalUnit,
        harvestStart: result.harvestStart, harvestEnd: result.harvestEnd,
        dataQualityScore: result.dataQuality.score, methodVersion: result.version,
        conditionsSummary: { ...result.conditions, growthProgressPct: result.growthProgressPct, areaHa: result.areaHa, dataQuality: result.dataQuality },
        factors: result.factors, suitability: result.suitability, advisories: result.advisories, limitations: result.limitations,
      })
      .returning();
    await tx.insert(predictionInputs).values({
      predictionId: p.id,
      snapshot: { ...input, farm: { id: farm.id, name: farm.name, latitude: lat, longitude: lng } },
      sources: {
        weather: season!.sources,
        soil: soil ? { provider: SOIL_PROVIDER, retrievedAt: soil.retrievedAt, available: soil.available, dataType: "modelled" } : { error: soilError },
        sensors: sensors ? { lastValidReadingAt: sensors.lastValidReadingAt, dataType: "measured", window: "7 days" } : null,
        cropParameters: { source: "AgriSense crop catalogue", slug: crop.slug },
        engine: { version: result.version, method: result.method },
      },
    });
    if (result.risks.length) {
      await tx.insert(predictionRisks).values(result.risks.map((r) => ({ predictionId: p.id, category: r.category, severity: r.severity, explanation: `${r.title}. ${r.explanation}` })));
    }
    return p;
  });

  await logActivity(farm.id, user.id, "prediction", `Yield prediction generated for ${row.c.name}: ${result.yieldMin}–${result.yieldMax} ${result.yieldUnit}`, row.p.id);
  await notify(farm.ownerId, { type: "prediction", severity: "info", title: `New ${row.c.name} prediction ready`, body: `${farm.name}: ${result.yieldMin}–${result.yieldMax} ${result.yieldUnit}, harvest ${result.harvestStart} to ${result.harvestEnd}.`, link: `/predictions/${pred.id}`, farmId: farm.id });
  void evaluateFarm(farm.id).catch(() => {});
  return pred;
}

export const addDaysIso = addDays;
