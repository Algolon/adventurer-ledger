import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The shipped stylesheets are a single dark theme.
 *
 * The browser tests prove what the app *renders*; these prove what it
 * *contains*, which is the part that decays quietly. The previous architecture
 * did not fail because a surface looked wrong on the day it shipped — it failed
 * because a light default and a partial dark override drifted apart over three
 * increments until half the app had no dark branch at all. A rule that says
 * "there is one theme" has to be checkable in the source, or the second theme
 * comes back one hard-coded hex at a time.
 */

/**
 * Comments are prose, not styling.
 *
 * These files explain at length *why* a light branch, a `--bg` reference and an
 * `overflow-x: clip` were removed, and naming the thing you have deleted is the
 * only way that explanation is any use. Scanning the raw text would make every
 * rule below fire on its own rationale, so the declarations are read with the
 * comments stripped out.
 */
const withoutComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "");

const STYLESHEETS = readdirSync("app")
  .filter(name => name.endsWith(".css"))
  .map(name => ({ name, source: withoutComments(readFileSync(`app/${name}`, "utf8")) }));

/**
 * Colours the theme is allowed to state literally, and only in `theme.css`.
 * Everything else must go through a custom property.
 */
const TOKEN_SOURCE = "theme.css";

describe("one global dark theme", () => {
  it("ships stylesheets at all", () => {
    expect(STYLESHEETS.map(sheet => sheet.name).sort()).toEqual(["globals.css", "m1.css", "m2.css", "sheet.css", "theme.css"]);
  });

  it("declares a dark colour scheme at the document root", () => {
    const theme = STYLESHEETS.find(sheet => sheet.name === TOKEN_SOURCE);
    expect(theme?.source).toMatch(/:root\s*\{[^}]*color-scheme:\s*dark/);
  });

  /**
   * The rule the product decision actually states: the OS preference does not
   * choose Runefolio's theme. A `prefers-color-scheme` branch anywhere is a
   * second theme, whichever direction it points in.
   */
  it("has no operating-system colour-preference branch anywhere", () => {
    const offenders = STYLESHEETS.filter(sheet => sheet.source.includes("prefers-color-scheme")).map(sheet => sheet.name);
    expect(offenders).toEqual([]);
  });

  /**
   * No stylesheet outside `theme.css` may name a colour directly.
   *
   * This is what stops a light value being reintroduced by hand. `currentColor`,
   * the system colour keywords used under `forced-colors`, and the token file
   * itself are the exceptions; `rgb(... / ...)` scrims for modal backdrops are
   * permitted because they are deliberately translucent black rather than a
   * surface colour.
   */
  it("states every surface, text and line colour as a token", () => {
    const literal = /#[0-9a-f]{3,8}\b/gi;
    const offenders: string[] = [];
    for (const sheet of STYLESHEETS) {
      if (sheet.name === TOKEN_SOURCE) continue;
      for (const match of sheet.source.matchAll(literal)) offenders.push(`${sheet.name}: ${match[0]}`);
    }
    expect(offenders, "hard-coded colours belong in theme.css as named tokens").toEqual([]);
  });

  /**
   * The play sheet must not re-declare the palette.
   *
   * It used to carry its own parallel `--sh-*` token set, restated in full
   * inside a dark media query. That was the second theme.
   */
  it("does not keep a second, sheet-scoped token set", () => {
    const sheet = STYLESHEETS.find(entry => entry.name === "sheet.css");
    expect(sheet?.source).not.toMatch(/--sh-[a-z-]+\s*:/);
  });

  /**
   * Every custom property a stylesheet reads must be one the theme defines.
   *
   * `.m2-builder-head` used `var(--bg)`, which no file ever declared, so a
   * sticky header that is supposed to be opaque resolved to transparent and the
   * page scrolled visibly through it. An undefined token fails silently in CSS;
   * it does not have to fail silently here.
   */
  it("reads only custom properties the theme declares", () => {
    const theme = STYLESHEETS.find(sheet => sheet.name === TOKEN_SOURCE)?.source ?? "";
    const declared = new Set(Array.from(theme.matchAll(/(--[a-z0-9-]+)\s*:/gi), match => match[1]));
    // Properties a component supplies itself, with the element that sets them.
    const suppliedByComponents = new Set([
      "--sheet-tab-count",
      "--appbar-height",
      "--appbar-content",
      "--rail-height",
      /*
       * The main region's inline padding, declared on `.m2-shell`. It is a
       * layout measurement rather than a theme colour, and it is named because
       * the full-bleed sheet-section strip has to cancel exactly it: the two
       * were separate literals until tightening one left the other bleeding
       * past the viewport edge.
       */
      "--main-pad-x",
    ]);
    const missing = new Set<string>();
    for (const sheet of STYLESHEETS) {
      for (const match of sheet.source.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) {
        const name = match[1];
        if (declared.has(name) || suppliedByComponents.has(name)) continue;
        missing.add(`${sheet.name}: ${name}`);
      }
    }
    expect(Array.from(missing), "every var() must resolve to a declared token").toEqual([]);
  });

  /**
   * The tab strip is a grid, not a scroller.
   *
   * This is the one layout rule in the contract that a screenshot cannot
   * distinguish: a flex row that happens to fit looks identical to a grid that
   * is guaranteed to.
   */
  it("lays the sheet sections out as a fixed grid", () => {
    const sheet = STYLESHEETS.find(entry => entry.name === "sheet.css")?.source ?? "";
    const strip = sheet.slice(sheet.indexOf(".sheet-tabs {"), sheet.indexOf(".sheet-tab {"));
    expect(strip).toContain("display: grid");
    expect(strip).toContain("repeat(var(--sheet-tab-count");
    expect(strip, "the strip must not be able to scroll sideways").not.toContain("overflow-x");
  });

  /**
   * Overflow is fixed, not hidden.
   *
   * `overflow-x: clip` on the shell, the main region or the page would make
   * every document-width assertion in the browser suite unable to fail.
   */
  it("does not clip horizontal overflow on the shell, main region or page", () => {
    const m2 = STYLESHEETS.find(entry => entry.name === "m2.css")?.source ?? "";
    const guard = m2.slice(0, m2.indexOf(".m2-appbar {"));
    expect(guard).not.toContain("overflow-x: clip");
  });
});

describe("legacy stylesheets stay reachable", () => {
  /**
   * Every selector that survived the light-theme removal is still referenced.
   *
   * The M1 application shell was deleted rather than converted because nothing
   * rendered it; converting a thousand lines of unreachable light CSS to dark
   * would have recreated the second theme. This is the guard that stops the
   * remainder from rotting the same way.
   */
  it("has no unreferenced class in globals.css or m1.css", () => {
    const markup = readdirSync("src/ui")
      .filter(name => name.endsWith(".tsx"))
      .map(name => readFileSync(`src/ui/${name}`, "utf8"))
      .concat(readFileSync("app/page.tsx", "utf8"), readFileSync("app/layout.tsx", "utf8"))
      .join("\n");

    const used = new Set<string>();
    for (const match of markup.matchAll(/className=\{?["`]([^"`]*)["`]/g))
      for (const token of match[1].split(/\s+/)) if (token) used.add(token);

    const unreferenced: string[] = [];
    for (const name of ["globals.css", "m1.css"]) {
      const source = STYLESHEETS.find(sheet => sheet.name === name)?.source ?? "";
      // Selector text only — everything before the `{` of each rule — so a
      // class named inside a declaration value cannot be mistaken for one.
      const selectorText = source.replace(/\{[^}]*\}/g, "{}");
      // Class selectors only: element and pseudo selectors are not this rule's
      // business, and `.m2-*` classes are declared in m2.css.
      for (const match of selectorText.matchAll(/\.([a-z][a-z0-9-]*)/gi)) {
        const selector = match[1];
        if (selector.startsWith("m2-") || selector.startsWith("sheet")) continue;
        if (used.has(selector)) continue;
        unreferenced.push(`${name}: .${selector}`);
      }
    }
    expect(Array.from(new Set(unreferenced)), "delete the rule or use it; do not leave dead theme paths").toEqual([]);
  });
});
