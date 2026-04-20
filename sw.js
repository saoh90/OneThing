// ============================================================================
// FlowDeck Pro - Service Worker
// Optimized for iOS PWA and offline-first experience
// ============================================================================

const CACHE_VERSION = 1;
const CACHE_NAME = `flowdeck-v${CACHE_VERSION}`;

const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Cache response for same-origin requests
 */
const cacheSameOrigin = async (request, response) => {
  // Only cache successful responses
  if (!response || !response.ok || response.status !== 200) return;
  
  const url = new URL(request.url);
  
  // Only cache same-origin requests
  if (url.origin !== self.location.origin) return;
  
  try {
    const cache = await caches.open(CACHE_NAME);
    // Clone the response as it can only be used once
    await cache.put(request, response.clone());
  } catch (error) {
    console.warn('Cache save failed:', error);
  }
};

/**
 * Get network response with timeout
 */
const fetchWithTimeout = (request, timeout = 8000) => {
  return Promise.race([
    fetch(request),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Fetch timeout')), timeout)
    )
  ]);
};

// ============================================================================
// INSTALLATION EVENT
// ============================================================================

/**
 * Install: Cache core assets with best-effort approach
 * Failures don't block installation
 */
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker');
  
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE_NAME);
      
      // Try to cache all core assets, but don't fail if some are missing
      const cachePromises = CORE_ASSETS.map(async (url) => {
        try {
          await cache.add(url);
        } catch (error) {
          console.warn(`Failed to cache ${url}:`, error);
        }
      });
      
      await Promise.all(cachePromises);
      console.log('[SW] Core assets cached');
    } catch (error) {
      console.error('[SW] Installation error:', error);
    }
  })());
  
  // Force activation on install
  self.skipWaiting();
});

// ============================================================================
// ACTIVATION EVENT
// ============================================================================

/**
 * Activate: Clean up old cache versions and claim clients
 */
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker');
  
  event.waitUntil((async () => {
    try {
      // Clean up old cache versions
      const keys = await caches.keys();
      const deletePromises = keys
        .filter(key => key !== CACHE_NAME && key.startsWith('flowdeck-'))
        .map(key => {
          console.log('[SW] Deleting old cache:', key);
          return caches.delete(key);
        });
      
      await Promise.all(deletePromises);
      
      // Claim all clients immediately
      await self.clients.claim();
      console.log('[SW] Activation complete');
    } catch (error) {
      console.error('[SW] Activation error:', error);
    }
  })());
});

// ============================================================================
// FETCH EVENT
// ============================================================================

/**
 * Fetch strategy:
 * - Navigation (HTML): network-first (always try fresh HTML first)
 * - Assets (JS, CSS, images): stale-while-revalidate (fast + silent updates)
 * - API calls: network-only with fallback to cache
 */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  
  // Ignore non-GET requests
  if (request.method !== 'GET') return;
  
  // ========================================================================
  // NAVIGATION REQUESTS (HTML pages)
  // ========================================================================
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          // Try to fetch from network first
          const networkResponse = await fetchWithTimeout(request, 10000);
          
          // Cache the fresh response
          await cacheSameOrigin(request, networkResponse);
          
          return networkResponse;
        } catch (error) {
          console.warn('[SW] Navigation fetch failed, using cache:', error);
          
          // Fallback to cached index.html or root
          try {
            return (
              (await caches.match('./index.html')) ||
              (await caches.match('./')) ||
              new Response('Offline - Application unavailable', { status: 503 })
            );
          } catch (cacheError) {
            console.error('[SW] Cache lookup failed:', cacheError);
            return new Response('Offline - Application unavailable', { status: 503 });
          }
        }
      })()
    );
    return;
  }

  // ========================================================================
  // ASSET REQUESTS (JS, CSS, images, fonts)
  // ========================================================================
  // Stale-while-revalidate: serve from cache immediately, then update in background
  const cachedPromise = caches.match(request);
  const fetchPromise = fetchWithTimeout(request, 8000)
    .then(async (response) => {
      await cacheSameOrigin(request, response);
      return response;
    })
    .catch((error) => {
      console.warn('[SW] Asset fetch failed:', error);
      return null;
    });

  // Emit fetch to cache asynchronously (don't wait for it)
  event.waitUntil(
    fetchPromise.catch(() => {
      /* Silently ignore fetch errors */
    })
  );

  // Respond with cache first (fast), then network (fresh)
  event.respondWith(
    (async () => {
      try {
        const cached = await cachedPromise;
        if (cached) {
          return cached;
        }
        
        const fresh = await fetchPromise;
        if (fresh) {
          return fresh;
        }
        
        // Fallback for different asset types
        if (request.destination === 'image') {
          return new Response(
            '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect fill="#f0f0f0" width="1" height="1"/></svg>',
            { headers: { 'Content-Type': 'image/svg+xml' } }
          );
        }
        
        return new Response('Resource not available offline', { status: 404 });
      } catch (error) {
        console.error('[SW] Response error:', error);
        return new Response('Internal Server Error', { status: 500 });
      }
    })()
  );
});

// ============================================================================
// MESSAGE EVENT (Communication from clients)
// ============================================================================

/**
 * Handle messages from the app
 */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    caches.delete(CACHE_NAME).then(() => {
      console.log('[SW] Cache cleared');
    });
  }
});

// ============================================================================
// PERIODIC BACKGROUND SYNC (iOS support via event)
// ============================================================================

/**
 * Handle periodic background sync if supported
 */
if ('periodicSync' in self.registration) {
  self.addEventListener('periodicsync', (event) => {
    if (event.tag === 'flowdeck-sync') {
      event.waitUntil(
        (async () => {
          try {
            console.log('[SW] Background sync triggered');
            // Perform any background updates here
          } catch (error) {
            console.error('[SW] Background sync error:', error);
          }
        })()
      );
    }
  });
}

console.log('[SW] Service worker loaded');
