"use client";
import { useEffect, useState } from "react";
import { useApp } from "@/lib/client/hooks";
import { Card, EmptyState, Field, Input, LinkButton, PageHeader } from "@/components/ui";

export default function ReportsClient({ today, fromDefault }: { today: string; fromDefault: string }) {
  const { farmId, farms } = useApp();
  const [from, setFrom] = useState(fromDefault);
  const [to, setTo] = useState(today);
  useEffect(() => { document.title = "Reports · AgriSense"; }, []);
  if (!farmId) return <EmptyState title="No farm yet" action={<LinkButton href="/farms?new=1">Add a farm</LinkButton>} />;
  const farm = farms.find((f) => f.id === farmId);
  const base = `/api/v1/reports/farms/${farmId}`;
  const dl = "inline-flex items-center gap-2 rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-800 hover:bg-stone-50";
  return (
    <>
      <PageHeader title="Reports & exports" description={`Download reports and data for ${farm?.name}. All exports include the generation date (UTC) and measurement units.`} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="📄 Farm & prediction report (PDF)" subtitle="Printable summary: farm details, plantings, latest predictions, risks, recommendations and sensor status">
          <LinkButton href={`/reports/${farmId}`}>Open printable report</LinkButton>
          <p className="mt-2 text-xs text-stone-500">Use “Download PDF” on the report page (your browser&apos;s Save as PDF).</p>
        </Card>
        <Card title="📡 Sensor readings (CSV)" subtitle="Raw readings with device time, server receipt time, units and quality flags">
          <div className="grid grid-cols-2 gap-3">
            <Field label="From"><Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label="To"><Input type="date" value={to} max={today} onChange={(e) => setTo(e.target.value)} /></Field>
          </div>
          <a className={`${dl} mt-3`} href={`${base}?type=readings&from=${from}&to=${to}`}>⬇ Download readings CSV</a>
        </Card>
        <Card title="⛅ Historical weather (CSV)" subtitle="Daily modelled weather from the Open-Meteo archive">
          <div className="flex flex-wrap gap-2">
            {[30, 90, 365].map((d) => <a key={d} className={dl} href={`${base}?type=weather&days=${d}`}>⬇ Last {d} days</a>)}
          </div>
        </Card>
        <Card title="🌾 Planting, harvest & prediction records (CSV)">
          <div className="flex flex-wrap gap-2">
            <a className={dl} href={`${base}?type=plantings`}>⬇ Plantings & harvests</a>
            <a className={dl} href={`${base}?type=predictions`}>⬇ Predictions</a>
          </div>
        </Card>
      </div>
    </>
  );
}
