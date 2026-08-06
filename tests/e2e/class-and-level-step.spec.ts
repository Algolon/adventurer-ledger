import { expect, test, type Page } from "@playwright/test";
import { acceptancePackJson } from "@/tests/fixtures/acceptance-ruleset";

/**
 * The starting level belongs to the class step.
 *
 * A pilot review found the first step accepting a level it could not judge:
 * coverage comes from the selected class's progression, which does not exist
 * until two steps later. Basics reported itself complete, the user moved on, and
 * choosing a class then marked Basics incomplete for a decision taken after
 * leaving it — with the only repair control on the screen they had left.
 *
 * These specs pin the corrected ownership: Basics holds the name and the
 * ruleset, Class & level holds the class and then the level, and the level's
 * range and every repair for it stay on that one step. The pack is original
 * synthetic content written for these tests; it holds a class that runs to
 * level 5 and another that stops at 3.
 */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const APP_ROOT = `${BASE_PATH}/`;

const next = (page: Page) => page.getByRole("button", { name: "Continue" }).click();
const levelSelect = (page: Page) => page.getByLabel("Create this character at level");
const stepTitle = (page: Page) => page.locator(".m2-builder-head h2");

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

async function importAcceptancePack(page: Page) {
  await page.goto(APP_ROOT);
  await openSettings(page);
  await page.getByRole("button", { name: "Imports and exports" }).click();
  await page.getByLabel("Pack JSON").fill(acceptancePackJson());
  await page.getByRole("button", { name: "Preview import" }).click();
  await expect(page.getByRole("heading", { name: "Ready to import" })).toBeVisible();
  await page.getByLabel("Create a ruleset profile so this content can be selected in the builder").check();
  await page.getByRole("button", { name: "Confirm atomic import" }).click();
  await expect(page.getByText(/ruleset profile\(s\) created and ready to select/)).toBeVisible();
}

async function newCharacter(page: Page) {
  await page.getByRole("button", { name: "Characters", exact: true }).click();
  await page.getByRole("button", { name: "New character" }).last().click();
  await expect(page.getByText(/^Step 1 of/)).toBeVisible();
}

test.describe("the level is chosen where it can be validated", () => {
  test("survives Continue, Back, reload and a resume with the class intact", async ({ page }) => {
    await importAcceptancePack(page);
    await newCharacter(page);

    // ---- 1. Basics: name and ruleset, and nothing that needs a class -------
    await expect(stepTitle(page)).toHaveText("Basics");
    await page.getByLabel("Character name", { exact: true }).fill("Level Owner");
    await expect(page.getByRole("button", { name: /^Emberline acceptance slice/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(levelSelect(page)).toHaveCount(0);

    // ---- 2. Continue reaches Class & level --------------------------------
    await next(page);
    await expect(stepTitle(page)).toHaveText("Class & level");
    await expect(page.getByText(/^Step 2 of/)).toBeVisible();
    // Still nothing to set the level against.
    await expect(levelSelect(page)).toHaveCount(0);

    // ---- 3 & 4. Class first, then the level its progression justifies ------
    await page.getByRole("button", { name: /^Beaconkeeper/ }).click();
    await expect(levelSelect(page).locator("option")).toHaveText(["1", "2", "3", "4", "5"]);
    await levelSelect(page).selectOption("5");

    /*
     * Selecting the level does not move the user. The old flow could mark the
     * first step incomplete at this moment, which is what produced the reported
     * bounce back to Basics.
     */
    await expect(stepTitle(page)).toHaveText("Class & level");
    await page.getByRole("button", { name: "All steps" }).click();
    await expect(page.getByRole("button", { name: /^Basics Complete$/ })).toBeVisible();
    await page.getByRole("button", { name: /Class & level/ }).click();

    // ---- 5. Continue goes forward, never backward -------------------------
    await next(page);
    await expect(stepTitle(page)).toHaveText("Origin");

    // ---- 6. Back and forward again preserve both decisions ----------------
    await page.getByRole("button", { name: "Back" }).click();
    await expect(stepTitle(page)).toHaveText("Class & level");
    await expect(page.getByRole("button", { name: /^Beaconkeeper/ })).toHaveAttribute("aria-pressed", "true");
    await expect(levelSelect(page)).toHaveValue("5");
    await next(page);
    await expect(stepTitle(page)).toHaveText("Origin");

    // ---- 7 & 8. Reload, then resume from the library ----------------------
    await page.reload();
    await page.getByRole("button", { name: "Characters", exact: true }).click();
    await page.getByRole("button", { name: /Resume building/ }).click();

    // ---- 9. The class and the level are exactly as they were --------------
    await page.getByRole("button", { name: "All steps" }).click();
    await page.getByRole("button", { name: /Class & level/ }).click();
    await expect(page.getByRole("button", { name: /^Beaconkeeper/ })).toHaveAttribute("aria-pressed", "true");
    await expect(levelSelect(page)).toHaveValue("5");
    // And Review reports both, so the commit is made against what is on screen.
    await page.getByRole("button", { name: "All steps" }).click();
    await page.getByRole("button", { name: /^Review/ }).click();
    await expect(page.getByRole("definition").filter({ hasText: "Beaconkeeper" })).toBeVisible();
    await expect(page.getByRole("definition").filter({ hasText: "Level 5" })).toBeVisible();
  });

  test("offers a short class only the levels it actually describes", async ({ page }) => {
    await importAcceptancePack(page);
    await newCharacter(page);
    await next(page);

    // Lamplighter's progression runs 1 to 3. The ruleset reaches 5 through
    // another class, and that must not widen this selector.
    await page.getByRole("button", { name: /^Lamplighter/ }).click();
    await expect(levelSelect(page).locator("option")).toHaveText(["1", "2", "3"]);
    await levelSelect(page).selectOption("3");
    await expect(page.getByText(/does not reach the chosen level/)).toHaveCount(0);

    // Continue is honest: it moves forward rather than bouncing back.
    await next(page);
    await expect(stepTitle(page)).toHaveText("Origin");
  });

  test("repairs an incompatible class switch on the step that caused it", async ({ page }) => {
    await importAcceptancePack(page);
    await newCharacter(page);
    await page.getByLabel("Character name", { exact: true }).fill("Downgrade");
    await next(page);

    await page.getByRole("button", { name: /^Beaconkeeper/ }).click();
    await levelSelect(page).selectOption("5");

    // Switching to the class that stops at 3 strands the chosen level.
    await page.getByRole("button", { name: /^Lamplighter/ }).click();

    /*
     * Three things must all hold, and each was broken before this pass: the user
     * is not moved, the level they chose is not silently rewritten, and the step
     * that owns the conflict is the one reported as incomplete.
     */
    await expect(stepTitle(page)).toHaveText("Class & level");
    await expect(levelSelect(page).locator("option[disabled]")).toHaveText("5 — not supported");
    const repair = page.getByRole("alert").filter({ hasText: /does not reach the chosen level/ });
    await expect(repair).toBeVisible();
    await expect(repair).toContainText("This class stops at level 3");

    await page.getByRole("button", { name: "All steps" }).click();
    await expect(page.getByRole("button", { name: /^Basics Complete$/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Class & level Incomplete$/ })).toBeVisible();
    await page.getByRole("button", { name: /Class & level/ }).click();

    // Guided mode refuses to advance past it, and says why, without moving.
    await next(page);
    await expect(stepTitle(page)).toHaveText("Class & level");
    await expect(page.getByRole("alert").filter({ hasText: /issue/ })).toBeVisible();

    // The repair is offered here and resolves it here.
    await page.getByRole("button", { name: /^Set the level to 3$/ }).click();
    await expect(page.getByText(/does not reach the chosen level/)).toHaveCount(0);
    await expect(levelSelect(page)).toHaveValue("3");
    await next(page);
    await expect(stepTitle(page)).toHaveText("Origin");
  });

  test("keeps a level the incoming class still covers", async ({ page }) => {
    await importAcceptancePack(page);
    await newCharacter(page);
    await next(page);

    await page.getByRole("button", { name: /^Beaconkeeper/ }).click();
    await levelSelect(page).selectOption("2");
    // Lamplighter also describes level 2, so the choice stands untouched.
    await page.getByRole("button", { name: /^Lamplighter/ }).click();
    await expect(levelSelect(page)).toHaveValue("2");
    await expect(page.getByText(/does not reach the chosen level/)).toHaveCount(0);
  });
});
