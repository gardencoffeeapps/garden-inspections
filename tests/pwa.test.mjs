import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const manifest = JSON.parse(
  readFileSync(new URL("../public/manifest.webmanifest", import.meta.url)),
);
const template = readFileSync(
  new URL("../scripts/sw-template.js", import.meta.url),
  "utf8",
);

test("PWA manifest supports GitHub Pages installation and required icon sizes", () => {
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, ".");
  assert.equal(manifest.scope, ".");
  assert.equal(manifest.prefer_related_applications, false);
  for (const size of [192, 512]) {
    const icon = manifest.icons.find((i) => i.sizes === `${size}x${size}`);
    assert(icon);
    assert(!icon.src.startsWith("/"));
    const png = readFileSync(new URL("../public/" + icon.src, import.meta.url));
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
  }
});

function worker() {
  const handlers = {};
  const operations = [];
  const cached = { body: "cached application shell" };
  const cache = {
    addAll: async (assets) => operations.push(["addAll", assets]),
    match: async (url) => {
      operations.push(["match", url]);
      return cached;
    },
  };
  runInNewContext(
    template
      .replace("__CACHE_NAME__", JSON.stringify("garden-shell-current"))
      .replace("__ASSETS__", JSON.stringify(["./index.html", "./bundle.js"])),
    {
      self: {
        location: { origin: "https://garden.test" },
        registration: { scope: "https://garden.test/garden-inspections/" },
        addEventListener: (name, handler) => (handlers[name] = handler),
      },
      URL,
      caches: {
        open: async (name) => {
          operations.push(["open", name]);
          return cache;
        },
        keys: async () => [
          "garden-shell-old",
          "garden-shell-current",
          "another-app",
        ],
        delete: async (key) => operations.push(["delete", key]),
      },
      fetch: () => {
        throw new Error("No network");
      },
    },
  );
  return { handlers, operations, cached };
}

test("Service worker only intercepts cached shell files inside the GitHub Pages scope", () => {
  const { handlers } = worker();
  for (const request of [
    { url: "https://garden.test/garden-inspections/api/login", method: "POST" },
    { url: "https://garden.test/garden-inspections/api/inspections", method: "GET" },
    {
      url: "https://garden.test/garden-inspections/api/photos/example?format=data",
      method: "GET",
    },
    { url: "https://garden.test/garden-inspections/api", method: "GET" },
    { url: "https://other.test/bundle.js", method: "GET" },
    { url: "https://garden.test/garden-inspections/unknown", method: "GET" },
  ]) {
    let intercepted = false;
    handlers.fetch({
      request,
      respondWith: () => {
        intercepted = true;
      },
    });
    assert.equal(intercepted, false, request.url);
  }
});

test("Cached shell can open under a repository subpath and old unrelated caches are preserved", async () => {
  const { handlers, operations, cached } = worker();
  let response;
  handlers.fetch({
    request: {
      url: "https://garden.test/garden-inspections/",
      method: "GET",
      mode: "navigate",
    },
    respondWith: (p) => (response = p),
  });
  assert.equal(await response, cached);
  assert(operations.some((o) => o[0] === "match" && o[1] === "./index.html"));
  let activated;
  handlers.activate({ waitUntil: (p) => (activated = p) });
  await activated;
  assert.deepEqual(
    operations.filter((o) => o[0] === "delete"),
    [["delete", "garden-shell-old"]],
  );
});
