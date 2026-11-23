"use client";
import { useEffect, useState, type FormEvent } from "react";
import { api, errorMessage } from "@/lib/client/api";
import { fmtDateTime, useApi, useApp, type SessionUser } from "@/lib/client/hooks";
import { Alert, Button, Card, Field, Input, PageHeader, Select, Spinner, Stat, Tabs, Textarea } from "@/components/ui";

type Tab = "overview" | "users" | "crops" | "audit";
interface CropRow { id: string; name: string; active: boolean; baseYieldMin: string; baseYieldMax: string; maturityDaysMin: number; maturityDaysMax: number; soilMoistureMin: string; soilMoistureMax: string; phMin: string; phMax: string; tempCriticalLow: string; tempCriticalHigh: string; yieldUnit: string }

export default function AdminPage() {
  const { user } = useApp();
  const [tab, setTab] = useState<Tab>("overview");
  useEffect(() => { document.title = "Admin · AgriSense"; }, []);
  if (user && user.role !== "admin") return <Alert tone="error">Administrator access required.</Alert>;
  return (
    <>
      <PageHeader title="Administration" description="Manage users, the crop catalogue, announcements and audit records." />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ id: "overview", label: "Overview" }, { id: "users", label: "Users" }, { id: "crops", label: "Crop catalogue" }, { id: "audit", label: "Audit log" }]} />
      {tab === "overview" && <Overview />}
      {tab === "users" && <Users />}
      {tab === "crops" && <Crops />}
      {tab === "audit" && <Audit />}
    </>
  );
}

function Overview() {
  const { data } = useApi<{ stats: Record<string, number> }>("/admin/stats");
  const [f, setF] = useState({ title: "", body: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const send = async (e: FormEvent) => {
    e.preventDefault();
    try { const r = await api<{ sent: number }>("/admin/announcements", { method: "POST", body: f }); setMsg(`Announcement sent to ${r.sent} users.`); setF({ title: "", body: "" }); } catch (e2) { setMsg(errorMessage(e2)); }
  };
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {data ? Object.entries(data.stats).map(([k, v]) => <Stat key={k} label={k} value={v} />) : <Spinner />}
      </div>
      <Card title="System announcement">
        <form onSubmit={send} className="space-y-3">
          {msg && <Alert tone="info">{msg}</Alert>}
          <Field label="Title"><Input required minLength={3} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          <Field label="Message"><Textarea required rows={3} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
          <Button type="submit">Send to all users</Button>
        </form>
      </Card>
    </div>
  );
}

function Users() {
  const [q, setQ] = useState("");
  const { data, loading, reload } = useApi<{ users: SessionUser[] }>(`/admin/users${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  const [err, setErr] = useState<string | null>(null);
  const setRole = async (userId: string, role: string) => { try { await api("/admin/users", { method: "PATCH", body: { userId, role } }); void reload(); } catch (e) { setErr(errorMessage(e)); } };
  return (
    <Card title="Users">
      <Input placeholder="Search name or email…" value={q} onChange={(e) => setQ(e.target.value)} className="mb-3" aria-label="Search users" />
      {err && <Alert tone="error">{err}</Alert>}
      {loading && !data ? <Spinner /> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-left text-sm">
            <thead className="text-xs uppercase text-stone-500"><tr><th className="py-2">Name</th><th>Email</th><th>Joined</th><th>Verified</th><th>Role</th></tr></thead>
            <tbody className="divide-y divide-stone-100">
              {data?.users.map((u) => (
                <tr key={u.id}>
                  <td className="py-2 font-medium">{u.fullName}</td><td>{u.email}</td><td>{fmtDateTime(u.createdAt)}</td><td>{u.emailVerified ? "✅" : "—"}</td>
                  <td><Select className="!w-auto !py-1 text-xs" value={u.role} onChange={(e) => setRole(u.id, e.target.value)} aria-label={`Role for ${u.email}`}>{["farmer", "agronomist", "technician", "admin"].map((r) => <option key={r}>{r}</option>)}</Select></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function CropEditor({ crop, onSaved }: { crop: CropRow; onSaved: () => void }) {
  const [f, setF] = useState(crop);
  const [msg, setMsg] = useState<string | null>(null);
  const num = (k: keyof CropRow) => <Input inputMode="decimal" className="!py-1 text-xs" value={String(f[k])} onChange={(e) => setF({ ...f, [k]: e.target.value })} aria-label={`${crop.name} ${k}`} />;
  const save = async () => {
    try {
      await api("/admin/crops", { method: "PATCH", body: { cropId: crop.id, active: f.active, baseYieldMin: f.baseYieldMin, baseYieldMax: f.baseYieldMax, maturityDaysMin: f.maturityDaysMin, maturityDaysMax: f.maturityDaysMax, soilMoistureMin: f.soilMoistureMin, soilMoistureMax: f.soilMoistureMax, phMin: f.phMin, phMax: f.phMax, tempCriticalLow: f.tempCriticalLow, tempCriticalHigh: f.tempCriticalHigh } });
      setMsg("Saved");
      onSaved();
    } catch (e) { setMsg(errorMessage(e)); }
  };
  return (
    <tr>
      <td className="py-2 pr-2 font-medium">{crop.name}<label className="ml-2 text-xs"><input type="checkbox" className="accent-leaf-700" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> active</label></td>
      <td className="pr-1"><div className="flex gap-1">{num("baseYieldMin")}{num("baseYieldMax")}</div></td>
      <td className="pr-1"><div className="flex gap-1">{num("maturityDaysMin")}{num("maturityDaysMax")}</div></td>
      <td className="pr-1"><div className="flex gap-1">{num("soilMoistureMin")}{num("soilMoistureMax")}</div></td>
      <td className="pr-1"><div className="flex gap-1">{num("phMin")}{num("phMax")}</div></td>
      <td className="pr-1"><div className="flex gap-1">{num("tempCriticalLow")}{num("tempCriticalHigh")}</div></td>
      <td><Button size="sm" onClick={save}>Save</Button>{msg && <span className="ml-1 text-xs text-stone-500">{msg}</span>}</td>
    </tr>
  );
}

function Crops() {
  const { data, loading, reload } = useApi<{ crops: CropRow[] }>("/admin/crops");
  return (
    <Card title="Crop catalogue & thresholds" subtitle="Changes apply to new predictions and risk evaluations. Historical predictions keep their saved input snapshot.">
      {loading && !data ? <Spinner /> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="text-xs uppercase text-stone-500"><tr><th className="py-2">Crop</th><th>Yield min/max (t/ha)</th><th>Maturity days</th><th>Soil moisture %</th><th>pH range</th><th>Critical °C low/high</th><th /></tr></thead>
            <tbody className="divide-y divide-stone-100">{data?.crops.map((c) => <CropEditor key={c.id} crop={c} onSaved={reload} />)}</tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function Audit() {
  const { data, loading } = useApi<{ logs: { id: number; action: string; entity: string; entityId: string | null; actor: string | null; createdAt: string; meta: unknown }[] }>("/admin/audit");
  return (
    <Card title="Audit log (latest 100)">
      {loading && !data ? <Spinner /> : (
        <ul className="divide-y divide-stone-100 text-sm">
          {data?.logs.map((l) => <li key={l.id} className="py-2"><span className="font-mono text-xs text-leaf-800">{l.action}</span> · {l.entity} {l.entityId?.slice(0, 8)} · <span className="text-stone-500">{l.actor ?? "system"} · {fmtDateTime(l.createdAt)}</span></li>)}
        </ul>
      )}
    </Card>
  );
}
