/** Unit helpers shared by server and client. Pure functions only. */
export const AREA_UNITS = {
  hectares: { label: "Hectares (ha)", toHa: 1 },
  acres: { label: "Acres (ac)", toHa: 0.404686 },
  square_meters: { label: "Square metres (m²)", toHa: 0.0001 },
} as const;

export type AreaUnit = keyof typeof AREA_UNITS;

export function toHectares(size: number, unit: string): number {
  const def = AREA_UNITS[unit as AreaUnit];
  if (!def) throw new Error(`Unknown area unit: ${unit}`);
  return size * def.toHa;
}

export function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + Math.round(days));
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(fromIso.slice(0, 10) + "T00:00:00Z").getTime();
  const b = new Date(toIso.slice(0, 10) + "T00:00:00Z").getTime();
  return Math.round((b - a) / 86_400_000);
}

export const SEVERITY_ORDER = ["info", "low", "medium", "high", "critical"] as const;
export type Severity = (typeof SEVERITY_ORDER)[number];

export function severityRank(s: Severity): number {
  return SEVERITY_ORDER.indexOf(s);
}

export function bumpSeverity(s: Severity, by = 1): Severity {
  return SEVERITY_ORDER[Math.min(SEVERITY_ORDER.length - 1, severityRank(s) + by)];
}
