const CACHE = "sifohotel-shell-v5";
const SHELL = ["/manifest.webmanifest", "/icons/sifohotel-icon.svg"];

// Keep the application HTML and hashed JavaScript/CSS network-only.
// Caching index.html or hashed assets independently can pair an old HTML shell
// with a newer deployment and leave installed PWAs showing a white screen.
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key.startsWith("sifobooks-hotel-shell-") || key.startsWith("sifohotel-shell-"))
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/rest/") || url.pathname.startsWith("/auth/") || url.pathname.startsWith("/functions/")) return;

  // Never serve stale app HTML or JS/CSS bundles: those can reference files
  // from another build and produce an all-white page after deployment.
  if (request.mode === "navigate" || /\.(?:js|mjs|css)$/.test(url.pathname) || url.pathname.startsWith("/assets/")) {
    event.respondWith(fetch(request, { cache: "no-store" }));
    return;
  }

  if (SHELL.includes(url.pathname)) {
    event.respondWith(
      fetch(request).then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, copy)).catch(() => {});
        }
        return response;
      }).catch(async () => (await caches.match(request)) || Response.error())
    );
  }
});
