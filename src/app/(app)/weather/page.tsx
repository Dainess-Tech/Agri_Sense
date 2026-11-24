"use client";
import { useEffect, useState } from "react";
import { useApi, useApp } from "@/lib/client/hooks";
import { SoilPanel, WeatherPanel } from "@/components/farm-widgets";
import { WeatherChart } from "@/components/charts";
import { Alert, Card, DataTypeBadge, EmptyState, LinkButton, PageHeader, Select, Skeleton } from "@/components/ui";

interface Hist { daily: { date: string; tMax: number | null; tMin: number | null; precipMm: number | null }[]; retrievedAt: string; provider: string }

export default function WeatherPage() {
  const { farmId, farms } = useApp();
  const [days, setDays] = useState(90);
  const hist = useApi<Hist>(farmId ? `/farms/${farmId}/weather?historyDays=${days}` : null);
  useEffect(() => { document.title = "Weather & soil · AgriSense"; }, []);
  if (!farmId) return <EmptyState title="No farm yet" action={<LinkButton href="/farms?new=1">Add a farm</LinkButton>} />;
  const farm = farms.find((f) => f.id === farmId);
  const historyDays = Array.isArray(hist.data?.daily) ? hist.data.daily : null;
  const total = historyDays?.reduce((a, d) => a + (d.precipMm ?? 0), 0) ?? 0;
  return (
    <>
      <PageHeader title="Weather & soil" description={`Environmental intelligence for ${farm?.name ?? "your farm"} — every value is labelled as measured, modelled or forecast.`} />
      <div className="space-y-5">
        <WeatherPanel farmId={farmId} />
        <Card
          title="Historical weather"
          subtitle={hist.data ? `${hist.data.provider} · retrieved ${new Date(hist.data.retrievedAt).toLocaleString()} · total rain ${total.toFixed(0)} mm` : undefined}
          action={
            <div className="flex items-center gap-2">
              <DataTypeBadge type="modelled" />
              <Select aria-label="History period" className="!w-auto !py-1 text-xs" value={days} onChange={(e) => setDays(Number(e.target.value))}>
                <option value={30}>30 days</option><option value={90}>90 days</option><option value={180}>180 days</option><option value={365}>1 year</option>
              </Select>
            </div>
          }
        >
          {hist.loading && !hist.data ? <Skeleton className="h-48" /> : hist.error ? <Alert tone="warning">{hist.error}</Alert> : hist.data && !historyDays ? <Alert tone="warning">Historical weather data is incomplete. Please reload this page.</Alert> : (
            <>
              <WeatherChart days={(historyDays ?? []).map((d) => ({ date: d.date, rain: d.precipMm, tMax: d.tMax, tMin: d.tMin, kind: "model" }))} />
              <a className="mt-3 inline-block text-sm font-semibold text-leaf-800 underline" href={`/api/v1/reports/farms/${farmId}?type=weather&days=${days}`}>⬇ Export as CSV</a>
            </>
          )}
        </Card>
        <SoilPanel farmId={farmId} />
      </div>
    </>
  );
}
