"use client";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, ApiClientError, errorMessage } from "./api";
import { clearCachedData, kvGet, kvSet } from "./offline-queue";

export interface SessionUser {
  id: string;
  fullName: string;
  email: string;
  role: "farmer" | "agronomist" | "technician" | "admin";
  phone: string | null;
  country: string | null;
  language: string;
  measurementSystem: string;
  emailVerified: boolean;
  createdAt: string;
}
export interface FarmLite {
  id: string;
  name: string;
  latitude: string;
  longitude: string;
  size: string;
  areaUnit: string;
  irrigation: string;
  locationName: string | null;
  soilType: string | null;
  elevationM: string | null;
  archivedAt: string | null;
  createdAt: string;
  version: number;
}

/**
 * Data hook with offline fallback: successful responses are saved to IndexedDB;
 * when the network fails, the last saved copy is shown with its timestamp.
 */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [loading, setLoading] = useState<boolean>(!!path);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const seq = useRef(0);
  const currentPath = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!path) return;
    // Never show data from a previous path/farm/filter while the new one loads.
    if (currentPath.current !== path) {
      currentPath.current = path;
      setData(null);
      setSavedAt(null);
      setOffline(false);
    }
    const id = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const d = await api<T>(path);
      if (id !== seq.current) return;
      const cachedResponse = !!(d && typeof d === "object" && (d as Record<string, unknown>).__offline);
      setData(d);
      setStatus(200);
      if (cachedResponse) {
        const cached = await kvGet<T>(`api:${path}`);
        setSavedAt(cached?.savedAt ?? null);
        setOffline(true);
      } else {
        setSavedAt(null);
        setOffline(false);
        void kvSet(`api:${path}`, d);
      }
    } catch (e) {
      if (id !== seq.current) return;
      const st = e instanceof ApiClientError ? e.status : null;
      setStatus(st);
      setOffline(st === 0);
      if (st === 0) {
        const cached = await kvGet<T>(`api:${path}`);
        if (cached) {
          setData(cached.value);
          setSavedAt(cached.savedAt);
          return;
        }
      }
      setError(errorMessage(e));
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  return { data, error, loading, savedAt, offline, status, reload: load, setData };
}

interface AppCtx {
  user: SessionUser | null;
  farms: FarmLite[];
  farmId: string | null;
  setFarmId: (id: string) => void;
  refreshFarms: () => Promise<void>;
  refreshUser: () => Promise<void>;
  ready: boolean;
}

const Ctx = createContext<AppCtx | null>(null);
const FARM_KEY = "agrisense.selectedFarm";

export function AppProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [farms, setFarms] = useState<FarmLite[]>([]);
  const [farmId, setFarmIdState] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const refreshUser = useCallback(async () => {
    try {
      const r = await api<{ user: SessionUser }>("/auth/me");
      setUser(r.user);
      void kvSet("me", r.user);
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 401) {
        setUser(null);
        return;
      }
      const cached = await kvGet<SessionUser>("me");
      if (cached) setUser(cached.value);
    }
  }, []);

  const refreshFarms = useCallback(async () => {
    let list: FarmLite[] = [];
    try {
      list = (await api<{ farms: FarmLite[] }>("/farms")).farms;
      void kvSet("farms", list);
    } catch {
      list = (await kvGet<FarmLite[]>("farms"))?.value ?? [];
    }
    setFarms(list);
    setFarmIdState((cur) => {
      const stored = cur ?? localStorage.getItem(FARM_KEY);
      return list.find((f) => f.id === stored)?.id ?? list[0]?.id ?? null;
    });
  }, []);

  useEffect(() => {
    let alive = true;
    // A stalled request must not leave the entire app stuck on a spinner.
    const timeout = setTimeout(() => { if (alive) setReady(true); }, 5_000);
    const finish = () => {
      clearTimeout(timeout);
      if (alive) setReady(true);
    };
    void Promise.all([Promise.resolve().then(refreshUser), Promise.resolve().then(refreshFarms)]).finally(finish);
    return () => {
      alive = false;
      clearTimeout(timeout);
    };
  }, [refreshUser, refreshFarms]);

  useEffect(() => {
    const onUnauthorized = (event: Event) => {
      setUser(null);
      setFarms([]);
      // Never leave one user's cached farm data visible after the session dies.
      void clearCachedData();
      const detail = (event as CustomEvent<{ next?: string; silent?: boolean }>).detail;
      if (detail?.silent) return;
      router.replace(`/auth/login?next=${encodeURIComponent(detail?.next ?? "/dashboard")}`);
    };
    window.addEventListener("agrisense:unauthorized", onUnauthorized);
    return () => window.removeEventListener("agrisense:unauthorized", onUnauthorized);
  }, [router]);

  const setFarmId = useCallback((id: string) => {
    localStorage.setItem(FARM_KEY, id);
    setFarmIdState(id);
  }, []);

  return <Ctx.Provider value={{ user, farms, farmId, setFarmId, refreshFarms, refreshUser, ready }}>{children}</Ctx.Provider>;
}

export function useApp() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useApp must be used within AppProvider");
  return c;
}

// ---------- formatting helpers ----------
export const fmtDate = (d: string | Date | null | undefined) =>
  d ? new Date(typeof d === "string" && d.length === 10 ? d + "T00:00:00Z" : d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }) : "—";
export const fmtDateTime = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
export function timeAgo(d: string | Date | null | undefined) {
  if (!d) return "never";
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
export const SENSOR_LABELS: Record<string, { label: string; unit: string; icon: string }> = {
  soil_moisture: { label: "Soil moisture", unit: "%", icon: "💧" },
  air_temperature: { label: "Air temperature", unit: "°C", icon: "🌡️" },
  air_humidity: { label: "Air humidity", unit: "%RH", icon: "☁️" },
  soil_temperature: { label: "Soil temperature", unit: "°C", icon: "🌱" },
  soil_ph: { label: "Soil pH", unit: "pH", icon: "⚗️" },
};
export const RISK_LABELS: Record<string, string> = {
  drought: "Drought",
  excessive_rainfall: "Excessive rainfall",
  waterlogging: "Waterlogging",
  heat_stress: "Heat stress",
  cold_stress: "Cold stress",
  soil_moisture: "Soil moisture",
  soil_ph: "Soil pH",
  season_disruption: "Season disruption",
};
