import { expect, test, type Page } from "@playwright/test";

/**
 * The creation flow as a whole, after the Species/Background split.
 *
 * These are the journeys the split could plausibly have broken without any
 * single step looking wrong: a higher starting level, the conditional Spells
 * step in both directions, and Review actually describing the character that
 * gets committed. All content is the seeded public-original synthetic ruleset.
 */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const APP_ROOT = `${BASE_PATH}/`;

const next = (page: Page) => page.getByRole("button", { name: "Continue" }).click();
const stepTitle = (page: Page) => page.getByRole("heading", { level: 2 }).first();
const stepList = (page: Page) => page.getByRole("navigation", { name: "Build steps" });

const ARRAY: readonly (readonly [string, string])[] = [
  ["Strength", "15"],
  ["Dexterity", "14"],
  ["Constitution", "13"],
  ["Intelligence", "12"],
  ["Wisdom", "10"],
  ["Charisma", "8"],
];

async function startBuild(page: Page, name: string) {
  await page.goto(APP_ROOT);
  await page.getByRole("button", { name: "New character" }).last().click();
  await page.getByLabel("Character name", { exact: true }).fill(name);
  await next(page);
}

/** Answers every equipment group the build happens to grant. */
async function answerEquipment(page: Page) {
  const groups = await page
    .locator(".m2-fieldset", { has: page.getByRole("button", { name: /pack|kit|staff/i }) })
    .all();
  for (const group of groups) await group.getByRole("button").first().click();
}

test.describe("creating directly at a higher starting level", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
  });

  test("a level 2 build explains what that level reaches and commits at it", async ({ page }) => {
    await startBuild(page, "Higher Start");

    // ---- Class explains the level it is being created at --------------------
    await page.getByRole("button", { name: /^Vanguard/ }).click();
    await page.getByLabel("Create this character at level").selectOption("2");

    const panel = page.locator(".m2-select-panel");
    await expect(panel.getByRole("heading", { name: "At your starting level" })).toBeVisible();
    // Level 2's own feature is described, not only level 1's.
    await expect(panel.getByText("Measured Advance")).toBeVisible();
    await expect(panel.getByText("Level 2")).toBeVisible();
    await next(page);

    // ---- Species traits still apply at a higher starting level --------------
    await page.getByRole("button", { name: /^Riverborn/ }).click();
    await expect(page.getByText("River Footing")).toBeVisible();
    await next(page);

    await page.getByRole("button", { name: /^Caravan Warden/ }).click();
    await page.getByRole("button", { name: /^Trade Cant/ }).click();
    await next(page);

    for (const [ability, value] of ARRAY) await page.getByLabel(ability, { exact: true }).selectOption(value);
    await page.getByLabel("+2 to").selectOption("strength");
    await page.getByLabel("+1 to").selectOption("constitution");
    await next(page);

    // ---- The class decisions that level makes reachable ---------------------
    await expect(stepTitle(page)).toHaveText("Class choices");
    await page.getByRole("button", { name: /^Guarded Hand/ }).click();
    await page.getByRole("button", { name: /^Riverlore/ }).click();
    await page.getByRole("button", { name: /^Haulage/ }).click();
    // Level 2 adds a weapon-mastery decision that a level 1 build never sees.
    await page.getByRole("button", { name: /^Measured Cut/ }).click();
    await next(page);

    await answerEquipment(page);
    await next(page);
    await next(page);

    // ---- Review states the level that was chosen ---------------------------
    await expect(stepTitle(page)).toHaveText("Review");
    await expect(page.getByText("Level 2", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Finish and open sheet" }).click();
    await expect(page.getByRole("heading", { name: "Higher Start", level: 2 })).toBeVisible();

    // ---- Reopening keeps the level and everything under it -----------------
    await page.getByRole("tab", { name: "Character" }).click();
    await page.getByRole("button", { name: "Edit character", exact: true }).click();
    await page.getByRole("button", { name: "All steps" }).click();
    await page.getByRole("button", { name: /^Class & level/ }).click();
    await expect(page.getByLabel("Create this character at level")).toHaveValue("2");
    await expect(page.getByRole("button", { name: /^Vanguard/ })).toHaveAttribute("aria-pressed", "true");
  });
});

test.describe("the conditional Spells & resources step", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
  });

  /**
   * The step is omitted rather than shown empty, and the omission survived the
   * two new steps being inserted before it.
   */
  test("a martial build never walks through it", async ({ page }) => {
    await startBuild(page, "Martial Walker");
    await page.getByRole("button", { name: /^Vanguard/ }).click();
    await next(page);

    await expect(page.getByText("Step 3 of 9")).toBeVisible();
    await page.getByRole("button", { name: "All steps" }).click();
    await expect(stepList(page).getByText("Spells & resources")).toHaveCount(0);
    await expect(stepList(page).getByText("Species")).toBeVisible();
    await expect(stepList(page).getByText("Background")).toBeVisible();
    await page.getByRole("button", { name: "All steps" }).click();

    await page.getByRole("button", { name: /^Riverborn/ }).click();
    await next(page);
    await page.getByRole("button", { name: /^Caravan Warden/ }).click();
    await page.getByRole("button", { name: /^Trade Cant/ }).click();
    await next(page);
    for (const [ability, value] of ARRAY) await page.getByLabel(ability, { exact: true }).selectOption(value);
    await page.getByLabel("+2 to").selectOption("strength");
    await page.getByLabel("+1 to").selectOption("constitution");
    await next(page);
    await page.getByRole("button", { name: /^Guarded Hand/ }).click();
    await page.getByRole("button", { name: /^Riverlore/ }).click();
    await page.getByRole("button", { name: /^Haulage/ }).click();
    await next(page);

    // Straight from Class choices to Equipment: no empty spell task in between.
    await expect(stepTitle(page)).toHaveText("Equipment");
  });

  test("a caster gets it, as the tenth step of a ten-step journey", async ({ page }) => {
    await startBuild(page, "Caster Walker");
    await page.getByRole("button", { name: /^Runecaller/ }).click();
    await next(page);

    // Ten steps, because the conditional one now applies.
    await expect(page.getByText("Step 3 of 10")).toBeVisible();
    await expect(stepTitle(page)).toHaveText("Species");
    await page.getByRole("button", { name: /^Riverborn/ }).click();
    await next(page);

    await expect(page.getByText("Step 4 of 10")).toBeVisible();
    await expect(stepTitle(page)).toHaveText("Background");
    await page.getByRole("button", { name: /^Caravan Warden/ }).click();
    await page.getByRole("button", { name: /^River Signs/ }).click();
    await next(page);

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
    await next(page);

    await page.getByRole("button", { name: /^Riverlore/ }).click();
    await next(page);

    // The step exists and has real content, rather than being an empty task.
    await expect(stepTitle(page)).toHaveText("Spells & resources");
    await expect(page.getByText("Known spells")).toBeVisible();
    await next(page);

    await expect(stepTitle(page)).toHaveText("Equipment");
    await answerEquipment(page);
    await next(page);
    await next(page);
    await expect(stepTitle(page)).toHaveText("Review");
    await expect(page.getByText("Step 10 of 10")).toBeVisible();
  });
});

test.describe("Review describes the character that gets committed", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
  });

  test("names both origins separately and shows base, increase and final", async ({ page }) => {
    await startBuild(page, "Review Walker");
    await page.getByRole("button", { name: /^Vanguard/ }).click();
    await next(page);

    // A species with a nested decision, so Review has one to report.
    await page.getByRole("button", { name: /^Stonevigil/ }).click();
    await page.getByRole("button", { name: /^Deepdelve/ }).click();
    await next(page);

    await page.getByRole("button", { name: /^Caravan Warden/ }).click();
    await page.getByRole("button", { name: /^Trade Cant/ }).click();
    await next(page);

    for (const [ability, value] of ARRAY) await page.getByLabel(ability, { exact: true }).selectOption(value);
    await page.getByLabel("+2 to").selectOption("strength");
    await page.getByLabel("+1 to").selectOption("constitution");

    // The step where the number is set already explains where it came from.
    await expect(page.getByText("15 base + 2 from Caravan Warden")).toBeVisible();
    await next(page);

    await page.getByRole("button", { name: /^Guarded Hand/ }).click();
    await page.getByRole("button", { name: /^Riverlore/ }).click();
    await page.getByRole("button", { name: /^Haulage/ }).click();
    await next(page);
    await answerEquipment(page);
    await next(page);
    await next(page);

    await expect(stepTitle(page)).toHaveText("Review");

    // Two concepts, two rows — not one "Origin" line.
    const summary = page.locator(".m2-summary");
    await expect(summary.getByText("Species", { exact: true })).toBeVisible();
    await expect(summary.getByText("Background", { exact: true })).toBeVisible();
    await expect(summary.getByText("Stonevigil")).toBeVisible();
    await expect(summary.getByText("Caravan Warden").first()).toBeVisible();

    // Base, what the background added, and the total.
    await expect(summary.getByText("15 base + 2 from Caravan Warden")).toBeVisible();
    await expect(page.locator(".m2-ability-review").getByText("17")).toBeVisible();

    // The nested species decision is reported with the source that asked for it.
    await expect(page.getByText("Stonevigil lineage")).toBeVisible();
    await expect(page.getByText("Deepdelve")).toBeVisible();

    // Equipment and the absent system are stated rather than left blank.
    await expect(page.getByRole("heading", { name: "Equipment" })).toBeVisible();
    await expect(page.getByText("None at this level")).toBeVisible();
    // Review says whether anything still needs the player, in those words. The
    // section used to be headed "Issues by severity" and to answer "No blocking
    // issues" — the engine's classification and the engine's vocabulary, on the
    // screen whose only question is whether this is the intended character.
    await expect(page.getByRole("heading", { name: "Still to resolve" })).toBeVisible();
    await expect(page.getByText("Nothing is blocking this character")).toBeVisible();
  });

  /**
   * Review is a promise about what will be written. The committed sheet has to
   * agree with it, or the last screen before commit is the least trustworthy
   * one in the flow.
   */
  test("the committed sheet agrees with what Review showed", async ({ page }) => {
    await startBuild(page, "Equivalent Walker");
    await page.getByRole("button", { name: /^Vanguard/ }).click();
    await next(page);
    await page.getByRole("button", { name: /^Riverborn/ }).click();
    await next(page);
    await page.getByRole("button", { name: /^Caravan Warden/ }).click();
    await page.getByRole("button", { name: /^Trade Cant/ }).click();
    await next(page);
    for (const [ability, value] of ARRAY) await page.getByLabel(ability, { exact: true }).selectOption(value);
    await page.getByLabel("+2 to").selectOption("strength");
    await page.getByLabel("+1 to").selectOption("constitution");
    await next(page);
    await page.getByRole("button", { name: /^Guarded Hand/ }).click();
    await page.getByRole("button", { name: /^Riverlore/ }).click();
    await page.getByRole("button", { name: /^Haulage/ }).click();
    await next(page);
    await answerEquipment(page);
    await next(page);
    await next(page);

    await expect(stepTitle(page)).toHaveText("Review");
    const reviewed = await page.locator(".m2-ability-review").innerText();

    await page.getByRole("button", { name: "Finish and open sheet" }).click();
    await expect(page.getByRole("heading", { name: "Equivalent Walker", level: 2 })).toBeVisible();

    // Strength 15 base + 2 = 17, and Constitution 13 + 1 = 14, on the sheet.
    expect(reviewed).toContain("17");
    expect(reviewed).toContain("14");
    await page.getByRole("tab", { name: "Character" }).click();
    // Named on the sheet's identity line, which is the sheet's own summary of
    // the two origins Review reported separately.
    await expect(page.getByText(/Vanguard 1 · Riverborn/)).toBeVisible();
    await expect(page.getByText("Caravan Warden").first()).toBeVisible();
  });

  /** An engine identifier is never what a player is shown. */
  test("shows no raw identifiers, issue codes or effect vocabulary", async ({ page }) => {
    await startBuild(page, "Vocabulary Walker");
    await page.getByRole("button", { name: /^Vanguard/ }).click();
    await next(page);
    await page.getByRole("button", { name: /^Emberkin/ }).click();
    await page.getByRole("button", { name: /^Hearth-kept/ }).click();
    await next(page);
    await page.getByRole("button", { name: /^Ferry Hand/ }).click();
    await page.getByRole("button", { name: /^Reading the water/ }).click();
    await next(page);
    for (const [ability, value] of [
      ["Strength", "15"],
      ["Dexterity", "14"],
      ["Constitution", "13"],
      ["Intelligence", "12"],
      ["Wisdom", "10"],
      ["Charisma", "8"],
    ] as const)
      await page.getByLabel(ability, { exact: true }).selectOption(value);
    await page.getByLabel("+2 to").selectOption("dexterity");
    await page.getByLabel("+1 to").selectOption("wisdom");
    await next(page);
    await page.getByRole("button", { name: /^Guarded Hand/ }).click();
    await page.getByRole("button", { name: /^Riverlore/ }).click();
    await page.getByRole("button", { name: /^Haulage/ }).click();
    await next(page);
    await answerEquipment(page);
    await next(page);
    await next(page);
    await expect(stepTitle(page)).toHaveText("Review");

    const text = await page.locator(".m2-step").innerText();
    // `kind:slug` is the shape of every identifier in this schema.
    expect(text).not.toMatch(/\b[a-z-]+:[a-z0-9-]+\b/);
    // Issue codes and effect types are SCREAMING_SNAKE and camelCase verbs.
    expect(text).not.toMatch(/\b[A-Z][A-Z0-9]*(_[A-Z0-9]+){2,}\b/);
    expect(text).not.toContain("manualAdjudication");
    expect(text).not.toContain("grantProficiency");
  });
});
