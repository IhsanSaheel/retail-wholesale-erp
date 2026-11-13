
const CACHE_NAME = 'etihad-traders-v74';
const APP_PREFIX = '/retail-wholesale-erp/';

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
      .then(cache => cache.addAll(APP_FILES))
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
            key.startsWith('etihad-traders-') &&
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

  if (
    url.origin !== self.location.origin ||
    !url.pathname.startsWith(APP_PREFIX)
  ) return;

  event.respondWith(
    fetch(request)
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
