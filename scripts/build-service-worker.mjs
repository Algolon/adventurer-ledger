import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  output = path.join(root, "out"),
  template = path.join(root, "public", "sw.js"),
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
      `/${path.relative(output, file).split(path.sep).map(encodeURIComponent).join("/")}`,
  );
if (assets.includes("/index.html") && !assets.includes("/"))
  assets.unshift("/");
const hash = createHash("sha256");
for (const file of selected) {
  hash.update(path.relative(output, file));
  hash.update(await fs.readFile(file));
}
const version = hash.digest("hex").slice(0, 16),
  source = (await fs.readFile(template, "utf8"))
    .replace("__CACHE_VERSION__", version)
    .replace('/*__PRECACHE_ASSETS__*/["/"]', JSON.stringify(assets));
await fs.writeFile(path.join(output, "sw.js"), source);
process.stdout.write(`Service worker ${version}: ${assets.length} assets\n`);
