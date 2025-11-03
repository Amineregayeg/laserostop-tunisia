// ===== Service Worker Configuration =====
const CACHE_NAME = 'laserostop-v8';
const STATIC_CACHE_NAME = 'laserostop-static-v8';
const RUNTIME_CACHE_NAME = 'laserostop-runtime-v8';

// Files to cache on install
const STATIC_FILES = [
  '/',
  '/index.html',
  '/dashboard.html',
  '/suivi.html',
  '/styles.css',
  '/app.js',
  '/dashboard.js',
  '/suivi.js',
  '/assets/logo.webp',
  '/pwa/manifest.webmanifest',
  '/pwa/icons/icon-192.png',
  '/pwa/icons/icon-512.png'
];

// API routes that should be cached with stale-while-revalidate
const API_ROUTES = [
  '/week',
  '/stats'
];

// ===== Install Event =====
self.addEventListener('install', event => {
  console.log('Service Worker: Installing...');
  
  event.waitUntil(
    caches.open(STATIC_CACHE_NAME)
      .then(cache => {
        console.log('Service Worker: Caching static files');
        return cache.addAll(STATIC_FILES);
      })
      .then(() => {
        console.log('Service Worker: Installation complete');
        return self.skipWaiting();
      })
      .catch(error => {
        console.error('Service Worker: Installation failed', error);
      })
  );
});

// ===== Activate Event =====
self.addEventListener('activate', event => {
  console.log('Service Worker: Activating...');
  
  event.waitUntil(
    caches.keys()
      .then(cacheNames => {
        return Promise.all(
          cacheNames.map(cacheName => {
            // Delete old caches
            if (cacheName !== STATIC_CACHE_NAME && cacheName !== RUNTIME_CACHE_NAME) {
              console.log('Service Worker: Deleting old cache', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        console.log('Service Worker: Activation complete');
        return self.clients.claim();
      })
      .catch(error => {
        console.error('Service Worker: Activation failed', error);
      })
  );
});

// ===== Fetch Event =====
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Only handle GET requests
  if (request.method !== 'GET') {
    return;
  }
  
  // Handle different types of requests
  if (isStaticFile(url)) {
    event.respondWith(cacheFirst(request));
  } else if (isAPIRequest(url)) {
    event.respondWith(staleWhileRevalidate(request));
  } else if (isHTMLRequest(request)) {
    event.respondWith(networkFirst(request));
  } else {
    event.respondWith(fetch(request));
  }
});

// ===== Caching Strategies =====

// Cache First - for static assets
async function cacheFirst(request) {
  try {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    
    const networkResponse = await fetch(request);
    
    if (networkResponse.ok) {
      const cache = await caches.open(STATIC_CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    console.error('Cache first strategy failed:', error);
    
    // Fallback for offline scenarios
    if (request.destination === 'document') {
      const cachedHTML = await caches.match('/index.html');
      if (cachedHTML) return cachedHTML;
    }
    
    throw error;
  }
}

// Network First - for HTML pages
async function networkFirst(request) {
  try {
    const networkResponse = await fetch(request);
    
    if (networkResponse.ok) {
      const cache = await caches.open(RUNTIME_CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    console.log('Network first falling back to cache:', error);
    
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // Ultimate fallback for navigation requests
    if (request.destination === 'document') {
      const fallbackHTML = await caches.match('/index.html');
      if (fallbackHTML) return fallbackHTML;
    }
    
    throw error;
  }
}

// Stale While Revalidate - for API calls
async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE_NAME);
  const cachedResponse = await cache.match(request);
  
  const networkPromise = fetch(request)
    .then(networkResponse => {
      if (networkResponse.ok) {
        cache.put(request, networkResponse.clone());
      }
      return networkResponse;
    })
    .catch(error => {
      console.log('Network request failed:', error);
      throw error;
    });
  
  // Return cached response immediately if available
  if (cachedResponse) {
    // Update cache in background
    networkPromise.catch(() => {}); // Ignore network errors
    return cachedResponse;
  }
  
  // If no cached response, wait for network
  return networkPromise;
}

// ===== Helper Functions =====
function isStaticFile(url) {
  const staticExtensions = ['.css', '.js', '.png', '.jpg', '.jpeg', '.webp', '.svg', '.woff', '.woff2'];
  const pathname = url.pathname;
  
  return staticExtensions.some(ext => pathname.endsWith(ext)) ||
         pathname.includes('/assets/') ||
         pathname.includes('/pwa/');
}

function isAPIRequest(url) {
  return url.hostname.includes('supabase.co') ||
         API_ROUTES.some(route => url.pathname.includes(route));
}

function isHTMLRequest(request) {
  return request.destination === 'document' ||
         request.headers.get('accept')?.includes('text/html');
}

// ===== Background Sync (optional) =====
self.addEventListener('sync', event => {
  console.log('Background sync event:', event.tag);
  
  if (event.tag === 'booking-sync') {
    event.waitUntil(syncPendingBookings());
  }
});

async function syncPendingBookings() {
  try {
    // This would sync any offline bookings when connection is restored
    // Implementation depends on your offline storage strategy
    console.log('Syncing pending bookings...');
  } catch (error) {
    console.error('Background sync failed:', error);
  }
}

// ===== Push Notifications (optional) =====
self.addEventListener('push', event => {
  if (!event.data) return;
  
  try {
    const data = event.data.json();
    const options = {
      body: data.body || 'Nouvelle notification LaserOstop',
      icon: '/pwa/icons/icon-192.png',
      badge: '/pwa/icons/icon-192.png',
      vibrate: [200, 100, 200],
      data: data.data || {},
      actions: [
        {
          action: 'view',
          title: 'Voir',
          icon: '/pwa/icons/icon-192.png'
        },
        {
          action: 'dismiss',
          title: 'Ignorer'
        }
      ]
    };
    
    event.waitUntil(
      self.registration.showNotification(data.title || 'LaserOstop', options)
    );
  } catch (error) {
    console.error('Push notification error:', error);
  }
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  
  if (event.action === 'view' || !event.action) {
    event.waitUntil(
      clients.openWindow('/')
    );
  }
});

// ===== Message Handling =====
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'CACHE_CLEAR') {
    event.waitUntil(
      caches.keys().then(cacheNames => {
        return Promise.all(
          cacheNames.map(cacheName => caches.delete(cacheName))
        );
      })
    );
  }
});

// ===== Error Handling =====
self.addEventListener('error', event => {
  console.error('Service Worker error:', event.error);
});

self.addEventListener('unhandledrejection', event => {
  console.error('Service Worker unhandled rejection:', event.reason);
});

console.log('Service Worker: Script loaded');