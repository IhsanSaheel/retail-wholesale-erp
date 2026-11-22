const CACHE = "etihad-prime-shell-v20";
const OFFLINE = "/offline";
const SHELL = ["/", OFFLINE, "/icon.svg", "/brand-logo.svg", "/receipt-logo.svg", "/manifest.webmanifest"];

function cacheKey(input) {
  const url = new URL(typeof input === "string" ? input : input.url, self.location.origin);
  return new Request(url.origin + url.pathname);
}
async function store(cache, input, response) {
  if (!response || !response.ok || response.type !== "basic") return;
  try { await cache.put(cacheKey(input), response.clone()); } catch (error) { /* cache quota or unsupported response */ }
}
async function precacheHome(cache) {
  try {
    const homeRequest = new Request(new URL("/", self.location.origin), { cache: "reload" });
    const response = await fetch(homeRequest);
    if (!response.ok || response.type !== "basic") return;
    await store(cache, "/", response);
    const html = await response.clone().text();
    const assets = new Set();
    for (const match of html.matchAll(/(?:src|href)=["']([^"'#]+)["']/g)) {
      try {
        const url = new URL(match[1], self.location.origin);
        if (url.origin === self.location.origin &&
          (url.pathname.startsWith("/_next/static/") || url.pathname.endsWith(".css") || url.pathname.endsWith(".js"))) assets.add(url.href);
      } catch {}
    }
    await Promise.all([...assets].map(async href => {
      try { const req = new Request(href, { cache: "reload" }); await store(cache, href, await fetch(req)); } catch {}
    }));
  } catch {}
}
self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(SHELL.map(async path => {
      try { await store(cache, path, await fetch(new Request(new URL(path, self.location.origin), { cache: "reload" }))); } catch {}
    }));
    await precacheHome(cache);
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
self.addEventListener("message", event => { if (event.data?.type === "SKIP_WAITING") void self.skipWaiting(); });
self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const response = await fetch(request);
        await store(cache, request, response);
        if (url.pathname === "/") await store(cache, "/", response);
        return response;
      } catch {
        const exact = await caches.match(cacheKey(request), { ignoreSearch: true });
        const home = await caches.match(cacheKey("/"));
        const offline = await caches.match(cacheKey(OFFLINE));
        return exact || home || offline || new Response(
          "<!doctype html><html><head><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Etihad Prime Supplies</title></head><body style=\"font-family:Arial;padding:28px;background:#f5f3ee;color:#24221d\"><h2>Etihad Prime Supplies</h2><p>This device has not cached the app shell yet. Connect to the internet, open the dashboard once, then try offline again.</p></body></html>",
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
