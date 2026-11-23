"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/client/api";
import { fmtDateTime, useApi } from "@/lib/client/hooks";
import { Alert, Badge, Button, Card, EmptyState, PageHeader, SavedDataNotice, SeverityBadge, Spinner, cx } from "@/components/ui";
import { PushToggle } from "@/components/push-toggle";

interface N { id: string; type: string; severity: string; title: string; body: string; link: string | null; readAt: string | null; createdAt: string }

export default function NotificationsPage() {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const { data, loading, error, reload, savedAt } = useApi<{ notifications: N[]; unread: number }>(`/notifications${unreadOnly ? "?unread=1" : ""}`);
  useEffect(() => { document.title = "Notifications · AgriSense"; }, []);
  const [err, setErr] = useState<string | null>(null);
  const markAll = async () => {
    setErr(null);
    try {
      await api("/notifications", { method: "POST" });
      void reload();
    } catch (e) {
      setErr(errorMessage(e));
    }
  };
  const toggle = async (n: N) => {
    setErr(null);
    try {
      await api(`/notifications/${n.id}`, { method: "PATCH", body: { read: !n.readAt } });
      void reload();
    } catch (e) {
      setErr(errorMessage(e));
    }
  };
  const icons: Record<string, string> = { risk: "⚠️", prediction: "📈", device: "📡", harvest: "🌾", system: "📣" };
  return (
    <>
      <PageHeader title="Notifications" description="Risk alerts, predictions, device status, harvest reminders and announcements." action={<Button variant="secondary" onClick={markAll} disabled={!data?.unread}>Mark all read</Button>} />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <SavedDataNotice savedAt={savedAt} />
          {error && <Alert tone="error">{error}</Alert>}
          {err && <Alert tone="error">{err}</Alert>}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-leaf-700" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} /> Unread only {data ? `(${data.unread})` : ""}</label>
          {loading && !data ? <Spinner /> : !data?.notifications.length ? (
            <EmptyState icon="🔔" title="You're all caught up">New alerts will appear here.</EmptyState>
          ) : data.notifications.map((n) => (
            <div key={n.id} className={cx("rounded-2xl border bg-white p-4 shadow-sm", n.readAt ? "border-stone-200" : "border-leaf-300 ring-1 ring-leaf-100")}>
              <div className="flex items-start gap-3">
                <span className="text-xl" aria-hidden>{icons[n.type] ?? "🔔"}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-stone-900">{n.title}</p>
                    {n.severity !== "info" && <SeverityBadge severity={n.severity} />}
                    {!n.readAt && <Badge tone="green">New</Badge>}
                  </div>
                  <p className="mt-0.5 text-sm text-stone-600">{n.body}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                    <span className="text-stone-400">{fmtDateTime(n.createdAt)}</span>
                    {n.link && <Link href={n.link} className="font-semibold text-leaf-800 underline" onClick={() => !n.readAt && toggle(n)}>View</Link>}
                    <button className="text-stone-500 underline" onClick={() => toggle(n)}>{n.readAt ? "Mark unread" : "Mark read"}</button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
        <Card title="Device notifications" subtitle="Permission-based; falls back to this in-app centre">
          <PushToggle />
          <p className="mt-3 text-xs text-stone-500">Choose which alerts you receive in <Link className="underline" href="/settings">Settings</Link>. Repeated low-priority alerts are automatically suppressed.</p>
        </Card>
      </div>
    </>
  );
}
