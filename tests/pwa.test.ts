import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  delete process.env.NEXT_PUBLIC_BASE_PATH;
  vi.resetModules();
});
describe("PWA foundation", () => {
  it.each([
    ["", "/"],
    ["/adventurer-ledger", "/adventurer-ledger/"],
  ])("creates scoped manifest metadata for base path %s", async (basePath, root) => {
    process.env.NEXT_PUBLIC_BASE_PATH = basePath;
    vi.resetModules();
    const { default: manifest } = await import("@/app/manifest"),
      value = manifest();
    expect(value).toMatchObject({
      id: root,
      start_url: root,
      scope: root,
      display: "standalone",
      theme_color: "#111a22",
      background_color: "#f2e7ce",
    });
    expect(value.icons?.every((icon) => icon.src.startsWith(root))).toBe(true);
  });
  it("keeps the active cache authoritative until a controlled update", () => {
    const worker = readFileSync("public/sw.js", "utf8"),
      install = worker.slice(
        worker.indexOf('addEventListener("install"'),
        worker.indexOf('addEventListener("activate"'),
      );
    expect(install).not.toContain("skipWaiting");
    expect(worker).toContain('event.data?.type==="SKIP_WAITING"');
    expect(worker).toContain('event.data?.type==="GET_OFFLINE_STATUS"');
    expect(worker).toContain("caches.has(SHELL_CACHE)");
    expect(worker).toContain("caches.open(SHELL_CACHE)");
    expect(worker).toContain(
      'request.mode==="navigate")return await cache.match(APP_ROOT)||await cache.match(FALLBACK)',
    );
    expect(worker).not.toContain("caches.match(request)");
    expect(worker).toContain("key.startsWith(SHELL_PREFIX)");
    expect(worker).toMatch(/key\s*===\s*"ledger-v1"/);
    expect(worker).toContain("caches.delete(key)");
    expect(worker).toContain("/*__PRECACHE_ASSETS__*/");
  });
  it("registers the scoped worker only in production and exposes real states", () => {
    const registration = readFileSync("src/ui/pwa-status.tsx", "utf8");
    expect(registration).toMatch(/process\.env\.NODE_ENV\s*!==\s*"production"/);
    expect(registration).toMatch(/register\(withBasePath\("\/sw\.js"\)/);
    expect(registration).toMatch(/scope:\s*APP_ROOT/);
    expect(registration).toMatch(/updateViaCache:\s*"none"/);
    expect(registration).toContain("new MessageChannel()");
    for (const label of [
      "Preparing offline access…",
      "Offline ready",
      "Update ready",
      "Offline cache unavailable",
    ])
      expect(registration).toContain(label);
  });
});
