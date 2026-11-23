import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { SensorSummary } from "@/modules/risk-engine/rules";

/** Aggregates only VALID readings — suspect/invalid readings never feed risk or prediction logic. */
export async function summarizeSensors(farmId: string, days = 7): Promise<SensorSummary | null> {
  const windowDays = Math.max(1, Math.round(days));
  const res = await db.execute<{
    moisture_avg: string | null;
    moisture_n: string;
    ph_latest: string | null;
    soil_temp_latest: string | null;
    air_temp_avg: string | null;
    last_valid: Date | string | null;
  }>(sql`
    select
      avg(value) filter (where sensor_type = 'soil_moisture' and measured_at > now() - make_interval(days => ${windowDays})) as moisture_avg,
      count(*) filter (where sensor_type = 'soil_moisture' and measured_at > now() - make_interval(days => ${windowDays})) as moisture_n,
      (array_agg(value order by measured_at desc) filter (where sensor_type = 'soil_ph' and measured_at > now() - interval '30 days'))[1] as ph_latest,
      (array_agg(value order by measured_at desc) filter (where sensor_type = 'soil_temperature' and measured_at > now() - interval '2 days'))[1] as soil_temp_latest,
      avg(value) filter (where sensor_type = 'air_temperature' and measured_at > now() - make_interval(days => ${windowDays})) as air_temp_avg,
      max(measured_at) as last_valid
    from sensor_readings
    where farm_id = ${farmId} and quality = 'valid' and measured_at > now() - interval '30 days'
  `);
  const r = res.rows[0];
  if (!r || !r.last_valid) return null;
  const n = (v: string | null) => (v === null ? null : Number(v));
  return {
    soilMoistureAvg: n(r.moisture_avg),
    soilMoistureSamples: Number(r.moisture_n),
    soilPhLatest: n(r.ph_latest),
    soilTempLatest: n(r.soil_temp_latest),
    airTempAvg: n(r.air_temp_avg),
    lastValidReadingAt: new Date(r.last_valid).toISOString(),
  };
}

/** Latest reading per sensor type for a farm (including quality, so UIs can flag sensor faults). */
export async function latestReadings(farmId: string) {
  const res = await db.execute<{ sensor_type: string; value: string; unit: string; quality: string; quality_note: string | null; measured_at: Date; device_id: string }>(sql`
    select distinct on (sensor_type) sensor_type, value, unit, quality, quality_note, measured_at, device_id
    from sensor_readings where farm_id = ${farmId} and measured_at > now() - interval '30 days'
    order by sensor_type, measured_at desc
  `);
  return res.rows.map((r) => ({ sensorType: r.sensor_type, value: Number(r.value), unit: r.unit, quality: r.quality, qualityNote: r.quality_note, measuredAt: new Date(r.measured_at).toISOString(), deviceId: r.device_id }));
}

/** Downsampled time series (hourly buckets by default) for charts — avoids sending every raw reading. */
export async function readingSeries(opts: { farmId?: string; deviceId?: string; sensorType: string; hours: number; bucketMinutes?: number }) {
  const bucket = Math.max(1, Math.round(opts.bucketMinutes ?? (opts.hours > 72 ? 180 : opts.hours > 24 ? 60 : 15)));
  const hours = Math.max(1, Math.round(opts.hours));
  const scope = opts.deviceId ? sql`device_id = ${opts.deviceId}` : sql`farm_id = ${opts.farmId!}`;
  const res = await db.execute<{ t: Date; v: string }>(sql`
    select to_timestamp(floor(extract(epoch from measured_at) / (${bucket} * 60)) * ${bucket} * 60) as t, avg(value) as v
    from sensor_readings
    where ${scope} and sensor_type = ${opts.sensorType} and quality = 'valid'
      and measured_at > now() - make_interval(hours => ${hours})
    group by 1 order by 1
  `);
  return res.rows.map((r) => ({ t: new Date(r.t).toISOString(), v: Number(Number(r.v).toFixed(2)) }));
}
