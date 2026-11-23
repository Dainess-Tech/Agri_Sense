/**
 * IoT reading validation — pure module (no DB, no framework).
 * Distinguishes sensor failure from real environmental conditions:
 * e.g. a disconnected DS18B20 reports -127 °C and a disconnected capacitive
 * moisture probe often reports 0 % — neither must be treated as real data.
 */
export type ReadingQuality = "valid" | "suspect" | "invalid";

export interface SensorDef {
  code: string;
  label: string;
  unit: string;
  minValid: number;
  maxValid: number;
  hardware: string;
}

export const SENSOR_DEFS: Record<string, SensorDef> = {
  soil_moisture: { code: "soil_moisture", label: "Soil moisture", unit: "%VWC", minValid: 0, maxValid: 100, hardware: "Capacitive soil moisture sensor" },
  air_temperature: { code: "air_temperature", label: "Air temperature", unit: "°C", minValid: -40, maxValid: 80, hardware: "DHT22" },
  air_humidity: { code: "air_humidity", label: "Air humidity", unit: "%RH", minValid: 0, maxValid: 100, hardware: "DHT22" },
  soil_temperature: { code: "soil_temperature", label: "Soil temperature", unit: "°C", minValid: -55, maxValid: 125, hardware: "DS18B20" },
  soil_ph: { code: "soil_ph", label: "Soil pH", unit: "pH", minValid: 0, maxValid: 14, hardware: "Soil pH probe" },
  // Optional NPK nutrient probes (proposal §3.2). Values are mg/kg (ppm) as
  // reported by common ESP32 NPK modules; only deployed where hardware exists.
  soil_n: { code: "soil_n", label: "Soil nitrogen (N)", unit: "mg/kg", minValid: 0, maxValid: 2000, hardware: "NPK soil nutrient sensor" },
  soil_p: { code: "soil_p", label: "Soil phosphorus (P)", unit: "mg/kg", minValid: 0, maxValid: 2000, hardware: "NPK soil nutrient sensor" },
  soil_k: { code: "soil_k", label: "Soil potassium (K)", unit: "mg/kg", minValid: 0, maxValid: 2000, hardware: "NPK soil nutrient sensor" },
};

export const SENSOR_CODES = Object.keys(SENSOR_DEFS);

export interface ValidationResult {
  quality: ReadingQuality;
  unit: string;
  note: string | null;
}

export function validateReading(type: string, value: number): ValidationResult | null {
  const def = SENSOR_DEFS[type];
  if (!def) return null; // unknown sensor type → reject entirely
  if (!Number.isFinite(value)) return { quality: "invalid", unit: def.unit, note: "Non-numeric value" };
  // Disconnected-sensor sentinels must be reported before the generic range check.
  if (type === "soil_temperature" && value === -127) return { quality: "invalid", unit: def.unit, note: "DS18B20 disconnected sentinel (-127)" };
  if (value < def.minValid || value > def.maxValid) {
    return { quality: "invalid", unit: def.unit, note: `Outside physical range ${def.minValid}–${def.maxValid} ${def.unit}` };
  }
  switch (type) {
    case "soil_temperature":
      if (value === 85) return { quality: "suspect", unit: def.unit, note: "DS18B20 power-on reset value (85 °C)" };
      if (value > 70) return { quality: "suspect", unit: def.unit, note: "Implausibly hot soil" };
      break;
    case "soil_moisture":
      if (value === 0) return { quality: "suspect", unit: def.unit, note: "0% suggests a disconnected/dry-air probe, not real soil" };
      if (value === 100) return { quality: "suspect", unit: def.unit, note: "100% suggests probe submerged or shorted" };
      break;
    case "soil_ph":
      if (value < 3 || value > 10) return { quality: "suspect", unit: def.unit, note: "pH outside typical agricultural soils (3–10) — check calibration" };
      break;
    case "soil_n":
    case "soil_p":
    case "soil_k":
      if (value === 0) return { quality: "suspect", unit: def.unit, note: "0 mg/kg suggests an uncalibrated or disconnected NPK probe" };
      if (value >= 2000) return { quality: "suspect", unit: def.unit, note: "At sensor full-scale — check calibration" };
      break;
    case "air_temperature":
      if (value > 55) return { quality: "suspect", unit: def.unit, note: "Air temperature above 55 °C — check sensor shading" };
      break;
  }
  return { quality: "valid", unit: def.unit, note: null };
}

/** Device considered offline if no data within 3 reporting intervals (min 30 min). */
export function deviceStatus(lastSeenAt: Date | string | null, intervalSec: number, now = new Date()): "online" | "offline" | "never" {
  if (!lastSeenAt) return "never";
  const last = new Date(lastSeenAt).getTime();
  const threshold = Math.max(intervalSec * 3, 1800) * 1000;
  return now.getTime() - last <= threshold ? "online" : "offline";
}
