"use client";
import { useState, useSyncExternalStore } from "react";
import { api, errorMessage } from "@/lib/client/api";
import { Button } from "./ui";

const PUSH_STATE_EVENT = "agrisense:push-state-change";
const subscribePushState = (onChange: () => void) => {
  window.addEventListener("focus", onChange);
  window.addEventListener(PUSH_STATE_EVENT, onChange);
  return () => {
    window.removeEventListener("focus", onChange);
    window.removeEventListener(PUSH_STATE_EVENT, onChange);
  };
};
const getPushState = () => {
  if (typeof window === "undefined") return "checking";
  if (!("Notification" in window) || !("serviceWorker" in navigator)) return "unsupported";
  return Notification.permission;
};

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function PushToggle() {
  const state = useSyncExternalStore(subscribePushState, getPushState, () => "checking");
  const [msg, setMsg] = useState<string | null>(null);
  const enable = async () => {
    try {
      const perm = await Notification.requestPermission();
      window.dispatchEvent(new Event(PUSH_STATE_EVENT));
      if (perm !== "granted") return setMsg("Permission not granted. You will still see alerts in the in-app notification centre.");
      const cfg = await api<{ configured: boolean; publicKey: string | null }>("/notifications/push");
      if (cfg.configured && cfg.publicKey && "PushManager" in window) {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(cfg.publicKey) });
        await api("/notifications/push", { method: "POST", body: sub.toJSON() });
        await api("/users/preferences", { method: "PATCH", body: { pushEnabled: true } });
        setMsg("Push notifications enabled on this device.");
      } else {
        setMsg("Device notifications enabled while AgriSense is open. (Server push requires VAPID keys — see README.)");
      }
    } catch (e) {
      setMsg(errorMessage(e));
    }
  };
  return (
    <div className="space-y-2 text-sm">
      {state === "unsupported" ? (
        <p className="text-stone-600">This browser doesn&apos;t support notifications. Alerts will appear in the in-app notification centre.</p>
      ) : state === "granted" ? (
        <p className="text-leaf-800">✅ Device notifications are allowed.</p>
      ) : state === "denied" ? (
        <p className="text-stone-600">Notifications are blocked in your browser settings. In-app alerts still work.</p>
      ) : (
        <Button size="sm" onClick={enable}>🔔 Enable device notifications</Button>
      )}
      {state === "granted" && <Button size="sm" variant="secondary" onClick={enable}>Re-register push on this device</Button>}
      {msg && <p className="text-xs text-stone-600">{msg}</p>}
    </div>
  );
}

