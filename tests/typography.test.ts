import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ADOBE_FONTS_ORIGIN, ADOBE_FONTS_STYLESHEET, ADOBE_FONT_FAMILIES } from "@/src/config/fonts";

/**
 * What the repository contains, rather than what the browser renders.
 *
 * The browser tests prove that Runefolio survives the webfont being blocked.
 * These prove the other half of the licence and the architecture: Adobe hosts
 * the fonts, and this project never starts quietly hosting them itself. A
 * committed `.woff2` and a self-hosted `@font-face` are both single commits
 * away at any time, and neither would fail a rendering test — the app would
 * look right, and be wrong.
 */

const withoutComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "");

const STYLESHEETS = readdirSync("app")
  .filter(name => name.endsWith(".css"))
  .map(name => ({ name, source: withoutComments(readFileSync(`app/${name}`, "utf8")) }));

const TRACKED = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
  encoding: "utf8",
}).split("\0").filter(Boolean);

describe("the fonts are Adobe's, and stay Adobe's", () => {
  it("commits no font binary of any kind", () => {
    const fonts = TRACKED.filter(path => /\.(?:woff2?|otf|ttf|eot)$/i.test(path));
    expect(fonts, "font files belong on Adobe's servers, not in this repository").toEqual([]);
  });

  it("declares no @font-face in its own stylesheets", () => {
    const offenders = STYLESHEETS.filter(sheet => sheet.source.includes("@font-face")).map(sheet => sheet.name);
    expect(offenders, "a local @font-face means this project has started serving fonts").toEqual([]);
  });

  /**
   * The service worker precaches the build's own output. If a font URL ever
   * appeared in that list it would mean Runefolio was keeping a copy of
   * Adobe's files on the user's device, which is redistribution by another
   * name.
   */
  it("never precaches anything from the font host", () => {
    const builder = readFileSync("scripts/build-service-worker.mjs", "utf8");
    expect(builder).not.toContain(ADOBE_FONTS_ORIGIN);
    expect(builder).not.toContain("typekit");
  });

  it("links the web project exactly once, from the document head", () => {
    const layout = readFileSync("app/layout.tsx", "utf8");
    expect(layout).toContain("ADOBE_FONTS_STYLESHEET");
    expect(ADOBE_FONTS_STYLESHEET).toBe("https://use.typekit.net/xlu6nmm.css");
    /*
     * One literal, in one module, so the tests and the document cannot
     * disagree about which web project this is. The module that declares it and
     * this file — which pins its value one line above — are the two places
     * allowed to name it; everything else reaches it through the export.
     */
    const allowed = new Set(["src/config/fonts.ts", "tests/typography.test.ts"]);
    const literals = TRACKED.filter(path => /^(?:app|src|tests)\//.test(path) && /\.tsx?$/.test(path)).filter(
      path => !allowed.has(path) && readFileSync(path, "utf8").includes("use.typekit.net"),
    );
    expect(literals, "the stylesheet URL is stated once, in src/config/fonts.ts").toEqual([]);
  });
});

describe("type is used as hierarchy", () => {
  const theme = STYLESHEETS.find(sheet => sheet.name === "theme.css")?.source ?? "";
  const others = STYLESHEETS.filter(sheet => sheet.name !== "theme.css");

  it("names every Adobe family in exactly one place, ahead of a local stack", () => {
    for (const family of ADOBE_FONT_FAMILIES) {
      expect(theme, `${family} must be declared in theme.css`).toContain(family);
      for (const sheet of others)
        expect(sheet.source, `${sheet.name} must reach ${family} through a token, not by name`).not.toContain(family);
    }
  });

  /**
   * Bookmania Bold is the wordmark's, and the wordmark is one rule.
   *
   * `--wordmark` and `--title` resolve to the same family on purpose — they are
   * the same typeface at two weights — so the restraint has to be checked as
   * "how many rules use the wordmark token", which is what this does.
   */
  it("reserves the wordmark token for a single rule", () => {
    const users = others.flatMap(sheet =>
      Array.from(sheet.source.matchAll(/var\(--wordmark\)/g), () => sheet.name),
    );
    expect(users.length, "the wordmark face is used in exactly one place").toBe(1);
  });

  /**
   * The condensed accent stays out of utility text.
   *
   * Modesto Light Condensed is a display face; below about 14 px its light
   * weight stops being comfortable on a dark surface, which is the one way this
   * addition could make the app harder to read rather than easier.
   */
  it("never sets the condensed accent below 14px", () => {
    const offenders: string[] = [];
    for (const sheet of others)
      for (const match of sheet.source.matchAll(/font:\s*[^;]*?(\d+)px[^;]*?var\(--accent\)/g))
        if (Number.parseInt(match[1], 10) < 14) offenders.push(`${sheet.name}: ${match[0].trim()}`);
    expect(offenders, "the display accent must not be used as small utility type").toEqual([]);
  });
});
