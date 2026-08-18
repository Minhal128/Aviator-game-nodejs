/**
 * Ludo Royale service worker — minimal app-shell caching (UX sprint §1).
 * Strategy, deliberately simple:
 *  - /api/*     → untouched (network only; live meta-game data never caches)
 *  - navigations → network-first, falling back to the cached shell offline
 *  - /assets/art/* → network-first; these are STABLE names that change
 *               across deploys (manifest.json + shipped PNGs), so
 *               cache-first would pin returning players to stale art
 *  - other same-origin static assets (Vite-hashed build files, icons)
 *               → cache-first; hashed names make stale entries impossible
 * Bump CACHE on strategy changes; activate() sweeps every older cache.
 */
'use strict';

const CACHE = 'lr-shell-v2';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/api/')) return; // live data: network only

  // App entry: network-first so deploys land immediately; cached shell offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(CACHE).then((cache) => cache.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./index.html')),
    );
    return;
  }

  // Shipped art (stable names, mutated by deploys): network-first with the
  // cached copy as the offline fallback.
  if (url.pathname.includes('/assets/art/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request).then((hit) => hit ?? Response.error())),
    );
    return;
  }

  // Static assets: cache-first + populate on first fetch.
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ??
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
