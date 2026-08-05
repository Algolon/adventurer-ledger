/**
 * The three engine-correctness contracts, through the product.
 *
 * Import the engine-correctness pack, then prove in the browser what the unit
 * regressions prove in the engine: hit points that apply Constitution once per
 * level, an armour-dependent bonus that actually activates, and one subclass
 * decision presented once whether it is reached directly or by levelling.
 *
 * The pack is original synthetic content written for these tests.
 */
import { expect, test, type Page } from "@playwright/test";
import { tidewatchPackJson } from "@/tests/fixtures/engine-correctness-ruleset";

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

async function importEnginePack(page: Page) {
  await page.goto(APP_ROOT);
  await openSettings(page);
  await page.getByRole("button", { name: "Imports and exports" }).click();
  await page.getByLabel("Pack JSON").fill(tidewatchPackJson());
  await page.getByRole("button", { name: "Preview import" }).click();
  await expect(page.getByRole("heading", { name: "Ready to import" })).toBeVisible();
  await page
    .getByLabel("Create a ruleset profile so this content can be selected in the builder")
    .check();
  await page.getByRole("button", { name: "Confirm atomic import" }).click();
  await expect(page.getByText(/ruleset profile\(s\) created and ready to select/)).toBeVisible();
}

/** Opens the builder against the imported ruleset at the requested level. */
async function startBuild(page: Page, name: string, level: string) {
  await page.getByRole("button", { name: "Characters", exact: true }).click();
  await page.getByRole("button", { name: "New character" }).last().click();
  await expect(page.getByText(/^Step 1 of/)).toBeVisible();
  await expect(page.getByRole("button", { name: /^Tidewatch engine-correctness slice/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByLabel("Character name", { exact: true }).fill(name);
  await page.getByLabel("Create this character at level").selectOption(level);
  await next(page);
}

/** Standard array plus the origin's +2/+1, landing on Constitution 14. */
async function fillAbilities(page: Page) {
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
  await expect(page.getByLabel("Constitution final")).toContainText("14");
}

async function chooseOrigin(page: Page) {
  await page.getByRole("button", { name: /^Shoalfolk/ }).click();
  await page.getByRole("button", { name: /^Harbour Hand/ }).click();
}

/** Opens a committed character from the library by its own card. */
async function openCommitted(page: Page, name: string) {
  await page.getByRole("button", { name: "Characters", exact: true }).click();
  await page.getByRole("button", { name: new RegExp(`Open ${name}, active sheet`) }).click();
}

test.describe("hit points and armour resolve from content", () => {
  test("a level 5 build reaches 44 hit points and an armour-dependent 17 armour class", async ({ page }) => {
    await importEnginePack(page);
    await startBuild(page, "Perrin Sallow", "5");

    await page.getByRole("button", { name: /^Bulwark/ }).click();
    await next(page);
    await chooseOrigin(page);
    await next(page);
    await fillAbilities(page);
    await next(page);

    // One subclass surface, and the ordinary class choice beside it.
    await expect(page.getByRole("group", { name: /Subclass/ })).toHaveCount(1);
    await page.getByRole("button", { name: /^Standing Hold/ }).click();
    await page.getByRole("button", { name: /^Rigging/ }).click();
    await next(page);

    // Wear the body armour rather than the shield or the rope.
    await page.getByRole("button", { name: /^Wear the coat/ }).click();
    await next(page);
    await next(page); // identity

    await expect(page.getByRole("definition").filter({ hasText: "Level 5" })).toBeVisible();
    await page.getByRole("button", { name: "Finish and open sheet" }).click();

    /*
     * Class base 34 at level 5 plus the Constitution modifier on each of the
     * five levels is 44. The defective engine applied the modifier once and
     * showed 36.
     */
    await expect(page.getByText("44 / 44")).toBeVisible();
    // Armour class 16, plus the +1 the level 1 feature contributes while armour
    // is worn. That bonus could never apply while the context said no armour.
    await expect(page.getByRole("button", { name: /Explain Armour class, 17/ })).toBeVisible();
    await page.getByRole("button", { name: /Explain Armour class/ }).click();
    const dialog = page.getByRole("dialog", { name: "Armour class" });
    await expect(dialog.getByText("Plated coat")).toBeVisible();
    await expect(dialog.getByText("Feature bonus")).toBeVisible();
    await page.keyboard.press("Escape");

    // Reopening resolves from content again and reaches the same two numbers.
    await page.reload();
    await openCommitted(page, "Perrin Sallow");
    await expect(page.getByText("44 / 44")).toBeVisible();
    await expect(page.getByRole("button", { name: /Explain Armour class, 17/ })).toBeVisible();
  });
});

test.describe("a redundantly declared subclass is one decision", () => {
  test("direct creation at level 5 presents it once and persists it", async ({ page }) => {
    await importEnginePack(page);
    await startBuild(page, "Mirror Direct", "5");

    await page.getByRole("button", { name: /^Mirrored Tide/ }).click();
    await next(page);
    await chooseOrigin(page);
    await next(page);
    await fillAbilities(page);
    await next(page);

    /*
     * The pack declares this decision twice: as the class's typed subclasses and
     * again as a generic "Mirrored path" choice over the same two entries. Only
     * the typed surface is presented, and answering it clears the requirement.
     */
    await expect(page.getByRole("group", { name: /Subclass/ })).toHaveCount(1);
    await expect(page.getByRole("group", { name: /Mirrored path/ })).toHaveCount(0);
    await page.getByRole("button", { name: /^Flood/ }).click();
    await next(page);
    await page.getByRole("button", { name: /^Wear the coat/ }).click();
    await next(page);
    await next(page); // identity

    await expect(page.getByRole("definition").filter({ hasText: "Flood" })).toHaveCount(1);
    await page.getByRole("button", { name: "Finish and open sheet" }).click();
    await expect(page.getByText("Mirrored Tide 5 (Flood)")).toBeVisible();

    await page.reload();
    await openCommitted(page, "Mirror Direct");
    await expect(page.getByText("Mirrored Tide 5 (Flood)")).toBeVisible();
  });

  test("levelling into it presents it once and blocks confirmation until it is answered", async ({ page }) => {
    await importEnginePack(page);
    await startBuild(page, "Mirror Climb", "2");

    await page.getByRole("button", { name: /^Mirrored Tide/ }).click();
    await next(page);
    await chooseOrigin(page);
    await next(page);
    await fillAbilities(page);
    await next(page);
    // Level 2 is below the subclass level, so nothing is asked for yet.
    await expect(page.getByRole("group", { name: /Mirrored path/ })).toHaveCount(0);
    await next(page);
    await page.getByRole("button", { name: /^Wear the coat/ }).click();
    await next(page);
    await next(page); // identity
    await page.getByRole("button", { name: "Finish and open sheet" }).click();
    await expect(page.getByText("Mirrored Tide 2")).toBeVisible();

    await page.getByRole("button", { name: "Level up" }).click();
    const dialog = page.getByRole("dialog", { name: "Level 2 to 3" });
    await expect(dialog).toBeVisible();
    // One subclass surface in the level-up dialog too, and no duplicate choice.
    await expect(dialog.getByRole("heading", { name: "Subclass" })).toHaveCount(1);
    await expect(dialog.getByText("Mirrored path")).toHaveCount(0);
    const confirm = dialog.getByRole("button", { name: "Confirm level 3" });
    await expect(confirm).toBeDisabled();

    await dialog.getByRole("button", { name: /^Ebb/ }).click();
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(page.getByText("Mirrored Tide 3 (Ebb)")).toBeVisible();

    await page.reload();
    await openCommitted(page, "Mirror Climb");
    await expect(page.getByText("Mirrored Tide 3 (Ebb)")).toBeVisible();
  });
});
