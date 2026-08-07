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
// The installed app's declared shape and its splash colours. Neither is
// observable in a rendered page: `orientation` governs how the platform
// launches the installed app, and `background_color` paints the splash screen
// before the app's first frame, which is where a light value shows as a flash.
assert(manifest.orientation === "portrait-primary", "Manifest is not portrait-primary");
assert(manifest.background_color === "#08121B", "Manifest splash background is not the dark shell colour");
assert(manifest.theme_color === "#0F1D29", "Manifest theme colour mismatch");
// The first paint, before any stylesheet resolves.
assert(html.includes('style="color-scheme:dark'), "Generated HTML does not declare a dark colour scheme inline");
assert(
  html.includes('name="color-scheme" content="dark"'),
  "Generated HTML does not tell the user agent to use its dark palette",
);
assert(
  html.includes(`rel="manifest" href="${appRoot}manifest.webmanifest?v=runefolio-2"`),
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
