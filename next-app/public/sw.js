const CACHE = "etihad-prime-shell-v17";
const OFFLINE = "/offline";
const SHELL = ["/", OFFLINE, "/icon.svg", "/brand-logo.svg", "/receipt-logo.svg", "/manifest.webmanifest"];

async function cacheResponse(cache, request, response) {
  if (!response || !response.ok || response.type !== "basic") return;
  try { await cache.put(request, response.clone()); } catch {}
}

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Cache each shell resource independently: one missing optional asset must
    // never prevent the service worker itself from installing.
    await Promise.all(SHELL.map(async path => {
      const request = new Request(new URL(path, self.location.origin), { cache: "reload" });
      try {
        const response = await fetch(request);
        await cacheResponse(cache, request, response);
      } catch {}
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => (key.startsWith("etihad-traders-shell-") || key.startsWith("etihad-prime-shell-") || key === "etihad-traders-v1") && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") void self.skipWaiting();
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const response = await fetch(new Request(request, { cache: "no-store" }));
        await cacheResponse(cache, request, response);
        if (response.ok && response.type === "basic" && url.pathname === "/") {
          await cacheResponse(cache, new Request(new URL("/", self.location.origin)), response);
        }
        return response;
      } catch {
        return await caches.match(request, { ignoreSearch: true })
          || await caches.match(new Request(new URL("/", self.location.origin)))
          || await caches.match(OFFLINE)
          || new Response("Etihad Prime Supplies is not yet prepared for offline use on this device. Connect once, sign in, and open Sales & POS.", {
            status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" }
          });
      }
    })());
    return;
  }

  // Cache the app's compiled JS/CSS, fonts, images and Next.js server-component
  // payloads needed to reopen the already-loaded POS without a network.
  const isAppAsset = url.pathname.startsWith("/_next/static/")
    || ["script", "style", "font", "image"].includes(request.destination)
    || request.headers.has("RSC")
    || ["/icon.svg", "/brand-logo.svg", "/receipt-logo.svg", "/manifest.webmanifest"].includes(url.pathname);

  // Never cache API/auth endpoints or user-specific Supabase traffic.
  if (!isAppAsset || url.pathname.startsWith("/api/")) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(new Request(request, { cache: "no-store" }));
      await cacheResponse(cache, request, response);
      return response;
    } catch {
      return await caches.match(request) || Response.error();
    }
  })());
});
