const CACHE_NAME = 'glassshare-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/src/main.js',
  '/src/style.css',
  '/src/visualizer.js',
  '/src/wakelock.js',
  '/src/qr.js',
  '/src/webrtc.js',
  '/manifest.json'
];

// Install Event
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Activate Event
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

// Fetch Event
self.addEventListener('fetch', (e) => {
  // Avoid caching WebRTC/WebSocket signaling requests
  if (e.request.url.startsWith('ws') || e.request.url.startsWith('http') === false) {
    return;
  }
  
  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(e.request).then((networkResponse) => {
        // Cache new assets dynamically
        if (networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(e.request, responseClone);
          });
        }
        return networkResponse;
      });
    }).catch(() => {
      // Fallback for offline usage
      return caches.match('/');
    })
  );
});
