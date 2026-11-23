import { requireUser } from "@/server/auth";
import { ApiError, handle, json, rateLimit } from "@/server/http";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/geo?q=Nakuru — place search via OpenStreetMap Nominatim (max 1 req/s, attribution required).
 * GET /api/v1/geo?lat=..&lng=.. — elevation lookup via Open-Meteo Elevation API (Copernicus DEM).
 */
export const GET = handle(async (req: Request) => {
  const user = await requireUser();
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim();
  if (q) {
    rateLimit(`geo:${user.id}`, 1, 1100);
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(q)}`, {
      headers: { "User-Agent": `AgriSense/1.0 (${process.env.APP_URL || "agrisense"})`, "Accept-Language": "en" },
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    if (!res || !res.ok) throw new ApiError(503, "Place search is unavailable right now. Enter coordinates manually.");
    const data = (await res.json()) as { display_name: string; lat: string; lon: string }[];
    return json({ results: data.map((d) => ({ name: d.display_name, latitude: Number(d.lat), longitude: Number(d.lon) })), attribution: "© OpenStreetMap contributors" });
  }
  const latRaw = url.searchParams.get("lat");
  const lngRaw = url.searchParams.get("lng");
  const lat = latRaw === null ? NaN : Number(latRaw);
  const lng = lngRaw === null ? NaN : Number(lngRaw);
  if (latRaw === null || lngRaw === null || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new ApiError(422, "Provide q, or valid lat and lng");
  }
  const res = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lng}`, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!res || !res.ok) throw new ApiError(503, "Elevation service unavailable");
  const data = (await res.json()) as { elevation?: number[] };
  return json({ elevationM: data.elevation?.[0] ?? null, provider: "Open-Meteo Elevation (Copernicus DEM GLO-90)", dataType: "modelled" });
});
