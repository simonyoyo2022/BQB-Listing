/* ============================================================
   BQB Listing Dashboard — Service Worker v3
   Network-first for all app files to ensure updates propagate
   ============================================================ */

const CACHE_NAME = 'bqb-listing-v6';
const STATIC_ASSETS = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './manifest.json',
    './data/listings.json',
    './data/customers.json'
];

// Install: cache static assets, force immediate activation
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
    );
    self.skipWaiting();
});

// Activate: delete ALL old caches, take control immediately
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

// Fetch: network-first for all same-origin requests
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // API calls — network only
    if (url.hostname.includes('qualificationapi.bluetooth.com')) {
        event.respondWith(fetch(event.request));
        return;
    }

    // Same-origin (app files) — NETWORK FIRST, fall back to cache
    if (url.hostname === location.hostname) {
        event.respondWith(
            fetch(event.request).then(response => {
                const clone = response.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                return response;
            }).catch(() => caches.match(event.request))
        );
        return;
    }

    // External CDN — stale-while-revalidate
    event.respondWith(
        caches.open(CACHE_NAME).then(cache =>
            cache.match(event.request).then(cached => {
                const fetched = fetch(event.request).then(resp => {
                    cache.put(event.request, resp.clone());
                    return resp;
                }).catch(() => cached);
                return cached || fetched;
            })
        )
    );
});
