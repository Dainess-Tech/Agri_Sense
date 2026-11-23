"use client";
import { useEffect, useState, type FormEvent } from "react";
import { api, errorMessage } from "@/lib/client/api";
import { fmtDateTime, SENSOR_LABELS, timeAgo, useApi, useApp } from "@/lib/client/hooks";
import { Alert, Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, Spinner, cx } from "@/components/ui";

interface Device { id: string; name: string; deviceUid: string; farmId: string; farmName?: string; status: string; lastSeenAt: string | null; intervalSec: number; sensors: string[]; hardware: string; firmwareVersion: string | null; active: boolean }
interface ReadingRow { id: number; sensorType: string; value: string; unit: string; quality: string; qualityNote: string | null; measuredAt: string; receivedAt: string; messageId: string }

const ALL_SENSORS = ["soil_moisture", "air_temperature", "air_humidity", "soil_temperature", "soil_ph"];

function CredentialPanel({ device, apiKey, onClose }: { device: Device; apiKey: string; onClose: () => void }) {
  const [sim, setSim] = useState<string | null>(null);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const simulate = async (fault = false) => {
    setSim("Sending…");
    const now = Date.now();
    const readings = device.sensors.map((t) => ({
      type: t,
      value: fault && t === "soil_moisture" ? 0 : fault && t === "soil_temperature" ? -127 : t === "soil_moisture" ? +(22 + Math.random() * 20).toFixed(1) : t === "air_temperature" ? +(18 + Math.random() * 12).toFixed(1) : t === "air_humidity" ? +(45 + Math.random() * 35).toFixed(0) : t === "soil_temperature" ? +(17 + Math.random() * 6).toFixed(1) : +(5.4 + Math.random() * 1.6).toFixed(2),
    }));
    try {
      const res = await fetch("/api/v1/iot/readings", { method: "POST", headers: { "Content-Type": "application/json", "X-Device-Id": device.deviceUid, Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ messageId: `sim-${now}`, measuredAt: Math.floor(now / 1000), readings, firmware: "simulator-1.0" }) });
      const body = await res.json();
      setSim(`HTTP ${res.status}: accepted ${body.accepted ?? 0}, duplicates ${body.duplicates ?? 0}, flagged ${body.flagged ?? 0}${body.rejected?.length ? `, rejected ${body.rejected.length}` : ""}`);
    } catch (e) {
      setSim(errorMessage(e));
    }
  };
  const curl = `curl -X POST ${origin}/api/v1/iot/readings \\\n  -H "Content-Type: application/json" \\\n  -H "X-Device-Id: ${device.deviceUid}" \\\n  -H "Authorization: Bearer ${apiKey}" \\\n  -d '{"messageId":"msg-001","readings":[{"type":"soil_moisture","value":31.5},{"type":"air_temperature","value":24.1}]}'`;
  const firmware = `#define AGRISENSE_HOST   "${origin}"\n#define DEVICE_ID        "${device.deviceUid}"\n#define DEVICE_API_KEY   "${apiKey}"\n#define INTERVAL_SEC     ${device.intervalSec}`;
  return (
    <Card title={`🔑 Credentials for ${device.name}`} className="border-amber-300 bg-amber-50/40" action={<Button size="sm" variant="secondary" onClick={onClose}>Done</Button>}>
      <Alert tone="warning">Copy this API key now — it is shown only once and stored hashed. You can rotate it later if lost.</Alert>
      <div className="mt-3 space-y-3 text-sm">
        <div><p className="font-semibold">Device ID</p><code className="block break-all rounded-lg bg-white p-2">{device.deviceUid}</code></div>
        <div><p className="font-semibold">API key</p><code className="block break-all rounded-lg bg-white p-2">{apiKey}</code></div>
        <div><p className="font-semibold">ESP32 firmware config (firmware/esp32/agrisense_node/config.h)</p><pre className="overflow-x-auto rounded-lg bg-stone-900 p-3 text-xs text-stone-100">{firmware}</pre></div>
        <div><p className="font-semibold">Test with curl</p><pre className="overflow-x-auto rounded-lg bg-stone-900 p-3 text-xs text-stone-100">{curl}</pre></div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => simulate(false)}>📡 Send simulated reading</Button>
          <Button size="sm" variant="secondary" onClick={() => simulate(true)}>⚠ Simulate disconnected sensors</Button>
        </div>
        {sim && <p className="text-xs text-stone-700" role="status">{sim}</p>}
        <p className="text-xs text-stone-500">No hardware yet? Run <code>node scripts/simulate-device.mjs</code> from the repo to stream realistic readings.</p>
      </div>
    </Card>
  );
}

function DeviceReadings({ deviceId }: { deviceId: string }) {
  const [page, setPage] = useState(1);
  const { data, loading } = useApi<{ readings: ReadingRow[]; total: number; limit: number }>(`/devices/${deviceId}/readings?page=${page}&limit=25`);
  if (loading && !data) return <Spinner />;
  if (!data?.readings.length) return <p className="text-sm text-stone-500">No readings received yet.</p>;
  const pages = Math.ceil(data.total / data.limit);
  return (
    <div className="mt-3">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="text-xs uppercase text-stone-500"><tr><th className="py-2">Measured (device)</th><th>Received (server)</th><th>Sensor</th><th>Value</th><th>Quality</th></tr></thead>
          <tbody className="divide-y divide-stone-100">
            {data.readings.map((r) => (
              <tr key={r.id}>
                <td className="py-1.5">{fmtDateTime(r.measuredAt)}</td>
                <td className="text-stone-500">{fmtDateTime(r.receivedAt)}</td>
                <td>{SENSOR_LABELS[r.sensorType]?.label ?? r.sensorType}</td>
                <td className="font-medium">{Number(r.value)} {r.unit}</td>
                <td><Badge tone={r.quality === "valid" ? "green" : r.quality === "suspect" ? "amber" : "red"}>{r.quality}</Badge>{r.qualityNote && <span className="ml-1 text-xs text-stone-500">{r.qualityNote}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex items-center justify-between text-sm">
        <span className="text-stone-500">{data.total} readings</span>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <span className="py-1.5">{page}/{pages}</span>
          <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      </div>
    </div>
  );
}

export default function DevicesPage() {
  const { farms, farmId } = useApp();
  const { data, loading, error, reload } = useApi<{ devices: Device[] }>("/devices");
  const [form, setForm] = useState({ farmId: farmId ?? "", name: "", deviceUid: "", intervalSec: "900", sensors: ["soil_moisture", "air_temperature", "air_humidity", "soil_temperature"] });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [creds, setCreds] = useState<{ device: Device; apiKey: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { document.title = "Devices · AgriSense"; }, []);
  const selectedFarmId = form.farmId || farmId || farms[0]?.id || "";

  const register = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ device: Device; apiKey: string }>("/devices", { method: "POST", body: { farmId: selectedFarmId, name: form.name, deviceUid: form.deviceUid || undefined, intervalSec: Number(form.intervalSec), sensors: form.sensors } });
      setCreds(r);
      setForm((f) => ({ ...f, name: "", deviceUid: "" }));
      void reload();
    } catch (e2) {
      setErr(errorMessage(e2));
    } finally {
      setBusy(false);
    }
  };
  const rotate = async (d: Device) => {
    if (!confirm(`Rotate the API key for ${d.name}? The device will stop sending until you update its firmware config.`)) return;
    setErr(null);
    try {
      const r = await api<{ apiKey: string }>(`/devices/${d.id}`, { method: "POST", body: { action: "rotate-key" } });
      setCreds({ device: d, apiKey: r.apiKey });
    } catch (e) {
      setErr(errorMessage(e));
    }
  };
  const patch = async (d: Device, body: object) => {
    setErr(null);
    try {
      await api(`/devices/${d.id}`, { method: "PATCH", body });
      void reload();
    } catch (e) {
      setErr(errorMessage(e));
    }
  };
  const remove = async (d: Device) => {
    if (!confirm(`Remove ${d.name} and all its readings?`)) return;
    setErr(null);
    try {
      await api(`/devices/${d.id}`, { method: "DELETE" });
      void reload();
    } catch (e) {
      setErr(errorMessage(e));
    }
  };

  return (
    <>
      <PageHeader title="IoT devices" description="Register ESP32 monitoring stations, assign them to farms and check their connection status." />
      {err && <div className="mb-4"><Alert tone="error">{err}</Alert></div>}
      <div className="space-y-5">
        {creds && <CredentialPanel device={creds.device} apiKey={creds.apiKey} onClose={() => setCreds(null)} />}
        <Card title="Register a device">
          {!farms.length ? <p className="text-sm text-stone-500">Register a farm first.</p> : (
            <form onSubmit={register} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Farm" htmlFor="dfarm"><Select id="dfarm" value={selectedFarmId} onChange={(e) => setForm({ ...form, farmId: e.target.value })}>{farms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</Select></Field>
                <Field label="Device name" htmlFor="dname"><Input id="dname" required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="North field station" /></Field>
                <Field label="Device ID (optional)" htmlFor="duid" hint="Auto-generated if empty"><Input id="duid" value={form.deviceUid} onChange={(e) => setForm({ ...form, deviceUid: e.target.value })} placeholder="esp32-north-01" /></Field>
                <Field label="Measurement interval" htmlFor="dint"><Select id="dint" value={form.intervalSec} onChange={(e) => setForm({ ...form, intervalSec: e.target.value })}>{[[60, "1 min"], [300, "5 min"], [900, "15 min"], [1800, "30 min"], [3600, "1 hour"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
              </div>
              <fieldset>
                <legend className="text-sm font-medium text-stone-800">Connected sensors</legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  {ALL_SENSORS.map((s) => (
                    <label key={s} className={cx("flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-1.5 text-sm", form.sensors.includes(s) ? "border-leaf-500 bg-leaf-50" : "border-stone-300")}>
                      <input type="checkbox" className="accent-leaf-700" checked={form.sensors.includes(s)} onChange={(e) => setForm({ ...form, sensors: e.target.checked ? [...form.sensors, s] : form.sensors.filter((x) => x !== s) })} />
                      {SENSOR_LABELS[s].icon} {SENSOR_LABELS[s].label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <Button type="submit" loading={busy}>Register device</Button>
            </form>
          )}
        </Card>
        {loading && !data ? <Spinner /> : error ? <Alert tone="error">{error}</Alert> : !data?.devices.length ? (
          <EmptyState icon="📡" title="No devices registered">An ESP32 with a capacitive soil moisture sensor, DHT22 and DS18B20 probe is enough to start.</EmptyState>
        ) : (
          data.devices.map((d) => (
            <Card key={d.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="flex items-center gap-2 font-semibold text-stone-900">
                    <span className={cx("inline-block h-2.5 w-2.5 rounded-full", d.status === "online" ? "bg-leaf-500" : d.status === "offline" ? "bg-red-500" : "bg-stone-300")} aria-hidden />
                    {d.name} {!d.active && <Badge tone="amber">Deactivated</Badge>}
                  </p>
                  <p className="text-xs text-stone-500">{d.deviceUid} · {d.hardware}{d.firmwareVersion ? ` · fw ${d.firmwareVersion}` : ""} · {d.farmName}</p>
                  <p className="mt-1 text-sm">{d.status === "never" ? "Waiting for first measurement" : <>Last seen {timeAgo(d.lastSeenAt)} <span className="text-stone-500">({fmtDateTime(d.lastSeenAt)})</span></>} · <Badge tone={d.status === "online" ? "green" : d.status === "offline" ? "red" : "stone"}>{d.status}</Badge></p>
                  <p className="mt-1 text-xs text-stone-500">Sensors: {d.sensors.map((s) => SENSOR_LABELS[s]?.label ?? s).join(", ")}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Select aria-label="Interval" className="!w-auto !py-1.5 text-xs" value={d.intervalSec} onChange={(e) => patch(d, { intervalSec: Number(e.target.value) })}>{[60, 300, 900, 1800, 3600].map((v) => <option key={v} value={v}>every {v < 3600 ? `${v / 60} min` : "1 h"}</option>)}</Select>
                  <Button size="sm" variant="secondary" onClick={() => setOpen(open === d.id ? null : d.id)}>{open === d.id ? "Hide" : "Readings"}</Button>
                  <Button size="sm" variant="secondary" onClick={() => patch(d, { active: !d.active })}>{d.active ? "Deactivate" : "Activate"}</Button>
                  <Button size="sm" variant="secondary" onClick={() => rotate(d)}>Rotate key</Button>
                  <Button size="sm" variant="danger" onClick={() => remove(d)}>Remove</Button>
                </div>
              </div>
              {open === d.id && <DeviceReadings deviceId={d.id} />}
            </Card>
          ))
        )}
      </div>
    </>
  );
}
