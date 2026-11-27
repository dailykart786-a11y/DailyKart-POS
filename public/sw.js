// DailyKart service worker: lets the app open without internet.
//
// - Pages: always try the network first, so a new version shows up right
//   away. Only when there is no internet is the saved copy used.
// - /assets/* files have a unique name per version, so a saved copy is
//   always correct.
// - Requests to the database (Supabase) are never touched.
const CACHE = "dailykart-app-v1";

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE);
      const res = await fetch("/", { cache: "no-store" });
      if (res.ok) {
        const html = await res.clone().text();
        await cache.put("/", res);
        // Save the scripts and styles the page needs
        const urls = Array.from(html.matchAll(/(?:src|href)="(\/[^"]+\.(?:js|css|png|ico|svg))"/g)).map((m) => m[1]);
        await Promise.all(urls.map((u) => cache.add(u).catch(() => undefined)));
      }
    } catch {
      // Offline during install: pages get saved as they are used instead
    }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith("dailykart-app-") && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // database, fonts, etc.

  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) {
          const cache = await caches.open(CACHE);
          cache.put("/", res.clone()).catch(() => undefined);
        }
        return res;
      } catch {
        const cached = await caches.match("/");
        return cached || new Response("<h1>No internet</h1><p>Open DailyKart once with internet on this device first.</p>", {
          status: 503,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
    })());
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      const res = await fetch(req);
      if (res.ok) {
        const cache = await caches.open(CACHE);
        cache.put(req, res.clone()).catch(() => undefined);
      }
      return res;
    })());
    return;
  }

  // Logo, icons and other files: use the network, fall back to a saved copy
  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok) {
        const cache = await caches.open(CACHE);
        cache.put(req, res.clone()).catch(() => undefined);
      }
      return res;
    } catch {
      const cached = await caches.match(req);
      if (cached) return cached;
      throw new Error("offline");
    }
  })());
});
