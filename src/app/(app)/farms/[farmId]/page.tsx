"use client";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { api, errorMessage, isQueued } from "@/lib/client/api";
import { fmtDate, fmtDateTime, timeAgo, useApi, useApp, type FarmLite } from "@/lib/client/hooks";
import { FarmForm } from "@/components/farm-form";
import { FarmMap } from "@/components/farm-map";
import { RiskList, SoilPanel, WeatherPanel } from "@/components/farm-widgets";
import { PlantingForm, PlantingUpdate, type PlantingRow } from "@/components/planting-form";
import { RecommendationList, type Rec } from "@/components/recommendations";
import { Alert, Badge, Button, Card, EmptyState, Field, Input, LinkButton, PageHeader, SavedDataNotice, Select, Spinner, Tabs } from "@/components/ui";

type Tab = "overview" | "crops" | "devices" | "risks" | "recommendations" | "activity" | "environment";

function FarmDetail() {
  const { farmId } = useParams<{ farmId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { refreshFarms, setFarmId } = useApp();
  const tabParam = (search.get("tab") as Tab) || "overview";
  const justCreated = search.get("new") === "1";
  // Re-derive the tab from the URL on query navigation, but keep local tab clicks until then.
  const [tabState, setTabState] = useState(() => ({ search, tab: tabParam }));
  const tab = tabState.search === search ? tabState.tab : tabParam;
  const setTab = (next: Tab) => setTabState({ search, tab: next });
  const farmQ = useApi<{ farm: FarmLite; canEdit: boolean }>(`/farms/${farmId}`);
  const [editing, setEditing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  useEffect(() => setFarmId(farmId), [farmId, setFarmId]);
  useEffect(() => { if (farmQ.data) document.title = `${farmQ.data.farm.name} · AgriSense`; }, [farmQ.data]);

  if (farmQ.loading && !farmQ.data) return <Spinner />;
  if (farmQ.error && !farmQ.data) return <Alert tone="error">{farmQ.error}</Alert>;
  if (!farmQ.data) return null;
  const { farm, canEdit } = farmQ.data;

  const archive = async () => {
    setActionError(null);
    try {
      await api(`/farms/${farm.id}`, { method: "PATCH", body: { version: farm.version, archived: !farm.archivedAt } });
      await refreshFarms();
      void farmQ.reload();
    } catch (e) {
      setActionError(errorMessage(e));
    }
  };
  const remove = async () => {
    if (!confirm(`Permanently delete "${farm.name}" and ALL its plantings, devices, readings and predictions? Consider archiving instead.`)) return;
    setActionError(null);
    try {
      await api(`/farms/${farm.id}`, { method: "DELETE" });
      await refreshFarms();
      router.push("/farms");
    } catch (e) {
      setActionError(errorMessage(e));
    }
  };

  return (
    <>
      <PageHeader
        title={farm.name}
        description={`${farm.locationName ?? "Location set by coordinates"} · ${farm.size} ${farm.areaUnit} · ${farm.irrigation}`}
        action={<><LinkButton href="/predictions">📈 Predict yield</LinkButton><LinkButton variant="secondary" href={`/reports/${farm.id}`}>📄 Report</LinkButton></>}
      />
      <SavedDataNotice savedAt={farmQ.savedAt} />
      {actionError && <div className="mb-4"><Alert tone="error">{actionError}</Alert></div>}
      {farm.archivedAt && <div className="mb-4"><Alert tone="warning">This farm is archived. Its history is preserved.</Alert></div>}
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "overview", label: "Overview" },
          { id: "crops", label: "Crops & plantings" },
          { id: "devices", label: "Devices" },
          { id: "risks", label: "Risks" },
          { id: "recommendations", label: "Recommendations" },
          { id: "environment", label: "Weather & soil" },
          { id: "activity", label: "Activity" },
        ]}
      >
      {tab === "overview" && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card title="Location">
            <FarmMap lat={Number(farm.latitude)} lng={Number(farm.longitude)} className="h-72" />
          </Card>
          <Card title="Farm details" action={canEdit && !editing && <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>Edit</Button>}>
            {editing ? (
              <FarmForm farm={farm} onCancel={() => setEditing(false)} onSaved={async () => { setEditing(false); await refreshFarms(); void farmQ.reload(); }} />
            ) : (
              <>
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  {[
                    ["Latitude / longitude", `${farm.latitude}, ${farm.longitude}`],
                    ["Farm size", `${farm.size} ${farm.areaUnit}`],
                    ["Soil type", farm.soilType ?? "Unknown"],
                    ["Irrigation", farm.irrigation],
                    ["Elevation", farm.elevationM ? `${farm.elevationM} m` : "—"],
                    ["Registered", fmtDate(farm.createdAt)],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-xl bg-stone-50 p-3"><dt className="text-xs text-stone-500">{k}</dt><dd className="font-medium capitalize">{v}</dd></div>
                  ))}
                </dl>
                {canEdit && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={archive}>{farm.archivedAt ? "Restore farm" : "Archive farm"}</Button>
                    <Button size="sm" variant="danger" onClick={remove}>Delete permanently</Button>
                  </div>
                )}
              </>
            )}
          </Card>
        </div>
      )}
      {tab === "crops" && <CropsTab farm={farm} justCreated={justCreated} />}
      {tab === "devices" && <DevicesTab farmId={farm.id} />}
      {tab === "risks" && <RisksTab farmId={farm.id} />}
      {tab === "recommendations" && <RecsTab farmId={farm.id} />}
      {tab === "environment" && <div className="grid gap-5"><WeatherPanel farmId={farm.id} /><SoilPanel farmId={farm.id} /></div>}
      {tab === "activity" && <ActivityTab farmId={farm.id} />}
      </Tabs>
    </>
  );
}

function CropsTab({ farm, justCreated }: { farm: FarmLite; justCreated: boolean }) {
  const { data, loading, reload } = useApi<{ plantings: PlantingRow[] }>(`/plantings?farmId=${farm.id}`);
  const [addingState, setAddingState] = useState(() => ({ justCreated, adding: justCreated }));
  const adding = addingState.justCreated === justCreated ? addingState.adding : justCreated;
  const setAdding = (next: boolean) => setAddingState({ justCreated, adding: next });
  const [editing, setEditing] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      {notice && <Alert tone="success">{notice}</Alert>}
      {adding ? (
        <Card title="Record a planting">
          <PlantingForm farmId={farm.id} defaultIrrigation={farm.irrigation} onCancel={() => setAdding(false)} onSaved={(queued) => { setAdding(false); setNotice(queued ? "Saved offline — the planting will sync when you reconnect." : "Planting saved."); void reload(); }} />
        </Card>
      ) : (
        <Button onClick={() => setAdding(true)}>+ Add planting</Button>
      )}
      {loading && !data ? <Spinner /> : !data?.plantings.length ? (
        <EmptyState icon="🌱" title="No plantings recorded">Record what you planted, when, and on how much land. Predictions are made per planting.</EmptyState>
      ) : (
        <div className="space-y-3">
          {data.plantings.map((p) => (
            <Card key={p.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold text-stone-900">{p.cropName} {p.varietyName && <span className="font-normal text-stone-500">· {p.varietyName}</span>}</p>
                  <p className="text-sm text-stone-600">Planted {fmtDate(p.plantingDate)} · {p.plantedArea} {p.areaUnit} · {p.irrigation}{p.season ? ` · ${p.season}` : ""}</p>
                  {p.actualYield && <p className="text-sm text-leaf-800">Harvested {fmtDate(p.actualHarvestDate)}: <strong>{p.actualYield} {p.actualYieldUnit}</strong></p>}
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={p.status === "harvested" ? "sky" : p.status === "failed" ? "red" : "green"}>{p.status}</Badge>
                  <Button size="sm" variant="secondary" onClick={() => setEditing(editing === p.id ? null : p.id)}>Update / harvest</Button>
                  <LinkButton variant="secondary" href={`/predictions?plantingId=${p.id}`}>Predict</LinkButton>
                </div>
              </div>
              {editing === p.id && <PlantingUpdate planting={p} onSaved={() => { setEditing(null); void reload(); }} />}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function DevicesTab({ farmId }: { farmId: string }) {
  const { data, loading } = useApi<{ devices: { id: string; name: string; deviceUid: string; status: string; lastSeenAt: string | null; intervalSec: number; sensors: string[] }[] }>(`/devices?farmId=${farmId}`);
  if (loading && !data) return <Spinner />;
  return (
    <div className="space-y-3">
      <LinkButton href="/devices">Manage devices</LinkButton>
      {!data?.devices.length ? <EmptyState icon="📡" title="No devices on this farm">Register an ESP32 monitoring station from the Devices page.</EmptyState> : data.devices.map((d) => (
        <Card key={d.id}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><p className="font-semibold">{d.name}</p><p className="text-xs text-stone-500">{d.deviceUid} · every {Math.round(d.intervalSec / 60)} min · {d.sensors.join(", ")}</p></div>
            <Badge tone={d.status === "online" ? "green" : d.status === "offline" ? "red" : "stone"}>{d.status === "never" ? "never reported" : `${d.status} · ${timeAgo(d.lastSeenAt)}`}</Badge>
          </div>
        </Card>
      ))}
    </div>
  );
}

function RisksTab({ farmId }: { farmId: string }) {
  const [history, setHistory] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const { data, loading, error } = useApi<{ risks: Parameters<typeof RiskList>[0]["risks"] }>(`/farms/${farmId}/risks?${history ? "history=1&" : ""}${refreshKey ? `refresh=1&k=${refreshKey}` : ""}`);
  return (
    <Card title="Risk analysis" subtitle="Crop-specific rules evaluated against forecasts, soil data and valid sensor readings" action={<Button size="sm" variant="secondary" loading={loading} onClick={() => setRefreshKey(Date.now())}>Re-evaluate now</Button>}>
      <label className="mb-3 flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-leaf-700" checked={history} onChange={(e) => setHistory(e.target.checked)} /> Include resolved risks (history)</label>
      {error ? <Alert tone="error">{error}</Alert> : loading && !data ? <Spinner /> : <RiskList risks={data?.risks ?? []} empty="No active risks for your current plantings. Risks are only evaluated for active plantings." />}
    </Card>
  );
}

function RecsTab({ farmId }: { farmId: string }) {
  const { data, loading, reload } = useApi<{ recommendations: Rec[] }>(`/farms/${farmId}/recommendations`);
  if (loading && !data) return <Spinner />;
  return <RecommendationList items={data?.recommendations ?? []} onChange={reload} />;
}

function ActivityTab({ farmId }: { farmId: string }) {
  const { data, loading, reload } = useApi<{ activities: { id: string; type: string; description: string; occurredAt: string; userName: string | null }[] }>(`/farms/${farmId}/activities`);
  const [f, setF] = useState({ type: "scouting", description: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      const r = await api(`/farms/${farmId}/activities`, { method: "POST", body: { ...f, occurredAt: new Date().toISOString() }, offlineQueue: { label: `Log activity: ${f.type}` } });
      setMsg(isQueued(r) ? "Saved offline — will sync when you reconnect." : "Activity recorded.");
      setF({ ...f, description: "" });
      void reload();
    } catch (e2) {
      setErr(errorMessage(e2));
    }
  };
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card title="Log a farm activity" className="lg:col-span-1">
        <form onSubmit={submit} className="space-y-3">
          {msg && <Alert tone="success">{msg}</Alert>}
          {err && <Alert tone="error">{err}</Alert>}
          <Field label="Type"><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{["scouting", "weeding", "fertilizer", "spraying", "irrigation", "planting", "harvest", "other"].map((t) => <option key={t}>{t}</option>)}</Select></Field>
          <Field label="Description"><Input required minLength={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="e.g. Applied CAN top dressing on 1 acre" /></Field>
          <Button type="submit">Save activity</Button>
          <p className="text-xs text-stone-500">Works offline — entries are queued and synced later.</p>
        </form>
      </Card>
      <Card title="Farm history" className="lg:col-span-2">
        {loading && !data ? <Spinner /> : (
          <ol className="relative space-y-4 border-l border-stone-200 pl-5">
            {data?.activities.map((a) => (
              <li key={a.id}>
                <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full bg-leaf-600" aria-hidden />
                <p className="text-sm text-stone-900">{a.description}</p>
                <p className="text-xs text-stone-500"><Badge>{a.type}</Badge> {fmtDateTime(a.occurredAt)}{a.userName ? ` · ${a.userName}` : ""}</p>
              </li>
            ))}
            {!data?.activities.length && <li className="text-sm text-stone-500">No activity yet.</li>}
          </ol>
        )}
        <Link href="/reports" className="mt-4 inline-block text-sm font-semibold text-leaf-800 hover:underline">Export records →</Link>
      </Card>
    </div>
  );
}

export default function FarmPage() {
  return <Suspense><FarmDetail /></Suspense>;
}
