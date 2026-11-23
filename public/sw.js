/* AgriSense service worker — offline shell, cached pages & API fallback, push notifications. */
const VERSION = "agrisense-v2";
const SHELL = `${VERSION}-shell`;
const PAGES = `${VERSION}-pages`;
const API = `${VERSION}-api`;
const ASSETS = `${VERSION}-assets`;
const PRECACHE = ["/offline", "/manifest.webmanifest", "/icons/agrisense.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res.ok && res.status === 200) cache.put(request, res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(request, { ignoreVary: true });
    if (hit) {
      // Mark responses served from cache so the UI can show "offline data".
      const headers = new Headers(hit.headers);
      headers.set("x-agrisense-cache", "offline");
      return new Response(await hit.blob(), { status: hit.status, headers });
    }
    if (fallbackUrl) {
      const fb = await caches.match(fallbackUrl);
      if (fb) return fb;
    }
    throw e;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // mutations are handled by the IndexedDB outbox in the app
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/api/")) {
    // API responses are session-scoped and may contain personal farm data.
    // The app keeps its own snapshots in IndexedDB (cleared on sign-out/401),
    // so the service worker deliberately never caches API responses.
    return;
  }
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, PAGES, "/offline"));
  }
});

self.addEventListener("message", (event) => {
  if (event.data === "clear-user-cache") {
    event.waitUntil(Promise.all([caches.delete(API), caches.delete(PAGES)].map((p) => p.catch(() => {}))));
  }
});

self.addEventListener("push", (event) => {
  let data = { title: "AgriSense", body: "You have a new notification", url: "/notifications" };
  try {
    data = { ...data, ...event.data.json() };
  } catch (e) {}
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icons/agrisense.svg",
      badge: "/icons/agrisense.svg",
      tag: data.tag,
      data: { url: data.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/notifications";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) {
          c.navigate(target);
          return c.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
