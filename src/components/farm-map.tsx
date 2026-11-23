"use client";
/**
 * Farm location map using the official OpenStreetMap embed (tile usage policy
 * compliant, attribution shown). Swap for Leaflet + a tile provider when you
 * need interactive multi-farm maps or polygon field boundaries.
 */
export function FarmMap({ lat, lng, zoom = 0.01, className = "h-64" }: { lat: number; lng: number; zoom?: number; className?: string }) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return <div className={`flex items-center justify-center rounded-xl bg-stone-100 text-sm text-stone-500 ${className}`}>Enter coordinates to preview the map</div>;
  }
  const bbox = [lng - zoom, lat - zoom * 0.6, lng + zoom, lat + zoom * 0.6].map((n) => n.toFixed(5)).join(",");
  return (
    <div className="overflow-hidden rounded-xl border border-stone-200">
      <iframe
        title={`Map of farm location ${lat.toFixed(4)}, ${lng.toFixed(4)}`}
        className={`w-full ${className}`}
        loading="lazy"
        src={`https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat.toFixed(5)},${lng.toFixed(5)}`}
      />
      <div className="flex justify-between bg-stone-50 px-3 py-1.5 text-xs text-stone-500">
        <span>
          {lat.toFixed(5)}, {lng.toFixed(5)}
        </span>
        <a className="underline" href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=15/${lat}/${lng}`} target="_blank" rel="noreferrer">
          © OpenStreetMap contributors
        </a>
      </div>
    </div>
  );
}
