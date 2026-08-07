import { expect, test, type Page, type TestInfo } from "@playwright/test";

/**
 * Screenshot evidence for the creation information architecture.
 *
 * The surfaces the redesign is judged on, at the three phone widths the mobile
 * visual contract names: Class, Species, an expanded Species with its nested
 * choice, Background, an expanded Background, and Review.
 *
 * Every capture is paired with an assertion, because a screenshot on its own
 * proves nothing — it becomes evidence only once the test would have failed if
 * the surface were wrong. Each one therefore checks that the surface is dark and
 * that it does not scroll sideways at the moment the image is taken.
 */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const APP_ROOT = `${BASE_PATH}/`;
const EVIDENCE_WIDTHS = [360, 390, 412] as const;
const DARK_CEILING = 0.1;

const continueStep = (page: Page) => page.getByRole("button", { name: "Continue" }).click();

async function capture(page: Page, testInfo: TestInfo, name: string) {
  const report = await page.evaluate(() => {
    const body = getComputedStyle(document.body).backgroundColor;
    const [r, g, b] = (body.match(/[\d.]+/g) ?? []).map(Number);
    const channel = (part: number) => (part <= 0.03928 ? part / 12.92 : Math.pow((part + 0.055) / 1.055, 2.4));
    return {
      luminance: 0.2126 * channel(r / 255) + 0.7152 * channel(g / 255) + 0.0722 * channel(b / 255),
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    };
  });
  // The two properties the image is evidence *of*, checked as it is taken.
  expect(report.luminance, `${name} is not a dark surface`).toBeLessThan(DARK_CEILING);
  expect(report.scrollWidth, `${name} scrolls sideways`).toBeLessThanOrEqual(report.clientWidth);

  const image = await page.screenshot({ fullPage: true });
  await testInfo.attach(name, { body: image, contentType: "image/png" });
}

for (const width of EVIDENCE_WIDTHS) {
  test(`captures the creation steps at ${width} px`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Evidence is captured once, in the mobile project.");
    test.slow();
    await page.setViewportSize({ width, height: 800 });

    await page.goto(APP_ROOT);
    await page.getByRole("button", { name: "New character" }).last().click();
    await page.getByLabel("Character name", { exact: true }).fill("Evidence Walker");
    await continueStep(page);

    // ---- Class: compact rows, then the selected class expanded -------------
    await expect(page.getByText("Step 2 of 9")).toBeVisible();
    await capture(page, testInfo, `${width}-01-class-unselected`);
    await page.getByRole("button", { name: /^Vanguard/ }).click();
    await expect(page.locator(".m2-select-panel")).toHaveCount(1);
    await capture(page, testInfo, `${width}-02-class-expanded`);
    await continueStep(page);

    // ---- Species: scannable list, then expanded, then a nested choice ------
    await expect(page.getByRole("heading", { level: 2 }).first()).toHaveText("Species");
    await capture(page, testInfo, `${width}-03-species-unselected`);

    await page.getByRole("button", { name: /^Riverborn/ }).click();
    await expect(page.getByText("River Footing")).toBeVisible();
    await capture(page, testInfo, `${width}-04-species-expanded-simple`);

    // A species whose lineage decision lives inside the selected species.
    await page.getByRole("button", { name: /^Stonevigil/ }).click();
    await expect(page.locator(".m2-select-panel").getByRole("heading", { name: "Choices to make" })).toBeVisible();
    await capture(page, testInfo, `${width}-05-species-expanded-nested-choice`);
    await page.getByRole("button", { name: /^Deepdelve/ }).click();
    await expect(page.getByRole("button", { name: /^Deepdelve/ })).toHaveAttribute("aria-pressed", "true");
    await capture(page, testInfo, `${width}-06-species-nested-choice-answered`);
    await continueStep(page);

    // ---- Background: its own step, compact then expanded -------------------
    await expect(page.getByRole("heading", { level: 2 }).first()).toHaveText("Background");
    await capture(page, testInfo, `${width}-07-background-unselected`);

    await page.getByRole("button", { name: /^Ferry Hand/ }).click();
    await expect(page.locator(".m2-select-panel").getByText("Ferry Sense")).toBeVisible();
    await capture(page, testInfo, `${width}-08-background-expanded`);
    await page.getByRole("button", { name: /^Reading the water/ }).click();
    await continueStep(page);

    // ---- Abilities: the alternative distributions this background offers ---
    await expect(page.getByRole("heading", { level: 2 }).first()).toHaveText("Abilities");
    for (const [ability, value] of [
      ["Strength", "12"],
      ["Dexterity", "15"],
      ["Constitution", "13"],
      ["Intelligence", "10"],
      ["Wisdom", "14"],
      ["Charisma", "8"],
    ] as const)
      await page.getByLabel(ability, { exact: true }).selectOption(value);
    await capture(page, testInfo, `${width}-09-abilities-increase-shapes`);
    await page.getByLabel("+2 to").selectOption("dexterity");
    await page.getByLabel("+1 to").selectOption("wisdom");
    await continueStep(page);

    // ---- Class choices, equipment, identity -------------------------------
    await page.getByRole("button", { name: /^Guarded Hand/ }).click();
    await page.getByRole("button", { name: /^Riverlore/ }).click();
    await page.getByRole("button", { name: /^Haulage/ }).click();
    await continueStep(page);
    // Two sources grant a pack of the same name here — the class kit and the
    // background kit — so each equipment choice is answered on its own.
    for (const group of await page.locator(".m2-fieldset", { has: page.getByRole("button", { name: /pack|kit|staff/i }) }).all())
      await group.getByRole("button").first().click();
    await continueStep(page);
    await continueStep(page);

    // ---- Review ------------------------------------------------------------
    await expect(page.getByRole("heading", { level: 2 }).first()).toHaveText("Review");
    await capture(page, testInfo, `${width}-10-review`);
  });
}

test("captures the character overflow menu and its delete confirmation", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Evidence is captured once, in the mobile project.");
  test.slow();
  await page.setViewportSize({ width: 390, height: 720 });
  await page.goto(APP_ROOT);

  // One committed character, reached the short way through the builder.
  await page.getByRole("button", { name: "New character" }).last().click();
  await page.getByLabel("Character name", { exact: true }).fill("Menu Evidence");
  await continueStep(page);
  await page.getByRole("button", { name: /^Vanguard/ }).click();
  await continueStep(page);
  await page.getByRole("button", { name: /^Riverborn/ }).click();
  await continueStep(page);
  await page.getByRole("button", { name: /^Caravan Warden/ }).click();
  await page.getByRole("button", { name: /^Trade Cant/ }).click();
  await continueStep(page);
  for (const [ability, value] of [
    ["Strength", "15"],
    ["Dexterity", "14"],
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
  await expect(page.getByRole("heading", { name: "Menu Evidence", level: 2 })).toBeVisible();
  await page.getByRole("button", { name: "Characters" }).click();

  await page.getByRole("button", { name: "More actions for Menu Evidence" }).click();
  await expect(page.getByRole("menuitem", { name: /^Delete / })).toBeVisible();
  await capture(page, testInfo, "390-11-overflow-menu");

  await page.getByRole("menuitem", { name: "Delete Menu Evidence" }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await capture(page, testInfo, "390-12-delete-confirmation");
});
