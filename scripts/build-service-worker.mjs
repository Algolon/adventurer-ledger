import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  output = path.join(root, "out"),
  template = path.join(root, "public", "sw.js"),
  configuredBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "",
  basePath = configuredBasePath === "/" ? "" : configuredBasePath.replace(/\/+$/, ""),
  appRoot = `${basePath}/`,
  cacheNamespace = basePath.slice(1).replace(/[^a-z0-9]+/gi, "-") || "root",
  shellCachePrefix = `adventurer-ledger-shell-${cacheNamespace}-`,
  extensions = new Set([
    ".css",
    ".html",
    ".ico",
    ".js",
    ".json",
    ".png",
    ".webmanifest",
    ".woff",
    ".woff2",
  ]);
async function files(directory) {
  const found = [];
  for (const item of await fs.readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, item.name);
    if (item.isDirectory()) found.push(...(await files(target)));
    else found.push(target);
  }
  return found;
}
const selected = (await files(output))
    .filter(
      (file) =>
        extensions.has(path.extname(file)) &&
        !file.endsWith(`${path.sep}sw.js`),
    )
    .sort(),
  assets = selected.map(
    (file) =>
      `${basePath}/${path.relative(output, file).split(path.sep).map(encodeURIComponent).join("/")}`,
  );
if (assets.includes(`${basePath}/index.html`) && !assets.includes(appRoot))
  assets.unshift(appRoot);
const hash = createHash("sha256");
hash.update(basePath);
for (const file of selected) {
  hash.update(path.relative(output, file));
  hash.update(await fs.readFile(file));
}
const version = hash.digest("hex").slice(0, 16),
  source = (await fs.readFile(template, "utf8"))
    .replace("__CACHE_VERSION__", version)
    .replaceAll("__SHELL_CACHE_PREFIX__", shellCachePrefix)
    .replaceAll("__APP_ROOT__", appRoot)
    .replace("__FALLBACK__", `${basePath}/index.html`)
    .replace("__WORKER_PATH__", `${basePath}/sw.js`)
    .replace(/\/\*__PRECACHE_ASSETS__\*\/\[[^\]]*\]/, JSON.stringify(assets));
await fs.writeFile(path.join(output, "sw.js"), source);
await fs.writeFile(path.join(output, ".nojekyll"), "");
process.stdout.write(`Service worker ${version}: ${assets.length} assets\n`);
