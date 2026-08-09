import { writeFile } from "node:fs/promises";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { ADOBE_FONTS_ORIGIN } from "@/src/config/fonts";
import { LARGE_ARRAY, MASTERY_LABELS, largeChoicePackJson } from "@/tests/fixtures/large-choice-ruleset";

/**
 * Evidence for the Creation visual-polish pass, at Samsung-like phone width.
 *
 * The surfaces here are the ones physical testing named: the sticky creation
 * chrome, Starting Equipment, an expanded large class-choice picker, Review, the
 * first frame of the Sheet after a commit, and the global app header. Each
 * capture is paired with the measurement that makes it evidence rather than a
 * picture — the type sizes and row heights the pass claims to have reduced, and
 * the scroll offset the Sheet is claimed to open at.
 *
 * The images go to the Playwright output directory, not into the repository:
 * they are review evidence for one change rather than fixtures with assertions
 * behind them. The numbers attached beside them are what a later reader can
 * actually compare.
 */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const APP_ROOT = `${BASE_PATH}/`;

/** A Galaxy S23 reports 360 x 780 CSS px at its default display size. */
const S23 = { width: 360, height: 780 } as const;

const continueStep = (page: Page) => page.getByRole("button", { name: "Continue" }).click();
const stepTitle = (page: Page) => page.getByRole("heading", { level: 2 }).first();

async function shot(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: false });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

/** The measurements this pass is judged on, read off whatever is painted. */
async function measure(page: Page) {
  return page.evaluate(() => {
    const size = (selector: string) => {
      const node = document.querySelector(selector);
      return node ? Number.parseFloat(getComputedStyle(node).fontSize) : null;
    };
    const height = (selector: string) => {
      const node = document.querySelector(selector);
      return node ? Math.round(node.getBoundingClientRect().height) : null;
    };
    return {
      documentHeight: document.documentElement.scrollHeight,
      stepTitleSize: size(".m2-builder-head h2"),
      legendSize: size(".m2-fieldset legend, .m2-task legend"),
      optionTitleSize: size(".m2-option b"),
      optionHeight: height("li > .m2-option"),
      optionMarkHeight: height(".m2-option-mark"),
      wordmarkFamily: (() => {
        const node = document.querySelector(".m2-appbar-brand strong");
        return node ? getComputedStyle(node).fontFamily : null;
      })(),
    };
  });
}

/** Writes a measurement beside its screenshot, and attaches it to the report. */
async function note(testInfo: TestInfo, name: string, value: unknown) {
  const path = testInfo.outputPath(`${name}.json`);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await testInfo.attach(name, { path, contentType: "application/json" });
}

async function record(page: Page, testInfo: TestInfo, name: string) {
  await shot(page, testInfo, name);
  await note(testInfo, name, await measure(page));
}

async function openSettings(page: Page) {
  await page.getByRole("button", { name: "Settings", exact: true }).last().click();
}

test.describe("Creation visual-polish evidence at 360 px", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(S23);
    test.slow();
  });

  test("captures the creation surfaces, Review, and the Sheet's first frame", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Evidence is captured once, in the mobile project.");

    // The global shell header, on the app's first screen.
    await page.goto(APP_ROOT);
    await record(page, testInfo, "01-shell-header-characters");

    await page.getByRole("button", { name: "New character" }).last().click();
    await expect(page.getByText("Step 1 of")).toBeVisible();
    await page.getByLabel("Character name", { exact: true }).fill("Brammel Voss");
    await continueStep(page);
    await expect(stepTitle(page)).toHaveText("Class & level");

    // The creation header and tool area, over a step with real options.
    await record(page, testInfo, "02-creation-header-and-choices");

    await page.getByRole("button", { name: /^Vanguard/ }).click();
    await continueStep(page);
    await page.getByRole("button", { name: /^Riverborn/ }).click();
    await continueStep(page);
    await page.getByRole("button", { name: /^Caravan Warden/ }).click();
    await page.getByRole("button", { name: /^Trade Cant/ }).click();
    await continueStep(page);
    for (const [ability, value] of [
      ["Strength", "14"],
      ["Dexterity", "15"],
      ["Constitution", "13"],
      ["Intelligence", "12"],
      ["Wisdom", "10"],
      ["Charisma", "8"],
    ] as const)
      await page.getByLabel(ability, { exact: true }).selectOption(value);
    await page.getByLabel("+2 to").selectOption("strength");
    await page.getByLabel("+1 to").selectOption("constitution");
    await continueStep(page);
    await page.getByRole("button", { name: /^Guarded Hand/ }).click();
    await page.getByRole("button", { name: /^Riverlore/ }).click();
    await page.getByRole("button", { name: /^Haulage/ }).click();
    await continueStep(page);

    await expect(stepTitle(page)).toHaveText("Equipment");
    await record(page, testInfo, "03-starting-equipment");
    await page.getByRole("button", { name: /^Warden pack/ }).click();
    await continueStep(page);
    await continueStep(page); // Identity

    await expect(stepTitle(page)).toHaveText("Review");
    await record(page, testInfo, "04-review-top");

    /*
     * The pilot's report: Review scrolled part-way down, then committed. The
     * offset is recorded before the commit so the Sheet's own offset can be
     * compared against something rather than merely asserted to be small.
     */
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const reviewOffset = await page.evaluate(() => Math.round(window.scrollY));
    await shot(page, testInfo, "05-review-scrolled");

    await page.getByRole("button", { name: "Finish and open sheet" }).click();
    await expect(page.getByRole("heading", { name: "Brammel Voss", level: 2 })).toBeVisible();
    const sheetOffset = await page.evaluate(() => Math.round(window.scrollY));
    await shot(page, testInfo, "06-sheet-first-frame");
    await note(testInfo, "scroll-handoff", { reviewOffset, sheetOffset });

    // The header again, on the Sheet and on the Compendium.
    await page.getByRole("button", { name: "Compendium" }).click();
    await expect(page.locator(".entrycard").first()).toBeVisible();
    await shot(page, testInfo, "07-shell-header-compendium");
    await openSettings(page);
    await shot(page, testInfo, "08-shell-header-settings");
  });

  test("captures an expanded large class-choice picker", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Evidence is captured once, in the mobile project.");

    await page.goto(APP_ROOT);
    await openSettings(page);
    await page.getByRole("button", { name: "Imports and exports" }).click();
    await page.getByLabel("Pack JSON").fill(largeChoicePackJson());
    await page.getByRole("button", { name: "Preview import" }).click();
    await expect(page.getByRole("heading", { name: "Ready to import" })).toBeVisible();
    await page.getByLabel("Create a ruleset profile so this content can be selected in the builder").check();
    await page.getByRole("button", { name: "Confirm atomic import" }).click();
    await expect(page.getByText(/ruleset profile\(s\) created and ready to select/)).toBeVisible();

    await page.getByRole("button", { name: "Characters", exact: true }).click();
    await page.getByRole("button", { name: "New character" }).last().click();
    await page.getByLabel("Character name", { exact: true }).fill("Scan Probe");
    await continueStep(page);
    await page.getByRole("button", { name: /^Tidewarden/ }).click();
    await page.getByLabel("Create this character at level").selectOption("4");
    await continueStep(page);
    await page.getByRole("button", { name: /^Quaymark/ }).click();
    await continueStep(page);
    await page.getByRole("button", { name: /^Lamp Tender/ }).click();
    await continueStep(page);
    for (const [index, ability] of ["Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma"].entries())
      await page.getByLabel(ability, { exact: true }).selectOption(String(LARGE_ARRAY[index]));
    await continueStep(page);
    await expect(stepTitle(page)).toHaveText("Class choices");

    await record(page, testInfo, "09-class-choices-collapsed");

    const mastery = page.locator("fieldset.m2-task").filter({ hasText: "Tideworn mastery" });
    await mastery.getByRole("button", { name: /^Choose 2 more/ }).click();
    await expect(mastery.getByRole("button", { name: MASTERY_LABELS[0], exact: true })).toBeVisible();
    await record(page, testInfo, "10-class-choices-open");

    // The same picker with something chosen, so the selected treatment is shown.
    await mastery.getByRole("button", { name: MASTERY_LABELS[0], exact: true }).click();
    await record(page, testInfo, "11-class-choices-open-selected");
  });

  /**
   * The same surfaces with the typekit refused.
   *
   * Paired with the captures above, this is what makes the font a documented
   * enhancement rather than an assumption: the two sets are the same layout in
   * two typefaces. `typography.spec.ts` asserts that; these images are what a
   * reviewer looks at to agree with it.
   */
  test("captures the fallback typeface with Adobe Fonts blocked", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Evidence is captured once, in the mobile project.");
    await page.route(`${ADOBE_FONTS_ORIGIN}/**`, route => route.abort());

    await page.goto(APP_ROOT);
    await record(page, testInfo, "12-fallback-shell-header");

    await page.getByRole("button", { name: "New character" }).last().click();
    await page.getByLabel("Character name", { exact: true }).fill("Brammel Voss");
    await continueStep(page);
    await expect(stepTitle(page)).toHaveText("Class & level");
    await record(page, testInfo, "13-fallback-creation-header-and-choices");

    await page.getByRole("button", { name: /^Vanguard/ }).click();
    await record(page, testInfo, "14-fallback-expanded-class-card");
  });
});
