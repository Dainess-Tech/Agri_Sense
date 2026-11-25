"use client";
import { useParams } from "next/navigation";
import { useEffect } from "react";
import { fmtDate, fmtDateTime, RISK_LABELS, SENSOR_LABELS, useApi } from "@/lib/client/hooks";
import { Alert, Button, Spinner } from "@/components/ui";

interface Summary {
  generatedAt: string;
  farm: { name: string; locationName: string | null; latitude: string; longitude: string; size: string; areaUnit: string; irrigation: string; soilType: string | null; elevationM: string | null; createdAt: string };
  plantings?: { id: string; cropName: string; varietyName: string | null; plantingDate: string; plantedArea: string; areaUnit: string; status: string; season: string | null; actualYield: string | null; actualYieldUnit: string | null }[];
  predictions?: { id: string; cropName: string; yieldMin: string; yieldMax: string; yieldUnit: string; totalMin: string; totalMax: string; totalUnit: string; harvestStart: string; harvestEnd: string; dataQualityScore: number; methodVersion: string; createdAt: string }[];
  risks?: { id: string; category: string; severity: string; title: string; active: boolean; detectedAt: string }[];
  recommendations?: { id: string; title: string; status: string; severity: string; requiresExpert: boolean }[];
  latestReadings?: { sensorType: string; value: number; unit: string; quality: string; measuredAt: string }[];
  devices?: { name: string; uid: string; lastSeenAt: string | null }[];
  soil: { phH2o: string | null; clayPct: string | null; sandPct: string | null; siltPct: string | null; organicCarbonGKg: string | null; texture: string | null; available: boolean } | null;
}

const th = "border-b border-stone-300 py-1.5 pr-3 text-left text-xs font-semibold uppercase text-stone-500";
const td = "border-b border-stone-100 py-1.5 pr-3 align-top";

export default function PrintableReport() {
  const { farmId } = useParams<{ farmId: string }>();
  const { data, loading, error } = useApi<Summary>(`/api/v1/reports/farms/${farmId}?type=summary`);
  useEffect(() => { if (data) document.title = `AgriSense report – ${data.farm.name}`; }, [data]);
  if (loading && !data) return <Spinner label="Preparing report…" />;
  if (error && !data) return <Alert tone="error">{error}</Alert>;
  if (!data) return null;
  const f = data.farm;
  const plantings = data.plantings ?? [];
  const predictions = data.predictions ?? [];
  const latestReadings = data.latestReadings ?? [];
  const devices = data.devices ?? [];
  const risks = data.risks ?? [];
  const recommendations = data.recommendations ?? [];
  return (
    <article className="mx-auto max-w-4xl rounded-2xl bg-white p-6 text-sm shadow-sm print:max-w-none print:p-0 print:shadow-none sm:p-10">
      <div className="no-print mb-6 flex justify-end gap-2">
        <Button onClick={() => window.print()}>⬇ Download PDF</Button>
      </div>
      <header className="flex items-start justify-between border-b-2 border-leaf-700 pb-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-leaf-700">AgriSense farm report</p>
          <h1 className="mt-1 text-2xl font-bold">{f.name}</h1>
          <p className="text-stone-600">{f.locationName ?? ""} ({f.latitude}, {f.longitude})</p>
        </div>
        <div className="text-right text-xs text-stone-500">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/agrisense.svg" alt="" className="ml-auto h-10 w-10 rounded-lg" />
          <p className="mt-1">Generated {fmtDateTime(data.generatedAt)}</p>
          <p>{new Date(data.generatedAt).toISOString()} UTC</p>
        </div>
      </header>

      <section className="mt-5">
        <h2 className="mb-2 text-base font-bold">Farm details</h2>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
          <p><span className="text-stone-500">Size:</span> {f.size} {f.areaUnit}</p>
          <p><span className="text-stone-500">Irrigation:</span> {f.irrigation}</p>
          <p><span className="text-stone-500">Soil type (farmer):</span> {f.soilType ?? "Unknown"}</p>
          <p><span className="text-stone-500">Elevation:</span> {f.elevationM ? `${f.elevationM} m` : "—"}</p>
          <p><span className="text-stone-500">Registered:</span> {fmtDate(f.createdAt)}</p>
        </div>
        {data.soil?.available && (
          <p className="mt-2 text-stone-700"><span className="text-stone-500">Modelled soil (SoilGrids, 0–15 cm):</span> pH {data.soil.phH2o ?? "—"}, clay {data.soil.clayPct ?? "—"}%, sand {data.soil.sandPct ?? "—"}%, silt {data.soil.siltPct ?? "—"}%, organic carbon {data.soil.organicCarbonGKg ?? "—"} g/kg{data.soil.texture ? ` (${data.soil.texture})` : ""}</p>
        )}
      </section>

      <section className="mt-6 break-inside-avoid">
        <h2 className="mb-2 text-base font-bold">Plantings & harvests</h2>
        <table className="w-full"><thead><tr><th className={th}>Crop</th><th className={th}>Planted</th><th className={th}>Area</th><th className={th}>Season</th><th className={th}>Status</th><th className={th}>Actual yield</th></tr></thead>
          <tbody>{plantings.map((p) => <tr key={p.id}><td className={td}>{p.cropName}{p.varietyName ? ` (${p.varietyName})` : ""}</td><td className={td}>{fmtDate(p.plantingDate)}</td><td className={td}>{p.plantedArea} {p.areaUnit}</td><td className={td}>{p.season ?? "—"}</td><td className={td}>{p.status}</td><td className={td}>{p.actualYield ? `${p.actualYield} ${p.actualYieldUnit}` : "—"}</td></tr>)}</tbody>
        </table>
        {!plantings.length && <p className="text-stone-500">No plantings recorded.</p>}
      </section>

      <section className="mt-6 break-inside-avoid">
        <h2 className="mb-2 text-base font-bold">Yield predictions</h2>
        <table className="w-full"><thead><tr><th className={th}>Generated</th><th className={th}>Crop</th><th className={th}>Yield range</th><th className={th}>Total production</th><th className={th}>Harvest window</th><th className={th}>Data quality</th></tr></thead>
          <tbody>{predictions.map((p) => <tr key={p.id}><td className={td}>{fmtDate(p.createdAt)}</td><td className={td}>{p.cropName}</td><td className={td}>{p.yieldMin}–{p.yieldMax} {p.yieldUnit}</td><td className={td}>{p.totalMin}–{p.totalMax} {p.totalUnit}</td><td className={td}>{fmtDate(p.harvestStart)} – {fmtDate(p.harvestEnd)}</td><td className={td}>{p.dataQualityScore}%</td></tr>)}</tbody>
        </table>
        {!predictions.length && <p className="text-stone-500">No predictions generated.</p>}
        {predictions[0] && <p className="mt-1 text-xs text-stone-500">Method: {predictions[0].methodVersion} (rule-based; not yet calibrated against local harvest records).</p>}
      </section>

      <section className="mt-6 grid gap-6 sm:grid-cols-2 break-inside-avoid">
        <div>
          <h2 className="mb-2 text-base font-bold">Latest sensor readings</h2>
          <ul className="space-y-1">{latestReadings.map((r) => <li key={r.sensorType}>{SENSOR_LABELS[r.sensorType]?.label ?? r.sensorType}: <strong>{r.value} {r.unit}</strong> <span className="text-xs text-stone-500">({fmtDateTime(r.measuredAt)}{r.quality !== "valid" ? `, ${r.quality}` : ""})</span></li>)}</ul>
          {!latestReadings.length && <p className="text-stone-500">No recent readings.</p>}
          <p className="mt-2 text-xs text-stone-500">Devices: {devices.map((d) => `${d.name} (last seen ${d.lastSeenAt ? fmtDateTime(d.lastSeenAt) : "never"})`).join("; ") || "none"}</p>
        </div>
        <div>
          <h2 className="mb-2 text-base font-bold">Risks</h2>
          <ul className="space-y-1">{risks.slice(0, 12).map((r) => <li key={r.id}><span className="font-medium capitalize">[{r.severity}]</span> {r.title} <span className="text-xs text-stone-500">— {RISK_LABELS[r.category] ?? r.category}, {r.active ? "active" : "resolved"}, {fmtDate(r.detectedAt)}</span></li>)}</ul>
          {!risks.length && <p className="text-stone-500">No risks recorded.</p>}
        </div>
      </section>

      <section className="mt-6 break-inside-avoid">
        <h2 className="mb-2 text-base font-bold">Recommendations</h2>
        <ul className="list-disc space-y-1 pl-5">{recommendations.map((r) => <li key={r.id}>{r.title} <span className="text-xs text-stone-500">({r.status}{r.requiresExpert ? ", requires expert confirmation" : ""})</span></li>)}</ul>
        {!recommendations.length && <p className="text-stone-500">None.</p>}
      </section>

      <footer className="mt-8 border-t border-stone-200 pt-3 text-xs text-stone-500">
        Units: yields in tonnes per hectare (t/ha) unless stated; temperatures °C; soil moisture % volumetric water content; rainfall mm. Weather: Open-Meteo (modelled/forecast, CC BY 4.0). Soil: ISRIC SoilGrids (modelled, CC BY 4.0). Estimates are decision-support information, not guarantees.
      </footer>
    </article>
  );
}
