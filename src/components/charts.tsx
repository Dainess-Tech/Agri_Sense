"use client";
/** Lightweight dependency-free SVG charts (keeps the PWA bundle small for rural networks). */
import { useId } from "react";

export interface Point {
  t: string;
  v: number;
}

export function LineChart({ data, unit, height = 180, color = "#2f7a46", band }: { data: Point[]; unit: string; height?: number; color?: string; band?: [number, number] }) {
  const gid = useId();
  if (!data.length) return <div className="flex h-32 items-center justify-center rounded-xl bg-stone-50 text-sm text-stone-500">No valid readings in this period</div>;
  const W = 600, H = height, P = { l: 40, r: 10, t: 10, b: 24 };
  const vals = data.map((d) => d.v).concat(band ?? []);
  let min = Math.min(...vals), max = Math.max(...vals);
  if (min === max) { min -= 1; max += 1; }
  const pad = (max - min) * 0.1; min -= pad; max += pad;
  const t0 = new Date(data[0].t).getTime(), t1 = new Date(data[data.length - 1].t).getTime() || t0 + 1;
  const x = (t: string) => P.l + ((new Date(t).getTime() - t0) / Math.max(1, t1 - t0)) * (W - P.l - P.r);
  const y = (v: number) => P.t + (1 - (v - min) / (max - min)) * (H - P.t - P.b);
  const path = data.map((d, i) => `${i ? "L" : "M"}${x(d.t).toFixed(1)},${y(d.v).toFixed(1)}`).join(" ");
  const area = `${path} L${x(data[data.length - 1].t)},${H - P.b} L${x(data[0].t)},${H - P.b} Z`;
  const ticks = [min + (max - min) * 0.1, (min + max) / 2, max - (max - min) * 0.1];
  const latest = data[data.length - 1];
  const fmt = (t: number) => new Date(t).toLocaleString(undefined, t1 - t0 > 2 * 86400000 ? { month: "short", day: "numeric" } : { hour: "2-digit", minute: "2-digit" });
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Chart: latest ${latest.v} ${unit}, ${data.length} points, range ${Math.min(...data.map((d) => d.v))} to ${Math.max(...data.map((d) => d.v))} ${unit}`}>
        <defs>
          <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {band && <rect x={P.l} width={W - P.l - P.r} y={y(band[1])} height={Math.max(0, y(band[0]) - y(band[1]))} fill="#2f7a46" opacity="0.07" />}
        {ticks.map((v) => (
          <g key={v}>
            <line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} stroke="#e7e5e4" strokeDasharray="3 3" />
            <text x={P.l - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill="#78716c">{v.toFixed(v < 10 ? 1 : 0)}</text>
          </g>
        ))}
        <path d={area} fill={`url(#${gid})`} />
        <path d={path} fill="none" stroke={color} strokeWidth="2.2" strokeLinejoin="round" />
        <circle cx={x(latest.t)} cy={y(latest.v)} r="4" fill={color} />
        <text x={P.l} y={H - 6} fontSize="11" fill="#78716c">{fmt(t0)}</text>
        <text x={W - P.r} y={H - 6} fontSize="11" fill="#78716c" textAnchor="end">{fmt(t1)}</text>
      </svg>
      {band && <figcaption className="mt-1 text-xs text-stone-500">Shaded band: crop-suitable range ({band[0]}–{band[1]} {unit})</figcaption>}
    </figure>
  );
}

export interface DayBar {
  date: string;
  rain: number | null;
  tMax: number | null;
  tMin: number | null;
  kind: string;
}

/** Combined daily rainfall bars + temperature range; forecast days visually distinguished. */
export function WeatherChart({ days, height = 200 }: { days: DayBar[]; height?: number }) {
  if (!days.length) return null;
  const W = 640, H = height, P = { l: 34, r: 34, t: 10, b: 26 };
  const n = days.length, bw = (W - P.l - P.r) / n;
  const maxRain = Math.max(10, ...days.map((d) => d.rain ?? 0));
  const temps = days.flatMap((d) => [d.tMax, d.tMin]).filter((v): v is number => v !== null);
  const tMin = Math.min(...temps, 0) - 2, tMax = Math.max(...temps, 20) + 2;
  const yR = (v: number) => H - P.b - (v / maxRain) * (H - P.t - P.b);
  const yT = (v: number) => P.t + (1 - (v - tMin) / (tMax - tMin)) * (H - P.t - P.b);
  const firstForecast = days.findIndex((d) => d.kind === "forecast");
  const line = (key: "tMax" | "tMin") => days.map((d, i) => (d[key] === null ? "" : `${i && days[i - 1][key] !== null ? "L" : "M"}${(P.l + i * bw + bw / 2).toFixed(1)},${yT(d[key]!).toFixed(1)}`)).join(" ");
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Daily rainfall and temperature chart">
        {firstForecast > 0 && <rect x={P.l + firstForecast * bw} y={P.t} width={W - P.r - (P.l + firstForecast * bw)} height={H - P.t - P.b} fill="#7c3aed" opacity="0.05" />}
        {firstForecast > 0 && <text x={P.l + firstForecast * bw + 4} y={P.t + 12} fontSize="11" fill="#6d28d9">Forecast →</text>}
        {days.map((d, i) => (
          <rect key={d.date} x={P.l + i * bw + bw * 0.15} width={bw * 0.7} y={yR(d.rain ?? 0)} height={H - P.b - yR(d.rain ?? 0)} rx="2" fill={d.kind === "forecast" ? "#93c5fd" : "#3b82f6"}>
            <title>{`${d.date}: ${d.rain ?? "—"} mm, ${d.tMin ?? "—"}–${d.tMax ?? "—"} °C (${d.kind === "forecast" ? "forecast" : "modelled"})`}</title>
          </rect>
        ))}
        <path d={line("tMax")} fill="none" stroke="#ea580c" strokeWidth="2" />
        <path d={line("tMin")} fill="none" stroke="#0891b2" strokeWidth="2" />
        <text x={P.l - 4} y={P.t + 8} fontSize="10" fill="#3b82f6" textAnchor="end">{Math.round(maxRain)}mm</text>
        <text x={W - P.r + 4} y={P.t + 8} fontSize="10" fill="#ea580c">{Math.round(tMax)}°</text>
        <text x={W - P.r + 4} y={H - P.b} fontSize="10" fill="#0891b2">{Math.round(tMin)}°</text>
        {days.map((d, i) => (i % Math.ceil(n / 8) === 0 ? <text key={d.date} x={P.l + i * bw + bw / 2} y={H - 8} fontSize="10" fill="#78716c" textAnchor="middle">{d.date.slice(5)}</text> : null))}
      </svg>
      <figcaption className="mt-1 flex flex-wrap gap-3 text-xs text-stone-500">
        <span><span className="mr-1 inline-block h-2 w-3 rounded bg-blue-500" />Rain (modelled)</span>
        <span><span className="mr-1 inline-block h-2 w-3 rounded bg-blue-300" />Rain (forecast)</span>
        <span><span className="mr-1 inline-block h-0.5 w-3 bg-orange-600 align-middle" />Max °C</span>
        <span><span className="mr-1 inline-block h-0.5 w-3 bg-cyan-600 align-middle" />Min °C</span>
      </figcaption>
    </figure>
  );
}
