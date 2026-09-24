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
  const scopePath = new URL(self.registration.scope).pathname;
  // Never intercept writes, other origins, or files outside the app folder.
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    !url.pathname.startsWith(scopePath)
  )
    return;
  const relativePath = url.pathname.slice(scopePath.length) || "index.html";
  const asset =
    "./" + (request.mode === "navigate" ? "index.html" : relativePath);
  if (!ASSETS.includes(asset)) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(asset);
      return cached || fetch(request);
    }),
  );
});
