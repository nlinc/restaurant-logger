const CACHE_NAME = 'lincoln-eats-v11';
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/styles.css',
  '/js/app.js',
  '/js/firebase-config.js',
  '/icons/icon-180.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-512.png'
];

// Install: Cache essential shell assets
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Activate: Clean up old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: Network-first for app shell files so phones pick up new deploys quickly.
self.addEventListener('fetch', (e) => {
  // Only handle local GET requests
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  const isAppShellRequest =
    e.request.mode === 'navigate' ||
    ASSETS.includes(url.pathname) ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.json');

  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      if (isAppShellRequest) {
        try {
          const networkResponse = await fetch(e.request);
          if (networkResponse.status === 200) {
            cache.put(e.request, networkResponse.clone());
          }
          return networkResponse;
        } catch (err) {
          const cachedResponse = await caches.match(e.request, { ignoreSearch: true });
          if (cachedResponse) return cachedResponse;
          if (e.request.mode === 'navigate') return caches.match('/index.html');
          throw err;
        }
      }

      const cachedResponse = await caches.match(e.request, { ignoreSearch: true });
      if (cachedResponse) return cachedResponse;

      const networkResponse = await fetch(e.request);
      if (networkResponse.status === 200) {
        cache.put(e.request, networkResponse.clone());
      }
      return networkResponse;
    })()
  );
});

self.addEventListener('message', (e) => {
  if (e.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
