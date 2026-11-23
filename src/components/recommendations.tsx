"use client";
import { useState } from "react";
import { api, errorMessage, isQueued } from "@/lib/client/api";
import { fmtDateTime } from "@/lib/client/hooks";
import { Alert, Badge, Button, EmptyState, SeverityBadge, cx } from "./ui";

export interface Rec {
  id: string;
  title: string;
  body: string;
  reason: string;
  severity: string;
  requiresExpert: boolean;
  status: string;
  createdAt: string;
  cropName?: string | null;
  farmName?: string;
}

export function RecommendationList({ items, onChange }: { items: Rec[]; onChange: () => void }) {
  const [filter, setFilter] = useState<"open" | "completed" | "all">("open");
  const [msg, setMsg] = useState<string | null>(null);
  const [local, setLocal] = useState<Record<string, string>>({});
  const status = (r: Rec) => local[r.id] ?? r.status;
  const shown = items.filter((r) => (filter === "all" ? true : filter === "open" ? status(r) !== "completed" : status(r) === "completed"));

  const update = async (r: Rec, s: string) => {
    const previous = local[r.id];
    setLocal((l) => ({ ...l, [r.id]: s }));
    try {
      const res = await api(`/recommendations/${r.id}`, { method: "PATCH", body: { status: s }, offlineQueue: { label: `Mark "${r.title}" ${s}` } });
      if (isQueued(res)) setMsg("Saved offline — will sync when you reconnect.");
      else onChange();
    } catch (e) {
      setLocal((l) => {
        const next = { ...l };
        if (previous === undefined) delete next[r.id];
        else next[r.id] = previous;
        return next;
      });
      setMsg(errorMessage(e));
      onChange();
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2" role="group" aria-label="Filter">
        {(["open", "completed", "all"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} aria-pressed={filter === f} className={cx("rounded-full px-3 py-1 text-sm font-medium capitalize", filter === f ? "bg-leaf-700 text-white" : "bg-white text-stone-600 ring-1 ring-stone-200")}>
            {f}
          </button>
        ))}
      </div>
      {msg && <Alert tone="info">{msg}</Alert>}
      {!shown.length ? (
        <EmptyState icon="💡" title={filter === "open" ? "Nothing needs attention" : "No recommendations here"}>Recommendations appear when risk rules detect conditions worth acting on.</EmptyState>
      ) : (
        shown.map((r) => (
          <article key={r.id} className={cx("rounded-2xl border bg-white p-4 shadow-sm", status(r) === "new" ? "border-leaf-300" : "border-stone-200", status(r) === "completed" && "opacity-70")}>
            <div className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={r.severity} />
              <h3 className="font-semibold text-stone-900">{r.title}</h3>
              {status(r) === "new" && <Badge tone="green">New</Badge>}
              {r.requiresExpert && <Badge tone="violet">👩‍🔬 Requires expert confirmation</Badge>}
            </div>
            <p className="mt-1.5 text-sm text-stone-700">{r.body}</p>
            <p className="mt-2 rounded-xl bg-stone-50 p-2.5 text-xs text-stone-600"><strong>Why: </strong>{r.reason}</p>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-stone-400">{[r.farmName, r.cropName].filter(Boolean).join(" · ")} · {fmtDateTime(r.createdAt)}</p>
              <div className="flex gap-2">
                {status(r) === "new" && <Button size="sm" variant="ghost" onClick={() => update(r, "read")}>Mark read</Button>}
                {status(r) !== "completed" ? <Button size="sm" variant="secondary" onClick={() => update(r, "completed")}>✓ Mark completed</Button> : <Button size="sm" variant="ghost" onClick={() => update(r, "read")}>Reopen</Button>}
              </div>
            </div>
          </article>
        ))
      )}
    </div>
  );
}
