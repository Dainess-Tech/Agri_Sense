"use client";
/**
 * IndexedDB-backed outbox for offline actions (structured records — not localStorage).
 * Safe actions (create farm/planting with clientId, record activity, update
 * recommendation status) are queued when offline and replayed in order when
 * connectivity returns. 409 conflicts are kept for the user to review instead
 * of silently overwriting newer server data.
 */
export interface QueuedAction {
  id: string;
  method: "POST" | "PATCH" | "DELETE";
  url: string;
  body: unknown;
  label: string;
  createdAt: string;
  attempts: number;
  status: "pending" | "conflict" | "failed";
  lastError?: string;
}

const DB_NAME = "agrisense";
const STORE = "outbox";
const listeners = new Set<() => void>();

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export const onQueueChange = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const emit = () => listeners.forEach((l) => l());

export async function listQueue(): Promise<QueuedAction[]> {
  if (typeof indexedDB === "undefined") return [];
  const all = await tx<QueuedAction[]>(STORE, "readonly", (s) => s.getAll() as IDBRequest<QueuedAction[]>);
  return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function enqueue(a: Omit<QueuedAction, "id" | "createdAt" | "attempts" | "status">) {
  const item: QueuedAction = { ...a, id: crypto.randomUUID(), createdAt: new Date().toISOString(), attempts: 0, status: "pending" };
  await tx(STORE, "readwrite", (s) => s.put(item));
  emit();
  return item;
}

export async function removeQueued(id: string) {
  await tx(STORE, "readwrite", (s) => s.delete(id));
  emit();
}

async function putQueued(item: QueuedAction) {
  await tx(STORE, "readwrite", (s) => s.put(item));
}

/** Tell the service worker to drop its HTTP caches for the current session. */
function clearServiceWorkerCaches() {
  try {
    navigator.serviceWorker?.controller?.postMessage("clear-user-cache");
  } catch {
    /* service workers are optional */
  }
}

/**
 * Drop cached user data (IndexedDB snapshots + HTTP caches). Used on 401 and
 * whenever the identity changes; the outbox is deliberately preserved so
 * queued edits can be replayed after the user signs in again.
 */
export async function clearCachedData() {
  if (typeof indexedDB !== "undefined") {
    await tx("kv", "readwrite", (s) => s.clear() as IDBRequest<undefined>).catch(() => undefined);
  }
  clearServiceWorkerCaches();
}

/**
 * Full sign-out cleanup: cached data, queued actions and local preferences.
 * This prevents one user's data/outbox from leaking into the next account.
 */
export async function clearUserData() {
  if (typeof indexedDB !== "undefined") {
    await Promise.all([
      tx(STORE, "readwrite", (s) => s.clear() as IDBRequest<undefined>).catch(() => undefined),
      tx("kv", "readwrite", (s) => s.clear() as IDBRequest<undefined>).catch(() => undefined),
    ]);
  }
  try {
    localStorage.removeItem("agrisense.selectedFarm");
  } catch {
    /* storage can be disabled */
  }
  clearServiceWorkerCaches();
  emit();
}

/** Small key/value cache in IndexedDB (e.g. last dashboard snapshot for offline viewing). */
export async function kvSet(key: string, value: unknown) {
  if (typeof indexedDB === "undefined") return;
  await tx("kv", "readwrite", (s) => s.put({ value, savedAt: new Date().toISOString() }, key));
}
export async function kvGet<T>(key: string): Promise<{ value: T; savedAt: string } | undefined> {
  if (typeof indexedDB === "undefined") return undefined;
  return tx("kv", "readonly", (s) => s.get(key) as IDBRequest<{ value: T; savedAt: string } | undefined>);
}

let syncing = false;
export const isSyncing = () => syncing;

export async function syncQueue(): Promise<{ synced: number; conflicts: number; failed: number }> {
  if (syncing || !navigator.onLine) return { synced: 0, conflicts: 0, failed: 0 };
  syncing = true;
  emit();
  let synced = 0, conflicts = 0, failed = 0;
  try {
    for (const item of await listQueue()) {
      if (item.status !== "pending") continue;
      try {
        const res = await fetch(item.url, {
          method: item.method,
          headers: { "Content-Type": "application/json", "X-Offline-Replay": "1" },
          body: item.body === undefined ? undefined : JSON.stringify(item.body),
          credentials: "same-origin",
        });
        if (res.ok) {
          await removeQueued(item.id);
          synced++;
        } else if (res.status === 409) {
          const data = await res.json().catch(() => ({}));
          await putQueued({ ...item, status: "conflict", attempts: item.attempts + 1, lastError: data?.error?.message ?? "Conflict with newer data" });
          conflicts++;
        } else if (res.status === 401) {
          // Keep the change queued: the session can be restored by signing in again.
          await putQueued({ ...item, attempts: item.attempts + 1, lastError: "Waiting for sign in — will retry automatically" });
          break;
        } else if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          const data = await res.json().catch(() => ({}));
          await putQueued({ ...item, status: "failed", attempts: item.attempts + 1, lastError: data?.error?.message ?? `HTTP ${res.status}` });
          failed++;
        } else {
          await putQueued({ ...item, attempts: item.attempts + 1, lastError: `HTTP ${res.status}` });
          break; // server/rate issue: retry later, preserve order
        }
      } catch {
        break; // still offline
      }
    }
  } finally {
    syncing = false;
    emit();
  }
  return { synced, conflicts, failed };
}
