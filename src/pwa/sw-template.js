/* Voltline service worker — generated at build time (see vite.config.ts). */
const VERSION = '__VERSION__';
const CACHE = `voltline-${VERSION}`;
const PRECACHE = __PRECACHE__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      // Cache everything needed to play offline. Fail the install if any asset is missing
      // so we never activate a half-cached version.
      await cache.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' })));
    }),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('voltline-') && k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    // App shell: serve the cached index (offline-first), refresh in the background.
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const cached = (await cache.match('./')) || (await cache.match('./index.html'));
        // The cached shell always matches this worker's precached assets. Updates arrive as a
        // new worker with its own complete precache, never by patching this one's index.
        if (cached) return cached;
        const network = await fetch(req).catch(() => null);
        return network || (await cache.match('./offline.html')) || new Response('Offline', { status: 503 });
      })(),
    );
    return;
  }
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok && res.type === 'basic') cache.put(req, res.clone());
        return res;
      } catch {
        return new Response('', { status: 504, statusText: 'Offline' });
      }
    })(),
  );
});
