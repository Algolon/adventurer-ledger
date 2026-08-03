import http from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "out",
  ),
  port = Number(process.env.PORT || 4173),
  types = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".woff2": "font/woff2",
  };
http
  .createServer((request, response) => {
    const pathname = decodeURIComponent(
        new URL(request.url ?? "/", "http://localhost").pathname,
      ),
      relative = pathname.replace(/^\/+/, "");
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
    if (pathname === "/sw.js")
      Object.assign(headers, {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Content-Security-Policy": "default-src 'self'; script-src 'self'",
        "Service-Worker-Allowed": "/",
      });
    response.writeHead(200, headers);
    createReadStream(file).pipe(response);
  })
  .listen(port, "127.0.0.1", () =>
    process.stdout.write(`Static preview on http://127.0.0.1:${port}\n`),
  );
