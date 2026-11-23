"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { fmtDate, fmtDateTime, RISK_LABELS, useApi } from "@/lib/client/hooks";
import { Alert, Badge, Card, DataTypeBadge, LinkButton, PageHeader, SavedDataNotice, SeverityBadge, Spinner, cx } from "@/components/ui";

interface Factor { key: string; label: string; multiplier: number; impact: string; explanation: string; dataType: string }
interface Detail {
  prediction: {
    id: string; cropName: string; yieldMin: string; yieldMax: string; yieldUnit: string; totalMin: string; totalMax: string; totalUnit: string;
    harvestStart: string; harvestEnd: string; dataQualityScore: number; methodVersion: string; createdAt: string;
    conditionsSummary: { rainSincePlantingMm: number | null; forecastRainMm: number | null; meanTempC: number | null; gddAccumulated: number | null; hotDays: number; coldDays: number; soilPh: number | null; soilPhSource: string | null; soilMoistureAvg: number | null; soilTexture: string | null; growthProgressPct: number; areaHa: number; dataQuality: { score: number; components: { name: string; available: boolean; weight: number; note: string }[] } };
    factors: Factor[]; limitations: string[];
  };
  farm: { id: string; name: string };
  planting: { plantingDate: string; plantedArea: string; areaUnit: string; irrigation: string; actualYield: string | null; actualYieldUnit: string | null } | null;
  risks: { id: string; category: string; severity: string; explanation: string }[];
  inputs: { snapshot: unknown; sources: unknown; createdAt: string } | null;
  version: { version: string; method: string; description: string } | null;
  previous: { id: string; yieldMin: string; yieldMax: string; createdAt: string; methodVersion: string } | null;
}

export default function PredictionDetail() {
  const { predictionId } = useParams<{ predictionId: string }>();
  const { data, loading, error, savedAt } = useApi<Detail>(`/predictions/${predictionId}`);
  const [showInputs, setShowInputs] = useState(false);
  useEffect(() => { if (data) document.title = `${data.prediction.cropName} prediction · AgriSense`; }, [data]);
  if (loading && !data) return <Spinner label="Loading prediction…" />;
  if (error && !data) return <Alert tone="error">{error}</Alert>;
  if (!data) return null;
  const p = data.prediction;
  const c = p.conditionsSummary;
  const q = p.dataQualityScore;
  const mid = (Number(p.yieldMin) + Number(p.yieldMax)) / 2;
  const prevMid = data.previous ? (Number(data.previous.yieldMin) + Number(data.previous.yieldMax)) / 2 : null;

  return (
    <div className="space-y-5">
      <PageHeader
        title={`${p.cropName} yield estimate`}
        description={`${data.farm.name} · generated ${fmtDateTime(p.createdAt)} · ${p.methodVersion}`}
        action={<><LinkButton variant="secondary" href={`/reports/${data.farm.id}`}>📄 Farm report</LinkButton><LinkButton href="/predictions">New prediction</LinkButton></>}
      />
      <SavedDataNotice savedAt={savedAt} />

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl bg-leaf-800 p-5 text-white shadow md:col-span-2">
          <p className="text-sm text-leaf-200">Estimated yield range</p>
          <p className="mt-1 text-4xl font-extrabold">{p.yieldMin} – {p.yieldMax} <span className="text-xl font-semibold text-leaf-200">{p.yieldUnit}</span></p>
          <p className="mt-2 text-leaf-100">Total production on {c.areaHa} ha: <strong className="text-white">{p.totalMin} – {p.totalMax} {p.totalUnit}</strong></p>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/20" aria-label={`Growth progress ${c.growthProgressPct}%`}>
            <div className="h-full rounded-full bg-amber-400" style={{ width: `${c.growthProgressPct}%` }} />
          </div>
          <p className="mt-1 text-xs text-leaf-200">Season progress ≈ {c.growthProgressPct}%{data.planting && ` · planted ${fmtDate(data.planting.plantingDate)} · ${data.planting.irrigation}`}</p>
        </div>
        <div className="grid gap-4">
          <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
            <p className="text-xs uppercase tracking-wide text-stone-500">Expected harvest window</p>
            <p className="mt-1 text-lg font-bold">{fmtDate(p.harvestStart)} – {fmtDate(p.harvestEnd)}</p>
          </div>
          <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
            <p className="text-xs uppercase tracking-wide text-stone-500">Data quality</p>
            <p className={cx("mt-1 text-lg font-bold", q >= 70 ? "text-leaf-700" : q >= 45 ? "text-amber-700" : "text-red-700")}>{q}% {q >= 70 ? "Good" : q >= 45 ? "Fair" : "Limited"}</p>
            <p className="text-xs text-stone-500">Lower quality → wider range</p>
          </div>
        </div>
      </div>

      {data.planting?.actualYield && (
        <Alert tone="success">Actual harvest recorded: <strong>{data.planting.actualYield} {data.planting.actualYieldUnit}</strong> — compare with the estimated total of {p.totalMin}–{p.totalMax} {p.totalUnit}.</Alert>
      )}
      {data.previous && prevMid !== null && (
        <Alert tone="info">
          Compared with the <Link className="font-semibold underline" href={`/predictions/${data.previous.id}`}>previous prediction</Link> ({fmtDate(data.previous.createdAt)}: {data.previous.yieldMin}–{data.previous.yieldMax} {p.yieldUnit}), the midpoint {mid >= prevMid ? "rose" : "fell"} by {Math.abs(mid - prevMid).toFixed(2)} {p.yieldUnit}.
        </Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Identified production risks">
          {data.risks.length ? (
            <ul className="space-y-2">
              {data.risks.map((r) => (
                <li key={r.id} className="rounded-xl border border-stone-200 p-3 text-sm">
                  <div className="flex items-center gap-2"><SeverityBadge severity={r.severity} /><span className="font-medium">{RISK_LABELS[r.category] ?? r.category}</span></div>
                  <p className="mt-1 text-stone-600">{r.explanation}</p>
                </li>
              ))}
            </ul>
          ) : <p className="rounded-xl bg-leaf-50 p-3 text-sm text-leaf-800">✅ No production risks identified from available data.</p>}
        </Card>
        <Card title="Environmental conditions summary">
          <dl className="grid grid-cols-2 gap-2 text-sm">
            {[
              ["Rain since planting", c.rainSincePlantingMm !== null ? `${c.rainSincePlantingMm} mm` : "—", "modelled"],
              ["Forecast rain (season window)", c.forecastRainMm !== null ? `${c.forecastRainMm} mm` : "—", "forecast"],
              ["Mean temperature", c.meanTempC !== null ? `${c.meanTempC} °C` : "—", "calculated"],
              ["Growing degree days", c.gddAccumulated !== null ? `${c.gddAccumulated} °C·d` : "—", "calculated"],
              ["Heat / cold stress days", `${c.hotDays} / ${c.coldDays}`, "calculated"],
              ["Soil pH", c.soilPh !== null ? String(c.soilPh) : "—", c.soilPhSource ?? "modelled"],
              ["Soil moisture (7-day avg)", c.soilMoistureAvg !== null ? `${c.soilMoistureAvg} %` : "—", "measured"],
              ["Soil texture", c.soilTexture ?? "—", "modelled"],
            ].map(([k, v, t]) => (
              <div key={k} className="rounded-xl bg-stone-50 p-2.5">
                <dt className="flex items-center justify-between gap-1 text-xs text-stone-500">{k} <DataTypeBadge type={t} /></dt>
                <dd className="mt-0.5 font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>

      <Card title="Factors influencing the estimate" subtitle="Each factor multiplies the crop's attainable yield; values below 1 reduce the estimate.">
        <ul className="space-y-2">
          {p.factors.map((f) => (
            <li key={f.key} className="flex flex-col gap-1 rounded-xl border border-stone-200 p-3 sm:flex-row sm:items-center sm:gap-4">
              <div className={cx("w-20 shrink-0 text-lg font-bold", f.impact === "negative" ? "text-orange-700" : f.impact === "positive" ? "text-leaf-700" : "text-stone-700")}>×{f.multiplier.toFixed(2)}</div>
              <div className="flex-1">
                <p className="flex flex-wrap items-center gap-2 font-medium">{f.label} <DataTypeBadge type={f.dataType} /></p>
                <p className="text-sm text-stone-600">{f.explanation}</p>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Data used & quality">
          <ul className="space-y-1.5 text-sm">
            {c.dataQuality.components.map((d) => (
              <li key={d.name} className="flex items-start gap-2">
                <span aria-hidden>{d.available ? "✅" : "⚪"}</span>
                <span><strong>{d.name}</strong> <span className="text-stone-500">({d.weight} pts)</span> — {d.note}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Limitations">
          <ul className="list-disc space-y-1 pl-5 text-sm text-stone-700">
            {p.limitations.map((l) => <li key={l}>{l}</li>)}
          </ul>
        </Card>
      </div>

      <Card title="Method & reproducibility" action={<button className="text-sm font-semibold text-leaf-800 underline" onClick={() => setShowInputs((s) => !s)}>{showInputs ? "Hide" : "Show"} input snapshot</button>}>
        <p className="text-sm text-stone-700"><Badge tone="violet">{data.version?.version ?? p.methodVersion}</Badge> {data.version?.method}</p>
        {data.version?.description && <p className="mt-1 text-sm text-stone-600">{data.version.description}</p>}
        <p className="mt-2 text-xs text-stone-500">All inputs, data sources and retrieval times were saved when this prediction was generated, so it stays reproducible even if providers later revise their data.</p>
        {showInputs && data.inputs && (
          <pre className="mt-3 max-h-96 overflow-auto rounded-xl bg-stone-900 p-3 text-xs text-stone-100">{JSON.stringify({ sources: data.inputs.sources, snapshot: data.inputs.snapshot }, null, 2)}</pre>
        )}
      </Card>
    </div>
  );
}
