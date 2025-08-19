const CACHE_VERSION = 'v1';
const APP_CACHE = `tiffin-cache-${CACHE_VERSION}`;
const PRECACHE_URLS = [
  './',
  'index.html',
  'styles.css',
  'app.jsx',
  'icons/icon.svg',
  // External libs to enable offline after first install
  'https://unpkg.com/react@18/umd/react.production.min.js',
  'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js',
  'https://unpkg.com/@babel/standalone/babel.min.js',
  'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
  'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.4/dist/jspdf.plugin.autotable.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_CACHE).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== APP_CACHE).map((k) => caches.delete(k)));
      if ('navigationPreload' in self.registration) {
        try { await self.registration.navigationPreload.enable(); } catch {}
      }
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Handle navigations: serve index.html offline
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const preload = await event.preloadResponse;
          if (preload) return preload;
          const networkResponse = await fetch(request);
          return networkResponse;
        } catch (err) {
          const cache = await caches.open(APP_CACHE);
          const cached = await cache.match('index.html');
          return cached || Response.error();
        }
      })()
    );
    return;
  }

  // Runtime caching for same-origin assets: cache-first
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((resp) => {
        const copy = resp.clone();
        caches.open(APP_CACHE).then((cache) => cache.put(request, copy));
        return resp;
      }))
    );
    return;
  }

  // Runtime caching for common CDNs: stale-while-revalidate
  const cdnHosts = [
    'fonts.googleapis.com',
    'fonts.gstatic.com',
    'unpkg.com',
    'cdn.jsdelivr.net'
  ];
  if (cdnHosts.includes(url.host)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(APP_CACHE);
        const cached = await cache.match(request);
        const networkPromise = fetch(request).then((resp) => {
          cache.put(request, resp.clone());
          return resp;
        }).catch(() => undefined);
        return cached || networkPromise || fetch(request);
      })()
    );
  }
});
