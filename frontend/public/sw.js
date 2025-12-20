// public/sw.js

const CACHE_NAME = "qr-inventory-cache-v1";

// On install: nothing fancy yet; we do "runtime" caching in fetch handler.
self.addEventListener("install", (event) => {
  // Skip waiting so updated SW activates earlier (optional).
  self.skipWaiting();
});

// On activate: clean up old caches if you ever bump CACHE_NAME.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch handler: cache-first for same-origin GET requests.
self.addEventListener("fetch", (event) => {
  // Only GET
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  // Only handle same-origin (your frontend assets). Do NOT touch the Flask API.
  if (url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(event.request);
      if (cached) {
        // Return cached version if available
        return cached;
      }

      // Otherwise, try network, then cache it
      try {
        const response = await fetch(event.request);
        cache.put(event.request, response.clone());
        return response;
      } catch (err) {
        // If network fails and we have nothing cached, just throw.
        // (Optional: here you could return a fallback offline page.)
        return new Response("Offline and not in cache", {
          status: 503,
          statusText: "Service Unavailable",
        });
      }
    })
  );
});
