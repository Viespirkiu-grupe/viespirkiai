const CACHE_NAME = "network-first-cache-v1";
const CACHE_URLS = ["/"]; // Only cache the main page

// Install event: cache only the main page
self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(CACHE_URLS)),
    );
});

// Fetch event
self.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url);

    // Serve "/" from cache if offline
    if (event.request.method === "GET" && url.pathname === "/") {
        event.respondWith(fetch(event.request).catch(() => caches.match("/")));
        return;
    }

    // For all other requests, just fetch from network
    event.respondWith(fetch(event.request));
});
