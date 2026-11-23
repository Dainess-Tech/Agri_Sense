"use client";
import { clearCachedData, enqueue } from "./offline-queue";

/** Centralised API client for /api/v1 — all frontend data access goes through here. */
export class ApiClientError extends Error {
  constructor(public status: number, message: string, public details?: unknown, public code?: string) {
    super(message);
  }
}

export interface ApiOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  /** If the request fails because the device is offline, queue it in IndexedDB for later sync. */
  offlineQueue?: { label: string };
  /** Silent background requests never force a login redirect (e.g. notification polling). */
  silent?: boolean;
}

export type Queued = { queued: true };

const REQUEST_TIMEOUT_MS = 20_000;

/** Notify the app that the session is no longer valid, without hard-coding navigation here. */
function unauthorized(opts: ApiOptions) {
  if (typeof window === "undefined") return;
  void clearCachedData();
  window.dispatchEvent(new CustomEvent("agrisense:unauthorized", { detail: { silent: opts.silent ?? false } }));
  if (opts.silent) return;
  const next = window.location.pathname + window.location.search + window.location.hash;
  window.location.assign(`/auth/login?next=${encodeURIComponent(next)}`);
}

export async function api<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const url = path.startsWith("/api/") ? path : `/api/v1${path}`;
  const method = opts.method ?? "GET";
  const queue = async () => {
    await enqueue({ method: method as "POST" | "PATCH" | "DELETE", url, body: opts.body, label: opts.offlineQueue!.label });
    return { queued: true } as T;
  };
  if (opts.offlineQueue && method !== "GET" && typeof navigator !== "undefined" && !navigator.onLine) return queue();

  const controller = typeof AbortController === "undefined" ? null : new AbortController();
  const timer = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : null;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: opts.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: "same-origin",
      signal: controller?.signal,
    });
  } catch {
    if (opts.offlineQueue && method !== "GET") return queue();
    throw new ApiClientError(0, "Unable to reach the server. Showing saved data where available.");
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && !url.includes("/auth/")) unauthorized(opts);
    const message = data?.error?.message ?? `Request failed (${res.status})`;
    throw new ApiClientError(res.status, message, data?.error?.details, data?.error?.code);
  }
  if (res.headers.get("x-agrisense-cache") === "offline" && data && typeof data === "object") {
    (data as Record<string, unknown>).__offline = true;
  }
  return data as T;
}

export function isQueued(v: unknown): v is Queued {
  return !!v && typeof v === "object" && (v as Queued).queued === true;
}

/** Formats validation issues from 422 responses into a readable string. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiClientError) {
    if (Array.isArray(e.details) && e.details.length) {
      return e.details.map((d: { path?: unknown[]; message?: string }) => `${(d.path ?? []).join(".")}: ${d.message}`).join("; ");
    }
    return e.message;
  }
  return e instanceof Error ? e.message : "Something went wrong";
}
