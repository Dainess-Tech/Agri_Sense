"use client";
import { useMemo, useState, type FormEvent } from "react";
import { api, ApiClientError, errorMessage, isQueued } from "@/lib/client/api";
import { useApi } from "@/lib/client/hooks";
import { Alert, Button, Field, Input, Select, Textarea } from "./ui";

export interface Crop {
  id: string;
  name: string;
  slug: string;
  scientificName: string | null;
  maturityDaysMin: number;
  maturityDaysMax: number;
  baseYieldMin: string;
  baseYieldMax: string;
  yieldUnit: string;
  soilMoistureMin: string;
  soilMoistureMax: string;
  phMin: string;
  phMax: string;
  varieties: { id: string; name: string }[];
}

const STATUSES = ["planned", "planted", "germination", "vegetative", "flowering", "maturing", "harvested", "failed"];

/** randomUUID is unavailable on plain-HTTP origins, so fall back to getRandomValues/Math.random. */
function newId(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  if (c?.getRandomValues) {
    const b = c.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (n) => n.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const n = Math.floor(Math.random() * 16);
    return (ch === "x" ? n : (n & 0x3) | 0x8).toString(16);
  });
}

export function PlantingForm({ farmId, defaultIrrigation, onSaved, onCancel }: { farmId: string; defaultIrrigation: string; onSaved: (queued: boolean) => void; onCancel: () => void }) {
  const { data } = useApi<{ crops: Crop[] }>("/crops");
  const [f, setF] = useState({ cropId: "", varietyId: "", plantingDate: new Date().toISOString().slice(0, 10), plantedArea: "", areaUnit: "hectares", season: "", irrigation: defaultIrrigation, status: "planted", notes: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const crop = useMemo(() => data?.crops.find((c) => c.id === f.cropId), [data, f.cropId]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value, ...(k === "cropId" ? { varietyId: "" } : {}) }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api("/plantings", {
        method: "POST",
        body: { farmId, cropId: f.cropId, varietyId: f.varietyId || null, plantingDate: f.plantingDate, plantedArea: Number(f.plantedArea), areaUnit: f.areaUnit, season: f.season || null, irrigation: f.irrigation, status: f.status, notes: f.notes || null, clientId: newId() },
        offlineQueue: { label: `Add ${crop?.name ?? "crop"} planting` },
      });
      onSaved(isQueued(r));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Crop" htmlFor="pcrop">
          <Select id="pcrop" required value={f.cropId} onChange={set("cropId")}>
            <option value="">Select a crop…</option>
            {data?.crops.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Variety (optional)" htmlFor="pvar" hint={crop && !crop.varieties.length ? "No varieties listed" : undefined}>
          <Select id="pvar" value={f.varietyId} onChange={set("varietyId")} disabled={!crop?.varieties.length}>
            <option value="">Unknown / generic</option>
            {crop?.varieties.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </Select>
        </Field>
        <Field label="Planting date" htmlFor="pdate">
          <Input id="pdate" type="date" required value={f.plantingDate} onChange={set("plantingDate")} />
        </Field>
        <Field label="Planted area" htmlFor="parea">
          <Input id="parea" required inputMode="decimal" value={f.plantedArea} onChange={set("plantedArea")} placeholder="1.0" />
        </Field>
        <Field label="Area unit" htmlFor="punit">
          <Select id="punit" value={f.areaUnit} onChange={set("areaUnit")}>
            <option value="hectares">Hectares</option>
            <option value="acres">Acres</option>
            <option value="square_meters">Square metres</option>
          </Select>
        </Field>
        <Field label="Season (optional)" htmlFor="pseason">
          <Input id="pseason" value={f.season} onChange={set("season")} placeholder="e.g. Long rains 2026" />
        </Field>
        <Field label="Irrigation" htmlFor="pirr">
          <Select id="pirr" value={f.irrigation} onChange={set("irrigation")}>
            <option value="rainfed">Rain-fed</option>
            <option value="irrigated">Irrigated</option>
            <option value="mixed">Mixed</option>
          </Select>
        </Field>
        <Field label="Growth status" htmlFor="pstatus">
          <Select id="pstatus" value={f.status} onChange={set("status")}>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </Field>
      </div>
      {crop && (
        <p className="rounded-xl bg-leaf-50 p-3 text-xs text-leaf-900">
          <strong>{crop.name}</strong> {crop.scientificName && <em>({crop.scientificName})</em>}: matures in {crop.maturityDaysMin}–{crop.maturityDaysMax} days · attainable {crop.baseYieldMin}–{crop.baseYieldMax} {crop.yieldUnit} · soil moisture {crop.soilMoistureMin}–{crop.soilMoistureMax}% · pH {crop.phMin}–{crop.phMax}
        </p>
      )}
      <Field label="Notes (optional)" htmlFor="pnotes">
        <Textarea id="pnotes" rows={2} value={f.notes} onChange={set("notes")} />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" loading={busy}>Save planting</Button>
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

export interface PlantingRow {
  id: string;
  cropName: string;
  varietyName: string | null;
  plantingDate: string;
  plantedArea: string;
  areaUnit: string;
  season: string | null;
  irrigation: string;
  status: string;
  actualHarvestDate: string | null;
  actualYield: string | null;
  actualYieldUnit: string | null;
  version: number;
}

/** Inline status/harvest update with optimistic-concurrency conflict detection. */
export function PlantingUpdate({ planting, onSaved }: { planting: PlantingRow; onSaved: () => void }) {
  const [f, setF] = useState({ status: planting.status, actualHarvestDate: planting.actualHarvestDate ?? "", actualYield: planting.actualYield ?? "", actualYieldUnit: planting.actualYieldUnit ?? "t" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/plantings/${planting.id}`, {
        method: "PATCH",
        body: { version: planting.version, status: f.status, actualHarvestDate: f.actualHarvestDate || null, actualYield: f.actualYield === "" ? null : Number(f.actualYield), actualYieldUnit: f.actualYield === "" ? null : f.actualYieldUnit },
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiClientError && err.status === 409 ? "This planting was updated elsewhere. Reload to see the latest values before saving." : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={save} className="mt-3 grid gap-3 rounded-xl bg-stone-50 p-3 sm:grid-cols-5">
      {error && <div className="sm:col-span-5"><Alert tone="error">{error}</Alert></div>}
      <Field label="Status"><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</Select></Field>
      <Field label="Harvest date"><Input type="date" value={f.actualHarvestDate} onChange={(e) => setF({ ...f, actualHarvestDate: e.target.value })} /></Field>
      <Field label="Actual yield"><Input inputMode="decimal" value={f.actualYield} onChange={(e) => setF({ ...f, actualYield: e.target.value })} /></Field>
      <Field label="Unit"><Select value={f.actualYieldUnit} onChange={(e) => setF({ ...f, actualYieldUnit: e.target.value })}><option value="t">tonnes</option><option value="kg">kg</option><option value="bags_90kg">90 kg bags</option></Select></Field>
      <div className="flex items-end"><Button type="submit" size="sm" loading={busy}>Save</Button></div>
    </form>
  );
}
