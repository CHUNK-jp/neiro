// service-worker.js — offline cache for the Neiro app shell.
// Cache-first for same-scope static assets; navigations fall back to the
// cached shell when the network is unavailable.

const CACHE_NAME = 'neiro-app-v5';

const ASSETS = [
  './',
  './index.html',
  './mix.html',
  './manifest.json',
  './css/style.css',
  './css/mix.css',
  './js/app.js',
  './js/mix-app.js',
  './js/mix-engine.js',
  './js/recorder.js',
  './js/audio-mixer.js',
  './js/audio-analysis.js',
  './js/audio-effects.js',
  './js/feed.js',
  './js/storage.js',
  './js/i18n.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './icons/icon-180.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => {
          if (request.mode === 'navigate') return caches.match('./index.html');
          return Response.error();
        });
    })
  );
});
