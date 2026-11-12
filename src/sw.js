// Lannorama service worker (mobile/PWA only).
//
// This is the mobile "updater". There is no electron-updater on iOS/Android - an installed
// app cannot replace itself - so the update path here is: cache the app shell, notice when a
// newer shell is available, and tell the page to reload. Data responses are NEVER cached,
// because the cloud database is dynamic and a stale copy would show wrong stock counts.
//
// Bump VERSION when the shell changes so clients get a fresh copy.

const VERSION = 'v1.0.23';
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

// --- DUE / OVERDUE NOTIFICATIONS ---
// A service worker is the only thing that can run while a PWA is closed, and Periodic Background
// Sync is the only way to trigger it. Two honest limits:
//   - the browser decides when it runs (minimum interval about 12 hours), so this is not a
//     guaranteed 7am, and it only happens for an installed PWA on Chrome/Android;
//   - the worker cannot read localStorage, so the page mirrors what it needs into IndexedDB
//     (same origin, so the same database is visible here).
// The snapshot is only a starting point. When the network is available the worker re-reads the
// table, because a snapshot taken on an earlier day cannot know what is due today.
const NOTIFY_DB = 'lannorama-notify';

function openStateDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(NOTIFY_DB, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore('state'); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function readState(db, key) {
  return new Promise((resolve) => {
    const req = db.transaction('state', 'readonly').objectStore('state').get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
}

function writeState(db, key, value) {
  return new Promise((resolve) => {
    const tx = db.transaction('state', 'readwrite');
    tx.objectStore('state').put(value, key);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}

function localDateFor(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Same rule as the page: due today is not overdue, it only becomes overdue the day after.
function statusOf(row, today) {
  if (String(row.status || 'active') !== 'active') return null;
  const due = String(row.returnDate || '').slice(0, 10);
  if (!due) return null;
  if (due === today) return 'due_today';
  if (due > today) return null;
  return 'overdue';
}

self.addEventListener('periodicbackgroundsync', (event) => {
  if (event.tag !== 'due-check') return;

  event.waitUntil((async () => {
    const db = await openStateDb();
    const snapshot = await readState(db, 'snapshot');
    if (!snapshot) return;

    const today = localDateFor(0);
    const notified = (await readState(db, 'notified')) || {};
    let rows = [];

    if (snapshot.url) {
      try {
        const res = await fetch(snapshot.url);
        if (res.ok) {
          const cloud = await res.json();
          rows = Array.isArray(cloud.checkouts) ? cloud.checkouts : [];
        }
      } catch (err) {
        // Offline at sync time - fall back to the snapshot the page left behind.
      }
    }

    if (!rows.length) rows = (snapshot.due || []).concat(snapshot.late || []);

    const announce = (kind, title, body, id) => {
      const key = kind + '|' + today + '|' + String(id);
      if (notified[key]) return;
      notified[key] = true;
      self.registration.showNotification(title, { body, tag: key });
    };

    rows.forEach((row) => {
      const st = statusOf(row, today);
      if (!st) return;
      const name = row.studentName || 'Unknown student';
      const item = row.equipmentName || 'item';
      if (st === 'due_today') {
        announce('due', 'Due today: ' + name, item + ' is due today.', row.id);
      } else {
        announce('overdue', 'Overdue: ' + name, item + ' was due ' + (row.returnDate || 'unknown date') + '.', row.id);
      }
    });

    // Only today's and yesterday's keys matter, so the map cannot grow forever.
    const yest = localDateFor(-1);
    Object.keys(notified).forEach((k) => {
      const d = String(k).split('|')[1];
      if (d !== today && d !== yest) delete notified[k];
    });

    await writeState(db, 'notified', notified);
  })());
});
