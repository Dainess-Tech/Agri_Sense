"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, useSyncExternalStore } from "react";
import { useApi, useApp, fmtDate, type FarmLite } from "@/lib/client/hooks";
import { FarmForm } from "@/components/farm-form";
import { Alert, Badge, Button, Card, EmptyState, PageHeader, Skeleton } from "@/components/ui";

const DEV_VERIFY_EVENT = "agrisense:dev-verification-change";
const subscribeDevVerification = (onChange: () => void) => {
  window.addEventListener(DEV_VERIFY_EVENT, onChange);
  return () => window.removeEventListener(DEV_VERIFY_EVENT, onChange);
};
const getDevVerification = () => sessionStorage.getItem("agrisense.devVerify");
const clearDevVerification = () => {
  sessionStorage.removeItem("agrisense.devVerify");
  window.dispatchEvent(new Event(DEV_VERIFY_EVENT));
};

function FarmsInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { refreshFarms, setFarmId } = useApp();
  const [showArchived, setShowArchived] = useState(false);
  const { data, loading, error, reload, savedAt } = useApi<{ farms: FarmLite[] }>(`/farms${showArchived ? "?archived=1" : ""}`);
  const [creating, setCreating] = useState(params.get("new") === "1" || params.get("welcome") === "1");
  const [notice, setNotice] = useState<string | null>(null);
  const devVerify = useSyncExternalStore(subscribeDevVerification, getDevVerification, () => null);
  useEffect(() => { document.title = "Farms · AgriSense"; }, []);

  return (
    <>
      <PageHeader title="My farms" description="Manage all your farms under one account." action={!creating && <Button onClick={() => setCreating(true)}>+ Add farm</Button>} />
      {params.get("welcome") === "1" && (
        <div className="mb-4 space-y-2">
          <Alert tone="success">🎉 Account created! Register your first farm to get started.</Alert>
          {devVerify && (
            <Alert tone="info">
              Development mode (no email provider): <a className="font-semibold underline" href={devVerify} onClick={clearDevVerification}>verify your email</a>
            </Alert>
          )}
        </div>
      )}
      {notice && <div className="mb-4"><Alert tone="success">{notice}</Alert></div>}
      {savedAt && <div className="mb-4"><Alert tone="warning">📴 Offline — showing farms saved on {new Date(savedAt).toLocaleString()}.</Alert></div>}
      {creating && (
        <Card title="Register a farm" className="mb-6">
          <FarmForm
            onCancel={() => setCreating(false)}
            onSaved={async (r) => {
              setCreating(false);
              if (r.queued) {
                setNotice("You're offline — the farm was saved on this device and will be registered automatically when you reconnect.");
                return;
              }
              await refreshFarms();
              if (r.farm) {
                setFarmId(r.farm.id);
                router.push(`/farms/${r.farm.id}?tab=crops&new=1`);
              }
              void reload();
            }}
          />
        </Card>
      )}
      {loading && !data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-36" />)}</div>
      ) : error ? (
        <Alert tone="error">{error}</Alert>
      ) : data && data.farms.length === 0 && !creating ? (
        <EmptyState icon="🌾" title="No farms yet" action={<Button onClick={() => setCreating(true)}>Register a farm</Button>}>
          A farm holds your crops, devices, predictions and history.
        </EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data?.farms.map((f) => (
            <Link key={f.id} href={`/farms/${f.id}`} onClick={() => setFarmId(f.id)} className="group rounded-2xl border border-stone-200 bg-white p-5 shadow-sm transition hover:border-leaf-300 hover:shadow-md">
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-semibold text-stone-900 group-hover:text-leaf-800">{f.name}</h2>
                {f.archivedAt ? <Badge tone="amber">Archived</Badge> : <Badge tone="green">{f.irrigation}</Badge>}
              </div>
              <p className="mt-1 text-sm text-stone-600">{f.locationName ?? `${Number(f.latitude).toFixed(4)}, ${Number(f.longitude).toFixed(4)}`}</p>
              <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
                <div><dt className="text-xs text-stone-500">Size</dt><dd className="font-medium">{f.size} {f.areaUnit}</dd></div>
                <div><dt className="text-xs text-stone-500">Soil</dt><dd className="font-medium">{f.soilType ?? "Unknown"}</dd></div>
                <div><dt className="text-xs text-stone-500">Registered</dt><dd className="font-medium">{fmtDate(f.createdAt)}</dd></div>
                <div><dt className="text-xs text-stone-500">Elevation</dt><dd className="font-medium">{f.elevationM ? `${f.elevationM} m` : "—"}</dd></div>
              </dl>
            </Link>
          ))}
        </div>
      )}
      <label className="mt-6 flex items-center gap-2 text-sm text-stone-600">
        <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="h-4 w-4 accent-leaf-700" /> Show archived farms
      </label>
    </>
  );
}

export default function FarmsPage() {
  return <Suspense><FarmsInner /></Suspense>;
}
