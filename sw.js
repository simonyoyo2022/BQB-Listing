/* ============================================================
   BQB Listing Dashboard — Service Worker for PWA
   ============================================================ */

const CACHE_NAME = 'bqb-listing-v2';
const STATIC_ASSETS = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './manifest.json',
    './data/listings.json'
];

// Install: cache static assets
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
    );
    self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

// Fetch: network-first for API, cache-first for static
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // API calls — always network, never cache
    if (url.hostname.includes('qualificationapi.bluetooth.com')) {
        event.respondWith(fetch(event.request));
        return;
    }

    // External CDN (Chart.js, Google Fonts) — stale-while-revalidate
    if (url.hostname !== location.hostname) {
        event.respondWith(
            caches.open(CACHE_NAME).then(cache =>
                cache.match(event.request).then(cached => {
                    const fetched = fetch(event.request).then(response => {
                        cache.put(event.request, response.clone());
                        return response;
                    }).catch(() => cached);
                    return cached || fetched;
                })
            )
        );
        return;
    }

    // Static assets — cache-first
    event.respondWith(
        caches.match(event.request).then(cached => cached || fetch(event.request))
    );
});
