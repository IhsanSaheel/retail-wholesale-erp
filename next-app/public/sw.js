const CACHE = "etihad-prime-shell-v19";
const OFFLINE = "/offline";
const SHELL = ["/", OFFLINE, "/icon.svg", "/brand-logo.svg", "/receipt-logo.svg", "/manifest.webmanifest"];

async function cacheResponse(cache, request, response) {
  if (!response || !response.ok || response.type !== "basic") return;
  try { await cache.put(request, response.clone()); } catch {}
}

async function precacheCurrentAppAssets(cache) {
  // A newly installed PWA may not yet have cached the JavaScript chunks needed
  // to boot its first standalone launch. Fetch the current home document and
  // pre-cache its immutable Next.js build assets before activating this worker.
  const request = new Request(new URL("/", self.location.origin), { cache: "reload" });
  try {
    const response = await fetch(request);
    if (!response || !response.ok || response.type !== "basic") return;
    await cacheResponse(cache, request, response);
    const html = await response.clone().text();
    const candidates = new Set();
    for (const match of html.matchAll(/(?:src|href)=["']([^"'#]+)["']/g)) {
      try {
        const asset = new URL(match[1], self.location.origin);
        if (asset.origin === self.location.origin && asset.pathname.startsWith("/_next/static/")) candidates.add(asset.href);
      } catch {}
    }
    await Promise.all([...candidates].map(async href => {
      const assetRequest = new Request(href, { cache: "reload" });
      try {
        const assetResponse = await fetch(assetRequest);
        await cacheResponse(cache, assetRequest, assetResponse);
      } catch {}
    }));
  } catch {}
}

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(SHELL.map(async path => {
      const request = new Request(new URL(path, self.location.origin), { cache: "reload" });
      try {
        const response = await fetch(request);
        await cacheResponse(cache, request, response);
      } catch {}
    }));
    await precacheCurrentAppAssets(cache);
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

  const isAppAsset = url.pathname.startsWith("/_next/static/")
    || ["script", "style", "font", "image"].includes(request.destination)
    || request.headers.has("RSC")
    || ["/icon.svg", "/brand-logo.svg", "/receipt-logo.svg", "/manifest.webmanifest"].includes(url.pathname);

  // Do not cache APIs, authentication endpoints, or Supabase/user data.
  if (!isAppAsset || url.pathname.startsWith("/api/")) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(new Request(request, { cache: "no-store" }));
      await cacheResponse(cache, request, response);
      return response;
    } catch {
      return await caches.match(request, { ignoreSearch: true }) || Response.error();
    }
  })());
});
