const CACHE_NAME = 'swim-coach-v1';
const ASSETS = [
  '../index.html',
  '../css/style.css',
  '../js/app.js',
  '../js/dashboard.js',
  '../data/swims.json',
  '../data/health.json',
];

// Install: cache shell assets
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first for data, cache-first for shell
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Data files: network first, fall back to cache
  if (url.pathname.includes('/data/')) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Everything else: cache first, fall back to network
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
