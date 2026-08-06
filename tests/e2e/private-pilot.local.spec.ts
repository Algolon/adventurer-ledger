import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

/**
 * A bounded local smoke against the private pilot pack.
 *
 * Skipped unless `ADVENTURER_LEDGER_PRIVATE_PACK` names a pack on this device,
 * so CI and every other checkout are unaffected. It exists because the public
 * fixtures are small and deliberate, and a 200-entry real pack exercises
 * quantities and shapes they do not.
 *
 * Nothing here names private content. Classes are chosen by position and by
 * whether their progression reaches the target level, never by name, and no
 * assertion quotes an entry — so a failure report says which contract broke
 * without reproducing any of the material.
 */
const packPath = process.env.ADVENTURER_LEDGER_PRIVATE_PACK;
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const APP_ROOT = `${BASE_PATH}/`;

const next = (page: Page) => page.getByRole("button", { name: "Continue" }).click();
const stepTitle = (page: Page) => page.locator(".m2-builder-head h2");
const levelSelect = (page: Page) => page.getByLabel("Create this character at level");

test.skip(!packPath, "ADVENTURER_LEDGER_PRIVATE_PACK is not set");

const packJson = () => readFileSync(packPath as string, "utf8");

/** The same pack at a higher version and entry revision, built in memory. */
function bumpedPackJson(version: string, revisionOffset: number): string {
  const document = JSON.parse(packJson()) as {
    pack: { version: string };
    entries: { revision: number }[];
  };
  document.pack.version = version;
  document.entries = document.entries.map(entry => ({
    ...entry,
    revision: entry.revision + revisionOffset,
  }));
  return JSON.stringify(document);
}

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
 * Loads a pack through the file input rather than the textarea.
 *
 * This is the route a user takes with a real pack, and the only workable one
 * here: typing 400 kB into a controlled textarea dispatches an input event per
 * chunk and re-renders the panel each time, which takes minutes.
 */
async function previewPack(page: Page, json: string, filename = "pack.json") {
  await page.getByLabel("Choose JSON file").setInputFiles({
    name: filename,
    mimeType: "application/json",
    buffer: Buffer.from(json, "utf8"),
  });
  await page.getByRole("button", { name: "Preview import" }).click();
  await expect(page.getByLabel("Import preview")).toBeVisible({ timeout: 60_000 });
}

async function installPack(page: Page, json: string) {
  await previewPack(page, json);
  await expect(page.getByRole("heading", { name: /^Ready to (import|update)$/ })).toBeVisible();
  const offer = page.getByLabel("Create a ruleset profile so this content can be selected in the builder");
  if (await offer.count()) await offer.check();
  await page.getByRole("button", { name: "Confirm atomic import" }).click();
  await expect(page.getByText(/Import completed atomically/)).toBeVisible({ timeout: 60_000 });
}

/**
 * Picks the first class whose own progression reaches the target level.
 *
 * A real pack holds classes with different coverage, and which ones reach a
 * given level is a property of the content rather than something this spec
 * should assert. Trying them in order keeps it honest and keeps every private
 * name out of the source.
 */
async function chooseClassReaching(page: Page, level: string): Promise<boolean> {
  const classGroup = page.getByRole("group", { name: "Class" });
  const options = classGroup.getByRole("button");
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

test.describe("private pilot pack, fresh origin", () => {
  test("imports without conflict and builds through Class & level at 5", async ({ page }) => {
    test.setTimeout(300_000);
    await page.goto(APP_ROOT);
    await openImports(page);

    // ---- import reports no version or revision conflict --------------------
    await previewPack(page, packJson());
    await expect(page.getByRole("heading", { name: "Ready to import" })).toBeVisible();
    await expect(page.getByText("PACK_VERSION_CONFLICT")).toHaveCount(0);
    await expect(page.getByText("ENTRY_REVISION_CONFLICT")).toHaveCount(0);

    const offer = page.getByLabel("Create a ruleset profile so this content can be selected in the builder");
    await offer.check();
    await page.getByRole("button", { name: "Confirm atomic import" }).click();
    await expect(page.getByText(/Import completed atomically/)).toBeVisible({ timeout: 300_000 });

    // ---- the ruleset is present immediately, with no reload ----------------
    await page.getByRole("button", { name: "Back to Settings" }).click();
    await page.getByRole("button", { name: "Rulesets" }).click();
    await expect(page.getByText(/creation levels 1 to 5/)).toBeVisible({ timeout: 120_000 });

    // ---- Basics ------------------------------------------------------------
    await page.getByRole("button", { name: "Characters", exact: true }).click();
    await page.getByRole("button", { name: "New character" }).last().click();
    await expect(stepTitle(page)).toHaveText("Basics");
    await page.getByLabel("Character name", { exact: true }).fill("Pilot Smoke");
    await next(page);

    // ---- Class & level at 5 ------------------------------------------------
    await expect(stepTitle(page)).toHaveText("Class & level", { timeout: 120_000 });
    expect(await chooseClassReaching(page, "5")).toBe(true);
    await expect(levelSelect(page)).toHaveValue("5");
    // Choosing the level does not move the user.
    await expect(stepTitle(page)).toHaveText("Class & level");

    // ---- the next step is reached, with no redirect back -------------------
    await next(page);
    await expect(stepTitle(page)).not.toHaveText("Basics");
    await expect(stepTitle(page)).not.toHaveText("Class & level");
    await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();
    const landed = await stepTitle(page).textContent();

    // ---- close and resume --------------------------------------------------
    await page.getByRole("button", { name: "Characters", exact: true }).click();
    await page.getByRole("button", { name: /Resume building/ }).click({ timeout: 300_000 });
    await expect(stepTitle(page)).toHaveText(landed ?? "", { timeout: 120_000 });

    // ---- reload and continue -----------------------------------------------
    await page.reload();
    await page.getByRole("button", { name: "Characters", exact: true }).click();
    await page.getByRole("button", { name: /Resume building/ }).click({ timeout: 300_000 });
    await expect(stepTitle(page)).toHaveText(landed ?? "", { timeout: 120_000 });

    // Class and level survived all of it.
    await page.getByRole("button", { name: "All steps" }).click();
    await page.getByRole("button", { name: /Class & level/ }).click();
    await expect(levelSelect(page)).toHaveValue("5");
  });
});

test.describe("private pilot pack, origin holding a newer revision", () => {
  test("refuses the older import and says the newer install stays usable", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto(APP_ROOT);
    await openImports(page);

    // A newer scratch revision is installed first, built in memory. The pack
    // file on disk is never written to.
    await installPack(page, bumpedPackJson("9.9.9", 100));

    // The pilot version is then offered, and refused.
    await previewPack(page, packJson());
    await expect(
      page.getByRole("heading", { name: "Not imported: a newer version is already installed" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirm atomic import" })).toBeDisabled();

    // The refusal says the installed content is kept and stays usable...
    await expect(page.getByText(/newer installed content is kept and stays usable/)).toBeVisible();

    // ...and the existing ruleset is offered as the thing to use instead.
    const useExisting = page.getByRole("button", { name: /^Use / });
    await expect(useExisting).toBeVisible();
    await useExisting.click();
    await expect(page.getByText(/Nothing was imported/)).toBeVisible();

    // It really is selectable in the builder.
    await page.getByRole("button", { name: "Characters", exact: true }).click();
    await page.getByRole("button", { name: "New character" }).last().click();
    await expect(stepTitle(page)).toHaveText("Basics");
    await expect(page.getByRole("group", { name: "Ruleset" }).getByRole("button", { name: /./ }).first()).toBeVisible();
    await next(page);
    await expect(stepTitle(page)).toHaveText("Class & level");
    await expect(page.getByRole("group", { name: "Class" }).getByRole("button").first()).toBeVisible();
  });
});
