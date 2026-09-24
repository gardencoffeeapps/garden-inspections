import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
const index = resolve(dist, "index.html");
let html = readFileSync(index, "utf8").replace(
  '<html lang="en">',
  '<html lang="ru">',
);
html = html.replace(
  "You need to enable JavaScript to run this app.",
  "Для работы Garden включите JavaScript в браузере.",
);
html = html.replaceAll('src="/_expo/', 'src="./_expo/');
const tags = `<link rel="manifest" href="./manifest.webmanifest" />
    <meta name="theme-color" content="#183F35" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-title" content="Garden" />
    <meta name="apple-mobile-web-app-status-bar-style" content="default" />
    <link rel="apple-touch-icon" href="./icons/garden-180.png" />
    <link rel="icon" type="image/png" href="./icons/garden-192.png" />
    <script src="./pwa.js" defer></script>`;
if (!html.includes('rel="manifest"'))
  html = html.replace("</head>", tags + "\n</head>");
writeFileSync(index, html);
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(resolve(dir, e.name)) : [resolve(dir, e.name)],
  );
}
const assets = files(dist).filter(
  (p) => !["sw.js", "metadata.json"].includes(relative(dist, p)),
);
const hash = createHash("sha256");
for (const p of assets.sort()) hash.update(readFileSync(p));
const version = hash.digest("hex").slice(0, 16);
const urls = assets.map((p) => "./" + relative(dist, p).replaceAll("\\", "/"));
const template = readFileSync(resolve(root, "scripts/sw-template.js"), "utf8");
writeFileSync(
  resolve(dist, "sw.js"),
  template
    .replace("__CACHE_NAME__", JSON.stringify("garden-shell-" + version))
    .replace("__ASSETS__", JSON.stringify(urls)),
);
console.log(
  `Garden PWA: ${urls.length} public assets; cache ${version}. API and photos are excluded.`,
);
