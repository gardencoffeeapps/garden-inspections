const CACHE = __CACHE_NAME__;
const ASSETS = __ASSETS__;
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("garden-shell-") && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      ),
  );
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  // Never intercept API, user data, photos, writes, or other origins.
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname === "/api" ||
    url.pathname.startsWith("/api/")
  )
    return;
  const asset = request.mode === "navigate" ? "/index.html" : url.pathname;
  if (!ASSETS.includes(asset)) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(asset);
      return cached || fetch(request);
    }),
  );
});
