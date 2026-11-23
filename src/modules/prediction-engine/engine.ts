/**
 * AgriSense Prediction Engine — rule-based & statistical yield estimation.
 *
 * Independent module: no database, no HTTP, no framework imports.
 * Deterministic: same inputs → same outputs. Testable in isolation and
 * portable to a Python/FastAPI service later without changing the contract.
 *
 * Method summary (v1):
 *  1. Start from the crop's attainable yield range (catalogue, t/ha) × variety factor.
 *  2. Apply limiting factors (water balance, temperature, soil pH, soil texture,
 *     sensor soil moisture). Each factor is a multiplier in [0.3, 1.05].
 *  3. Widen the range according to data quality and remaining season length.
 *  4. Estimate harvest window from growing-degree-days (GDD) when temperatures
 *     are available, otherwise from catalogue maturity days.
 *  5. Run the risk rules engine on the same inputs.
 */
import { addDays, daysBetween, round, toHectares } from "../shared/units";
import {
  evaluateRisks,
  growthProgress,
  type DailyWeather,
  type EngineRisk,
  type SensorSummary,
  type SoilSummary,
} from "../risk-engine/rules";

export const ENGINE_VERSION = "agrisense-rules-1.0.0";
export const ENGINE_METHOD = "Rule-based limiting-factor model with GDD phenology";

export interface CropParams {
  slug: string;
  name: string;
  yieldUnit: string;
  baseYieldMin: number;
  baseYieldMax: number;
  maturityDaysMin: number;
  maturityDaysMax: number;
  baseTempC: number;
  gddToMaturity: number;
  tempOptMin: number;
  tempOptMax: number;
  tempCriticalLow: number;
  tempCriticalHigh: number;
  waterNeedMinMm: number;
  waterNeedMaxMm: number;
  soilMoistureMin: number;
  soilMoistureMax: number;
  phMin: number;
  phMax: number;
}

export interface PredictionInput {
  crop: CropParams;
  variety: { name: string; maturityFactor: number; yieldFactor: number } | null;
  plantingDate: string; // YYYY-MM-DD
  asOf: string; // YYYY-MM-DD
  plantedArea: number;
  areaUnit: string;
  irrigation: "rainfed" | "irrigated" | "mixed";
  weather: DailyWeather[] | null;
  soil: SoilSummary | null;
  sensors: SensorSummary | null;
}

export interface Factor {
  key: string;
  label: string;
  multiplier: number;
  impact: "positive" | "neutral" | "negative";
  explanation: string;
  dataType: "measured" | "modelled" | "forecast" | "calculated" | "assumed";
}

export interface PredictionResult {
  version: string;
  method: string;
  yieldMin: number;
  yieldMax: number;
  yieldUnit: string;
  totalMin: number;
  totalMax: number;
  totalUnit: string;
  areaHa: number;
  harvestStart: string;
  harvestEnd: string;
  growthProgressPct: number;
  dataQuality: { score: number; components: { name: string; available: boolean; weight: number; note: string }[] };
  factors: Factor[];
  risks: EngineRisk[];
  conditions: {
    rainSincePlantingMm: number | null;
    forecastRainMm: number | null;
    meanTempC: number | null;
    gddAccumulated: number | null;
    hotDays: number;
    coldDays: number;
    soilPh: number | null;
    soilPhSource: "measured" | "modelled" | null;
    soilMoistureAvg: number | null;
    soilTexture: string | null;
  };
  limitations: string[];
}

export class PredictionValidationError extends Error {}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const impactOf = (m: number): Factor["impact"] => (m > 1.001 ? "positive" : m < 0.98 ? "negative" : "neutral");

export function validateInput(input: PredictionInput): void {
  const c = input.crop;
  if (!(input.plantedArea > 0)) throw new PredictionValidationError("Planted area must be greater than zero.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.plantingDate)) throw new PredictionValidationError("Planting date must be YYYY-MM-DD.");
  if (daysBetween(input.plantingDate, input.asOf) > c.maturityDaysMax + 120)
    throw new PredictionValidationError("Planting is too old for an in-season prediction; record the actual harvest instead.");
  if (daysBetween(input.asOf, input.plantingDate) > 180)
    throw new PredictionValidationError("Planting date is more than 6 months in the future.");
  if (c.baseYieldMin <= 0 || c.baseYieldMax < c.baseYieldMin) throw new PredictionValidationError("Crop parameters are invalid.");
}

export function predictYield(input: PredictionInput): PredictionResult {
  validateInput(input);
  const { crop, irrigation } = input;
  const limitations: string[] = [];
  const factors: Factor[] = [];
  const areaHa = toHectares(input.plantedArea, input.areaUnit);
  const maturityFactor = input.variety?.maturityFactor ?? 1;
  const elapsedDays = Math.max(0, daysBetween(input.plantingDate, input.asOf));
  const midMaturity = ((crop.maturityDaysMin + crop.maturityDaysMax) / 2) * maturityFactor;
  const seasonEnd = addDays(input.plantingDate, crop.maturityDaysMax * maturityFactor);

  const daily = (input.weather ?? []).filter((d) => d.date >= input.plantingDate && d.date <= seasonEnd);
  const observed = daily.filter((d) => d.kind === "model" && d.date < input.asOf);
  const forecast = daily.filter((d) => d.kind === "forecast" && d.date >= input.asOf);
  const hasWeather = observed.length + forecast.length >= 5;
  const temps = [...observed, ...forecast].filter((d) => d.tMax !== null && d.tMin !== null);

  // ---------- Data quality ----------
  const reliableSensors = input.sensors && input.sensors.soilMoistureSamples >= 3 ? input.sensors : null;
  const components = [
    { name: "Weather history", available: observed.length > 0 || elapsedDays === 0, weight: 30, note: observed.length ? `${observed.length} days of modelled observations` : elapsedDays === 0 ? "Season not started" : "Unavailable" },
    { name: "Weather forecast", available: forecast.length > 0, weight: 20, note: forecast.length ? `${forecast.length}-day forecast` : "Unavailable" },
    { name: "Soil properties", available: !!input.soil && (input.soil.phH2o !== null || input.soil.clayPct !== null), weight: 20, note: input.soil ? "Modelled soil data (SoilGrids)" : "Unavailable" },
    { name: "Farm sensors", available: !!reliableSensors, weight: 20, note: reliableSensors ? `${reliableSensors.soilMoistureSamples} valid soil moisture readings` : "No recent valid sensor data" },
    { name: "Crop variety", available: !!input.variety, weight: 5, note: input.variety ? input.variety.name : "Generic crop parameters used" },
    { name: "Planting record", available: true, weight: 5, note: `Planted ${input.plantingDate}` },
  ];
  const score = components.reduce((a, c) => a + (c.available ? c.weight : 0), 0);

  // ---------- Water balance factor ----------
  const rainObserved = observed.reduce((a, d) => a + (d.precipMm ?? 0), 0);
  const rainForecast = forecast.reduce((a, d) => a + (d.precipMm ?? 0), 0);
  const windowDays = observed.length + forecast.length;
  let waterRatio: number | null = null;
  if (irrigation === "irrigated") {
    factors.push({ key: "water", label: "Water supply", multiplier: 1, impact: "neutral", explanation: "Irrigated planting: water assumed adequately supplied.", dataType: "assumed" });
  } else if (hasWeather && windowDays > 0) {
    const dailyNeed = ((crop.waterNeedMinMm + crop.waterNeedMaxMm) / 2) / midMaturity;
    const need = dailyNeed * windowDays;
    waterRatio = (rainObserved + rainForecast) / need;
    let m: number;
    if (waterRatio < 0.5) m = 0.6;
    else if (waterRatio < 0.8) m = 0.6 + ((waterRatio - 0.5) / 0.3) * 0.4;
    else if (waterRatio <= 1.3) m = 1.0;
    else if (waterRatio <= 1.8) m = 0.92;
    else m = 0.8;
    if (irrigation === "mixed" && m < 1) m = 1 - (1 - m) / 2;
    m = round(m, 3);
    factors.push({
      key: "water",
      label: "Rainfall vs crop water need",
      multiplier: m,
      impact: impactOf(m),
      explanation: `Rainfall over the ${windowDays}-day window (${round(rainObserved, 0)} mm modelled + ${round(rainForecast, 0)} mm forecast) covers ${round(waterRatio * 100, 0)}% of estimated crop water need${irrigation === "mixed" ? "; partial irrigation halves the penalty" : ""}.`,
      dataType: "calculated",
    });
  } else {
    factors.push({ key: "water", label: "Rainfall vs crop water need", multiplier: 0.9, impact: "negative", explanation: "Weather data unavailable — a conservative water factor was assumed.", dataType: "assumed" });
    limitations.push("Weather data unavailable: water balance could not be calculated.");
  }

  // ---------- Temperature factor ----------
  let meanTemp: number | null = null;
  let hotDays = 0;
  let coldDays = 0;
  if (temps.length >= 5) {
    meanTemp = temps.reduce((a, d) => a + ((d.tMax ?? 0) + (d.tMin ?? 0)) / 2, 0) / temps.length;
    hotDays = temps.filter((d) => (d.tMax ?? 0) >= crop.tempCriticalHigh).length;
    coldDays = temps.filter((d) => (d.tMin ?? 99) <= crop.tempCriticalLow).length;
    const heatFrac = hotDays / temps.length;
    const coldFrac = coldDays / temps.length;
    const offOpt = meanTemp < crop.tempOptMin ? crop.tempOptMin - meanTemp : meanTemp > crop.tempOptMax ? meanTemp - crop.tempOptMax : 0;
    const m = round(clamp(1 - 0.6 * heatFrac - 0.5 * coldFrac - Math.min(0.2, offOpt * 0.03), 0.4, 1), 3);
    factors.push({
      key: "temperature",
      label: "Temperature suitability",
      multiplier: m,
      impact: impactOf(m),
      explanation: `Mean temperature ${round(meanTemp, 1)} °C (optimal ${crop.tempOptMin}–${crop.tempOptMax} °C); ${hotDays} day(s) ≥ ${crop.tempCriticalHigh} °C and ${coldDays} day(s) ≤ ${crop.tempCriticalLow} °C.`,
      dataType: "calculated",
    });
  } else {
    limitations.push("Temperature data insufficient: temperature effects not assessed.");
  }

  // ---------- Soil pH factor (measured preferred over modelled) ----------
  const soilPh = input.sensors?.soilPhLatest ?? input.soil?.phH2o ?? null;
  const soilPhSource = input.sensors?.soilPhLatest != null ? "measured" : input.soil?.phH2o != null ? "modelled" : null;
  if (soilPh !== null) {
    const off = soilPh < crop.phMin ? crop.phMin - soilPh : soilPh > crop.phMax ? soilPh - crop.phMax : 0;
    const m = round(clamp(1 - off * 0.08, 0.7, 1), 3);
    factors.push({
      key: "soil_ph",
      label: "Soil pH",
      multiplier: m,
      impact: impactOf(m),
      explanation: `${soilPhSource === "measured" ? "Measured" : "Modelled"} pH ${round(soilPh, 1)} vs suitable ${crop.phMin}–${crop.phMax}.`,
      dataType: soilPhSource === "measured" ? "measured" : "modelled",
    });
  } else {
    limitations.push("Soil pH unknown (no sensor pH and no modelled soil data for this location).");
  }

  // ---------- Soil texture / organic carbon ----------
  let texture: string | null = null;
  if (input.soil && (input.soil.sandPct !== null || input.soil.clayPct !== null)) {
    const sand = input.soil.sandPct ?? 0;
    const clay = input.soil.clayPct ?? 0;
    texture = sand > 70 ? "sandy" : clay > 50 ? "heavy clay" : clay > 35 ? "clay" : "loamy";
    let m = 1;
    const notes: string[] = [];
    if (sand > 70 && irrigation !== "irrigated") { m *= 0.92; notes.push("sandy soil retains little water"); }
    if (clay > 50) { m *= 0.94; notes.push("heavy clay drains slowly"); }
    if (input.soil.organicCarbonGKg !== null && input.soil.organicCarbonGKg < 5) { m *= 0.95; notes.push("low organic carbon"); }
    m = round(m, 3);
    factors.push({
      key: "soil_texture",
      label: "Soil texture & organic matter",
      multiplier: m,
      impact: impactOf(m),
      explanation: `Modelled texture: ${texture} (sand ${sand}%, clay ${clay}%)${notes.length ? " — " + notes.join(", ") : ""}.`,
      dataType: "modelled",
    });
  }

  // ---------- Sensor soil moisture ----------
  if (reliableSensors?.soilMoistureAvg != null && irrigation !== "irrigated") {
    const avg = reliableSensors.soilMoistureAvg;
    let m = 1;
    if (avg < crop.soilMoistureMin) m = clamp(1 - ((crop.soilMoistureMin - avg) / crop.soilMoistureMin) * 0.5, 0.7, 1);
    else if (avg > crop.soilMoistureMax + 10) m = 0.92;
    else m = 1.03; // measured moisture within optimal band → slight confidence boost
    m = round(m, 3);
    factors.push({
      key: "soil_moisture",
      label: "Measured soil moisture",
      multiplier: m,
      impact: impactOf(m),
      explanation: `Average soil moisture ${round(avg, 1)}% (crop band ${crop.soilMoistureMin}–${crop.soilMoistureMax}%).`,
      dataType: "measured",
    });
  } else if (!reliableSensors) {
    limitations.push("No reliable recent sensor readings; estimate relies on external datasets only.");
  }

  // ---------- Combine ----------
  const combined = clamp(factors.reduce((a, f) => a * f.multiplier, 1), 0.3, 1.05);
  const yf = input.variety?.yieldFactor ?? 1;
  const adjustedCrop = {
    ...crop,
    maturityDaysMin: Math.round(crop.maturityDaysMin * maturityFactor),
    maturityDaysMax: Math.round(crop.maturityDaysMax * maturityFactor),
  };
  const progress = growthProgress(input.plantingDate, input.asOf, adjustedCrop) ?? 0;
  const qualityWiden = (100 - score) / 100; // 0..1
  const seasonWiden = Math.max(0, 1 - progress) * 0.15;
  let yieldMin = crop.baseYieldMin * yf * combined * (1 - 0.15 * qualityWiden - seasonWiden);
  let yieldMax = crop.baseYieldMax * yf * combined * (1 + 0.1 * qualityWiden);
  yieldMin = round(Math.max(0, yieldMin), 2);
  yieldMax = round(Math.max(yieldMin + 0.01, yieldMax), 2);

  // ---------- Harvest window (GDD) ----------
  let gddAccum: number | null = null;
  let start = crop.maturityDaysMin * maturityFactor;
  let end = crop.maturityDaysMax * maturityFactor;
  if (temps.length >= 5) {
    const gdd = (d: DailyWeather) => Math.max(0, ((d.tMax ?? 0) + (d.tMin ?? 0)) / 2 - crop.baseTempC);
    const obsTemps = observed.filter((d) => d.tMax !== null && d.tMin !== null);
    gddAccum = round(obsTemps.reduce((a, d) => a + gdd(d), 0), 0);
    const rate = temps.reduce((a, d) => a + gdd(d), 0) / temps.length;
    if (rate > 0.5) {
      const target = crop.gddToMaturity * maturityFactor;
      const remaining = Math.max(0, target - gddAccum);
      const est = elapsedDays + remaining / rate;
      const lo = crop.maturityDaysMin * maturityFactor * 0.85;
      const hi = crop.maturityDaysMax * maturityFactor * 1.3;
      const centre = clamp(est, lo, hi);
      start = centre - 7;
      end = centre + 7;
    }
  } else {
    limitations.push("Harvest window based on catalogue maturity days (no temperature data for GDD).");
  }
  const harvestStart = addDays(input.plantingDate, Math.max(elapsedDays, start));
  const harvestEnd = addDays(input.plantingDate, Math.max(elapsedDays + 1, end));

  // ---------- Risks ----------
  const risks = evaluateRisks({
    crop: adjustedCrop,
    irrigation,
    plantingDate: input.plantingDate,
    asOf: input.asOf,
    daily: input.weather ?? [],
    sensors: reliableSensors,
    soil: input.soil,
  });
  if (waterRatio !== null && waterRatio < 0.6 && !risks.some((r) => r.category === "drought")) {
    risks.push({
      category: "drought",
      severity: waterRatio < 0.4 ? "high" : "medium",
      title: "Seasonal rainfall deficit",
      explanation: `Season rainfall so far plus forecast covers only ${round(waterRatio * 100, 0)}% of the estimated ${crop.name} water need.`,
      source: "history",
    });
  }

  limitations.push("Forecast values are model predictions and may change; they are not observations.");
  limitations.push("Rule-based v1 estimate: not yet calibrated against local harvest records. Pests, diseases and management practices are not modelled.");

  return {
    version: ENGINE_VERSION,
    method: ENGINE_METHOD,
    yieldMin,
    yieldMax,
    yieldUnit: crop.yieldUnit,
    totalMin: round(yieldMin * areaHa, 2),
    totalMax: round(yieldMax * areaHa, 2),
    totalUnit: crop.yieldUnit.split("/")[0] || "t",
    areaHa: round(areaHa, 3),
    harvestStart,
    harvestEnd,
    growthProgressPct: round(Math.min(1, progress) * 100, 0),
    dataQuality: { score, components },
    factors,
    risks,
    conditions: {
      rainSincePlantingMm: observed.length ? round(rainObserved, 1) : null,
      forecastRainMm: forecast.length ? round(rainForecast, 1) : null,
      meanTempC: meanTemp !== null ? round(meanTemp, 1) : null,
      gddAccumulated: gddAccum,
      hotDays,
      coldDays,
      soilPh: soilPh !== null ? round(soilPh, 2) : null,
      soilPhSource,
      soilMoistureAvg: reliableSensors?.soilMoistureAvg != null ? round(reliableSensors.soilMoistureAvg, 1) : null,
      soilTexture: texture,
    },
    limitations,
  };
}
