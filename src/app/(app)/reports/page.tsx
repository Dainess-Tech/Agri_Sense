import ReportsClient from "./reports-client";

export const dynamic = "force-dynamic";

export default function ReportsPage() {
  const today = new Date().toISOString().slice(0, 10);
  const from = new Date(new Date().getTime() - 30 * 86400000).toISOString().slice(0, 10);
  return <ReportsClient today={today} fromDefault={from} />;
}
