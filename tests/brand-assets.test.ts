import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const brandDirectory = "public/brand",
  iconDirectory = "public/icons",
  vectors = [
    "runefolio-mark.svg",
    "runefolio-mark-inverse.svg",
    "runefolio-mark-monochrome.svg",
    "runefolio-favicon.svg",
  ],
  pngDimensions = new Map([
    ["runefolio-icon-192.png", 192],
    ["runefolio-icon-512.png", 512],
    ["runefolio-maskable-192.png", 192],
    ["runefolio-maskable-512.png", 512],
    ["runefolio-apple-touch-icon.png", 180],
    ["runefolio-favicon-16.png", 16],
    ["runefolio-favicon-32.png", 32],
  ]),
  approvedHashes = new Map([
    ["runefolio-icon-192.png", "5a761c39e810241622af19f60e413f00cf7bd2fe80918beca6881efedfd419a9"],
    ["runefolio-icon-512.png", "4b7bd892d2da717300c5040d867e165aee973dc86a0c89ef4a7317a3b0b3a988"],
    ["runefolio-maskable-192.png", "3a23c1fbed0c6bde4256f437afa276bba2387c77f95c046121dd08f0d3d3a188"],
    ["runefolio-maskable-512.png", "5ad32a0491ed0afe80f9818236e81545d10fbec621da5cf8fc24591b8b55fc44"],
    ["runefolio-apple-touch-icon.png", "84426066d846d0e7a0b044318122a47455e3c9895254b3c34c8c1ce54dd3bbce"],
    ["runefolio-favicon-16.png", "7feeb25e045867286e3bd8e896b8209836ab82ce2d236ea58a46b5850eff330a"],
    ["runefolio-favicon-32.png", "4922e3edf84a7f58930ebc062c80f333a2716a92ab5d66d76cb568d7649b4e17"],
  ]);

function pngSize(name: string) {
  const png = readFileSync(`${iconDirectory}/${name}`);
  expect(png.subarray(1, 4).toString()).toBe("PNG");
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

describe("Runefolio brand assets", () => {
  it("keeps every vector path-only and on the canonical viewBox", () => {
    const sources = vectors.map((name) =>
      readFileSync(`${brandDirectory}/${name}`, "utf8"),
    );
    for (const source of sources) {
      expect(source).toContain('viewBox="0 0 256 256"');
      expect(source).not.toMatch(/<(?:image|text|foreignObject|filter)\b/);
      expect(source.match(/<path\b/g)?.length).toBeGreaterThanOrEqual(5);
    }
    expect(sources[2]).toContain("currentColor");
  });

  it("generates every production PNG at its declared square size", () => {
    for (const [name, size] of pngDimensions)
      expect(pngSize(name)).toEqual([size, size]);
  });

  it("keeps renamed installation assets byte-identical to the approved branding", () => {
    for (const [name, hash] of approvedHashes)
      expect(createHash("sha256").update(readFileSync(`${iconDirectory}/${name}`)).digest("hex")).toBe(hash);
    expect(createHash("sha256").update(readFileSync("public/runefolio-favicon.ico")).digest("hex")).toBe(
      "12d0397614ca85014d04d20f6ece8a45743f20b1921aa96786e29a45946ab519",
    );
  });

  it("keeps the verification overview available as vector and raster", () => {
    const overview = readFileSync(
      "docs/brand/runefolio-visual-verification.svg",
      "utf8",
    );
    for (const label of [
      "16 px",
      "24 px",
      "32 px",
      "48 px",
      "64 px",
      "192 px",
      "512 px",
      "circle",
      "squircle",
      "rounded square",
    ])
      expect(overview).toContain(label);
  });
});
