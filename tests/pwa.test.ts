import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";
describe("PWA foundation", () => {
  it("provides installable standalone manifest metadata", () => {
    const value = manifest();
    expect(value).toMatchObject({
      start_url: "/",
      scope: "/",
      display: "standalone",
      theme_color: "#111a22",
      background_color: "#f2e7ce",
    });
    expect(value.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sizes: "192x192" }),
        expect.objectContaining({ sizes: "512x512" }),
        expect.objectContaining({ purpose: "maskable" }),
      ]),
    );
  });
  it("uses controlled updates and versioned cache cleanup", () => {
    const worker = readFileSync("public/sw.js", "utf8"),
      install = worker.slice(
        worker.indexOf('addEventListener("install"'),
        worker.indexOf('addEventListener("activate"'),
      );
    expect(install).not.toContain("skipWaiting");
    expect(worker).toContain('event.data?.type==="SKIP_WAITING"');
    expect(worker).toContain('key.startsWith("adventurer-ledger-shell-")');
    expect(worker).toMatch(/key\s*===\s*"ledger-v1"/);
    expect(worker).toContain("caches.delete(key)");
    expect(worker).toContain("/*__PRECACHE_ASSETS__*/");
  });
  it("registers only in production", () => {
    const registration = readFileSync("src/ui/pwa-status.tsx", "utf8");
    expect(registration).toMatch(/process\.env\.NODE_ENV\s*!==\s*"production"/);
    expect(registration).toMatch(/updateViaCache:\s*"none"/);
  });
});
