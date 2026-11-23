"use client";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { listQueue, onQueueChange, removeQueued, syncQueue, isSyncing, type QueuedAction } from "@/lib/client/offline-queue";
import { api } from "@/lib/client/api";
import { cx } from "./ui";

const subscribeConnectivity = (onChange: () => void) => {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
};
const getOnline = () => navigator.onLine;

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const register = () => navigator.serviceWorker.register("/sw.js").catch((e) => console.warn("SW registration failed", e));
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);
  return null;
}

/** Online / offline / syncing state + pending outbox, with automatic background sync. */
export function useConnection() {
  const online = useSyncExternalStore(subscribeConnectivity, getOnline, () => true);
  const [queue, setQueue] = useState<QueuedAction[]>([]);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(async () => {
    setQueue(await listQueue().catch(() => []));
    setSyncing(isSyncing());
  }, []);

  useEffect(() => {
    void Promise.resolve().then(refresh);
    const sync = () => void syncQueue().then(refresh);
    const on = () => sync();
    window.addEventListener("online", on);
    const unsub = onQueueChange(() => void refresh());
    const timer = setInterval(() => navigator.onLine && sync(), 30_000);
    if (navigator.onLine) sync();
    return () => {
      window.removeEventListener("online", on);
      unsub();
      clearInterval(timer);
    };
  }, [refresh]);

  return { online, queue, syncing, refresh };
}

export function ConnectionStatus() {
  const { online, queue, syncing } = useConnection();
  const [open, setOpen] = useState(false);
  const pending = queue.filter((q) => q.status === "pending").length;
  const problems = queue.filter((q) => q.status !== "pending");
  const state = !online ? "offline" : syncing ? "syncing" : problems.length ? "attention" : pending ? "pending" : "online";
  const styles = {
    online: "bg-leaf-100 text-leaf-800",
    offline: "bg-stone-800 text-white",
    syncing: "bg-sky-100 text-sky-800",
    pending: "bg-amber-100 text-amber-800",
    attention: "bg-red-100 text-red-800",
  }[state];
  const label = { online: "Online", offline: "Offline", syncing: "Syncing…", pending: `${pending} pending`, attention: `${problems.length} need review` }[state];
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-live="polite" className={cx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold", styles)}>
        <span className={cx("h-2 w-2 rounded-full", state === "online" ? "bg-leaf-600" : state === "offline" ? "bg-stone-400" : state === "syncing" ? "animate-pulse bg-sky-500" : state === "pending" ? "bg-amber-500" : "bg-red-500")} aria-hidden />
        {label}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-80 rounded-2xl border border-stone-200 bg-white p-4 text-sm shadow-xl">
          <p className="font-semibold text-stone-900">{online ? "Connected" : "You are offline"}</p>
          <p className="mt-1 text-xs text-stone-600">
            {online ? "Changes are saved directly to AgriSense." : "Previously visited pages and saved data remain available. Supported changes are queued and will sync automatically."}
          </p>
          {queue.length > 0 && (
            <ul className="mt-3 max-h-60 space-y-2 overflow-y-auto">
              {queue.map((q) => (
                <li key={q.id} className="rounded-xl border border-stone-200 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-stone-800">{q.label}</span>
                    <span className={cx("text-xs", q.status === "pending" ? "text-amber-700" : "text-red-700")}>{q.status}</span>
                  </div>
                  {q.lastError && <p className="mt-1 text-xs text-stone-500">{q.lastError}</p>}
                  {q.status !== "pending" && (
                    <button className="mt-1 text-xs font-semibold text-red-700 underline" onClick={() => void removeQueued(q.id)}>
                      Discard local change
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {online && pending > 0 && (
            <button className="mt-3 text-xs font-semibold text-leaf-800 underline" onClick={() => void syncQueue()}>
              Sync now
            </button>
          )}
        </div>
      )}
    </div>
  );
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}

let appInstalled = false;
const subscribeInstalled = (onChange: () => void) => {
  const displayMode = window.matchMedia("(display-mode: standalone)");
  const onInstalled = () => {
    appInstalled = true;
    onChange();
  };
  displayMode.addEventListener("change", onChange);
  window.addEventListener("appinstalled", onInstalled);
  return () => {
    displayMode.removeEventListener("change", onChange);
    window.removeEventListener("appinstalled", onInstalled);
  };
};
const getInstalled = () => appInstalled || window.matchMedia("(display-mode: standalone)").matches;

/** Install button (Chrome/Edge/Android) with iOS & unsupported-browser fallback hints. */
export function InstallPrompt({ compact }: { compact?: boolean }) {
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const installed = useSyncExternalStore(subscribeInstalled, getInstalled, () => false);
  const [hint, setHint] = useState<string | null>(null);
  useEffect(() => {
    const h = (e: Event) => {
      e.preventDefault();
      setEvt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", h);
    return () => window.removeEventListener("beforeinstallprompt", h);
  }, []);
  if (installed) return null;
  const click = async () => {
    if (evt) {
      await evt.prompt();
      await evt.userChoice;
      setEvt(null);
      return;
    }
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    setHint(ios ? "On iPhone/iPad: tap Share → “Add to Home Screen”." : "Use your browser menu → “Install app” / “Add to Home screen”. For the best experience use Chrome on Android or desktop.");
  };
  return (
    <div className={compact ? "" : "space-y-2"}>
      <button onClick={click} className={cx("inline-flex items-center gap-2 rounded-xl font-semibold", compact ? "px-2.5 py-1 text-xs text-leaf-800 hover:bg-leaf-50" : "bg-amber-400 px-5 py-3 text-sm text-stone-900 shadow hover:bg-amber-300")}>
        📲 Install app
      </button>
      {hint && <p className={cx("text-xs", compact ? "absolute right-4 z-40 mt-1 max-w-xs rounded-xl bg-white p-3 text-stone-700 shadow-lg" : "text-leaf-50")}>{hint}</p>}
    </div>
  );
}

/**
 * Polls the in-app notification centre. When Web Push isn't configured server-side,
 * shows a local system notification for new important alerts (if permission granted).
 */
export function useNotificationPoll() {
  const [unread, setUnread] = useState(0);
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const r = await api<{ unread: number; notifications: { id: string; title: string; body: string; severity: string; link: string | null }[] }>("/notifications?unread=1&limit=10", { silent: true });
        if (stop) return;
        setUnread(r.unread);
        const ids = new Set(r.notifications.map((n) => n.id));
        if (seen.current && "Notification" in window && Notification.permission === "granted") {
          for (const n of r.notifications) {
            if (!seen.current.has(n.id) && ["medium", "high", "critical"].includes(n.severity)) {
              const reg = await navigator.serviceWorker?.getRegistration();
              await reg?.showNotification(n.title, { body: n.body, icon: "/icons/agrisense.svg", tag: n.id, data: { url: n.link ?? "/notifications" } }).catch(() => {});
            }
          }
        }
        seen.current = ids;
      } catch {
        /* offline */
      }
    };
    void tick();
    const t = setInterval(tick, 60_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);
  return unread;
}
