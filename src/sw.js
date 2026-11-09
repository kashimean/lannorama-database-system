// Lannorama service worker (mobile/PWA only).
//
// This is the mobile "updater". There is no electron-updater on iOS/Android - an installed
// app cannot replace itself - so the update path here is: cache the app shell, notice when a
// newer shell is available, and tell the page to reload. Data responses are NEVER cached,
// because the cloud database is dynamic and a stale copy would show wrong stock counts.
//
// Bump VERSION when the shell changes so clients get a fresh copy.

const VERSION = 'v1.0.22';
const CACHE = 'lannorama-shell-' + VERSION;

const SHELL = [
  './',
  './index.html',
  './style.css',
  './renderer.js',
  './auth.js',
  './manifest.webmanifest',
  './assets/icon.png',
  './assets/pwa-192.png',
  './assets/pwa-512.png',
  './assets/apple-touch-icon.png'
];

function isBackend(url) {
  return url.hostname.includes('script.google.com') || url.hostname.includes('googleusercontent.com');
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Dynamic backend + non-GET requests go straight to the network.
  if (isBackend(url) || event.request.method !== 'GET') {
    event.respondWith(fetch(event.request));
    return;
  }

  // App shell: network when online (so an update is picked up), cache as the offline fallback.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && url.origin === self.location.origin) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((hit) => {
        if (hit) return hit;
        // Offline and the page itself is not cached yet.
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html').then((page) => page || new Response('Offline', { status: 503 }));
        }
        return new Response('Offline', { status: 503 });
      }))
  );
});

// Tell open pages that a newer shell was installed.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CHECK_UPDATE') {
    self.clients.matchAll().then((clients) => {
      clients.forEach((client) => client.postMessage({ type: 'UPDATE_AVAILABLE', version: VERSION }));
    });
  }
});
