const CACHE_NAME = 'flowdeck-v3';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

const cacheSameOrigin = async (request, response) => {
  if (!response || !response.ok) return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response);
};

// Installation : mise en cache best-effort des fichiers vitaux
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    for (const url of CORE_ASSETS) {
      try { await cache.add(url); } catch (e) {}
    }
  })());
  self.skipWaiting();
});

// Activation : nettoyage des anciens caches
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => (key !== CACHE_NAME ? caches.delete(key) : undefined)));
    await self.clients.claim();
  })());
});

// Navigations: network-first (évite le HTML figé), fallback offline sur le shell
// Assets: stale-while-revalidate (rapide + mise à jour silencieuse)
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(async (resp) => {
          await cacheSameOrigin(new Request('./index.html'), resp.clone());
          return resp;
        })
        .catch(async () => {
          return (await caches.match('./index.html')) || (await caches.match('./')) || Response.error();
        })
    );
    return;
  }

  const cachedPromise = caches.match(req);
  const fetchPromise = fetch(req)
    .then(async (resp) => {
      await cacheSameOrigin(req, resp.clone());
      return resp;
    })
    .catch(() => null);

  event.waitUntil(fetchPromise.catch(() => {}));
  event.respondWith((async () => {
    const cached = await cachedPromise;
    return cached || (await fetchPromise) || Response.error();
  })());
});
