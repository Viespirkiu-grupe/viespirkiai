const CACHE_NAME = "network-first-cache-v1";
const CACHE_URLS = [
	"/", // Išsaugojame tik pagrindinį puslapį
];

// Įdiegiame ir išsaugome pagrindinius failus į talpyklą
self.addEventListener("install", (event) => {
	event.waitUntil(
		caches.open(CACHE_NAME).then((cache) => cache.addAll(CACHE_URLS))
	);
});

// Tinklas pirmiausia, jei nepavyksta, grąžiname iš talpyklos
self.addEventListener("fetch", (event) => {
	event.respondWith(
		fetch(event.request)
			.then((networkResponse) => {
        // Išsaugome atsakymą į talpyklą
				const resClone = networkResponse.clone();
				caches.open(CACHE_NAME).then((cache) => {
					cache.put(event.request, resClone);
				});
				return networkResponse;
			})
			.catch(() => {
        // Jei tinklo užklausa nepavyko, grąžiname iš talpyklos
				return caches.match(event.request).then((cachedResponse) => {
					if (cachedResponse) {
						return cachedResponse;
					}
					// Jei nėra talpyklos, grąžiname klaidos atsakymą
					return new Response("Offline and no cached version available.", {
						status: 503,
						statusText: "Nepasiekiama",
						headers: { "Content-Type": "text/plain" },
					});
				});
			})
	);
});
