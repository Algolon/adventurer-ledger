/**
 * The preview server the Playwright suites run against.
 *
 * Configuration is read from the environment here; the serving itself lives in
 * `static-server.mjs`, which the local review command shares so a human review
 * and an automated journey exercise the same server.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStaticServer, normaliseBasePath } from "./static-server.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  root = path.resolve(projectRoot, process.env.PREVIEW_ROOT || "out"),
  nextRoot = process.env.PREVIEW_NEXT_ROOT
    ? path.resolve(projectRoot, process.env.PREVIEW_NEXT_ROOT)
    : undefined,
  port = Number(process.env.PORT || 4173),
  basePath = normaliseBasePath(process.env.NEXT_PUBLIC_BASE_PATH ?? "");

createStaticServer({ root, basePath, ...(nextRoot ? { nextRoot } : {}) }).listen(port, "127.0.0.1", () =>
  process.stdout.write(`Static preview on http://127.0.0.1:${port}${basePath}/\n`),
);
