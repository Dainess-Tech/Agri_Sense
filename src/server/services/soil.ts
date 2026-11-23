import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { soilProfiles } from "@/db/schema";

/**
 * Soil integration — ISRIC SoilGrids v2.0 REST API (CC BY 4.0, modelled data at
 * 250 m resolution; no key; fair-use limits apply). Values are MODELLED estimates,
 * not field measurements. Urban areas / water bodies return null values.
 */
export const SOIL_PROVIDER = "ISRIC SoilGrids v2.0";
const URL_BASE = "https://rest.isric.org/soilgrids/v2.0/properties/query";

export type SoilProfile = typeof soilProfiles.$inferSelect;

function texture(sand: number | null, clay: number | null, silt: number | null): string | null {
  if (sand === null || clay === null || silt === null) return null;
  if (clay >= 40) return silt >= 40 ? "Silty clay" : sand > 45 ? "Sandy clay" : "Clay";
  if (clay >= 27) return sand > 45 ? "Sandy clay loam" : silt > 40 ? "Silty clay loam" : "Clay loam";
  if (silt >= 80) return "Silt";
  if (silt >= 50) return "Silt loam";
  if (sand >= 85) return "Sand";
  if (sand >= 70) return "Loamy sand";
  if (sand >= 52) return "Sandy loam";
  return "Loam";
}

interface Layer {
  name: string;
  unit_measure: { d_factor: number };
  depths: { label: string; values: { mean: number | null } }[];
}

async function fetchSoil(lat: number, lng: number) {
  const params = new URLSearchParams({ lon: lng.toFixed(4), lat: lat.toFixed(4), value: "mean" });
  for (const p of ["phh2o", "soc", "nitrogen", "sand", "silt", "clay"]) params.append("property", p);
  for (const d of ["0-5cm", "5-15cm"]) params.append("depth", d);
  const res = await fetch(`${URL_BASE}?${params}`, { signal: AbortSignal.timeout(20_000), cache: "no-store" });
  if (res.status === 429) throw new Error("SoilGrids rate limit reached");
  if (!res.ok) throw new Error(`SoilGrids returned ${res.status}`);
  const body = (await res.json()) as { properties?: { layers?: Layer[] } };
  const layers = body?.properties?.layers;
  if (!Array.isArray(layers)) throw new Error("Unexpected SoilGrids response");
  const get = (name: string): number | null => {
    const l = layers.find((x) => x.name === name);
    if (!l) return null;
    const vals = l.depths.map((d) => d.values?.mean).filter((v): v is number => typeof v === "number");
    if (!vals.length) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length / (l.unit_measure?.d_factor || 1);
  };
  // d_factor conversions → pH, g/kg (soc dg/kg÷10), g/kg (nitrogen cg/kg÷100), % (g/kg÷10)
  return { ph: get("phh2o"), soc: get("soc"), n: get("nitrogen"), sand: get("sand"), silt: get("silt"), clay: get("clay") };
}

export async function getSoil(lat: number, lng: number): Promise<SoilProfile> {
  const key = `soil:${lat.toFixed(3)}:${lng.toFixed(3)}`;
  const [row] = await db.select().from(soilProfiles).where(eq(soilProfiles.cacheKey, key)).limit(1);
  if (row && row.expiresAt > new Date()) return row;
  try {
    const s = await fetchSoil(lat, lng);
    const r1 = (v: number | null, dp = 1) => (v === null ? null : v.toFixed(dp));
    const available = Object.values(s).some((v) => v !== null);
    const now = new Date();
    const values = {
      cacheKey: key,
      provider: SOIL_PROVIDER,
      latitude: lat.toFixed(6),
      longitude: lng.toFixed(6),
      phH2o: r1(s.ph, 2),
      organicCarbonGKg: r1(s.soc, 2),
      nitrogenGKg: r1(s.n, 3),
      sandPct: r1(s.sand),
      siltPct: r1(s.silt),
      clayPct: r1(s.clay),
      texture: texture(s.sand, s.clay, s.silt),
      depth: "0-15cm",
      available,
      retrievedAt: now,
      // Soil properties change slowly; unavailable locations are retried sooner.
      expiresAt: new Date(now.getTime() + (available ? 90 : 7) * 86_400_000),
    };
    const [saved] = await db.insert(soilProfiles).values(values).onConflictDoUpdate({ target: soilProfiles.cacheKey, set: values }).returning();
    return saved;
  } catch (e) {
    if (row) return row;
    throw e;
  }
}

export function soilSummary(p: SoilProfile | null) {
  if (!p || !p.available) return null;
  const n = (v: string | null) => (v === null ? null : Number(v));
  return { phH2o: n(p.phH2o), clayPct: n(p.clayPct), sandPct: n(p.sandPct), siltPct: n(p.siltPct), organicCarbonGKg: n(p.organicCarbonGKg), nitrogenGKg: n(p.nitrogenGKg) };
}
