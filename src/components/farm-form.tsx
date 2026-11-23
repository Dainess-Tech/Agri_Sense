"use client";
import { useState, type FormEvent } from "react";
import { api, ApiClientError, errorMessage, isQueued } from "@/lib/client/api";
import type { FarmLite } from "@/lib/client/hooks";
import { FarmMap } from "./farm-map";
import { Alert, Button, Field, Input, Select } from "./ui";

const SOIL_TYPES = ["", "Clay", "Clay loam", "Loam", "Sandy loam", "Sandy", "Silt", "Volcanic (andosol)", "Black cotton (vertisol)", "Other"];

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

export function FarmForm({ farm, onSaved, onCancel }: { farm?: FarmLite; onSaved: (result: { farm?: FarmLite; queued?: boolean }) => void; onCancel?: () => void }) {
  const [f, setF] = useState({
    name: farm?.name ?? "",
    locationName: farm?.locationName ?? "",
    latitude: farm?.latitude ?? "",
    longitude: farm?.longitude ?? "",
    size: farm?.size ?? "",
    areaUnit: farm?.areaUnit ?? "hectares",
    soilType: farm?.soilType ?? "",
    irrigation: farm?.irrigation ?? "rainfed",
    elevationM: farm?.elevationM ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<FarmLite | null>(null);
  const [gpsMsg, setGpsMsg] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ name: string; latitude: number; longitude: number }[]>([]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));

  const useGps = () => {
    if (!("geolocation" in navigator)) return setGpsMsg("GPS is not available on this device. Enter coordinates manually.");
    setGpsMsg("Getting your location…");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setF((s) => ({ ...s, latitude: p.coords.latitude.toFixed(6), longitude: p.coords.longitude.toFixed(6) }));
        setGpsMsg(`Location captured (±${Math.round(p.coords.accuracy)} m). Only use this if you are standing on the farm.`);
      },
      (e) => setGpsMsg(`Could not get location: ${e.message}. You can enter coordinates manually.`),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  const search = async () => {
    if (query.trim().length < 3) return;
    try {
      const r = await api<{ results: typeof results }>(`/geo?q=${encodeURIComponent(query)}`);
      setResults(r.results);
      if (!r.results.length) setGpsMsg("No places found. Try a nearby town name.");
    } catch (e) {
      setGpsMsg(errorMessage(e));
    }
  };

  const lookupElevation = async () => {
    try {
      const r = await api<{ elevationM: number | null }>(`/geo?lat=${f.latitude}&lng=${f.longitude}`);
      if (r.elevationM !== null) setF((s) => ({ ...s, elevationM: String(Math.round(r.elevationM!)) }));
    } catch (e) {
      setGpsMsg(errorMessage(e));
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      name: f.name,
      locationName: f.locationName || null,
      latitude: Number(f.latitude),
      longitude: Number(f.longitude),
      size: Number(f.size),
      areaUnit: f.areaUnit,
      soilType: f.soilType || null,
      irrigation: f.irrigation,
      elevationM: f.elevationM === "" ? null : Number(f.elevationM),
    };
    try {
      if (farm) {
        const r = await api<{ farm: FarmLite }>(`/farms/${farm.id}`, { method: "PATCH", body: { ...body, version: conflict?.version ?? farm.version } });
        onSaved({ farm: r.farm });
      } else {
        const r = await api<{ farm: FarmLite } | { queued: true }>("/farms", { method: "POST", body: { ...body, clientId: newId() }, offlineQueue: { label: `Create farm "${f.name}"` } });
        onSaved(isQueued(r) ? { queued: true } : { farm: r.farm });
      }
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 409) {
        const current = (err.details as { current?: FarmLite })?.current ?? null;
        setConflict(current);
        setError("This farm was changed on another device. Review the latest saved values below; saving again will apply your version on top of them.");
      } else setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const lat = Number(f.latitude), lng = Number(f.longitude);
  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}
      {conflict && (
        <Alert tone="warning">
          Latest saved: <strong>{conflict.name}</strong>, {conflict.size} {conflict.areaUnit}, {conflict.irrigation}, ({conflict.latitude}, {conflict.longitude}).{" "}
          <button type="button" className="font-semibold underline" onClick={() => setF((s) => ({ ...s, name: conflict.name, size: conflict.size, latitude: conflict.latitude, longitude: conflict.longitude, irrigation: conflict.irrigation, areaUnit: conflict.areaUnit }))}>
            Use saved values
          </button>
        </Alert>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Farm name" htmlFor="fname">
          <Input id="fname" required value={f.name} onChange={set("name")} placeholder="e.g. Shamba ya Juu" />
        </Field>
        <Field label="Location / village (optional)" htmlFor="floc">
          <Input id="floc" value={f.locationName} onChange={set("locationName")} placeholder="e.g. Njoro, Nakuru" />
        </Field>
      </div>

      <fieldset className="space-y-3 rounded-2xl border border-stone-200 p-4">
        <legend className="px-1 text-sm font-semibold text-stone-800">Farm location</legend>
        <p className="text-xs text-stone-500">GPS is optional — you can register a farm far from where you are now by searching a place or typing coordinates.</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={useGps}>📍 Use my current location</Button>
          <div className="flex min-w-0 flex-1 gap-2">
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search a place…" aria-label="Search a place" className="!py-1.5" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void search(); } }} />
            <Button type="button" variant="secondary" size="sm" onClick={search}>Search</Button>
          </div>
        </div>
        {results.length > 0 && (
          <ul className="max-h-40 overflow-y-auto rounded-xl border border-stone-200 text-sm">
            {results.map((r) => (
              <li key={`${r.latitude},${r.longitude}`}>
                <button type="button" className="w-full px-3 py-2 text-left hover:bg-leaf-50" onClick={() => { setF((s) => ({ ...s, latitude: r.latitude.toFixed(6), longitude: r.longitude.toFixed(6), locationName: s.locationName || r.name.split(",").slice(0, 2).join(",") })); setResults([]); }}>
                  {r.name}
                </button>
              </li>
            ))}
          </ul>
        )}
        {gpsMsg && <p className="text-xs text-stone-600" role="status">{gpsMsg}</p>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Latitude" htmlFor="flat">
            <Input id="flat" required inputMode="decimal" value={f.latitude} onChange={set("latitude")} placeholder="-0.3031" />
          </Field>
          <Field label="Longitude" htmlFor="flng">
            <Input id="flng" required inputMode="decimal" value={f.longitude} onChange={set("longitude")} placeholder="35.9420" />
          </Field>
        </div>
        <FarmMap lat={f.latitude === "" ? NaN : lat} lng={f.longitude === "" ? NaN : lng} className="h-48" />
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Farm size" htmlFor="fsize">
          <Input id="fsize" required inputMode="decimal" value={f.size} onChange={set("size")} placeholder="2.5" />
        </Field>
        <Field label="Area unit" htmlFor="funit">
          <Select id="funit" value={f.areaUnit} onChange={set("areaUnit")}>
            <option value="hectares">Hectares</option>
            <option value="acres">Acres</option>
            <option value="square_meters">Square metres</option>
          </Select>
        </Field>
        <Field label="Irrigation" htmlFor="firr">
          <Select id="firr" value={f.irrigation} onChange={set("irrigation")}>
            <option value="rainfed">Rain-fed</option>
            <option value="irrigated">Irrigated</option>
            <option value="mixed">Mixed</option>
          </Select>
        </Field>
        <Field label="Known soil type (optional)" htmlFor="fsoil">
          <Select id="fsoil" value={f.soilType} onChange={set("soilType")}>
            {SOIL_TYPES.map((s) => <option key={s} value={s}>{s || "Unknown"}</option>)}
          </Select>
        </Field>
        <Field label="Elevation, m (optional)" htmlFor="felev">
          <div className="flex gap-2">
            <Input id="felev" inputMode="numeric" value={f.elevationM} onChange={set("elevationM")} />
            <Button type="button" variant="secondary" size="sm" onClick={lookupElevation} disabled={!f.latitude || !f.longitude}>Look up</Button>
          </div>
        </Field>
      </div>
      <div className="flex gap-2">
        <Button type="submit" loading={busy}>{farm ? "Save changes" : "Register farm"}</Button>
        {onCancel && <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>}
      </div>
    </form>
  );
}
