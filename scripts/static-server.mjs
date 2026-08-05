/**
 * The static file server both the Playwright preview and the local review
 * command run on.
 *
 * It exists as a module rather than a second copy of the same forty lines so
 * that the thing a reviewer looks at in their own browser is served exactly the
 * way the automated journeys are served: same base-path handling, same SPA
 * fallback, same headers on the service worker. A review that passes against a
 * subtly different server proves less than it appears to.
 *
 * Node's standard library only. No dependency, no framework, no production
 * server — this serves a local export to localhost and nothing else.
 */
import http from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";

const TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".woff2": "font/woff2",
};

/** Trailing slashes and a bare "/" both mean "no base path". */
export const normaliseBasePath = (value = "") =>
  value === "/" ? "" : value.replace(/\/+$/, "");

/**
 * A server for one static export.
 *
 * `nextRoot` exists for the controlled-update fixtures, which need to swap the
 * served build underneath a running page. It is inert unless supplied.
 */
export function createStaticServer({ root, basePath = "", nextRoot } = {}) {
  const base = normaliseBasePath(basePath);
  let active = root;

  return http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);

    if (nextRoot && request.method === "POST" && pathname === "/__test__/activate-next") {
      active = nextRoot;
      response.writeHead(204);
      response.end();
      return;
    }
    if (base && pathname === base) {
      response.writeHead(308, { Location: `${base}/` });
      response.end();
      return;
    }
    if (base && !pathname.startsWith(`${base}/`)) {
      response.writeHead(404);
      response.end();
      return;
    }

    const scopedPathname = pathname.slice(base.length) || "/",
      relative = scopedPathname.replace(/^\/+/, "");
    let file = path.resolve(active, relative || "index.html");
    // Nothing outside the served root, whatever the request path claims.
    if (!file.startsWith(`${active}${path.sep}`) && file !== path.join(active, "index.html")) {
      response.writeHead(400);
      response.end();
      return;
    }
    if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, "index.html");
    // The app routes on the client, so an unknown HTML path is its entry point.
    if (!existsSync(file) && request.headers.accept?.includes("text/html"))
      file = path.join(active, "index.html");
    if (!existsSync(file)) {
      response.writeHead(404);
      response.end();
      return;
    }

    const headers = {
      "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream",
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
  });
}
