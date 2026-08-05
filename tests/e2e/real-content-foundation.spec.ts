import { expect, test, type Page } from "@playwright/test";
import {
  ACCEPTANCE_ARRAY,
  acceptancePackJson,
} from "@/tests/fixtures/acceptance-ruleset";

/**
 * The whole real-content journey, through the product.
 *
 * Import a pack, turn it into a selectable ruleset, pick it explicitly, and
 * create a level 5 character directly — resolving every choice the five levels
 * reach, including the ones that only exist because something else was chosen.
 * The pack is original synthetic content written for these tests.
 */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const APP_ROOT = `${BASE_PATH}/`;

const next = (page: Page) => page.getByRole("button", { name: "Continue" }).click();

/** Opens Settings from whichever control is showing at this width. */
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

/** Imports the acceptance pack and creates its ruleset in the same confirmation. */
async function importAcceptancePack(page: Page) {
  await page.goto(APP_ROOT);
  await openSettings(page);
  await page.getByRole("button", { name: "Imports and exports" }).click();
  await page.getByLabel("Pack JSON").fill(acceptancePackJson());
  await page.getByRole("button", { name: "Preview import" }).click();
  await expect(page.getByRole("heading", { name: "Ready to import" })).toBeVisible();
  // The offer states what the pack would become before anything is written.
  await expect(page.getByText(/can become the ruleset ruleset:pack:emberline-acceptance/)).toBeVisible();
  await page
    .getByLabel("Create a ruleset profile so this content can be selected in the builder")
    .check();
  await page.getByRole("button", { name: "Confirm atomic import" }).click();
  await expect(page.getByText(/ruleset profile\(s\) created and ready to select/)).toBeVisible();
}

/** Opens the builder in the imported ruleset and targets level 5. */
async function startAtLevelFive(page: Page, name: string) {
  await page.getByRole("button", { name: "Characters", exact: true }).click();
  await page.getByRole("button", { name: "New character" }).last().click();
  await expect(page.getByText(/^Step 1 of/)).toBeVisible();

  // Both installed rulesets are listed on the first step. The imported one is
  // the active selection because creating it was an explicit decision, not
  // because it happens to come first.
  await expect(page.getByRole("button", { name: /^Runefolio 2024 synthetic/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Emberline acceptance slice/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.getByLabel("Character name", { exact: true }).fill(name);
  await expect(page.getByLabel("Create this character at level").locator("option")).toHaveText([
    "1",
    "2",
    "3",
    "4",
    "5",
  ]);
  await page.getByLabel("Create this character at level").selectOption("5");
}

test.describe("an imported pack becomes a selectable ruleset", () => {
  test("imports, creates the profile, and offers it in the builder", async ({ page }) => {
    await importAcceptancePack(page);

    // Settings lists it as installed, with the range its content covers.
    await page.getByRole("button", { name: "Back to Settings" }).click();
    await page.getByRole("button", { name: "Rulesets" }).click();
    await expect(page.getByRole("heading", { name: "Emberline acceptance slice" })).toBeVisible();
    await expect(page.getByText(/creation levels 1 to 5/)).toBeVisible();
    // The pre-existing public synthetic profile is untouched.
    await expect(page.getByRole("heading", { name: "Runefolio 2024 synthetic" })).toBeVisible();
  });

  test("creates a level 5 character directly, resolving every level's choices", async ({ page }) => {
    await importAcceptancePack(page);
    await startAtLevelFive(page, "Wren Halloway");
    await next(page);

    // ---- class ------------------------------------------------------------
    await page.getByRole("button", { name: /^Beaconkeeper/ }).click();
    await next(page);

    // ---- origin, including a choice the species trait declares -------------
    await page.getByRole("button", { name: /^Cairnfolk/ }).click();
    await page.getByRole("button", { name: /^Ferry Clerk/ }).click();
    await expect(page.getByRole("group", { name: /Cairn Sense focus/ })).toBeVisible();
    // Provenance is on screen: the trait asks, not the species.
    await expect(page.getByText("From Cairn Sense")).toBeVisible();
    await page.getByRole("button", { name: /^Cairnlore/ }).click();
    await next(page);

    // ---- abilities: base scores, origin increases, final scores ------------
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
    // Base 15 plus the origin's +2 is shown as the final score, not folded away.
    await expect(page.getByLabel("Strength final")).toContainText("17");
    await expect(page.getByLabel("Wisdom final")).toContainText("11");
    await next(page);

    // ---- class choices: subclass, skills, a feat and the feat's own choice --
    await expect(page.getByRole("group", { name: /Subclass/ })).toBeVisible();
    await page.getByRole("button", { name: /^Kindled Watch/ }).click();

    // The background already grants Signalling, so the class must not spend a
    // selection on it. The option stays visible, explained, and unselectable.
    const signalling = page.getByRole("button", { name: /^Signalling/ });
    await expect(signalling).toBeDisabled();
    await expect(signalling).toContainText("Already granted by Ferry Clerk");
    await page.getByRole("button", { name: /^Ledgerwork/ }).click();
    await page.getByRole("button", { name: /^Stonecraft/ }).click();

    // The subclass brings its own choice with it.
    await expect(page.getByRole("group", { name: /Flare shape/ })).toBeVisible();
    await page.getByRole("button", { name: /^Wide flare/ }).click();

    // A feat chosen at level 4 brings a further choice that did not exist before.
    await expect(page.getByRole("group", { name: /Attentive focus/ })).toHaveCount(0);
    await page.getByRole("button", { name: /^Attentive Clerk/ }).click();
    await expect(page.getByRole("group", { name: /Attentive focus/ })).toBeVisible();
    await page.getByRole("button", { name: /^Signal lamp/ }).click();
    await next(page);

    // ---- equipment: both granting sources, with package contents -----------
    await expect(page.getByRole("heading", { name: "Warden kit" })).toBeVisible();
    await expect(page.getByText("Granted by Beaconkeeper (class)")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Clerk's satchel" })).toBeVisible();
    await expect(page.getByText("Granted by Ferry Clerk (background)")).toBeVisible();
    // What each package holds is legible before it is chosen.
    const ledgerCase = page.getByRole("button", { name: /^Ledger case/ });
    await expect(ledgerCase).toContainText("Ledger case");
    await ledgerCase.click();
    await page.getByRole("button", { name: /^Ink set/ }).click();
    await next(page);

    // ---- identity ----------------------------------------------------------
    await page.getByLabel("Nickname").fill("Wren");
    await next(page);

    // ---- review ------------------------------------------------------------
    await expect(page.getByRole("definition").filter({ hasText: "Level 5" })).toBeVisible();
    await expect(page.getByRole("definition").filter({ hasText: "Kindled Watch" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Proficiencies by source" })).toBeVisible();
    await expect(page.getByText(/Signalling — automatic/)).toBeVisible();
    await expect(page.getByText(/Ledgerwork — chosen in Beaconkeeper skills/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Equipment" })).toBeVisible();

    await page.getByRole("button", { name: "Finish and open sheet" }).click();

    // ---- the resulting sheet ------------------------------------------------
    await expect(page.getByRole("heading", { name: "Wren Halloway", level: 2 })).toBeVisible();
    await expect(page.getByText("Beaconkeeper 5 (Kindled Watch)")).toBeVisible();
    // Level 5 values, reached in one pass: the level 5 proficiency bonus, the
    // level 5 hit-point base plus the Constitution modifier on each of the five
    // levels, and the level 5 resource maximum. A character created at 1 would
    // show none of them.
    await expect(page.getByRole("button", { name: /Explain Proficiency, \+3/ })).toBeVisible();
    await expect(page.getByText("27 / 27")).toBeVisible();
    await expect(page.getByText("Emberlight")).toBeVisible();
    await expect(page.getByText("4 / 4")).toBeVisible();
  });

  test("blocks a level the chosen class does not cover, and says so", async ({ page }) => {
    await importAcceptancePack(page);
    await startAtLevelFive(page, "Overreach");
    await next(page);

    // The second class stops at level 3; the first step names the repair.
    await page.getByRole("button", { name: /^Lamplighter/ }).click();
    await page.getByRole("button", { name: "All steps" }).click();
    await page.getByRole("button", { name: /Name, ruleset and level/ }).click();
    await expect(page.getByText(/does not reach the chosen level/)).toBeVisible();
    await expect(page.getByText(/This class stops at level 3/)).toBeVisible();

    // Lowering the level clears it without touching anything else.
    await page.getByLabel("Create this character at level").selectOption("3");
    await expect(page.getByText(/does not reach the chosen level/)).toHaveCount(0);
  });

  test("switching the ruleset on the first step clears what belonged to the old one", async ({ page }) => {
    await importAcceptancePack(page);
    await startAtLevelFive(page, "Switcher");
    await next(page);
    await page.getByRole("button", { name: /^Beaconkeeper/ }).click();
    await next(page);
    await page.getByRole("button", { name: /^Cairnfolk/ }).click();

    // Back to the first step and across to the other installed ruleset. The
    // switch is a two-phase decision, so selecting it previews the change and
    // the write only happens on an explicit confirmation.
    await page.getByRole("button", { name: "All steps" }).click();
    await page.getByRole("button", { name: /Name, ruleset and level/ }).click();
    await page.getByRole("button", { name: /^Runefolio 2024 synthetic/ }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Switch ruleset" }).click();
    await expect(page.getByRole("button", { name: /^Runefolio 2024 synthetic/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // The class step now offers the other ruleset's content, with nothing
    // carried over from the ruleset that defined the old selection.
    await page.getByRole("button", { name: "All steps" }).click();
    await page.getByRole("button", { name: /^Class (Incomplete|Complete)$/ }).click();
    await expect(page.getByRole("button", { name: /^Vanguard/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Beaconkeeper/ })).toHaveCount(0);
    // The name is not ruleset-scoped, so it survives.
    await page.getByRole("button", { name: "All steps" }).click();
    await page.getByRole("button", { name: /Name, ruleset and level/ }).click();
    await expect(page.getByLabel("Character name", { exact: true })).toHaveValue("Switcher");
  });
});

test.describe("the standard array is the ruleset's own", () => {
  test("offers exactly the imported ruleset's base scores", async ({ page }) => {
    await importAcceptancePack(page);
    await startAtLevelFive(page, "Array check");
    await next(page);
    await page.getByRole("button", { name: /^Beaconkeeper/ }).click();
    await next(page);
    await page.getByRole("button", { name: /^Cairnfolk/ }).click();
    await page.getByRole("button", { name: /^Ferry Clerk/ }).click();
    await page.getByRole("button", { name: /^Cairnlore/ }).click();
    await next(page);

    const chips = page.locator(".m2-remaining-chip");
    await expect(chips).toHaveText(ACCEPTANCE_ARRAY.map(String));
  });
});
