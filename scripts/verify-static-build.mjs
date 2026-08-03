import { readFile } from "node:fs/promises";
import path from "node:path";

const output = path.resolve("out"),
  basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, ""),
  appRoot = `${basePath}/`,
  [html, manifestText, worker] = await Promise.all([
    readFile(path.join(output, "index.html"), "utf8"),
    readFile(path.join(output, "manifest.webmanifest"), "utf8"),
    readFile(path.join(output, "sw.js"), "utf8"),
  ]),
  manifest = JSON.parse(manifestText),
  publicReferences = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(
    (match) => match[1],
  ),
  precacheText = worker.match(/const PRECACHE=(\[[^;]+\]);/)?.[1],
  precache = precacheText ? JSON.parse(precacheText) : [],
  installAssets = [
    "icons/runefolio-icon-192.png",
    "icons/runefolio-icon-512.png",
    "icons/runefolio-maskable-192.png",
    "icons/runefolio-maskable-512.png",
    "icons/runefolio-apple-touch-icon.png",
    "icons/runefolio-favicon-16.png",
    "icons/runefolio-favicon-32.png",
    "runefolio-favicon.ico",
  ];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
assert(manifest.id === appRoot, "Manifest id is outside the app scope");
assert(manifest.start_url === appRoot, "Manifest start_url is outside the app scope");
assert(manifest.scope === appRoot, "Manifest scope is outside the app scope");
assert(manifest.name === "Runefolio", "Manifest product name mismatch");
assert(manifest.short_name === "Runefolio", "Manifest short name mismatch");
assert(
  html.includes(`rel="manifest" href="${appRoot}manifest.webmanifest?v=runefolio-1"`),
  "Generated HTML does not use the versioned Runefolio manifest reference",
);
assert(
  manifest.icons.filter((icon) => icon.purpose === "any").length === 2,
  "Manifest must contain 192 px and 512 px any icons",
);
assert(
  manifest.icons.filter((icon) => icon.purpose === "maskable").length === 2,
  "Manifest must contain 192 px and 512 px maskable icons",
);
assert(
  manifest.icons.every((icon) => icon.src.startsWith(`${basePath}/icons/`)),
  "A manifest icon is outside the app scope",
);
assert(
  manifest.icons.every((icon) => /\/runefolio-(?:icon|maskable)-/.test(icon.src)),
  "Manifest references a non-Runefolio installation icon",
);
assert(
  !html.match(/\/(?:icons\/(?:icon-|maskable-|apple-touch-icon|favicon-(?:16|32))|favicon\.ico)/),
  "Generated HTML references a legacy generic installation asset",
);
for (const asset of installAssets) {
  await readFile(path.join(output, asset));
  assert(precache.includes(`${basePath}/${asset}`), `${asset} is missing from the precache`);
}
assert(
  publicReferences
    .filter((reference) => reference.startsWith("/"))
    .every((reference) => reference.startsWith(appRoot)),
  "Generated HTML contains a public root-path reference",
);
assert(precache.length > 0, "The service-worker precache is empty");
assert(
  precache.every((asset) => asset.startsWith(appRoot)),
  "The service-worker precache contains an asset outside the app scope",
);
assert(worker.includes(`const APP_ROOT="${appRoot}"`), "Worker app root mismatch");
assert(
  worker.includes(`const WORKER_PATH="${basePath}/sw.js"`),
  "Worker URL mismatch",
);
assert(!worker.includes("__CACHE_"), "Worker still contains build placeholders");
assert(!html.includes("DO-NOT-SHOW"), "Private test marker found in output");
process.stdout.write(
  `Verified ${basePath || "root"} static build: ${precache.length} cached assets\n`,
);
