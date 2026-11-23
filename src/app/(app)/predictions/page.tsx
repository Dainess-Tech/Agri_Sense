"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState, type FormEvent } from "react";
import { api, errorMessage } from "@/lib/client/api";
import { fmtDate, fmtDateTime, useApi, useApp } from "@/lib/client/hooks";
import type { PlantingRow } from "@/components/planting-form";
import { Alert, Badge, Button, Card, EmptyState, Field, LinkButton, PageHeader, SavedDataNotice, Select, Spinner } from "@/components/ui";
import { useConnection } from "@/components/pwa";

interface PredRow { id: string; cropName: string; farmName?: string; yieldMin: string; yieldMax: string; yieldUnit: string; totalMin: string; totalMax: string; totalUnit: string; harvestStart: string; harvestEnd: string; dataQualityScore: number; methodVersion: string; createdAt: string }

const STEPS = ["Validating farm & crop information", "Retrieving weather history & forecast", "Retrieving soil properties", "Reading recent sensor measurements", "Running crop-specific model", "Estimating harvest window & risks", "Saving prediction & input snapshot"];

function PredictionsInner() {
  const { farmId } = useApp();
  const params = useSearchParams();
  const router = useRouter();
  const { online } = useConnection();
  const plantingsQ = useApi<{ plantings: (PlantingRow & { farmName: string; farmId: string })[] }>(`/plantings${farmId ? `?farmId=${farmId}` : ""}`);
  const historyQ = useApi<{ predictions: PredRow[] }>(`/predictions${farmId ? `?farmId=${farmId}` : ""}`);
  const [plantingId, setPlantingId] = useState(params.get("plantingId") ?? "");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { document.title = "Predictions · AgriSense"; }, []);
  const eligible = useMemo(
    () => plantingsQ.data?.plantings.filter((p) => !["harvested", "failed"].includes(p.status)) ?? [],
    [plantingsQ.data?.plantings],
  );
  const selectedPlantingId = plantingId || eligible[0]?.id || "";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setStep(0);
    const t = setInterval(() => setStep((s) => Math.min(STEPS.length - 1, s + 1)), 700);
    try {
      const r = await api<{ prediction: { id: string } }>("/predictions", { method: "POST", body: { plantingId: selectedPlantingId } });
      router.push(`/predictions/${r.prediction.id}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      clearInterval(t);
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Yield predictions" description="Estimated yield range, total production, harvest window and risks — calculated from crop parameters, weather, soil and sensor data." />
      <div className="grid gap-5 lg:grid-cols-5">
        <Card title="Request a prediction" className="lg:col-span-2">
          {!online && <div className="mb-3"><Alert tone="warning">📴 You are offline. New predictions need current weather and soil data, so they can&apos;t be generated now. Previously generated predictions remain available below.</Alert></div>}
          {plantingsQ.loading && !plantingsQ.data ? <Spinner /> : !eligible.length ? (
            <EmptyState icon="🌱" title="No active plantings" action={<LinkButton href={farmId ? `/farms/${farmId}?tab=crops` : "/farms"}>Add a planting</LinkButton>}>Predictions are made per planting. Record a crop planting first.</EmptyState>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              {error && <Alert tone="error">{error}</Alert>}
              <Field label="Planting" htmlFor="pl">
                <Select id="pl" value={selectedPlantingId} onChange={(e) => setPlantingId(e.target.value)} required>
                  {eligible.map((p) => <option key={p.id} value={p.id}>{p.cropName}{p.varietyName ? ` (${p.varietyName})` : ""} · {p.farmName} · planted {p.plantingDate}</option>)}
                </Select>
              </Field>
              <p className="text-xs text-stone-500">Inputs used: farm coordinates, crop & variety, planting date, area, irrigation, weather history & forecast (Open-Meteo), soil (SoilGrids), and the last 7 days of valid sensor readings.</p>
              <Button type="submit" loading={busy} disabled={!online} className="w-full">Generate prediction</Button>
              {busy && (
                <ol className="space-y-1 text-sm" aria-live="polite">
                  {STEPS.map((s, i) => <li key={s} className={i < step ? "text-leaf-700" : i === step ? "font-semibold text-stone-900" : "text-stone-400"}>{i < step ? "✓" : i === step ? "…" : "○"} {s}</li>)}
                </ol>
              )}
            </form>
          )}
        </Card>
        <Card title="Prediction history" className="lg:col-span-3">
          <SavedDataNotice savedAt={historyQ.savedAt} />
          {historyQ.loading && !historyQ.data ? <Spinner /> : !historyQ.data?.predictions.length ? <p className="text-sm text-stone-500">No predictions yet.</p> : (
            <ul className="divide-y divide-stone-100">
              {historyQ.data.predictions.map((p) => (
                <li key={p.id}>
                  <Link href={`/predictions/${p.id}`} className="block py-3 hover:bg-stone-50">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold">{p.cropName} <span className="font-normal text-stone-500">· {p.farmName}</span></span>
                      <span className="text-xs text-stone-500">{fmtDateTime(p.createdAt)}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-sm">
                      <span><strong>{p.yieldMin}–{p.yieldMax}</strong> {p.yieldUnit}</span>
                      <span className="text-stone-600">Total {p.totalMin}–{p.totalMax} {p.totalUnit}</span>
                      <span className="text-stone-600">Harvest {fmtDate(p.harvestStart)}–{fmtDate(p.harvestEnd)}</span>
                      <Badge tone={p.dataQualityScore >= 70 ? "green" : p.dataQualityScore >= 45 ? "amber" : "red"}>Data quality {p.dataQualityScore}%</Badge>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

export default function PredictionsPage() {
  return <Suspense><PredictionsInner /></Suspense>;
}
