
const CACHE_NAME = 'etihad-prime-supplies-v94';
// Derive the base path from the registered scope so the same PWA works on
// GitHub Pages (/retail-wholesale-erp/) and Vercel (/) without path rewrites.
const APP_PREFIX = new URL('./', self.registration.scope).pathname;

const APP_FILES = [
  APP_PREFIX,
  `${APP_PREFIX}index.html`,
  `${APP_PREFIX}demo.html`,
  `${APP_PREFIX}manifest.json`,
  `${APP_PREFIX}icon.svg`,
  `${APP_PREFIX}etihad-icon-192.jpg`,
  `${APP_PREFIX}etihad-brand-192-v3.jpg`
];

// Install the new application cache.
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(async cache => {
        await cache.addAll(APP_FILES);
        // The auth client is loaded from a CDN. Cache it during an online install
        // so the app can initialize its local-only owner mode without internet.
        await Promise.all([
          cache.add('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2').catch(() => {}),
          cache.add('https://unpkg.com/@supabase/supabase-js@2').catch(() => {})
        ]);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate the new version and remove old Etihad Traders caches.
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key =>
            (key.startsWith('etihad-traders-') || key.startsWith('etihad-prime-supplies-')) &&
            key !== CACHE_NAME
          )
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// Network-first strategy: use the latest version online,
// but retain cached files for offline access.
self.addEventListener('fetch', event => {
  const request = event.request;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Serve the Supabase browser bundle from cache when offline. Keep online
  // requests fresh and update the cached copy for the next offline launch.
  if (url.href === 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2' ||
      url.href === 'https://unpkg.com/@supabase/supabase-js@2') {
    event.respondWith(
      fetch(request).then(response => {
        if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
        return response;
      }).catch(async () => {
        const cached = await caches.match(request);
        return cached || new Response('Authentication library unavailable offline', {
          status: 503,
          statusText: 'Offline'
        });
      })
    );
    return;
  }

  if (
    url.origin !== self.location.origin ||
    !url.pathname.startsWith(APP_PREFIX)
  ) return;

  event.respondWith(
    fetch(new Request(request, { cache: request.mode === 'navigate' ? 'no-store' : 'default' }))
      .then(response => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();

          caches.open(CACHE_NAME)
            .then(cache => cache.put(request, copy));
        }

        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);

        if (cached) return cached;

        if (request.mode === 'navigate') {
          return caches.match(`${APP_PREFIX}index.html`);
        }

        return new Response('File unavailable offline', {
          status: 503,
          statusText: 'Offline'
        });
      })
  );
});
