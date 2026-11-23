"use client";
import Link from "next/link";
import { useEffect } from "react";
import { fmtDate, fmtDateTime, timeAgo, useApi, useApp, type FarmLite } from "@/lib/client/hooks";
import { LatestReadings, RiskList, SoilPanel, WeatherPanel, type Reading } from "@/components/farm-widgets";
import { Alert, Badge, Card, EmptyState, LinkButton, PageHeader, SavedDataNotice, Skeleton, Stat } from "@/components/ui";

interface Dash {
  farms: { id: string; name: string }[];
  selectedFarmId: string | null;
  totals: { farms: number; activePlantings: number; devices: number; devicesOnline: number; activeRisks: number; unread: number };
  seasons?: string[];
  selected: null | {
    farm: FarmLite;
    plantings: { id: string; cropName: string; plantingDate: string; plantedArea: string; areaUnit: string; status: string; season: string | null }[];
    predictions: { id: string; cropName: string; yieldMin: string; yieldMax: string; yieldUnit: string; harvestStart: string; harvestEnd: string; createdAt: string; dataQualityScore: number }[];
    risks: { id: string; category: string; severity: string; title: string; explanation: string; source: string; detectedAt: string }[];
    activities: { id: string; type: string; description: string; occurredAt: string }[];
    latestReadings: Reading[];
    devices: { id: string; name: string; status: string; lastSeenAt: string | null; deviceUid: string }[];
  };
}

export default function DashboardPage() {
  const { farmId, user } = useApp();
  const { data, loading, error, savedAt } = useApi<Dash>(`/dashboard${farmId ? `?farmId=${farmId}` : ""}`);
  useEffect(() => { document.title = "Dashboard · AgriSense"; }, []);

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div>
        <Skeleton className="h-64" />
      </div>
    );
  }
  const errorNotice = error ? <Alert tone="error">{error}</Alert> : null;
  if (!data) return errorNotice;

  if (!data.selected) {
    return (
      <>
        {errorNotice}
        <PageHeader title={`Welcome${user ? `, ${user.fullName.split(" ")[0]}` : ""} 👋`} description="Let's get your land talking." />
        <EmptyState icon="🌾" title="Register your first farm" action={<LinkButton href="/farms?new=1">Add a farm</LinkButton>}>
          Add your farm&apos;s location and size. Then record a planting, connect a sensor and request your first yield prediction.
        </EmptyState>
      </>
    );
  }
  const s = data.selected;
  const t = data.totals;
  return (
    <div className="space-y-5">
      {errorNotice}
      <PageHeader
        title={s.farm.name}
        description={`${s.farm.locationName ?? `${Number(s.farm.latitude).toFixed(3)}, ${Number(s.farm.longitude).toFixed(3)}`} · ${s.farm.size} ${s.farm.areaUnit} · ${s.farm.irrigation}`}
        action={<><LinkButton href="/predictions" variant="primary">📈 New prediction</LinkButton><LinkButton href={`/farms/${s.farm.id}`} variant="secondary">Farm details</LinkButton></>}
      />
      <SavedDataNotice savedAt={savedAt} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Farms" value={t.farms} icon="🌾" />
        <Stat label="Active crops" value={t.activePlantings} icon="🌱" hint={data.seasons?.length ? `Seasons: ${data.seasons.join(", ")}` : undefined} />
        <Stat label="Devices online" value={`${t.devicesOnline}/${t.devices}`} icon="📡" />
        <Stat label="Active risks" value={t.activeRisks} icon="⚠️" />
        <Stat label="Unread alerts" value={t.unread} icon="🔔" />
      </div>

      <Card title="Latest sensor readings" action={<Link href="/monitoring" className="text-sm font-semibold text-leaf-800 hover:underline">Trends →</Link>}>
        <LatestReadings readings={s.latestReadings} />
      </Card>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <WeatherPanel farmId={s.farm.id} compact />
          <Card title="Active risks & alerts" action={<Link href={`/farms/${s.farm.id}?tab=risks`} className="text-sm font-semibold text-leaf-800 hover:underline">History →</Link>}>
            <RiskList risks={s.risks} />
          </Card>
          <Card title="Latest yield predictions" action={<Link href="/predictions" className="text-sm font-semibold text-leaf-800 hover:underline">All →</Link>}>
            {s.predictions.length ? (
              <ul className="divide-y divide-stone-100">
                {s.predictions.map((p) => (
                  <li key={p.id}>
                    <Link href={`/predictions/${p.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2.5 hover:bg-stone-50">
                      <span className="font-medium">{p.cropName}</span>
                      <span className="text-sm"><strong>{p.yieldMin}–{p.yieldMax}</strong> {p.yieldUnit}</span>
                      <span className="text-xs text-stone-500">Harvest {fmtDate(p.harvestStart)} – {fmtDate(p.harvestEnd)}</span>
                      <Badge tone={p.dataQualityScore >= 70 ? "green" : p.dataQualityScore >= 45 ? "amber" : "red"}>Data {p.dataQualityScore}%</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-stone-500">No predictions yet. <Link className="font-semibold text-leaf-800 underline" href="/predictions">Request one</Link>.</p>
            )}
          </Card>
        </div>
        <div className="space-y-5">
          <Card title="Current plantings">
            {s.plantings.length ? (
              <ul className="space-y-2">
                {s.plantings.map((p) => (
                  <li key={p.id} className="rounded-xl bg-stone-50 p-3 text-sm">
                    <div className="flex justify-between"><span className="font-semibold">{p.cropName}</span><Badge tone="green">{p.status}</Badge></div>
                    <p className="text-xs text-stone-500">Planted {fmtDate(p.plantingDate)} · {p.plantedArea} {p.areaUnit}{p.season ? ` · ${p.season}` : ""}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-stone-500">No active plantings. <Link className="font-semibold text-leaf-800 underline" href={`/farms/${s.farm.id}?tab=crops`}>Add one</Link>.</p>
            )}
          </Card>
          <Card title="Device status">
            {s.devices.length ? (
              <ul className="space-y-2">
                {s.devices.map((d) => (
                  <li key={d.id} className="flex items-center justify-between text-sm">
                    <span><span className={`mr-2 inline-block h-2.5 w-2.5 rounded-full ${d.status === "online" ? "bg-leaf-500" : d.status === "offline" ? "bg-red-500" : "bg-stone-300"}`} aria-hidden />{d.name}</span>
                    <span className="text-xs text-stone-500">{d.status === "never" ? "never reported" : timeAgo(d.lastSeenAt)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-stone-500">No devices. <Link className="font-semibold text-leaf-800 underline" href="/devices">Register an ESP32</Link>.</p>
            )}
          </Card>
          <SoilPanel farmId={s.farm.id} />
          <Card title="Recent activity">
            <ul className="space-y-2 text-sm">
              {s.activities.map((a) => (
                <li key={a.id}><p className="text-stone-800">{a.description}</p><p className="text-xs text-stone-400">{fmtDateTime(a.occurredAt)}</p></li>
              ))}
              {!s.activities.length && <li className="text-stone-500">No activity yet.</li>}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
