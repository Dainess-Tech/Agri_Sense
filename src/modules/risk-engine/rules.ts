/**
 * AgriSense risk rules engine — pure, configurable, crop-specific.
 * Never raises alerts from unreliable data: callers must pass only
 * sensor summaries built from readings with quality = "valid".
 */
import { bumpSeverity, daysBetween, round, severityRank, type Severity } from "../shared/units";

export interface CropThresholds {
  name: string;
  maturityDaysMin: number;
  maturityDaysMax: number;
  tempCriticalLow: number;
  tempCriticalHigh: number;
  soilMoistureMin: number;
  soilMoistureMax: number;
  phMin: number;
  phMax: number;
}

export interface DailyWeather {
  date: string;
  tMax: number | null;
  tMin: number | null;
  precipMm: number | null;
  /** "model" = past days from weather model/reanalysis; "forecast" = future. Forecasts are never treated as observations. */
  kind: "model" | "forecast";
}

export interface SensorSummary {
  soilMoistureAvg: number | null;
  soilMoistureSamples: number;
  soilPhLatest: number | null;
  soilTempLatest: number | null;
  airTempAvg: number | null;
  lastValidReadingAt: string | null;
}

export interface SoilSummary {
  phH2o: number | null;
  clayPct: number | null;
  sandPct: number | null;
  organicCarbonGKg: number | null;
}

export interface RiskContext {
  crop: CropThresholds;
  irrigation: "rainfed" | "irrigated" | "mixed";
  plantingDate: string | null;
  asOf: string; // YYYY-MM-DD
  daily: DailyWeather[];
  sensors: SensorSummary | null;
  soil: SoilSummary | null;
}

export interface EngineRisk {
  category:
    | "drought"
    | "excessive_rainfall"
    | "waterlogging"
    | "heat_stress"
    | "cold_stress"
    | "soil_moisture"
    | "soil_ph"
    | "season_disruption";
  severity: Severity;
  title: string;
  explanation: string;
  source: "sensor" | "forecast" | "soil" | "history";
}

/** Tunable thresholds. Can be overridden from system_settings("risk_thresholds"). */
export const DEFAULT_RISK_THRESHOLDS = {
  forecastWindowDays: 7,
  heavyRain7dMediumMm: 100,
  heavyRain7dHighMm: 150,
  heavyRainSingleDayMm: 50,
  droughtPast14dMm: 10,
  droughtNext7dMm: 10,
  waterloggingMoistureMargin: 10,
  waterloggingClayPct: 45,
  waterloggingRain7dMm: 80,
  minSensorSamples: 3,
  phMediumMargin: 0.5,
  phHighMargin: 1.5,
};
export type RiskThresholds = typeof DEFAULT_RISK_THRESHOLDS;

export function growthProgress(plantingDate: string | null, asOf: string, crop: CropThresholds): number | null {
  if (!plantingDate) return null;
  const elapsed = daysBetween(plantingDate, asOf);
  const mid = (crop.maturityDaysMin + crop.maturityDaysMax) / 2;
  return Math.max(0, Math.min(1.2, elapsed / mid));
}

const sum = (xs: (number | null)[]) => xs.reduce<number>((a, b) => a + (b ?? 0), 0);

export function evaluateRisks(ctx: RiskContext, t: RiskThresholds = DEFAULT_RISK_THRESHOLDS): EngineRisk[] {
  const risks: EngineRisk[] = [];
  const { crop, sensors, soil } = ctx;
  const future = ctx.daily.filter((d) => d.kind === "forecast" && d.date >= ctx.asOf).slice(0, t.forecastWindowDays);
  const past14 = ctx.daily.filter((d) => d.kind === "model" && d.date < ctx.asOf && daysBetween(d.date, ctx.asOf) <= 14);
  const progress = growthProgress(ctx.plantingDate, ctx.asOf, crop);
  const sensitiveStage = progress !== null && progress >= 0.4 && progress <= 0.7; // approx. flowering/grain fill
  const reliableSensors = sensors && sensors.soilMoistureSamples >= t.minSensorSamples ? sensors : null;

  // Heat stress (forecast)
  const hotDays = future.filter((d) => d.tMax !== null && d.tMax >= crop.tempCriticalHigh);
  if (hotDays.length > 0) {
    let sev: Severity = hotDays.length >= 3 ? "high" : "medium";
    if (sensitiveStage) sev = bumpSeverity(sev);
    risks.push({
      category: "heat_stress",
      severity: sev,
      title: `High-temperature stress forecast (${hotDays.length} day${hotDays.length > 1 ? "s" : ""})`,
      explanation: `Forecast maximum temperatures reach ${Math.max(...hotDays.map((d) => d.tMax ?? 0)).toFixed(1)} °C, at or above the ${crop.name} critical threshold of ${crop.tempCriticalHigh} °C${sensitiveStage ? ", during a heat-sensitive growth stage" : ""}. This is a forecast, not an observation.`,
      source: "forecast",
    });
  }

  // Cold stress (forecast)
  const coldDays = future.filter((d) => d.tMin !== null && d.tMin <= crop.tempCriticalLow);
  if (coldDays.length > 0) {
    risks.push({
      category: "cold_stress",
      severity: coldDays.length >= 3 ? "high" : "medium",
      title: `Low-temperature stress forecast (${coldDays.length} day${coldDays.length > 1 ? "s" : ""})`,
      explanation: `Forecast minimum temperatures fall to ${Math.min(...coldDays.map((d) => d.tMin ?? 0)).toFixed(1)} °C, at or below the ${crop.name} critical threshold of ${crop.tempCriticalLow} °C.`,
      source: "forecast",
    });
  }

  // Excessive rainfall (forecast)
  const rain7 = sum(future.map((d) => d.precipMm));
  const maxDay = Math.max(0, ...future.map((d) => d.precipMm ?? 0));
  if (rain7 >= t.heavyRain7dMediumMm || maxDay >= t.heavyRainSingleDayMm) {
    risks.push({
      category: "excessive_rainfall",
      severity: rain7 >= t.heavyRain7dHighMm ? "high" : "medium",
      title: "Heavy rainfall expected",
      explanation: `About ${round(rain7, 0)} mm of rain is forecast over the next ${future.length} days (heaviest day ≈ ${round(maxDay, 0)} mm). Plan field activities around wet periods.`,
      source: "forecast",
    });
  }

  // Waterlogging (sensor-confirmed, or soil+forecast inferred)
  if (reliableSensors?.soilMoistureAvg != null && reliableSensors.soilMoistureAvg > crop.soilMoistureMax + t.waterloggingMoistureMargin) {
    risks.push({
      category: "waterlogging",
      severity: "high",
      title: "Possible waterlogging detected",
      explanation: `Average soil moisture is ${round(reliableSensors.soilMoistureAvg, 1)}%, well above the ${crop.name} upper threshold of ${crop.soilMoistureMax}% (based on ${reliableSensors.soilMoistureSamples} valid readings).`,
      source: "sensor",
    });
  } else if (soil?.clayPct != null && soil.clayPct >= t.waterloggingClayPct && rain7 >= t.waterloggingRain7dMm) {
    risks.push({
      category: "waterlogging",
      severity: "medium",
      title: "Waterlogging possible on clay-rich soil",
      explanation: `Modelled clay content is ${soil.clayPct}% and ${round(rain7, 0)} mm of rain is forecast. Clay soils drain slowly.`,
      source: "soil",
    });
  }

  // Soil moisture concern (sensor only, reliable data only)
  if (reliableSensors?.soilMoistureAvg != null && reliableSensors.soilMoistureAvg < crop.soilMoistureMin) {
    const deficit = crop.soilMoistureMin - reliableSensors.soilMoistureAvg;
    risks.push({
      category: "soil_moisture",
      severity: deficit >= 10 ? "high" : "medium",
      title: "Soil moisture below crop threshold",
      explanation: `Average soil moisture is ${round(reliableSensors.soilMoistureAvg, 1)}%, below the configured ${crop.name} minimum of ${crop.soilMoistureMin}% (from ${reliableSensors.soilMoistureSamples} valid readings).`,
      source: "sensor",
    });
  }

  // Drought (rainfed/mixed only)
  if (ctx.irrigation !== "irrigated" && past14.length >= 7 && future.length >= 3) {
    const pastRain = sum(past14.map((d) => d.precipMm));
    const nextRain = rain7;
    if (pastRain < t.droughtPast14dMm && nextRain < t.droughtNext7dMm) {
      const sensorConfirms = reliableSensors?.soilMoistureAvg != null && reliableSensors.soilMoistureAvg < crop.soilMoistureMin;
      risks.push({
        category: "drought",
        severity: sensorConfirms ? "high" : ctx.irrigation === "mixed" ? "low" : "medium",
        title: "Dry spell risk",
        explanation: `Only ${round(pastRain, 1)} mm of rain fell in the past 14 days (modelled) and ${round(nextRain, 1)} mm is forecast for the next ${future.length} days${sensorConfirms ? "; soil sensors confirm low moisture" : ""}.`,
        source: "history",
      });
    }
  }

  // Soil pH: prefer measured sensor pH, fall back to modelled SoilGrids pH.
  const ph = reliableSensors?.soilPhLatest ?? soil?.phH2o ?? null;
  const phSource: EngineRisk["source"] = reliableSensors?.soilPhLatest != null ? "sensor" : "soil";
  if (ph !== null) {
    const off = ph < crop.phMin ? crop.phMin - ph : ph > crop.phMax ? ph - crop.phMax : 0;
    if (off > 0) {
      risks.push({
        category: "soil_ph",
        severity: off >= t.phHighMargin ? "high" : off >= t.phMediumMargin ? "medium" : "low",
        title: ph < crop.phMin ? "Soil may be too acidic" : "Soil may be too alkaline",
        explanation: `${phSource === "sensor" ? "Measured" : "Modelled (SoilGrids)"} soil pH is ${round(ph, 1)}, outside the ${crop.name} suitable range of ${crop.phMin}–${crop.phMax}.`,
        source: phSource,
      });
    }
  }

  // Season disruption: very dry forecast during establishment, or overdue harvest.
  if (progress !== null && progress < 0.15 && ctx.irrigation === "rainfed" && future.length >= 5 && rain7 < 5) {
    risks.push({
      category: "season_disruption",
      severity: "medium",
      title: "Crop establishment at risk",
      explanation: `The crop is in early establishment and less than 5 mm of rain is forecast for the next ${future.length} days.`,
      source: "forecast",
    });
  }
  if (ctx.plantingDate && daysBetween(ctx.plantingDate, ctx.asOf) > crop.maturityDaysMax + 21) {
    risks.push({
      category: "season_disruption",
      severity: "low",
      title: "Harvest appears overdue",
      explanation: `It has been ${daysBetween(ctx.plantingDate, ctx.asOf)} days since planting, beyond the typical ${crop.maturityDaysMax}-day maturity. Record the harvest or update the planting status.`,
      source: "history",
    });
  }

  // Two rules can raise the same category (e.g. establishment + overdue harvest).
  // Keep the most severe one so dedupe keys stay unique and stale copies resolve.
  const unique = new Map<EngineRisk["category"], EngineRisk>();
  for (const r of risks) {
    const prev = unique.get(r.category);
    if (!prev || severityRank(r.severity) > severityRank(prev.severity)) unique.set(r.category, r);
  }
  return [...unique.values()];
}
