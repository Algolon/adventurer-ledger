import { expect, test, type Page } from "@playwright/test";

/**
 * Choosing spells, driven through the real UI on a phone.
 *
 * The slice is a vertical one, so this journey is vertical too: a caster is
 * built, its spell decisions are answered on the step that owns them, the
 * character is committed, reopened, edited, changed and reopened again. Nothing
 * here seeds a record — every assertion is about state that survived the real
 * commit and edit boundaries, which is the only way to catch a picker that works
 * and a persistence path that does not.
 *
 * Only original synthetic content is used.
 */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const APP_ROOT = `${BASE_PATH}/`;

/** The portrait widths the product is specified against. */
const PORTRAIT_WIDTHS = [320, 360, 375, 390, 412] as const;

const CANTRIPS = ["Silt Whisper", "Tally Mark"] as const;
const RUNES = ["Stone Reading", "Quiet the Wake"] as const;

const continueStep = (page: Page) => page.getByRole("button", { name: "Continue" }).click();

const spellButton = (page: Page, name: string) => page.getByRole("button", { name: new RegExp(`^${name}`) });

/** Nothing on the page may exceed the viewport, or be hidden sideways to fit. */
async function expectNoHorizontalScroll(page: Page, surface: string) {
  const report = await page.evaluate(() => ({
    documentScrollWidth: document.documentElement.scrollWidth,
    documentClientWidth: document.documentElement.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
    bodyClientWidth: document.body.clientWidth,
  }));
  expect(report.documentScrollWidth, `documentElement overflows on ${surface}`).toBeLessThanOrEqual(
    report.documentClientWidth,
  );
  expect(report.bodyScrollWidth, `body overflows on ${surface}`).toBeLessThanOrEqual(report.bodyClientWidth);
}

/** Walks a fresh Runecaller as far as the Spells & resources step. */
async function reachSpellsStep(page: Page, name: string) {
  await page.goto(APP_ROOT);
  await page.getByRole("button", { name: "New character" }).last().click();
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
  await expect(page.getByRole("heading", { name: "Cantrips", level: 3 })).toBeVisible();
}

/** Answers both decisions and finishes the build. */
async function answerSpellsAndCommit(page: Page, name: string) {
  for (const spell of [...CANTRIPS, ...RUNES]) await spellButton(page, spell).click();
  await continueStep(page);
  await page.getByRole("button", { name: /^River kit/ }).click();
  await continueStep(page);
  await continueStep(page);
  await page.getByRole("button", { name: "Finish and open sheet" }).click();
  await expect(page.getByRole("heading", { name, level: 2 })).toBeVisible();
}

/** Reopens the committed character on its Spells & resources step. */
async function openEditOnSpells(page: Page) {
  await page.getByRole("tab", { name: "Character" }).click();
  await page.getByRole("button", { name: "Edit character", exact: true }).click();
  await page.getByRole("button", { name: "All steps" }).click();
  await page.getByRole("button", { name: /^Spells & resources/ }).click();
  await expect(page.getByRole("heading", { name: "Cantrips", level: 3 })).toBeVisible();
}

test.describe("the spell selection step", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
  });

  test("states what is still owed, in words rather than a code", async ({ page }) => {
    await reachSpellsStep(page, "Owed Walker");

    await expect(page.getByText("Choose 2 more cantrips")).toBeVisible();
    await expect(page.getByText("Choose 2 more runes known")).toBeVisible();
    // A rule code is never the message.
    await expect(page.getByText(/SPELL_SELECTION_UNRESOLVED|CHOICE_MIN_NOT_MET/)).toHaveCount(0);

    await spellButton(page, "Silt Whisper").click();
    // One remaining drops the noun rather than mismatching its number.
    await expect(page.getByText("Choose 1 more", { exact: true })).toBeVisible();
    await spellButton(page, "Tally Mark").click();
    await expect(page.getByText("2 of 2 cantrips chosen")).toBeVisible();
  });

  test("distinguishes granted and always-prepared spells from choices", async ({ page }) => {
    await reachSpellsStep(page, "Granted Walker");

    // Emberline is granted and always prepared: stated, and not a button.
    await expect(page.getByText("Always prepared")).toBeVisible();
    await expect(spellButton(page, "Emberline")).toHaveCount(0);
    // Ward of Reeds is granted outright: also stated, also not pressable.
    await expect(spellButton(page, "Ward of Reeds")).toHaveCount(0);
    await expect(page.getByText("Granted", { exact: false }).first()).toBeVisible();

    // And none of that spends the allowance the content owes.
    await expect(page.getByText("Choose 2 more runes known")).toBeVisible();
  });

  test("does not let the step pass until the obligation is met", async ({ page }) => {
    await reachSpellsStep(page, "Blocked Walker");
    await spellButton(page, "Silt Whisper").click();
    await continueStep(page);
    // Still here: one cantrip short.
    await expect(page.getByRole("heading", { name: "Cantrips", level: 3 })).toBeVisible();
  });

  test("offers a labelled search once a group is longer than one glance", async ({ page }) => {
    await reachSpellsStep(page, "Search Walker");

    const search = page.getByLabel("Search runes known");
    await expect(search).toBeVisible();
    await search.fill("stone");
    await expect(spellButton(page, "Stone Reading")).toBeVisible();
    await expect(spellButton(page, "Quiet the Wake")).toHaveCount(0);

    // Filtering is presentation only: clearing it restores the full group.
    await search.fill("");
    await expect(spellButton(page, "Quiet the Wake")).toBeVisible();
  });

  test("presents each obligation as its own headed, navigable section", async ({ page }) => {
    await reachSpellsStep(page, "Grouped Walker");
    // Two decisions, two landmarks, each naming what it is for and where it came
    // from — rather than one undifferentiated wall of spells.
    await expect(page.getByRole("heading", { name: "Cantrips", level: 3 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Runes known", level: 3 })).toBeVisible();
    await expect(page.getByText("From Runecaller spellcasting.").first()).toBeVisible();
  });

  test("announces selected state without relying on the tick alone", async ({ page }) => {
    await reachSpellsStep(page, "Announced Walker");
    const spell = spellButton(page, "Silt Whisper");
    await expect(spell).toHaveAttribute("aria-pressed", "false");
    await spell.click();
    await expect(spell).toHaveAttribute("aria-pressed", "true");
  });

  test("keeps every control reachable at a thumb's size", async ({ page }) => {
    await reachSpellsStep(page, "Touch Walker");
    const buttons = page.locator("button.m2-option");
    const total = await buttons.count();
    expect(total).toBeGreaterThan(0);
    for (let index = 0; index < total; index += 1) {
      const box = await buttons.nth(index).boundingBox();
      expect(box?.height ?? 0, `spell row ${index} is under the 44 px floor`).toBeGreaterThanOrEqual(44);
    }
  });

  for (const width of PORTRAIT_WIDTHS)
    test(`fits the viewport at ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 780 });
      await reachSpellsStep(page, `Fit Walker ${width}`);
      await expectNoHorizontalScroll(page, `the spell step at ${width} px`);
    });
});

test.describe("the whole selection journey", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
  });

  test("commits, reopens, changes one spell and holds the change", async ({ page }) => {
    await reachSpellsStep(page, "Sereth Marsh");
    await answerSpellsAndCommit(page, "Sereth Marsh");

    // The sheet holds what was chosen, and nothing that was merely reachable.
    await page.getByRole("tab", { name: "Spells" }).click();
    for (const spell of [...CANTRIPS, ...RUNES]) await expect(page.getByText(spell, { exact: false }).first()).toBeVisible();
    await expect(page.getByText("Lantern Rune")).toHaveCount(0);
    await expect(page.getByText("Borrowed Footing")).toHaveCount(0);

    // Reopened, the answers are still pressed.
    await openEditOnSpells(page);
    for (const spell of [...CANTRIPS, ...RUNES])
      await expect(spellButton(page, spell)).toHaveAttribute("aria-pressed", "true");

    // Swap one cantrip for another, which is a legal reselection.
    await spellButton(page, "Tally Mark").click();
    await spellButton(page, "Lantern Rune").click();
    await expect(page.getByText("2 of 2 cantrips chosen")).toBeVisible();

    await page.getByRole("button", { name: "All steps" }).click();
    await page.getByRole("button", { name: /^Review/ }).click();
    await page.getByRole("button", { name: /Save changes and open sheet/ }).click();
    await expect(page.getByRole("heading", { name: "Sereth Marsh", level: 2 })).toBeVisible();

    // The recommitted sheet carries the swap.
    await page.getByRole("tab", { name: "Spells" }).click();
    await expect(page.getByText("Lantern Rune").first()).toBeVisible();
    await expect(page.getByText("Tally Mark")).toHaveCount(0);

    // And a second reopen reads the same answers back.
    await openEditOnSpells(page);
    await expect(spellButton(page, "Lantern Rune")).toHaveAttribute("aria-pressed", "true");
    await expect(spellButton(page, "Tally Mark")).toHaveAttribute("aria-pressed", "false");
    await expect(spellButton(page, "Silt Whisper")).toHaveAttribute("aria-pressed", "true");
  });

  test("drops the old class's spell answers when the class changes", async ({ page }) => {
    await reachSpellsStep(page, "Switch Walker");
    await spellButton(page, "Silt Whisper").click();
    await spellButton(page, "Tally Mark").click();

    // Back to the class step, and away from casting entirely.
    await page.getByRole("button", { name: "All steps" }).click();
    await page.getByRole("button", { name: /^Class & level/ }).click();
    await page.getByRole("button", { name: /^Vanguard/ }).click();

    // The conditional step leaves the sequence with the class that owed it.
    await page.getByRole("button", { name: "All steps" }).click();
    await expect(page.getByRole("button", { name: /^Spells & resources/ })).toHaveCount(0);
    await page.getByRole("button", { name: "All steps" }).click();

    // Coming back, the obligation is fresh rather than half-answered.
    await page.getByRole("button", { name: /^Runecaller/ }).click();
    await page.getByRole("button", { name: "All steps" }).click();
    await page.getByRole("button", { name: /^Spells & resources/ }).click();
    await expect(page.getByText("Choose 2 more cantrips")).toBeVisible();
    await expect(spellButton(page, "Silt Whisper")).toHaveAttribute("aria-pressed", "false");
  });
});
