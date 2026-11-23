import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { weatherSnapshots } from "@/db/schema";
import type { DailyWeather } from "@/modules/risk-engine/rules";
import { addDays } from "@/modules/shared/units";

/**
 * Weather integration — Open-Meteo (https://open-meteo.com, CC BY 4.0, free for
 * non-commercial use without key). Isolated behind this service so the provider
 * can be replaced. Past days are labelled "model" (reanalysis/model output),
 * future days "forecast" — forecasts are never stored as observations.
 */
export const WEATHER_PROVIDER = "Open-Meteo";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";

export class ProviderError extends Error {}

export interface WeatherDay extends DailyWeather {
  precipProbability: number | null;
  windMaxKmh: number | null;
  et0Mm: number | null;
}

export interface ForecastBundle {
  provider: string;
  retrievedAt: string;
  cached: boolean;
  stale: boolean;
  elevation: number | null;
  current: { time: string; temperatureC: number | null; humidityPct: number | null; precipitationMm: number | null; windSpeedKmh: number | null; weatherCode: number | null } | null;
  daily: WeatherDay[];
}

async function fetchJson(url: string, attempts = 3): Promise<unknown> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(12_000), cache: "no-store" });
      if (res.status === 429) throw new ProviderError("Weather provider rate limit reached");
      if (!res.ok) throw new ProviderError(`Weather provider returned ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (e instanceof ProviderError && e.message.includes("rate limit")) break;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new ProviderError("Weather provider unavailable");
}

async function cached<T>(key: string, kind: string, lat: number, lng: number, ttlMs: number, load: () => Promise<T>): Promise<{ data: T; retrievedAt: Date; cached: boolean; stale: boolean }> {
  const [row] = await db.select().from(weatherSnapshots).where(eq(weatherSnapshots.cacheKey, key)).limit(1);
  if (row && row.expiresAt > new Date()) return { data: row.payload as T, retrievedAt: row.retrievedAt, cached: true, stale: false };
  try {
    const data = await load();
    const now = new Date();
    const values = { cacheKey: key, kind, provider: WEATHER_PROVIDER, latitude: lat.toFixed(6), longitude: lng.toFixed(6), payload: data as object, retrievedAt: now, expiresAt: new Date(now.getTime() + ttlMs) };
    await db.insert(weatherSnapshots).values(values).onConflictDoUpdate({ target: weatherSnapshots.cacheKey, set: values });
    return { data, retrievedAt: now, cached: false, stale: false };
  } catch (e) {
    if (row) return { data: row.payload as T, retrievedAt: row.retrievedAt, cached: true, stale: true }; // graceful degradation
    throw e;
  }
}

type Daily = Record<string, (number | null)[] | string[]>;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function toDays(daily: Daily | undefined, today: string): WeatherDay[] {
  if (!daily || !Array.isArray(daily.time)) return [];
  return (daily.time as string[]).map((date, i) => ({
    date,
    tMax: num(daily.temperature_2m_max?.[i]),
    tMin: num(daily.temperature_2m_min?.[i]),
    precipMm: num(daily.precipitation_sum?.[i]),
    precipProbability: num(daily.precipitation_probability_max?.[i]),
    windMaxKmh: num(daily.wind_speed_10m_max?.[i]),
    et0Mm: num(daily.et0_fao_evapotranspiration?.[i]),
    kind: date < today ? ("model" as const) : ("forecast" as const),
  }));
}

export async function getForecast(lat: number, lng: number): Promise<ForecastBundle> {
  const key = `forecast:${lat.toFixed(2)}:${lng.toFixed(2)}`;
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lng.toFixed(4),
    current: "temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,weather_code",
    daily: "temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,et0_fao_evapotranspiration",
    past_days: "14",
    forecast_days: "16",
    timezone: "UTC",
  });
  const r = await cached(key, "forecast", lat, lng, 60 * 60 * 1000, async () => {
    const raw = (await fetchJson(`${FORECAST_URL}?${params}`)) as { daily?: Daily; current?: Record<string, unknown>; elevation?: number };
    if (!raw || !raw.daily) throw new ProviderError("Unexpected weather response");
    return raw;
  });
  // Label past/future days relative to when this payload was retrieved. Using
  // the real "today" would mislabel a stale cached forecast as observations.
  const today = r.retrievedAt.toISOString().slice(0, 10);
  const c = r.data.current;
  return {
    provider: WEATHER_PROVIDER,
    retrievedAt: r.retrievedAt.toISOString(),
    cached: r.cached,
    stale: r.stale,
    elevation: num(r.data.elevation),
    current: c
      ? { time: String(c.time), temperatureC: num(c.temperature_2m), humidityPct: num(c.relative_humidity_2m), precipitationMm: num(c.precipitation), windSpeedKmh: num(c.wind_speed_10m), weatherCode: num(c.weather_code) }
      : null,
    daily: toDays(r.data.daily, today),
  };
}

export async function getHistory(lat: number, lng: number, start: string, end: string): Promise<{ daily: WeatherDay[]; retrievedAt: string; cached: boolean }> {
  const key = `history:${lat.toFixed(2)}:${lng.toFixed(2)}:${start}:${end}`;
  const params = new URLSearchParams({ latitude: lat.toFixed(4), longitude: lng.toFixed(4), start_date: start, end_date: end, daily: "temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,et0_fao_evapotranspiration", timezone: "UTC" });
  const r = await cached(key, "history", lat, lng, 24 * 60 * 60 * 1000, async () => {
    const raw = (await fetchJson(`${ARCHIVE_URL}?${params}`)) as { daily?: Daily };
    if (!raw || !raw.daily) throw new ProviderError("Unexpected archive response");
    return raw;
  });
  return { daily: toDays(r.data.daily, "9999-12-31"), retrievedAt: r.retrievedAt.toISOString(), cached: r.cached };
}

/** Weather from planting date to end of forecast: archive (older) + forecast endpoint (recent + future). */
export async function getSeasonWeather(lat: number, lng: number, plantingDate: string) {
  const forecast = await getForecast(lat, lng);
  const firstForecastDate = forecast.daily[0]?.date ?? new Date().toISOString().slice(0, 10);
  const sources: { provider: string; dataset: string; retrievedAt: string; from: string; to: string }[] = [
    { provider: WEATHER_PROVIDER, dataset: "forecast (+14 past days, model)", retrievedAt: forecast.retrievedAt, from: firstForecastDate, to: forecast.daily.at(-1)?.date ?? firstForecastDate },
  ];
  let history: WeatherDay[] = [];
  if (plantingDate < firstForecastDate) {
    const end = addDays(firstForecastDate, -1);
    try {
      const h = await getHistory(lat, lng, plantingDate, end);
      history = h.daily.filter((d) => d.date < firstForecastDate);
      sources.push({ provider: WEATHER_PROVIDER, dataset: "historical archive (ERA5 reanalysis)", retrievedAt: h.retrievedAt, from: plantingDate, to: end });
    } catch (e) {
      console.warn("[weather] archive unavailable", e);
    }
  }
  return { daily: [...history, ...forecast.daily], forecast, sources };
}
