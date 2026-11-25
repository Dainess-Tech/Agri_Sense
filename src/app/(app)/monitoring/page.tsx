"use client";
import { useEffect, useMemo } from "react";
import { useApi, useApp } from "@/lib/client/hooks";
import { LatestReadings, SensorChart, type Reading } from "@/components/farm-widgets";
import type { Crop, PlantingRow } from "@/components/planting-form";
import { Alert, Card, EmptyState, LinkButton, PageHeader, SavedDataNotice, Spinner } from "@/components/ui";

export default function MonitoringPage() {
  const { farmId, farms } = useApp();
  const latestQ = useApi<{ latest: Reading[] }>(farmId ? `/farms/${farmId}/readings` : null);
  const plantingsQ = useApi<{ plantings: (PlantingRow & { cropId: string })[] }>(farmId ? `/plantings?farmId=${farmId}` : null);
  const cropsQ = useApi<{ crops: Crop[] }>("/crops");
  const devicesQ = useApi<{ devices: { hardware: string; firmwareVersion: string | null }[] }>("/devices");
  useEffect(() => { document.title = "Monitoring · AgriSense"; }, []);
  const farm = farms.find((f) => f.id === farmId);

  // Crop-suitable bands from the first active planting's crop thresholds.
  const crop = useMemo(() => {
    const active = plantingsQ.data?.plantings.find((p) => !["harvested", "failed"].includes(p.status));
    return active ? cropsQ.data?.crops.find((c) => c.id === active.cropId) : undefined;
  }, [plantingsQ.data, cropsQ.data]);

  if (!farmId) return <EmptyState title="No farm yet" action={<LinkButton href="/farms?new=1">Add a farm</LinkButton>} />;
  const types = Array.from(new Set(["soil_moisture", "air_temperature", "air_humidity", "soil_temperature", ...(latestQ.data?.latest.map((r) => r.sensorType) ?? [])]));

  return (
    <>
      <PageHeader title="IoT monitoring" description={`Live and historical measurements for ${farm?.name ?? "this farm"}. Readings flagged as sensor faults are excluded from charts and risk analysis.`} action={<LinkButton variant="secondary" href="/devices">Manage devices</LinkButton>} />
      {devicesQ.data?.devices.some((device) => /simulat|demo/i.test(`${device.hardware} ${device.firmwareVersion ?? ""}`)) && (
        <div className="mb-5">
          <Alert tone="warning">A simulated demo node is active on this farm. Its readings are generated locally and sent through the same ingestion API used by the ESP32 firmware; no physical sensor values are being represented.</Alert>
        </div>
      )}
      <SavedDataNotice savedAt={latestQ.savedAt} />
      <Card title="Latest readings" className="mb-5" subtitle="All values include timestamps and units">
        {latestQ.loading && !latestQ.data ? <Spinner /> : latestQ.error ? <Alert tone="error">{latestQ.error}</Alert> : <LatestReadings readings={latestQ.data?.latest ?? []} />}
      </Card>
      {crop && <p className="mb-3 text-sm text-stone-600">Shaded bands show the configured <strong>{crop.name}</strong> thresholds.</p>}
      <div className="grid gap-5 lg:grid-cols-2">
        {types.map((t) => (
          <SensorChart
            key={`${farmId}-${t}`}
            farmId={farmId}
            sensorType={t}
            band={crop && t === "soil_moisture" ? [Number(crop.soilMoistureMin), Number(crop.soilMoistureMax)] : crop && t === "soil_ph" ? [Number(crop.phMin), Number(crop.phMax)] : undefined}
          />
        ))}
      </div>
    </>
  );
}
