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
    ["icon-192.png", 192],
    ["icon-512.png", 512],
    ["maskable-192.png", 192],
    ["maskable-512.png", 512],
    ["apple-touch-icon.png", 180],
    ["favicon-16.png", 16],
    ["favicon-32.png", 32],
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
