const CACHE = "etihad-prime-shell-v23";
const OFFLINE = "/offline";
const SHELL = ["/", OFFLINE, "/icon.svg", "/brand-logo.svg", "/receipt-logo.svg", "/manifest.webmanifest"];

function cacheKey(input) {
  const url = new URL(typeof input === "string" ? input : input.url, self.location.origin);
  return new Request(url.origin + url.pathname);
}
async function store(cache, input, response) {
  if (!response || !response.ok || response.type !== "basic") return false;
  try { await cache.put(cacheKey(input), response.clone()); return true; }
  catch (error) { return false; }
}
async function precacheHome(cache) {
  try {
    const homeRequest = new Request(new URL("/", self.location.origin), { cache: "reload" });
    const response = await fetch(homeRequest);
    if (!response.ok || response.type !== "basic") return false;
    const homeStored = await store(cache, "/", response);
    const html = await response.clone().text();
    const assets = new Set();
    for (const match of html.matchAll(/(?:src|href)=["']([^"'#]+)["']/g)) {
      try {
        const url = new URL(match[1], self.location.origin);
        if (url.origin === self.location.origin &&
          (url.pathname.startsWith("/_next/static/") || url.pathname.endsWith(".css") || url.pathname.endsWith(".js"))) assets.add(url.href);
      } catch {}
    }
    const assetResults = await Promise.all([...assets].map(async href => {
      try {
        const req = new Request(href, { cache: "reload" });
        return await store(cache, href, await fetch(req));
      } catch { return false; }
    }));
    return homeStored && assetResults.every(Boolean) && Boolean(await cache.match(cacheKey("/")));
  } catch { return false; }
}
self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(SHELL.map(async path => {
      try { await store(cache, path, await fetch(new Request(new URL(path, self.location.origin), { cache: "reload" }))); } catch {}
    }));
    const shellReady = await precacheHome(cache);
    if (!shellReady) throw new Error("The new app shell could not be cached completely; keeping the current offline version active.");
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    // This origin is dedicated to Etihad Prime Supplies. Remove every older
    // Cache Storage entry so stale HTML/JS cannot keep booting an old auth UI.
    // IndexedDB (encrypted business snapshots and queued sales) is untouched.
    await Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener("message", event => { if (event.data?.type === "SKIP_WAITING") void self.skipWaiting(); });
self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const isCleanAppShell = url.pathname === "/" && !url.search;
      try {
        const response = await fetch(request);
        // Cache only the single public app shell, never arbitrary navigation
        // responses, query-string callbacks, or account-specific URLs.
        if (isCleanAppShell) await store(cache, "/", response);
        return response;
      } catch {
        // The encrypted local snapshot is restored by the client at "/".
        // Other paths must not fall back to a cached page from another route.
        if (isCleanAppShell) {
          const home = await cache.match(cacheKey("/"));
          if (home) return home;
        }
        const offline = await cache.match(cacheKey(OFFLINE));
        return offline || new Response(
          "<!doctype html><html><head><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Etihad Prime Supplies</title></head><body style=\"font-family:Arial;padding:28px;background:#f5f3ee;color:#24221d\"><h2>Etihad Prime Supplies</h2><p>This page is unavailable offline. Reconnect to continue.</p></body></html>",
          { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
        );
      }
    })());
    return;
  }
  const isAppAsset = url.pathname.startsWith("/_next/static/") ||
    ["script", "style", "font", "image"].includes(request.destination) ||
    ["/icon.svg", "/brand-logo.svg", "/receipt-logo.svg", "/manifest.webmanifest"].includes(url.pathname);
  if (!isAppAsset || url.pathname.startsWith("/api/")) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(request);
      await store(cache, request, response);
      return response;
    } catch {
      return await caches.match(cacheKey(request), { ignoreSearch: true }) || Response.error();
    }
  })());
});
