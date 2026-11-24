"use client";
import { useState } from "react";
import { fmtDateTime, RISK_LABELS, SENSOR_LABELS, timeAgo, useApi } from "@/lib/client/hooks";
import { LineChart, WeatherChart, type Point } from "./charts";
import { Alert, Badge, Card, DataTypeBadge, Select, SeverityBadge, Skeleton, SavedDataNotice, cx } from "./ui";

export interface Reading {
  sensorType: string;
  value: number;
  unit: string;
  quality: string;
  qualityNote: string | null;
  measuredAt: string;
}

export function LatestReadings({ readings }: { readings: Reading[] }) {
  if (!readings.length) return <p className="text-sm text-stone-500">No sensor readings in the last 30 days. Register a device and start sending measurements.</p>;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {readings.map((r) => {
        const meta = SENSOR_LABELS[r.sensorType] ?? { label: r.sensorType, unit: r.unit, icon: "📟" };
        const bad = r.quality !== "valid";
        return (
          <div key={r.sensorType} className={cx("rounded-xl border p-3", bad ? "border-amber-300 bg-amber-50" : "border-stone-200 bg-stone-50")}>
            <div className="flex items-center justify-between text-xs text-stone-500">
              <span>{meta.label}</span>
              <span aria-hidden>{meta.icon}</span>
            </div>
            <div className="mt-1 text-xl font-bold text-stone-900">
              {r.value}
              <span className="ml-0.5 text-sm font-medium text-stone-500">{r.unit}</span>
            </div>
            <div className="mt-1 flex items-center gap-1 text-[11px] text-stone-500">
              <DataTypeBadge type="measured" /> {timeAgo(r.measuredAt)}
            </div>
            {bad && <p className="mt-1 text-[11px] font-medium text-amber-800">⚠ Possible sensor fault: {r.qualityNote ?? r.quality} — excluded from analysis</p>}
          </div>
        );
      })}
    </div>
  );
}

interface Risk {
  id: string;
  category: string;
  severity: string;
  title: string;
  explanation: string;
  source: string;
  detectedAt: string;
  active?: boolean;
  resolvedAt?: string | null;
  cropName?: string | null;
}

export function RiskList({ risks, empty = "No active risks detected for current conditions." }: { risks: Risk[]; empty?: string }) {
  if (!risks.length) return <p className="rounded-xl bg-leaf-50 p-3 text-sm text-leaf-800">✅ {empty}</p>;
  return (
    <ul className="space-y-2">
      {risks.map((r) => (
        <li key={r.id} className={cx("rounded-xl border p-3", r.active === false ? "border-stone-200 bg-stone-50 opacity-75" : "border-stone-200")}>
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={r.severity} />
            <span className="font-medium text-stone-900">{r.title}</span>
            {r.cropName && <Badge tone="green">{r.cropName}</Badge>}
            <Badge>{RISK_LABELS[r.category] ?? r.category}</Badge>
            <DataTypeBadge type={r.source === "sensor" ? "measured" : r.source === "forecast" ? "forecast" : r.source === "soil" ? "modelled" : "calculated"} />
          </div>
          <p className="mt-1 text-sm text-stone-600">{r.explanation}</p>
          <p className="mt-1 text-xs text-stone-400">
            Detected {fmtDateTime(r.detectedAt)}
            {r.resolvedAt && ` · resolved ${fmtDateTime(r.resolvedAt)}`}
          </p>
        </li>
      ))}
    </ul>
  );
}

interface WeatherResp {
  provider: string;
  retrievedAt: string;
  cached: boolean;
  stale: boolean;
  elevation: number | null;
  current: { time: string; temperatureC: number | null; humidityPct: number | null; precipitationMm: number | null; windSpeedKmh: number | null; weatherCode: number | null } | null;
  daily: { date: string; tMax: number | null; tMin: number | null; precipMm: number | null; precipProbability: number | null; kind: string }[];
}

const WMO: Record<number, string> = { 0: "☀️ Clear", 1: "🌤️ Mainly clear", 2: "⛅ Partly cloudy", 3: "☁️ Overcast", 45: "🌫️ Fog", 48: "🌫️ Fog", 51: "🌦️ Drizzle", 53: "🌦️ Drizzle", 55: "🌦️ Drizzle", 61: "🌧️ Light rain", 63: "🌧️ Rain", 65: "🌧️ Heavy rain", 80: "🌦️ Showers", 81: "🌧️ Showers", 82: "⛈️ Violent showers", 95: "⛈️ Thunderstorm", 96: "⛈️ Thunderstorm", 99: "⛈️ Thunderstorm" };

export function WeatherPanel({ farmId, compact }: { farmId: string; compact?: boolean }) {
  const { data, error, loading, savedAt, reload } = useApi<WeatherResp>(`/farms/${farmId}/weather`);
  if (loading && !data) return <Card title="Weather"><Skeleton className="h-40" /></Card>;
  if (error && !data) return <Card title="Weather"><Alert tone="warning">{error}</Alert></Card>;
  if (!data) return null;
  if (!Array.isArray(data.daily)) {
    return (
      <Card title="Weather">
        <Alert tone="warning">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>Weather data is incomplete. Please try again.</span>
            <button type="button" className="font-semibold underline" onClick={() => void reload()}>Retry</button>
          </div>
        </Alert>
      </Card>
    );
  }
  const today = new Date().toISOString().slice(0, 10);
  const days = compact ? data.daily.filter((d) => d.date >= today).slice(0, 7) : data.daily;
  const next7 = data.daily.filter((d) => d.date >= today).slice(0, 7);
  const rain7 = next7.reduce((a, d) => a + (d.precipMm ?? 0), 0);
  const c = data.current;
  return (
    <Card
      title="Weather"
      subtitle={`${data.provider} · retrieved ${fmtDateTime(data.retrievedAt)}${data.stale ? " · ⚠ stale copy (provider unreachable)" : data.cached ? " · cached" : ""}`}
      action={<DataTypeBadge type="forecast" />}
    >
      <SavedDataNotice savedAt={savedAt} />
      {c && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl bg-sky-50 p-3">
            <p className="text-xs text-sky-700">Now</p>
            <p className="text-2xl font-bold text-stone-900">{c.temperatureC ?? "—"}°C</p>
            <p className="text-xs text-stone-600">{c.weatherCode !== null ? WMO[c.weatherCode] ?? `Code ${c.weatherCode}` : ""}</p>
          </div>
          <div className="rounded-xl bg-stone-50 p-3">
            <p className="text-xs text-stone-500">Humidity</p>
            <p className="text-xl font-bold">{c.humidityPct ?? "—"}%</p>
          </div>
          <div className="rounded-xl bg-stone-50 p-3">
            <p className="text-xs text-stone-500">Wind</p>
            <p className="text-xl font-bold">{c.windSpeedKmh ?? "—"} km/h</p>
          </div>
          <div className="rounded-xl bg-stone-50 p-3">
            <p className="text-xs text-stone-500">Rain next 7 days</p>
            <p className="text-xl font-bold">{rain7.toFixed(0)} mm</p>
            <p className="text-[11px] text-violet-700">forecast</p>
          </div>
        </div>
      )}
      <WeatherChart days={days.map((d) => ({ date: d.date, rain: d.precipMm, tMax: d.tMax, tMin: d.tMin, kind: d.kind }))} />
      {!compact && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="text-xs uppercase text-stone-500">
              <tr><th className="py-2">Date</th><th>Type</th><th>Min / Max °C</th><th>Rain mm</th><th>Rain chance</th></tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {data.daily.map((d) => (
                <tr key={d.date} className={d.date === today ? "bg-leaf-50" : ""}>
                  <td className="py-1.5">{d.date}</td>
                  <td><DataTypeBadge type={d.kind === "forecast" ? "forecast" : "modelled"} /></td>
                  <td>{d.tMin ?? "—"} / {d.tMax ?? "—"}</td>
                  <td>{d.precipMm ?? "—"}</td>
                  <td>{d.precipProbability !== null ? `${d.precipProbability}%` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-stone-500">Past days are weather-model estimates (not station observations); future days are forecasts and may change. Weather data by Open-Meteo.com (CC BY 4.0).</p>
        </div>
      )}
    </Card>
  );
}

interface SoilResp {
  soil: { phH2o: string | null; organicCarbonGKg: string | null; nitrogenGKg: string | null; sandPct: string | null; siltPct: string | null; clayPct: string | null; texture: string | null; depth: string; available: boolean; retrievedAt: string };
  provider: string;
}

export function SoilPanel({ farmId }: { farmId: string }) {
  const { data, error, loading } = useApi<SoilResp>(`/farms/${farmId}/soil`);
  if (loading && !data) return <Card title="Soil properties"><Skeleton className="h-32" /></Card>;
  if (error && !data) return <Card title="Soil properties"><Alert tone="warning">{error}</Alert></Card>;
  if (!data) return null;
  const s = data.soil;
  const rows: [string, string | null, string][] = [
    ["pH (H₂O)", s.phH2o, ""],
    ["Organic carbon", s.organicCarbonGKg, "g/kg"],
    ["Total nitrogen", s.nitrogenGKg, "g/kg"],
    ["Sand", s.sandPct, "%"],
    ["Silt", s.siltPct, "%"],
    ["Clay", s.clayPct, "%"],
  ];
  return (
    <Card title="Soil properties" subtitle={`${data.provider} · ${s.depth} · retrieved ${fmtDateTime(s.retrievedAt)}`} action={<DataTypeBadge type="modelled" />}>
      {!s.available ? (
        <Alert tone="info">SoilGrids has no modelled soil data for this exact location (common for urban areas and water bodies). Record your known soil type on the farm, or add a soil pH sensor.</Alert>
      ) : (
        <>
          {s.texture && <p className="mb-3 text-sm">Texture class: <strong>{s.texture}</strong></p>}
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {rows.map(([k, v, u]) => (
              <div key={k} className="rounded-xl bg-stone-50 p-3">
                <dt className="text-xs text-stone-500">{k}</dt>
                <dd className="text-lg font-semibold">{v ?? "—"} <span className="text-xs font-normal text-stone-500">{v ? u : ""}</span></dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-xs text-stone-500">Modelled estimates at ~250 m resolution, not laboratory measurements. Confirm with a soil test before applying amendments. Data: ISRIC SoilGrids (CC BY 4.0).</p>
        </>
      )}
    </Card>
  );
}

export function SensorChart({ farmId, deviceId, sensorType, band, initialHours = 24 }: { farmId?: string; deviceId?: string; sensorType: string; band?: [number, number]; initialHours?: number }) {
  const [hours, setHours] = useState(initialHours);
  const path = deviceId ? `/devices/${deviceId}/readings?series=${sensorType}&hours=${hours}` : `/farms/${farmId}/readings?sensorType=${sensorType}&hours=${hours}`;
  const { data, loading, error } = useApi<{ series: Point[] }>(path);
  const meta = SENSOR_LABELS[sensorType] ?? { label: sensorType, unit: "", icon: "📟" };
  const colors: Record<string, string> = { soil_moisture: "#2563eb", air_temperature: "#ea580c", air_humidity: "#0891b2", soil_temperature: "#a16207", soil_ph: "#7c3aed" };
  return (
    <Card
      title={`${meta.icon} ${meta.label}`}
      subtitle="Valid readings only, averaged per time bucket"
      action={
        <Select value={hours} onChange={(e) => setHours(Number(e.target.value))} className="!w-auto !py-1 text-xs" aria-label={`${meta.label} period`}>
          <option value={6}>6 h</option>
          <option value={24}>24 h</option>
          <option value={72}>3 days</option>
          <option value={168}>7 days</option>
          <option value={720}>30 days</option>
        </Select>
      }
    >
      {loading && !data ? <Skeleton className="h-40" /> : error ? <Alert tone="warning">{error}</Alert> : <LineChart data={data?.series ?? []} unit={meta.unit} band={band} color={colors[sensorType]} />}
    </Card>
  );
}
