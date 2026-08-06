import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

/**
 * The phone-pilot smoke, against the private pilot pack.
 *
 * Skipped unless `ADVENTURER_LEDGER_PRIVATE_PACK` names a pack on this device,
 * so CI and every other checkout are unaffected. This is browser emulation at
 * phone widths, not a physical device: it establishes that the production Pages
 * build can be driven end to end on a phone-sized viewport with real content,
 * and nothing more. Install, offline and storage behaviour on an actual handset
 * remain unverified.
 *
 * Nothing here names private content. The class is chosen by position and by
 * whether its progression reaches the target level, and no assertion quotes an
 * entry, so a failure report says which contract broke without reproducing any
 * of the material.
 */
const packPath = process.env.ADVENTURER_LEDGER_PRIVATE_PACK;
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const APP_ROOT = `${BASE_PATH}/`;

/**
 * The narrowest and widest common Android widths.
 *
 * Two rather than the full matrix, because each run imports a 400 kB pack into
 * a fresh origin and that is the expensive part. The intermediate widths are
 * covered against synthetic content in `mobile-task-navigation.spec.ts`, which
 * asserts the same reachability and overflow contracts in seconds; this spec
 * exists to put a real pack through the same journey at both extremes.
 */
const PHONE_WIDTHS = [360, 412] as const;

const stepTitle = (page: Page) => page.locator(".m2-builder-head h2");
const levelSelect = (page: Page) => page.getByLabel("Create this character at level");

test.skip(!packPath, "ADVENTURER_LEDGER_PRIVATE_PACK is not set");

const packJson = () => readFileSync(packPath as string, "utf8");

async function openImports(page: Page) {
  const candidates = page.getByRole("button", { name: /^(Open Settings|Settings)$/ });
  const total = await candidates.count();
  for (let index = 0; index < total; index += 1) {
    const candidate = candidates.nth(index);
    if (await candidate.isVisible()) {
      await candidate.click();
      break;
    }
  }
  await page.getByRole("button", { name: "Imports and exports" }).click();
}

/**
 * Loads the pack through the file input, which is the route a user takes with a
 * real pack — and the only workable one, since typing 400 kB into a controlled
 * textarea re-renders the panel per chunk.
 */
async function importPrivatePack(page: Page) {
  await page.getByLabel("Choose JSON file").setInputFiles({
    name: "pack.json",
    mimeType: "application/json",
    buffer: Buffer.from(packJson(), "utf8"),
  });
  await page.getByRole("button", { name: "Preview import" }).click();
  await expect(page.getByRole("heading", { name: "Ready to import" })).toBeVisible({ timeout: 120_000 });
  await page.getByLabel("Create a ruleset profile so this content can be selected in the builder").check();
  await page.getByRole("button", { name: "Confirm atomic import" }).click();
  await expect(page.getByText(/Import completed atomically/)).toBeVisible({ timeout: 300_000 });
}

/** Any primary navigation control that is on screen but cannot be pressed. */
async function blockedNavControls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const rail = document.querySelector(".m2-rail");
    if (!rail || getComputedStyle(rail).display === "none") return [];
    const blocked: string[] = [];
    for (const button of rail.querySelectorAll("button")) {
      const rect = button.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const hit = document.elementFromPoint(
        Math.round(rect.left + rect.width / 2),
        Math.round(rect.top + rect.height / 2),
      );
      if (!(hit && (button.contains(hit) || hit === button)))
        blocked.push(button.textContent?.trim() ?? "(unlabelled)");
    }
    return blocked;
  });
}

const noSidewaysScroll = async (page: Page) => {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth);
};

/** Picks the first class whose own progression reaches the target level. */
async function chooseClassReaching(page: Page, level: string): Promise<boolean> {
  const options = page.getByRole("group", { name: "Class" }).getByRole("button");
  const total = await options.count();
  for (let index = 0; index < total; index += 1) {
    await options.nth(index).click();
    const values = await levelSelect(page).locator("option:not([disabled])").allTextContents();
    if (values.includes(level)) {
      await levelSelect(page).selectOption(level);
      return true;
    }
  }
  return false;
}

for (const width of PHONE_WIDTHS) {
  test.describe(`phone pilot at ${width} px`, () => {
    test.use({ viewport: { width, height: 800 } });

    test("imports the pilot pack and builds, saves, resumes and reloads", async ({ page }) => {
      test.setTimeout(600_000);

      // ---- fresh origin loads ----------------------------------------------
      await page.goto(APP_ROOT);
      await expect(page.getByRole("heading", { name: "No characters on this device yet" })).toBeVisible();
      await noSidewaysScroll(page);

      // ---- private v0.1.2 through the file input ---------------------------
      await openImports(page);
      await importPrivatePack(page);

      // ---- the ruleset is available immediately, with no reload ------------
      await page.getByRole("button", { name: "Back to Settings" }).click();
      await page.getByRole("button", { name: "Rulesets" }).click();
      await expect(page.getByText(/creation levels 1 to 5/)).toBeVisible({ timeout: 120_000 });

      // ---- new character ----------------------------------------------------
      await page.getByRole("button", { name: "Characters", exact: true }).click();
      await page.getByRole("button", { name: "New character" }).last().click();

      // ---- Basics -----------------------------------------------------------
      await expect(stepTitle(page)).toHaveText("Basics");
      expect(await blockedNavControls(page)).toEqual([]);
      await noSidewaysScroll(page);
      await page.getByLabel("Character name", { exact: true }).fill("Phone Pilot");
      await page.getByRole("button", { name: "Continue" }).click();

      // ---- Class & level ----------------------------------------------------
      await expect(stepTitle(page)).toHaveText("Class & level", { timeout: 120_000 });
      expect(await chooseClassReaching(page, "5")).toBe(true);
      await expect(levelSelect(page)).toHaveValue("5");
      expect(await blockedNavControls(page)).toEqual([]);
      await noSidewaysScroll(page);
      await page.getByRole("button", { name: "Continue" }).click();

      /*
       * ---- two further steps ------------------------------------------------
       *
       * Reached through the step list rather than by answering whatever the
       * pack happens to ask. Which options a real pack offers is its own
       * business; what is being smoked here is that the task is navigable and
       * operable on a phone, so the steps are addressed by their canonical
       * identity and no private option is ever clicked or named.
       */
      const second = await stepTitle(page).textContent();
      expect(second).not.toBe("Class & level");
      expect(await blockedNavControls(page)).toEqual([]);
      await noSidewaysScroll(page);

      await page.getByRole("button", { name: "All steps" }).click();
      await page.getByRole("button", { name: /^Abilities/ }).click();
      await expect(stepTitle(page)).toHaveText("Abilities", { timeout: 120_000 });
      expect(await blockedNavControls(page)).toEqual([]);
      await noSidewaysScroll(page);

      // ---- Save & close ------------------------------------------------------
      const saveClose = page.getByRole("button", { name: /^(Save & close|Saving…)$/ });
      await expect(saveClose).toBeVisible();
      await saveClose.click();
      await expect(page.getByText("Unfinished builds")).toBeVisible();

      // ---- resume ------------------------------------------------------------
      await page.getByRole("button", { name: /Resume building Phone Pilot/ }).click();
      await expect(stepTitle(page)).toHaveText("Abilities", { timeout: 120_000 });

      // ---- reload ------------------------------------------------------------
      await page.reload();
      await page.getByRole("button", { name: "Characters", exact: true }).click();
      await page.getByRole("button", { name: /Resume building Phone Pilot/ }).click({ timeout: 120_000 });
      await expect(stepTitle(page)).toHaveText("Abilities", { timeout: 120_000 });

      // Class and level survived import, save, resume and reload.
      await page.getByRole("button", { name: "All steps" }).click();
      await page.getByRole("button", { name: /Class & level/ }).click();
      await expect(levelSelect(page)).toHaveValue("5");
      expect(await blockedNavControls(page)).toEqual([]);
      await noSidewaysScroll(page);
    });
  });
}
