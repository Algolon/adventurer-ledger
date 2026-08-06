import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  ACCEPTANCE_ARRAY,
  acceptancePackJson,
  sourceCollisionPackJson,
  overlapPackJson,
} from "@/tests/fixtures/acceptance-ruleset";

/**
 * The corrective pass, through the browser.
 *
 * These are the paths the merge-readiness review found covered only by unit
 * tests. A service test can prove that `changeRuleset` clears a selection; it
 * cannot prove that the user was shown what would be cleared, that Cancel really
 * reached the service as "write nothing", or that a name typed a keystroke
 * before pressing Continue survived the navigation that unmounted the field.
 * Those are properties of the assembled product, so they are asserted here.
 *
 * All content is the original synthetic acceptance slice.
 */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const APP_ROOT = `${BASE_PATH}/`;

const next = (page: Page) => page.getByRole("button", { name: "Continue" }).click();

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

/** Imports one pack through the real import boundary. */
async function importPack(page: Page, json: string, { createRuleset }: { createRuleset: boolean }) {
  await openSettings(page);
  await page.getByRole("button", { name: "Imports and exports" }).click();
  await page.getByLabel("Pack JSON").fill(json);
  await page.getByRole("button", { name: "Preview import" }).click();
  await expect(page.getByRole("heading", { name: "Ready to import" })).toBeVisible();
  if (createRuleset)
    await page
      .getByLabel("Create a ruleset profile so this content can be selected in the builder")
      .check();
  await page.getByRole("button", { name: "Confirm atomic import" }).click();
  await expect(page.getByText(/Import completed atomically/)).toBeVisible();
}

async function importAcceptancePack(page: Page) {
  await page.goto(APP_ROOT);
  await importPack(page, acceptancePackJson(), { createRuleset: true });
}

/** Opens a new build. The imported ruleset is the active one. */
async function startBuild(page: Page, name: string) {
  await page.getByRole("button", { name: "Characters", exact: true }).click();
  await page.getByRole("button", { name: "New character" }).last().click();
  await expect(page.getByText(/^Step 1 of/)).toBeVisible();
  await page.getByLabel("Character name", { exact: true }).fill(name);
}

const levelSelect = (page: Page) => page.getByLabel("Create this character at level");

/** Walks a level 5 Beaconkeeper from the first step to Review. */
async function buildLevelFive(page: Page, name: string, { feat = "Attentive Clerk" } = {}) {
  await startBuild(page, name);
  await next(page);

  // Class first, then the level its progression justifies.
  await page.getByRole("button", { name: /^Beaconkeeper/ }).click();
  await levelSelect(page).selectOption("5");
  await next(page);

  await page.getByRole("button", { name: /^Cairnfolk/ }).click();
  await page.getByRole("button", { name: /^Ferry Clerk/ }).click();
  await page.getByRole("button", { name: /^Cairnlore/ }).click();
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
  await page.getByLabel("+2 to").selectOption("strength");
  await page.getByLabel("+1 to").selectOption("wisdom");
  await next(page);

  await page.getByRole("button", { name: /^Kindled Watch/ }).click();
  await page.getByRole("button", { name: /^Ledgerwork/ }).click();
  await page.getByRole("button", { name: /^Stonecraft/ }).click();
  await page.getByRole("button", { name: /^Wide flare/ }).click();
  await page.getByRole("button", { name: new RegExp(`^${feat}`) }).click();
  if (feat === "Attentive Clerk") await page.getByRole("button", { name: /^Signal lamp/ }).click();
  await next(page);

  await page.getByRole("button", { name: /^Ledger case/ }).click();
  await page.getByRole("button", { name: /^Ink set/ }).click();
  await next(page);
  await next(page); // identity
}

/* -------------------------------------------------------------------------- */

test.describe("switching ruleset is previewed before it is written", () => {
  test("cancel leaves the whole draft exactly as it was", async ({ page }) => {
    await importAcceptancePack(page);
    await startBuild(page, "Cancelled Switch");
    await next(page);
    await page.getByRole("button", { name: /^Beaconkeeper/ }).click();
    await levelSelect(page).selectOption("5");
    await next(page);
    await page.getByRole("button", { name: /^Cairnfolk/ }).click();
    await page.getByRole("button", { name: /^Ferry Clerk/ }).click();
    await page.getByRole("button", { name: /^Cairnlore/ }).click();

    await page.getByRole("button", { name: "All steps" }).click();
    await page.getByRole("button", { name: /Basics/ }).click();
    await page.getByRole("button", { name: /^Runefolio 2024 synthetic/ }).click();

    // The consequence is stated before anything is written.
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: /Switch to Runefolio 2024 synthetic/ })).toBeVisible();
    await expect(dialog.getByText(/Nothing has been changed yet/)).toBeVisible();
    await expect(dialog.getByText(/Class: Beaconkeeper/)).toBeVisible();
    await expect(dialog.getByText(/Background: Ferry Clerk/)).toBeVisible();
    // Cancel is the focused default, so Enter cannot commit the destructive path.
    await expect(dialog.getByRole("button", { name: "Keep current ruleset" })).toBeFocused();
    await dialog.getByRole("button", { name: "Keep current ruleset" }).click();
    await expect(dialog).toHaveCount(0);

    // The draft survives the cancel, and survives a reload of it.
    await expect(page.getByRole("button", { name: /^Emberline acceptance slice/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.reload();
    await page.getByRole("button", { name: "Characters", exact: true }).click();
    await page.getByRole("button", { name: /Cancelled Switch/ }).first().click();
    await page.getByRole("button", { name: "All steps" }).click();
    await page.getByRole("button", { name: /^Class & level (Incomplete|Complete)$/ }).click();
    await expect(page.getByRole("button", { name: /^Beaconkeeper/ })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "All steps" }).click();
    await page.getByRole("button", { name: /^Origin (Incomplete|Complete)$/ }).click();
    await expect(page.getByRole("button", { name: /^Cairnfolk/ })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: /^Ferry Clerk/ })).toHaveAttribute("aria-pressed", "true");
  });

  test("confirm clears only what belonged to the old ruleset", async ({ page }) => {
    await importAcceptancePack(page);
    await startBuild(page, "Confirmed Switch");
    await next(page);
    await page.getByRole("button", { name: /^Beaconkeeper/ }).click();
    await levelSelect(page).selectOption("5");
    await next(page);
    await page.getByRole("button", { name: /^Cairnfolk/ }).click();
    await page.getByRole("button", { name: /^Ferry Clerk/ }).click();
    await page.getByRole("button", { name: /^Cairnlore/ }).click();
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
    await page.getByLabel("+2 to").selectOption("strength");
    await expect(page.getByLabel("Strength final")).toContainText("17");

    await page.getByRole("button", { name: "All steps" }).click();
    await page.getByRole("button", { name: /Basics/ }).click();
    await page.getByRole("button", { name: /^Runefolio 2024 synthetic/ }).click();
    const dialog = page.getByRole("alertdialog");
    // The origin increase is named as recalculated, not silently retained.
    await expect(dialog.getByText(/Final ability scores are recalculated/)).toBeVisible();
    // The switch is about this build, and says so.
    await expect(dialog.getByText(/default ruleset for new characters is not changed/)).toBeVisible();
    await dialog.getByRole("button", { name: "Switch ruleset" }).click();
    await expect(dialog).toHaveCount(0);

    /*
     * The switch cleared the class, so the confirmation lands on Class & level:
     * the first step that genuinely needs repairing. The old ruleset's content
     * is gone from it.
     */
    await expect(page.getByRole("heading", { name: "Class & level", level: 2 })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Beaconkeeper/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Vanguard/ })).toBeVisible();

    // Ruleset-independent values survive, and Basics records the new ruleset.
    await page.getByRole("button", { name: "All steps" }).click();
    await page.getByRole("button", { name: /Basics/ }).click();
    await expect(page.getByRole("button", { name: /^Runefolio 2024 synthetic/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByLabel("Character name", { exact: true })).toHaveValue("Confirmed Switch");

    // The base score is kept; the increase the removed origin authorised is not.
    await page.getByRole("button", { name: "All steps" }).click();
    await page.getByRole("button", { name: /^Abilities (Incomplete|Complete)$/ }).click();
    await expect(page.getByLabel("Strength final")).toContainText("15");

    // And that is what a reload sees, so nothing resurrected it.
    await page.reload();
    await page.getByRole("button", { name: "Characters", exact: true }).click();
    await page.getByRole("button", { name: /Confirmed Switch/ }).first().click();
    await page.getByRole("button", { name: "All steps" }).click();
    await page.getByRole("button", { name: /^Abilities (Incomplete|Complete)$/ }).click();
    await expect(page.getByLabel("Strength final")).toContainText("15");
  });

  test("stays usable and readable at 360 px in a dark browser preference", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.setViewportSize({ width: 360, height: 720 });
    await importAcceptancePack(page);
    await startBuild(page, "Narrow");
    await page.getByRole("button", { name: /^Runefolio 2024 synthetic/ }).click();

    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Keep current ruleset" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Switch ruleset" })).toBeVisible();

    // The document itself never scrolls sideways.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);

    // Both actions clear the 44 px target floor.
    for (const label of ["Keep current ruleset", "Switch ruleset"]) {
      const box = await dialog.getByRole("button", { name: label }).boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const blocking = results.violations.filter(violation =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    );
    expect(blocking.map(violation => violation.id)).toEqual([]);

    // Escape is the same answer as Cancel: write nothing.
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Emberline acceptance slice/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

/* -------------------------------------------------------------------------- */

test.describe("a rapidly typed name survives whatever happens next", () => {
  const NAME = "Wren Halloway of the Low Crossing";

  /** Types without pausing, so the debounce never settles mid-word. */
  const typeFast = (page: Page) =>
    page.getByLabel("Character name", { exact: true }).pressSequentially(NAME, { delay: 1 });

  test("survives Continue, Back, a mode switch, a reload and the commit", async ({ page }) => {
    await importAcceptancePack(page);
    await page.getByRole("button", { name: "Characters", exact: true }).click();
    await page.getByRole("button", { name: "New character" }).last().click();
    await expect(page.getByText(/^Step 1 of/)).toBeVisible();

    await typeFast(page);
    await next(page); // immediately, with the debounce still pending

    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByLabel("Character name", { exact: true })).toHaveValue(NAME);

    await page.getByRole("button", { name: /^(Guided|Flexible) mode$/ }).click();
    await expect(page.getByLabel("Character name", { exact: true })).toHaveValue(NAME);

    await page.reload();
    await page.getByRole("button", { name: "Characters", exact: true }).click();
    await page.getByRole("button", { name: new RegExp(NAME) }).first().click();
    await page.getByRole("button", { name: "All steps" }).click();
    await page.getByRole("button", { name: /Basics/ }).click();
    await expect(page.getByLabel("Character name", { exact: true })).toHaveValue(NAME);
  });

  test("reaches the committed sheet", async ({ page }) => {
    await importAcceptancePack(page);
    await page.getByRole("button", { name: "Characters", exact: true }).click();
    await page.getByRole("button", { name: "New character" }).last().click();
    await expect(page.getByText(/^Step 1 of/)).toBeVisible();
    await typeFast(page);
    await next(page);

    await page.getByRole("button", { name: /^Beaconkeeper/ }).click();
    await next(page);
    await page.getByRole("button", { name: /^Cairnfolk/ }).click();
    await page.getByRole("button", { name: /^Ferry Clerk/ }).click();
    await page.getByRole("button", { name: /^Cairnlore/ }).click();
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
    await page.getByLabel("+2 to").selectOption("strength");
    await page.getByLabel("+1 to").selectOption("wisdom");
    await next(page);
    await page.getByRole("button", { name: /^Ledgerwork/ }).click();
    await page.getByRole("button", { name: /^Stonecraft/ }).click();
    await next(page);
    await page.getByRole("button", { name: /^Ledger case/ }).click();
    await page.getByRole("button", { name: /^Ink set/ }).click();
    await next(page);
    await next(page);
    await page.getByRole("button", { name: "Finish and open sheet" }).click();

    await expect(page.getByRole("heading", { name: NAME, level: 2 })).toBeVisible();
  });
});

/* -------------------------------------------------------------------------- */

test.describe("abilities are base plus origin, and stay that way", () => {
  test("commits manual base scores with origin increases and reopens with both", async ({ page }) => {
    await importAcceptancePack(page);
    await startBuild(page, "Manual Base");
    await next(page);
    await page.getByRole("button", { name: /^Beaconkeeper/ }).click();
    await next(page);
    await page.getByRole("button", { name: /^Cairnfolk/ }).click();
    await page.getByRole("button", { name: /^Ferry Clerk/ }).click();
    await page.getByRole("button", { name: /^Cairnlore/ }).click();
    await next(page);

    await page.getByRole("button", { name: /^Enter scores manually/ }).click();
    for (const [ability, value] of [
      ["Strength base", "14"],
      ["Dexterity base", "13"],
      ["Constitution base", "15"],
      ["Intelligence base", "10"],
      ["Wisdom base", "12"],
      ["Charisma base", "8"],
    ] as const)
      await page.getByLabel(ability, { exact: true }).fill(value);
    await page.getByLabel("+2 to").selectOption("constitution");
    await page.getByLabel("+1 to").selectOption("strength");
    await expect(page.getByLabel("Constitution final")).toContainText("17");
    await expect(page.getByLabel("Strength final")).toContainText("15");
    await next(page);

    await page.getByRole("button", { name: /^Ledgerwork/ }).click();
    await page.getByRole("button", { name: /^Stonecraft/ }).click();
    await next(page);
    await page.getByRole("button", { name: /^Ledger case/ }).click();
    await page.getByRole("button", { name: /^Ink set/ }).click();
    await next(page);
    await next(page);
    // Review shows the finals the commit will write.
    await expect(page.getByRole("definition").filter({ hasText: "CON 17" })).toBeVisible();
    await page.getByRole("button", { name: "Finish and open sheet" }).click();
    await expect(page.getByRole("heading", { name: "Manual Base", level: 2 })).toBeVisible();

    /*
     * Reopening reads the committed record, and the committed record has to
     * carry the increases rather than the base scores.
     *
     * The sheet renders derived values rather than raw scores, which makes it
     * the stronger check: Constitution 15 + 2 is 17, a +3 modifier, so a level 1
     * hit die of 10 gives 13 maximum hit points. Strength 14 + 1 is 15, a +2
     * modifier, and the class is proficient in the save, so it reads +4. Neither
     * number is reachable from the base scores alone.
     */
    await page.reload();
    await page.getByRole("button", { name: "Characters", exact: true }).click();
    await page.getByRole("button", { name: /Manual Base/ }).first().click();
    await expect(page.getByRole("heading", { name: "Manual Base", level: 2 })).toBeVisible();
    await expect(page.getByText("13 / 13")).toBeVisible();
    await expect(page.getByRole("button", { name: /Strength save \+4/ })).toBeVisible();
  });
});

/* -------------------------------------------------------------------------- */

test.describe("level 5 is created directly and read back", () => {
  test("commits at level 5 and reopens at level 5", async ({ page }) => {
    await importAcceptancePack(page);
    await buildLevelFive(page, "Direct Five");
    await expect(page.getByRole("definition").filter({ hasText: "Level 5" })).toBeVisible();
    await page.getByRole("button", { name: "Finish and open sheet" }).click();
    await expect(page.getByText("Beaconkeeper 5 (Kindled Watch)")).toBeVisible();

    await page.reload();
    await page.getByRole("button", { name: "Characters", exact: true }).click();
    await page.getByRole("button", { name: /Direct Five/ }).first().click();
    await expect(page.getByText("Beaconkeeper 5 (Kindled Watch)")).toBeVisible();
    // Class base 22 at level 5 plus a +1 Constitution modifier on each of the
    // five levels. Direct creation and a sequential climb reach the same number.
    await expect(page.getByText("27 / 27")).toBeVisible();
  });

  test("the array offered is the imported ruleset's own", async ({ page }) => {
    await importAcceptancePack(page);
    await startBuild(page, "Array");
    await next(page);
    await page.getByRole("button", { name: /^Beaconkeeper/ }).click();
    await next(page);
    await page.getByRole("button", { name: /^Cairnfolk/ }).click();
    await page.getByRole("button", { name: /^Ferry Clerk/ }).click();
    await page.getByRole("button", { name: /^Cairnlore/ }).click();
    await next(page);
    await expect(page.locator(".m2-remaining-chip")).toHaveText(ACCEPTANCE_ARRAY.map(String));
  });
});

/* -------------------------------------------------------------------------- */

test.describe("levelling one step at a time through the UI", () => {
  /** Creates a level 1 Beaconkeeper and opens its sheet. */
  async function createLevelOne(page: Page, name: string) {
    await importAcceptancePack(page);
    await startBuild(page, name);
    await next(page);
    await page.getByRole("button", { name: /^Beaconkeeper/ }).click();
    await next(page);
    await page.getByRole("button", { name: /^Cairnfolk/ }).click();
    await page.getByRole("button", { name: /^Ferry Clerk/ }).click();
    await page.getByRole("button", { name: /^Cairnlore/ }).click();
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
    await page.getByLabel("+2 to").selectOption("strength");
    await page.getByLabel("+1 to").selectOption("wisdom");
    await next(page);
    await page.getByRole("button", { name: /^Ledgerwork/ }).click();
    await page.getByRole("button", { name: /^Stonecraft/ }).click();
    await next(page);
    await page.getByRole("button", { name: /^Ledger case/ }).click();
    await page.getByRole("button", { name: /^Ink set/ }).click();
    await next(page);
    await next(page);
    await page.getByRole("button", { name: "Finish and open sheet" }).click();
    await expect(page.getByRole("heading", { name, level: 2 })).toBeVisible();
  }

  // Level up sits with Edit character in the sheet's Character section.
  const openLevelUp = async (page: Page) => {
    await page.getByRole("tab", { name: "Character" }).click();
    await page.getByRole("button", { name: /^Level up/ }).first().click();
  };

  test("goes 1 to 5, choosing the subclass at the level the class declares it", async ({ page }) => {
    await createLevelOne(page, "Stepwise");
    await expect(page.getByText("Beaconkeeper 1")).toBeVisible();

    // ---- level 2: automatic features only, and the dialog says so ------------
    await openLevelUp(page);
    await expect(page.getByRole("heading", { name: "Level 1 to 2" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "What you gain" })).toBeVisible();
    await expect(page.getByText("Steady Hand")).toBeVisible();
    await expect(page.getByText("Nothing new to choose at this level.")).toBeVisible();
    await page.getByRole("button", { name: "Confirm level 2" }).click();
    await expect(page.getByText("Beaconkeeper 2")).toBeVisible();

    // ---- level 3: the subclass decision ------------------------------------
    await openLevelUp(page);
    await expect(page.getByRole("heading", { name: "Level 2 to 3" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Subclass" })).toBeVisible();
    // It cannot be confirmed until the subclass is chosen.
    await expect(page.getByRole("button", { name: "Confirm level 3" })).toBeDisabled();
    await page.getByRole("button", { name: /^Kindled Watch/ }).click();
    // Choosing it brings the subclass's own choice with it.
    await page.getByRole("button", { name: /^Wide flare/ }).click();
    await page.getByRole("button", { name: "Confirm level 3" }).click();
    await expect(page.getByText("Beaconkeeper 3 (Kindled Watch)")).toBeVisible();

    // ---- level 4: the boon choice, and a feat's own nested choice -----------
    await openLevelUp(page);
    await expect(page.getByRole("heading", { name: "Level 3 to 4" })).toBeVisible();
    await page.getByRole("button", { name: /^Stonewise/ }).click();
    await page.getByRole("button", { name: "Confirm level 4" }).click();
    await expect(page.getByText("Beaconkeeper 4 (Kindled Watch)")).toBeVisible();

    // ---- level 5 ------------------------------------------------------------
    await openLevelUp(page);
    await expect(page.getByRole("heading", { name: "Level 4 to 5" })).toBeVisible();
    await expect(page.getByText("Second Beacon")).toBeVisible();
    await page.getByRole("button", { name: "Confirm level 5" }).click();
    await expect(page.getByText("Beaconkeeper 5 (Kindled Watch)")).toBeVisible();
    await expect(page.getByRole("button", { name: /Proficiency bonus \+3/ })).toBeVisible();
  });
});

/* -------------------------------------------------------------------------- */

test.describe("the coverage guard blocks confirmation in the UI", () => {
  test("offers no unsupported level and names the repair", async ({ page }) => {
    await importAcceptancePack(page);
    await startBuild(page, "Overreach");
    await next(page);
    await page.getByRole("button", { name: /^Beaconkeeper/ }).click();
    await levelSelect(page).selectOption("5");

    // The second class stops at level 3. Everything below happens on this same
    // step: the conflict is reported where both controls that repair it live.
    await page.getByRole("button", { name: /^Lamplighter/ }).click();

    // The selector no longer offers 4 or 5 just because the draft stored 5.
    await expect(levelSelect(page).locator("option:not([disabled])")).toHaveText(["1", "2", "3"]);
    await expect(page.getByRole("alert").getByText(/does not reach the chosen level/)).toBeVisible();
    await expect(page.getByText(/This class stops at level 3/)).toBeVisible();

    // Review states the problem and the repair, and refuses the commit.
    await page.getByRole("button", { name: "All steps" }).click();
    await page.getByRole("button", { name: /^Review/ }).click();
    await expect(page.getByRole("heading", { name: "Review", level: 3 })).toBeVisible();
    await expect(page.getByText("This level cannot be created")).toBeVisible();
    await page.getByRole("button", { name: "Finish and open sheet" }).click();
    await expect(page.getByRole("alert").getByText(/does not reach the chosen level/)).toBeVisible();
    // Nothing was committed.
    await page.getByRole("button", { name: "Back" }).click();

    // The offered repair resolves it.
    await page.getByRole("button", { name: "All steps" }).click();
    await page.getByRole("button", { name: /Class & level/ }).click();
    await page.getByRole("button", { name: /^Set the level to 3$/ }).click();
    await expect(page.getByText(/does not reach the chosen level/)).toHaveCount(0);
    await expect(levelSelect(page)).toHaveValue("3");
  });
});

/* -------------------------------------------------------------------------- */

test.describe("equipment reads once, from every source that grants it", () => {
  test("shows package contents and does not double a bundle two entries grant", async ({ page }) => {
    await importAcceptancePack(page);
    // Stonewise grants the background's own satchel, so one bundle has two sources.
    await buildLevelFive(page, "Doubled", { feat: "Stonewise" });

    await expect(page.getByRole("heading", { name: "Equipment" })).toBeVisible();
    // The satchel's contents appear exactly once in Review.
    const tally = page.getByRole("listitem").filter({ hasText: "Tally sticks" });
    await expect(tally).toHaveCount(1);
    await expect(tally).not.toContainText("×2");
    await expect(page.getByRole("listitem").filter({ hasText: "Ink set" })).toHaveCount(1);

    // And the equipment step still names both sources on the one bundle, while
    // keeping the genuinely distinct class kit separate.
    await page.getByRole("button", { name: "All steps" }).click();
    await page.getByRole("button", { name: /^Equipment (Incomplete|Complete)$/ }).click();
    await expect(page.getByRole("heading", { name: "Clerk's satchel" })).toHaveCount(1);
    await expect(page.getByText(/Granted by Ferry Clerk \(background\) and Stonewise \(feat\)/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Warden kit" })).toBeVisible();
    await expect(page.getByText("Granted by Beaconkeeper (class)")).toBeVisible();
  });
});

/* -------------------------------------------------------------------------- */

test.describe("a pack that reuses a source ID cannot widen another ruleset", () => {
  test("keeps the imported profile's class list to its own pack", async ({ page }) => {
    await importAcceptancePack(page);
    // A second, well-formed pack whose entries sit on the first pack's source.
    await page.getByRole("button", { name: "Back to Settings" }).click();
    await importPack(page, sourceCollisionPackJson(), { createRuleset: false });

    await startBuild(page, "Scope Probe");
    await expect(page.getByRole("button", { name: /^Emberline acceptance slice/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await next(page);
    await expect(page.getByRole("button", { name: /^Beaconkeeper/ })).toBeVisible();
    // The other pack's class is installed, and is not part of this ruleset.
    await expect(page.getByRole("button", { name: /^Tollkeeper/ })).toHaveCount(0);
  });
});

/* -------------------------------------------------------------------------- */

test.describe("a ruleset says what kind of content it reaches", () => {
  test("shows the privacy classification in the builder and in Settings", async ({ page }) => {
    await importAcceptancePack(page);
    await page.getByRole("button", { name: "Back to Settings" }).click();
    await page.getByRole("button", { name: "Rulesets" }).click();
    await expect(page.getByText("Public content only").first()).toBeVisible();

    await startBuild(page, "Privacy");
    await expect(
      page.getByRole("button", { name: /^Emberline acceptance slice/ }).getByText("Public content only"),
    ).toBeVisible();
  });
});

/* -------------------------------------------------------------------------- */

test.describe("a build's ruleset is not the device's default", () => {
  test("switching one draft leaves the default for new characters alone", async ({ page }) => {
    await importAcceptancePack(page);
    await startBuild(page, "Local Switch");

    // Move this one build to the other installed ruleset.
    await page.getByRole("button", { name: /^Runefolio 2024 synthetic/ }).click();
    const dialog = page.getByRole("alertdialog");
    await dialog.getByRole("button", { name: "Switch ruleset" }).click();
    await expect(dialog).toHaveCount(0);
    await page.getByRole("button", { name: "All steps" }).click();
    await page.getByRole("button", { name: /Basics/ }).click();
    await expect(page.getByRole("button", { name: /^Runefolio 2024 synthetic/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // Settings still names the imported pack as the device default, and the
    // other ruleset still offers the explicit action that would change it.
    await page.goto(APP_ROOT);
    await openSettings(page);
    await page.getByRole("button", { name: "Rulesets" }).click();
    const acceptanceCard = page.locator(".m2-card").filter({ hasText: "Emberline acceptance slice" });
    await expect(acceptanceCard.getByText("Active", { exact: true })).toBeVisible();
    const syntheticCard = page.locator(".m2-card").filter({ hasText: "Runefolio 2024 synthetic" });
    await expect(syntheticCard.getByText("Installed", { exact: true })).toBeVisible();
    await expect(
      syntheticCard.getByRole("button", { name: "Use this ruleset for new characters" }),
    ).toBeVisible();

    // And a genuinely new build still starts in the default, not in the one the
    // previous draft was moved to.
    await page.goto(APP_ROOT);
    await startBuild(page, "Unaffected");
    await expect(page.getByRole("button", { name: /^Emberline acceptance slice/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

/* -------------------------------------------------------------------------- */

test.describe("a pack is imported from a real file", () => {
  test("installs through the file input, not only the pasted textarea", async ({ page }) => {
    await page.goto(APP_ROOT);
    await openSettings(page);
    await page.getByRole("button", { name: "Imports and exports" }).click();

    // The real control a user reaches for: a file chosen from the device.
    await page.getByLabel("Choose JSON file").setInputFiles({
      name: "emberline-acceptance.json",
      mimeType: "application/json",
      buffer: Buffer.from(acceptancePackJson(), "utf8"),
    });

    await page.getByRole("button", { name: "Preview import" }).click();
    await expect(page.getByRole("heading", { name: "Ready to import" })).toBeVisible();
    await page
      .getByLabel("Create a ruleset profile so this content can be selected in the builder")
      .check();
    await page.getByRole("button", { name: "Confirm atomic import" }).click();
    await expect(page.getByText(/Import completed atomically/)).toBeVisible();

    // The file's content is genuinely installed and reachable in the builder.
    await startBuild(page, "From File");
    await expect(page.getByRole("button", { name: /^Emberline acceptance slice/ })).toBeVisible();
    await next(page);
    await expect(page.getByRole("button", { name: /^Beaconkeeper/ })).toBeVisible();
  });
});

/* -------------------------------------------------------------------------- */

test.describe("the first step is accessible in either colour preference", () => {
  for (const colorScheme of ["light", "dark"] as const) {
    test(`axe reports no serious or critical violation under a ${colorScheme} preference`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await importAcceptancePack(page);
      await startBuild(page, `Scheme ${colorScheme}`);

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      const blocking = results.violations.filter(violation =>
        ["serious", "critical"].includes(violation.impact ?? ""),
      );
      expect(blocking.map(violation => violation.id)).toEqual([]);
    });
  }

  test("reaches name then ruleset in that order with the keyboard alone", async ({ page }) => {
    await importAcceptancePack(page);
    await startBuild(page, "Tab Order");

    await page.getByLabel("Character name", { exact: true }).focus();
    // Walk forward and record what each stop actually is, rather than assuming
    // a fixed control count that a layout change would silently invalidate.
    const stops: string[] = [];
    for (let step = 0; step < 20; step += 1) {
      const identity = await page.evaluate(() => {
        const element = document.activeElement as HTMLElement | null;
        if (!element) return "";
        // The accessible name, however this control happens to carry it: a form
        // field labelled by a <label> element exposes nothing on the node itself.
        const labelled = (element as HTMLInputElement).labels?.[0]?.textContent;
        return (
          element.getAttribute("aria-label") ||
          labelled ||
          element.textContent?.trim().slice(0, 60) ||
          element.tagName
        ).trim();
      });
      stops.push(identity);
      await page.keyboard.press("Tab");
    }

    const at = (pattern: RegExp) => stops.findIndex(stop => pattern.test(stop));
    const name = at(/Character name/);
    const ruleset = at(/Emberline acceptance slice/);

    expect(name).toBeGreaterThanOrEqual(0);
    expect(ruleset).toBeGreaterThan(name);
    // The level belongs to the class step, so it is deliberately not reachable
    // from this one — there is nothing here that could validate it.
    expect(at(/Create this character at level/)).toBe(-1);
  });
});

/* -------------------------------------------------------------------------- */

test.describe("the ruleset confirmation is a real modal", () => {
  /** Opens the confirmation from a known initiating control. */
  async function openConfirmation(page: Page) {
    await importAcceptancePack(page);
    await startBuild(page, "Modal Keys");
    const opener = page.getByRole("button", { name: /^Runefolio 2024 synthetic/ });
    await opener.click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    return { dialog, opener };
  }

  /** True when the active element is inside the open dialog. */
  const focusIsInside = (page: Page) =>
    page.evaluate(() => {
      const surface = document.querySelector('[role="alertdialog"]');
      const active = document.activeElement;
      return Boolean(surface && active && surface.contains(active));
    });

  test("keeps focus inside while tabbing forwards", async ({ page }) => {
    const { dialog } = await openConfirmation(page);
    // The safe action holds focus when the dialog opens.
    await expect(dialog.getByRole("button", { name: "Keep current ruleset" })).toBeFocused();

    // Deliberately more presses than the dialog has controls.
    for (let press = 0; press < 12; press += 1) {
      await page.keyboard.press("Tab");
      expect(await focusIsInside(page)).toBe(true);
    }
  });

  test("keeps focus inside while tabbing backwards", async ({ page }) => {
    await openConfirmation(page);
    for (let press = 0; press < 12; press += 1) {
      await page.keyboard.press("Shift+Tab");
      expect(await focusIsInside(page)).toBe(true);
    }
  });

  test("closes on Escape from a control that is not the default, and restores focus", async ({ page }) => {
    const { dialog, opener } = await openConfirmation(page);
    // Move off the default action first: Escape must not depend on where focus is.
    await dialog.getByRole("button", { name: "Switch ruleset" }).focus();
    await expect(dialog.getByRole("button", { name: "Switch ruleset" })).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    // Focus returns to the control that opened it, not to the document body.
    await expect(opener).toBeFocused();
    // And cancelling wrote nothing.
    await expect(page.getByRole("button", { name: /^Emberline acceptance slice/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("does not let a control behind the modal take focus", async ({ page }) => {
    await openConfirmation(page);
    // Every stop is recorded, not just the last one: a trap that leaks on the
    // second press and happens to land back inside on the twelfth still leaks.
    const stops: string[] = [];
    for (let press = 0; press < 12; press += 1) {
      await page.keyboard.press("Tab");
      stops.push(
        await page.evaluate(() => {
          const active = document.activeElement as HTMLElement | null;
          return (active?.getAttribute("aria-label") || active?.textContent?.trim() || active?.tagName || "?").slice(0, 40);
        }),
      );
    }
    const behind = stops.filter(stop => /Continue|Back|All steps|Guided mode|Characters|Compendium|Settings/.test(stop));
    expect(behind).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */

/**
 * Installs the dependent pack and creates its profile through Settings.
 *
 * The dependency is what makes the two profiles overlap: membership is the
 * pack's own entries plus its resolved dependency's, so this profile activates
 * every acceptance entry as well as its own background.
 */
async function installOverlapProfile(page: Page) {
  await page.goto(APP_ROOT);
  await importPack(page, overlapPackJson(), { createRuleset: false });
  await page.getByRole("button", { name: "Back to Settings" }).click();
  await page.getByRole("button", { name: "Rulesets" }).click();
  const offer = page.locator(".m2-card").filter({ hasText: "Emberline overlap addition" });
  await expect(offer).toBeVisible();
  await offer.getByRole("button", { name: "Create its ruleset" }).click();
  await expect(
    page.locator(".m2-card").filter({ hasText: "Emberline overlap addition" }).getByText("Installed", { exact: true }),
  ).toBeVisible();
}

test.describe("switching between rulesets that share content", () => {
  test("keeps everything the incoming ruleset still resolves", async ({ page }) => {
    await importAcceptancePack(page);
    await installOverlapProfile(page);

    // A complete level 5 build: class, subclass, origin, background, a parent
    // choice, the nested choice it activates, equipment, and origin increases.
    await buildLevelFive(page, "Shared Content");

    await page.getByRole("button", { name: "All steps" }).click();
    await page.getByRole("button", { name: /Basics/ }).click();
    await page.getByRole("button", { name: /^Emberline overlap addition/ }).click();

    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();

    // Everything the incoming ruleset still resolves is reported as kept.
    const kept = dialog.locator("h4", { hasText: "This is kept" });
    await expect(kept).toBeVisible();
    for (const label of [
      /Class: Beaconkeeper/,
      /Subclass: Kindled Watch/,
      /Origin species: Cairnfolk/,
      /Background: Ferry Clerk/,
    ])
      await expect(dialog.getByText(label)).toBeVisible();

    // And nothing at all is cleared, because nothing became invalid.
    await expect(dialog.locator("h4", { hasText: "This will be cleared" })).toHaveCount(0);
    await expect(dialog.getByText(/Nothing in this build belongs to the current ruleset/)).toBeVisible();

    await dialog.getByRole("button", { name: "Switch ruleset" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Emberline overlap addition/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    /*
     * Nothing became invalid, so there is no repair to land on and the user is
     * left exactly where they were rather than being moved for no reason.
     */
    await expect(page.getByLabel("Character name", { exact: true })).toHaveValue("Shared Content");
    await page.getByRole("button", { name: "All steps" }).click();
    await page.getByRole("button", { name: /Class & level/ }).click();
    await expect(levelSelect(page)).toHaveValue("5");

    const stillChosen = async () => {
      await page.getByRole("button", { name: "All steps" }).click();
      await page.getByRole("button", { name: /^Class & level (Incomplete|Complete)$/ }).click();
      await expect(page.getByRole("button", { name: /^Beaconkeeper/ })).toHaveAttribute("aria-pressed", "true");
      await page.getByRole("button", { name: "All steps" }).click();
      await page.getByRole("button", { name: /^Origin (Incomplete|Complete)$/ }).click();
      await expect(page.getByRole("button", { name: /^Cairnfolk/ })).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("button", { name: /^Ferry Clerk/ })).toHaveAttribute("aria-pressed", "true");
      // The parent choice and the nested choice it activates both survive.
      await page.getByRole("button", { name: "All steps" }).click();
      await page.getByRole("button", { name: /^Class choices (Incomplete|Complete)$/ }).click();
      await expect(page.getByRole("button", { name: /^Attentive Clerk/ })).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("button", { name: /^Signal lamp/ })).toHaveAttribute("aria-pressed", "true");
      // Equipment too.
      await page.getByRole("button", { name: "All steps" }).click();
      await page.getByRole("button", { name: /^Equipment (Incomplete|Complete)$/ }).click();
      await expect(page.getByRole("button", { name: /^Ledger case/ })).toHaveAttribute("aria-pressed", "true");
    };

    await stillChosen();

    // Review agrees, and the build is still committable.
    await page.getByRole("button", { name: "All steps" }).click();
    await page.getByRole("button", { name: /^Review/ }).click();
    await expect(page.getByText("This level cannot be created")).toHaveCount(0);

    // And a reload sees exactly the same thing: the write matched the preview.
    await page.reload();
    await page.getByRole("button", { name: "Characters", exact: true }).click();
    await page.getByRole("button", { name: /Shared Content/ }).first().click();
    await stillChosen();
  });
});

/* -------------------------------------------------------------------------- */

test.describe("a switch that strands the target level says so", () => {
  test("names the conflict, keeps the draft open, and blocks the commit until it is repaired", async ({ page }) => {
    await importAcceptancePack(page);
    await buildLevelFive(page, "Stranded Level");

    await page.getByRole("button", { name: "All steps" }).click();
    await page.getByRole("button", { name: /Basics/ }).click();
    // The built-in synthetic ruleset's content stops well short of level 5.
    await page.getByRole("button", { name: /^Runefolio 2024 synthetic/ }).click();

    const dialog = page.getByRole("alertdialog");
    await expect(dialog.locator("h4", { hasText: "This will need repairing" })).toBeVisible();
    const conflict = dialog.getByText(/Target level 5 is beyond the level this content reaches/);
    await expect(conflict).toBeVisible();
    // It states the repair rather than promising to silently lower the level.
    await expect(conflict).toContainText(/Choose a supported level or a class that covers it/);
    await expect(dialog.getByText(/level will be (lowered|reduced|set) automatically/i)).toHaveCount(0);

    await dialog.getByRole("button", { name: "Switch ruleset" }).click();
    await expect(dialog).toHaveCount(0);

    /*
     * The confirmation lands on the first step that needs repairing rather than
     * leaving the user on a screen with nothing wrong on it. The switch cleared
     * the class, so that is Class & level.
     */
    await expect(page.getByRole("heading", { name: "Class & level", level: 2 })).toBeVisible();

    /*
     * The stranded level is not asserted yet, and that is the honest position:
     * coverage is a property of a class, and the switch cleared the class. The
     * level the user chose is still held — it is not rewritten to something they
     * never picked — but nothing can judge it until a class exists again.
     */
    await page.getByRole("button", { name: /^Vanguard/ }).click();

    // Now it can be judged, and it is — on this step, with the repair beside it.
    const stranded = page.getByRole("alert").filter({ hasText: /does not reach the chosen level/ });
    await expect(stranded).toBeVisible();
    await expect(stranded).toContainText("This build is set to level 5");
    // The stored level stays visible and unselectable rather than being quietly
    // rewritten to something the user never chose.
    await expect(levelSelect(page).locator("option[disabled]")).toHaveText("5 — not supported");

    // The commit stays blocked while the conflict stands: Review is still on
    // screen afterwards, so nothing was created.
    await page.getByRole("button", { name: "All steps" }).click();
    await page.getByRole("button", { name: /^Review/ }).click();
    await page.getByRole("button", { name: "Finish and open sheet" }).click();
    await expect(page.getByRole("heading", { name: "Review", level: 3 })).toBeVisible();

    // Choosing a level the incoming content supports resolves it.
    await page.getByRole("button", { name: "All steps" }).click();
    await page.getByRole("button", { name: /Class & level/ }).click();
    await levelSelect(page).selectOption("1");
    await expect(page.getByText(/does not reach the chosen level/)).toHaveCount(0);
    await expect(levelSelect(page).locator("option[disabled]")).toHaveCount(0);
  });
});
