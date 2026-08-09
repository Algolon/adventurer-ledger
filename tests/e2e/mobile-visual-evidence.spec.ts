import { expect, test, type Page, type TestInfo } from "@playwright/test";

/**
 * Dark-mode evidence capture.
 *
 * Every screenshot the mobile visual contract calls for, at the three phone
 * widths it names. The images go to the Playwright output directory rather than
 * into the repository: they are review evidence for one change, not fixtures,
 * and thirty PNGs of the same app would be a maintenance burden with no
 * assertion behind them.
 *
 * Each capture is paired with a check that the surface it just photographed is
 * actually dark. A screenshot proves nothing on its own — it is only evidence
 * once something has failed if the pixel were wrong — so the luminance of the
 * painted surface is measured at the same moment the image is taken.
 */

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const APP_ROOT = `${BASE_PATH}/`;
const EVIDENCE_WIDTHS = [360, 390, 412] as const;

/** Above this, a surface is not a dark surface. */
const DARK_CEILING = 0.1;

const continueStep = (page: Page) => page.getByRole("button", { name: "Continue" }).click();

/** Luminance of the largest painted surface currently on screen. */
async function surfaceLuminance(page: Page, selector: string): Promise<{ background: string; luminance: number }> {
  return page.evaluate(target => {
    const node = document.querySelector(target);
    if (!node) return { background: "missing", luminance: 1 };
    const value = getComputedStyle(node).backgroundColor;
    const [r, g, b] = (value.match(/[\d.]+/g) ?? []).map(Number);
    const channel = (part: number) => (part <= 0.03928 ? part / 12.92 : Math.pow((part + 0.055) / 1.055, 2.4));
    return {
      background: value,
      luminance: 0.2126 * channel(r / 255) + 0.7152 * channel(g / 255) + 0.0722 * channel(b / 255),
    };
  }, selector);
}

/** Photographs the current screen and proves it is dark while doing it. */
async function capture(page: Page, testInfo: TestInfo, name: string, surface = ".m2-shell") {
  const measured = await surfaceLuminance(page, surface);
  expect(measured.luminance, `${name} must be a dark surface, but ${surface} painted ${measured.background}`).toBeLessThan(
    DARK_CEILING,
  );
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: false });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

async function openSettings(page: Page) {
  const candidates = page.getByRole("button", { name: /^(Open Settings|Settings)$/ });
  const total = await candidates.count();
  for (let index = 0; index < total; index += 1) {
    const candidate = candidates.nth(index);
    if (await candidate.isVisible()) {
      await candidate.click();
      return;
    }
  }
  throw new Error("No visible Settings control was found");
}

async function buildMartial(page: Page, name: string) {
  await page.getByLabel("Character name", { exact: true }).fill(name);
  await continueStep(page);
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
  await page.getByRole("button", { name: /^Warden pack/ }).click();
  await continueStep(page);
  await continueStep(page);
  await page.getByRole("button", { name: "Finish and open sheet" }).click();
  await expect(page.getByRole("heading", { name, level: 2 })).toBeVisible();
}

async function buildCaster(page: Page, name: string) {
  await page.getByLabel("Character name", { exact: true }).fill(name);
  await continueStep(page);
  await page.getByRole("button", { name: /^Runecaller/ }).click();
  await continueStep(page);
  await page.getByRole("button", { name: /^Riverborn/ }).click();
  await continueStep(page);

  await page.getByRole("button", { name: /^Caravan Warden/ }).click();
  await page.getByRole("button", { name: /^River Signs/ }).click();
  await continueStep(page);
  for (const [ability, value] of [
    ["Strength", "10"],
    ["Dexterity", "14"],
    ["Constitution", "13"],
    ["Intelligence", "12"],
    ["Wisdom", "15"],
    ["Charisma", "8"],
  ] as const)
    await page.getByLabel(ability, { exact: true }).selectOption(value);
  await page.getByLabel("+2 to").selectOption("dexterity");
  await page.getByLabel("+1 to").selectOption("constitution");
  await continueStep(page);
  await page.getByRole("button", { name: /^Riverlore/ }).click();
  await continueStep(page);
  // The step owes two real decisions, so it is answered rather than read.
  await page.getByRole("button", { name: /^Silt Whisper/ }).click();
  await page.getByRole("button", { name: /^Tally Mark/ }).click();
  await page.getByRole("button", { name: /^Stone Reading/ }).click();
  await page.getByRole("button", { name: /^Quiet the Wake/ }).click();
  await continueStep(page);
  await page.getByRole("button", { name: /^River kit/ }).click();
  await continueStep(page);
  await continueStep(page);
  await page.getByRole("button", { name: "Finish and open sheet" }).click();
  await expect(page.getByRole("heading", { name, level: 2 })).toBeVisible();
}

for (const width of EVIDENCE_WIDTHS) {
  test(`captures the dark surfaces at ${width} px`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Evidence is captured once, in the mobile project.");
    test.slow();
    await page.setViewportSize({ width, height: 800 });

    // Characters, empty.
    await page.goto(APP_ROOT);
    await capture(page, testInfo, `${width}-01-characters-empty`);

    // Builder: Basics, then Class & level.
    await page.getByRole("button", { name: "New character" }).last().click();
    await expect(page.getByText("Step 1 of")).toBeVisible();
    await capture(page, testInfo, `${width}-02-builder-basics`);

    await page.getByLabel("Character name", { exact: true }).fill("Brammel Voss");
    await continueStep(page);
    await expect(page.getByText("Step 2 of")).toBeVisible();
    await capture(page, testInfo, `${width}-03-builder-class-and-level`);

    // The martial sheet: four sections.
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
    await page.getByRole("button", { name: /^Warden pack/ }).click();
    await continueStep(page);
    await continueStep(page);
    await page.getByRole("button", { name: "Finish and open sheet" }).click();
    await expect(page.getByRole("heading", { name: "Brammel Voss", level: 2 })).toBeVisible();

    await capture(page, testInfo, `${width}-04-martial-overview`);
    await page.getByRole("tab", { name: "Actions" }).click();
    await capture(page, testInfo, `${width}-05-martial-actions`);
    await page.getByRole("tab", { name: "Inventory" }).click();
    await capture(page, testInfo, `${width}-06-martial-inventory`);
    await page.getByRole("tab", { name: "Character" }).click();
    await capture(page, testInfo, `${width}-07-martial-character`);

    // The caster sheet: five sections, so Spells exists.
    await page.getByRole("button", { name: "Characters" }).click();
    await page.getByRole("button", { name: "New character" }).last().click();
    await expect(page.getByText("Step 1 of")).toBeVisible();
    await buildCaster(page, "Sereth Marsh");
    await page.getByRole("tab", { name: "Spells" }).click();
    await capture(page, testInfo, `${width}-08-caster-spells`);

    // Settings.
    await openSettings(page);
    await capture(page, testInfo, `${width}-09-settings`);

    // Compendium, which had no dark rules at all before this pass.
    await page.getByRole("button", { name: "Compendium" }).click();
    await capture(page, testInfo, `${width}-10-compendium`);

    // The portrait guard, at this width rotated onto its side.
    await page.setViewportSize({ width: 800, height: width });
    await expect(page.getByRole("alert").filter({ hasText: "Turn your phone upright" })).toBeVisible();
    await capture(page, testInfo, `${width}-11-portrait-guard`, ".portrait-guard");
  });
}

/**
 * The same surfaces under an operating system set to light.
 *
 * This is the capture that proves the product rule rather than illustrating it:
 * every other image in this file is taken under the default preference, which
 * would look identical if the app had gone back to following the OS.
 */
test.describe("under an emulated light OS preference", () => {
  test.use({ colorScheme: "light" });

  test("captures a dark app on a light phone at 390 px", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Evidence is captured once, in the mobile project.");
    test.slow();
    await page.setViewportSize({ width: 390, height: 800 });

    expect(await page.evaluate(() => matchMedia("(prefers-color-scheme: light)").matches)).toBe(true);

    await page.goto(APP_ROOT);
    await capture(page, testInfo, "light-os-01-characters");

    await page.getByRole("button", { name: "New character" }).last().click();
    await expect(page.getByText("Step 1 of")).toBeVisible();
    await capture(page, testInfo, "light-os-02-builder-basics");

    await buildMartial(page, "Brammel Voss");
    await capture(page, testInfo, "light-os-03-martial-overview");

    await openSettings(page);
    await capture(page, testInfo, "light-os-04-settings");

    await page.getByRole("button", { name: "Compendium" }).click();
    await capture(page, testInfo, "light-os-05-compendium");
  });
});
