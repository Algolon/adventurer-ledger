import http from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  initialRoot = path.resolve(projectRoot, process.env.PREVIEW_ROOT || "out"),
  nextRoot = process.env.PREVIEW_NEXT_ROOT
    ? path.resolve(projectRoot, process.env.PREVIEW_NEXT_ROOT)
    : undefined,
  port = Number(process.env.PORT || 4173),
  configuredBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "",
  basePath = configuredBasePath === "/" ? "" : configuredBasePath.replace(/\/+$/, ""),
  types = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".woff2": "font/woff2",
  };
let root = initialRoot;
http
  .createServer((request, response) => {
    const pathname = decodeURIComponent(
        new URL(request.url ?? "/", "http://localhost").pathname,
      );
    if (nextRoot && request.method === "POST" && pathname === "/__test__/activate-next") {
      root = nextRoot;
      response.writeHead(204);
      response.end();
      return;
    }
    if (basePath && pathname === basePath) {
      response.writeHead(308, { Location: `${basePath}/` });
      response.end();
      return;
    }
    if (basePath && !pathname.startsWith(`${basePath}/`)) {
      response.writeHead(404);
      response.end();
      return;
    }
    const scopedPathname = pathname.slice(basePath.length) || "/",
      relative = scopedPathname.replace(/^\/+/, "");
    let file = path.resolve(root, relative || "index.html");
    if (
      !file.startsWith(`${root}${path.sep}`) &&
      file !== path.join(root, "index.html")
    ) {
      response.writeHead(400);
      response.end();
      return;
    }
    if (existsSync(file) && statSync(file).isDirectory())
      file = path.join(file, "index.html");
    if (!existsSync(file) && request.headers.accept?.includes("text/html"))
      file = path.join(root, "index.html");
    if (!existsSync(file)) {
      response.writeHead(404);
      response.end();
      return;
    }
    const headers = {
      "Content-Type": types[path.extname(file)] ?? "application/octet-stream",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    };
    if (scopedPathname === "/sw.js")
      Object.assign(headers, {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Content-Security-Policy": "default-src 'self'; script-src 'self'",
      });
    response.writeHead(200, headers);
    createReadStream(file).pipe(response);
  })
  .listen(port, "127.0.0.1", () =>
    process.stdout.write(`Static preview on http://127.0.0.1:${port}${basePath}/\n`),
  );
