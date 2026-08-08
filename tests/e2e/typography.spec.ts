import { expect, test, type Page } from "@playwright/test";
import { ADOBE_FONTS_ORIGIN, ADOBE_FONTS_STYLESHEET } from "@/src/config/fonts";

/**
 * Type is hierarchy, and the webfont is an enhancement.
 *
 * Runefolio now links a licensed Adobe Fonts web project. Adobe hosts the
 * files; this repository ships no font binary and no `@font-face` of its own.
 * That makes the typeface the one part of the interface that can simply fail to
 * arrive — a blocked host, a captive portal, an installed app opened for the
 * first time with no network — so the rule is that it may only ever change how
 * Runefolio *looks*.
 *
 * Both states are therefore checked against the same contract: no sideways
 * scroll at any required phone width, no navigation label trimmed to fit, every
 * control still a 44 px target, and a heading still visibly outranking the
 * options underneath it. The layout is specified against the fallback stack, so
 * if these two runs ever disagree the fallback is what is wrong.
 */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const APP_ROOT = `${BASE_PATH}/`;

/** The phone widths the visual contract holds at, in CSS pixels. */
const REQUIRED_WIDTHS = [320, 360, 375, 390, 412] as const;

const continueStep = (page: Page) => page.getByRole("button", { name: "Continue" }).click();

/** Refuses every request to Adobe's host, exactly as a blocked network would. */
const blockAdobeFonts = (page: Page) => page.route(`${ADOBE_FONTS_ORIGIN}/**`, route => route.abort());

/**
 * How many faces the document actually loaded.
 *
 * `document.fonts.size` counts the `FontFace` entries the linked stylesheet
 * contributed, so it is zero when the web project did not arrive and non-zero
 * when it did. `document.fonts.check()` is deliberately *not* used: it answers
 * "can this text be rendered", which is true for `bookmania` even with nothing
 * loaded, because the fallback can render it — so it reports success in exactly
 * the case these tests exist to distinguish.
 */
const loadedFaceCount = async (page: Page) => {
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate(() => document.fonts.size);
};

/** Class & level: the first creation step with a real list of options on it. */
async function reachClassStep(page: Page) {
  await page.goto(APP_ROOT);
  await page.getByRole("button", { name: "New character" }).last().click();
  await page.getByLabel("Character name", { exact: true }).fill("Type Probe");
  await continueStep(page);
  await expect(page.getByRole("heading", { level: 2 }).first()).toHaveText("Class & level");
}

/**
 * Background, with its selected origin's own decision open underneath it.
 *
 * This is where the generic choice presentation actually appears — a legend
 * naming one decision, over a list of plain option rows. Class & level is the
 * other shape: there the row *is* a class card and its name is the card's
 * title, which is a deliberate exception rather than the rule under test.
 */
async function reachBackgroundChoice(page: Page) {
  await reachClassStep(page);
  await page.getByRole("button", { name: /^Vanguard/ }).click();
  await continueStep(page);
  await page.getByRole("button", { name: /^Riverborn/ }).click();
  await continueStep(page);
  await page.getByRole("button", { name: /^Caravan Warden/ }).click();
  await expect(page.getByRole("button", { name: /^Trade Cant/ })).toBeVisible();
}

/** Every way this app is allowed to fail to fit, measured at once. */
async function layoutFaults(page: Page) {
  return page.evaluate(() => {
    const limit = document.documentElement.clientWidth;
    const describe = (element: Element) =>
      `${element.tagName.toLowerCase()}${
        typeof element.className === "string" && element.className.trim()
          ? `.${element.className.trim().split(/\s+/).join(".")}`
          : ""
      }`;

    const overhanging: string[] = [];
    const undersized: string[] = [];
    for (const element of Array.from(document.body.querySelectorAll("*"))) {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 1 || rect.height <= 1) continue;
      const style = getComputedStyle(element);
      if (style.visibility === "hidden" || style.display === "none") continue;
      // 1 px absorbs sub-pixel rounding, as everywhere else in this suite.
      const overhang = Math.max(rect.right - limit, -rect.left);
      if (overhang > 1) overhanging.push(`${describe(element)} overhangs by ${overhang.toFixed(1)}px`);
      if (element.matches("button, select, input, a[href]") && (rect.height < 44 || rect.width < 44))
        undersized.push(
          `${describe(element)} "${(element.textContent ?? "").trim().slice(0, 30)}" is ${Math.round(
            rect.width,
          )}x${Math.round(rect.height)}`,
        );
    }

    const clippedNavLabels = Array.from(document.querySelectorAll(".m2-nav-button span"))
      .filter(label => label.scrollWidth > label.clientWidth + 1)
      .map(label => (label.textContent ?? "").trim());

    return {
      documentScrollWidth: document.documentElement.scrollWidth,
      documentClientWidth: limit,
      overhanging: overhanging.slice(0, 10),
      undersized: undersized.slice(0, 10),
      clippedNavLabels,
    };
  });
}

async function expectLayoutHolds(page: Page, where: string) {
  const faults = await layoutFaults(page);
  expect(faults.overhanging, `elements wider than the viewport on ${where}`).toEqual([]);
  expect(faults.clippedNavLabels, `navigation labels trimmed to fit on ${where}`).toEqual([]);
  expect(faults.undersized, `controls below the 44 px target on ${where}`).toEqual([]);
  expect(faults.documentScrollWidth, `the document scrolls sideways on ${where}`).toBeLessThanOrEqual(
    faults.documentClientWidth,
  );
}

/** The type sizes the hierarchy is expressed in, read off the painted page. */
const typeScale = (page: Page) =>
  page.evaluate(() => {
    const read = (selector: string) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const style = getComputedStyle(node);
      return {
        size: Number.parseFloat(style.fontSize),
        weight: Number.parseInt(style.fontWeight, 10),
        family: style.fontFamily,
      };
    };
    /* The generic row, explicitly not the content-selection card variant. */
    const row = ".m2-select-panel .m2-fieldset";
    return {
      wordmark: read(".m2-appbar-brand strong"),
      stepTitle: read(".m2-builder-head h2"),
      sectionHeading: read(".m2-select-section h4, .m2-step h3"),
      legend: read(`${row} legend`),
      optionTitle: read(`${row} .m2-option b`),
      optionDetail: read(`${row} .m2-option small, .m2-option small`),
      cardTitle: read(".m2-select-card > .m2-option b"),
    };
  });

test.describe("the interface holds its shape with or without the webfont", () => {
  for (const blocked of [false, true] as const) {
    const state = blocked ? "with Adobe Fonts blocked" : "with Adobe Fonts available";

    test(`every required phone width survives ${state}`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "mobile", "The phone contract runs once, in the mobile project.");
      test.slow();
      if (blocked) await blockAdobeFonts(page);

      for (const width of REQUIRED_WIDTHS) {
        await page.setViewportSize({ width, height: 780 });
        await reachClassStep(page);

        /*
         * The blocked run has to prove it is blocked, or it is the same run
         * twice and neither of them says anything about the fallback.
         */
        if (blocked)
          expect(await loadedFaceCount(page), "the typekit was not actually blocked").toBe(0);

        await expectLayoutHolds(page, `Class & level at ${width} px ${state}`);

        // The densest surface in creation, and the one this pass compacted.
        await page.getByRole("button", { name: /^Vanguard/ }).click();
        await expectLayoutHolds(page, `an expanded class card at ${width} px ${state}`);
      }
    });

    test(`the hierarchy still reads top-down ${state}`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "mobile", "The phone contract runs once, in the mobile project.");
      test.slow();
      if (blocked) await blockAdobeFonts(page);
      await page.setViewportSize({ width: 360, height: 780 });
      await reachBackgroundChoice(page);

      const scale = await typeScale(page);
      expect(scale.stepTitle, "the step title did not render").not.toBeNull();
      expect(scale.legend, "no decision rendered under the selected background").not.toBeNull();
      expect(scale.optionTitle, "no option row rendered under the selected background").not.toBeNull();

      /*
       * The inversion this pass exists to remove: an option row was set at the
       * same size as the legend naming the decision it belongs to, and only
       * three pixels under the title of the whole step.
       */
      expect(scale.optionTitle!.size, "an option title is not smaller than the legend that owns it").toBeLessThan(
        scale.legend!.size,
      );
      expect(scale.legend!.size, "a legend is not smaller than the step title above it").toBeLessThan(
        scale.stepTitle!.size,
      );
      expect(scale.optionDetail!.size, "an option's detail line outranks its own title").toBeLessThan(
        scale.optionTitle!.size,
      );
      // The wordmark is a label, not a masthead — smaller than the step it sits above.
      expect(scale.wordmark!.size).toBeLessThan(scale.stepTitle!.size);

      /*
       * The one deliberate exception, asserted so it stays deliberate: a
       * content-selection card's name is the card's own title, so it keeps body
       * size while the rows inside the panel below it do not.
       */
      expect(scale.cardTitle, "the selected content card did not render").not.toBeNull();
      expect(scale.cardTitle!.size, "a card title must outrank the rows inside it").toBeGreaterThan(
        scale.optionTitle!.size,
      );
      expect(scale.cardTitle!.size, "a card title must not outgrow the step title").toBeLessThan(
        scale.stepTitle!.size,
      );
    });
  }
});

test.describe("the Adobe Fonts integration", () => {
  test("links exactly one external stylesheet, and hosts no font itself", async ({ page }) => {
    await page.goto(APP_ROOT);

    const links = await page.evaluate(() =>
      Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
        .map(link => (link as HTMLLinkElement).href)
        .filter(href => new URL(href).origin !== location.origin),
    );
    expect(links, "the document reaches exactly one external host, for type").toEqual([ADOBE_FONTS_STYLESHEET]);

    /*
     * No `@font-face` of our own, anywhere. Adobe's stylesheet declares its
     * own — that is its job — so only same-origin sheets are inspected. A rule
     * here would mean this repository had started serving font binaries, which
     * the licence does not permit and the build does not ship.
     */
    const selfHosted = await page.evaluate(() => {
      const found: string[] = [];
      for (const sheet of Array.from(document.styleSheets)) {
        if (sheet.href && new URL(sheet.href).origin !== location.origin) continue;
        let rules: CSSRuleList;
        try {
          rules = sheet.cssRules;
        } catch {
          continue;
        }
        for (const rule of Array.from(rules)) if (rule instanceof CSSFontFaceRule) found.push(rule.cssText.slice(0, 80));
      }
      return found;
    });
    expect(selfHosted, "Runefolio must not declare or serve a font face of its own").toEqual([]);
  });

  /**
   * Every family the theme names is followed by something already on the
   * device. This is the assertion that makes the fallback a design decision
   * rather than whatever the browser happens to reach for.
   */
  test("every display stack falls back to a local serif", async ({ page }) => {
    await page.goto(APP_ROOT);
    const stacks = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      return ["--wordmark", "--title", "--accent", "--display-text", "--display"].map(name => ({
        name,
        value: root.getPropertyValue(name).trim(),
      }));
    });

    expect(stacks.length).toBe(5);
    for (const stack of stacks) {
      expect(stack.value, `${stack.name} is not declared`).not.toBe("");
      expect(stack.value.endsWith("serif"), `${stack.name} must end in a generic serif: ${stack.value}`).toBe(true);
      expect(
        stack.value.split(",").length,
        `${stack.name} names a single family with nothing behind it: ${stack.value}`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  /**
   * The wordmark is the only place Bookmania Bold appears.
   *
   * The restraint is the point: a display face used for every heading is
   * decoration, and the mark stops meaning anything.
   *
   * This reads the *declared* family and weight rather than the rendered glyphs,
   * so it holds whether or not the enhancement resolved — the rule is about
   * which rules exist, and it should not stop being checked on a machine with
   * no route to Adobe.
   */
  test("uses Bookmania Bold for the wordmark and nowhere else", async ({ page }, testInfo) => {
    await page.goto(APP_ROOT);
    testInfo.annotations.push({
      type: "fonts",
      description: `${await loadedFaceCount(page)} web font face(s) loaded`,
    });

    const bold = await page.evaluate(() =>
      Array.from(document.querySelectorAll("body *"))
        .filter(node => node.children.length === 0 && (node.textContent ?? "").trim().length > 0)
        .filter(node => {
          const style = getComputedStyle(node);
          return style.fontFamily.includes("bookmania") && Number.parseInt(style.fontWeight, 10) >= 700;
        })
        .map(node => (node.textContent ?? "").trim().slice(0, 40)),
    );
    expect(bold, "Bookmania Bold is the wordmark, and only the wordmark").toEqual(["Runefolio"]);
  });
});
