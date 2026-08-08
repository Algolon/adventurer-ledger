import { expect, test, type Page } from "@playwright/test";
import { acceptancePack, acceptancePackWithAddition } from "@/tests/fixtures/acceptance-ruleset";

/**
 * Importing content leaves one unambiguous state, and says which one.
 *
 * A pilot review reported imports "complaining about the ruleset even though the
 * ruleset appears afterwards". Two things produced that: every refusal was
 * headed "Import blocked" over a list of raw issue codes, so re-importing what
 * was already installed looked identical to a genuine failure; and a refusal
 * never mentioned that the installed content was still there and still usable,
 * so a blocked import read as "there is nothing here".
 *
 * These specs pin all four outcomes and the one refresh contract that follows a
 * successful import. The pack is original synthetic content written for these
 * tests; version and revision are varied in-memory and nothing private is used.
 */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const APP_ROOT = `${BASE_PATH}/`;

/** The pack as published. */
const packJson = () => JSON.stringify(acceptancePack());

/** The same pack at a different version, with entry revisions to match. */
function packAt(version: string, revision: number): string {
  const document = acceptancePack();
  return JSON.stringify({
    ...document,
    pack: { ...document.pack, version },
    entries: document.entries.map(entry => ({ ...entry, revision })),
  });
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

async function openImports(page: Page) {
  await openSettings(page);
  await page.getByRole("button", { name: "Imports and exports" }).click();
}

/** Pastes a pack and previews it, without confirming. */
async function preview(page: Page, json: string) {
  await page.getByLabel("Pack JSON").fill(json);
  await page.getByRole("button", { name: "Preview import" }).click();
  await expect(page.getByLabel("Import preview")).toBeVisible();
}

/** Previews and confirms, creating the ruleset in the same confirmation. */
async function install(page: Page, json: string) {
  await preview(page, json);
  await expect(page.getByRole("heading", { name: /^Ready to (import|update)$/ })).toBeVisible();
  const offer = page.getByLabel("Create a ruleset profile so this content can be selected in the builder");
  if (await offer.count()) await offer.check();
  await page.getByRole("button", { name: "Confirm atomic import" }).click();
  await expect(page.getByText(/Import completed atomically/)).toBeVisible();
}

test.describe("a fresh install is reachable immediately", () => {
  test("appears in Content packs, Rulesets and the builder with no reload", async ({ page }) => {
    await page.goto(APP_ROOT);
    await openImports(page);
    await install(page, packJson());

    /*
     * No reload and no Settings detour between these. One service-level
     * invalidation runs after the write, so every reader is already correct.
     */
    await page.getByRole("button", { name: "Back to Settings" }).click();
    await page.getByRole("button", { name: "Rulesets" }).click();
    await expect(page.getByRole("heading", { name: "Emberline acceptance slice" })).toBeVisible();
    await expect(page.getByText(/creation levels 1 to 5/)).toBeVisible();

    await page.getByRole("button", { name: "Back to Settings" }).click();
    await page.getByRole("button", { name: "Content packs" }).click();
    await expect(page.getByText(/Emberline acceptance slice/).first()).toBeVisible();

    // And New character can select it straight away.
    await page.getByRole("button", { name: "Characters", exact: true }).click();
    await page.getByRole("button", { name: "New character" }).last().click();
    await expect(page.getByRole("button", { name: /^Emberline acceptance slice/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

test.describe("re-importing the same version is not a failure", () => {
  test("says nothing needs updating and keeps the ruleset usable", async ({ page }) => {
    await page.goto(APP_ROOT);
    await openImports(page);
    await install(page, packJson());

    await preview(page, packJson());

    // Not "Import blocked". The outcome is stated as what it is.
    await expect(page.getByRole("heading", { name: "Already installed — nothing to update" })).toBeVisible();
    await expect(page.getByText(/nothing to write/)).toBeVisible();
    await expect(page.getByText(/remains usable/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Import blocked" })).toHaveCount(0);

    // The version is named rather than left to be guessed at.
    await expect(page.getByText(/already installed at version 1\.0\.0/)).toBeVisible();

    // Nothing may be written, and the existing ruleset is offered instead.
    await expect(page.getByRole("button", { name: "Confirm atomic import" })).toBeDisabled();
    await expect(page.getByRole("button", { name: /^Use Emberline acceptance slice$/ })).toBeVisible();
  });
});

test.describe("an older incoming version is refused with its reason", () => {
  test("names both versions, says the newer install is kept, and offers it", async ({ page }) => {
    await page.goto(APP_ROOT);
    await openImports(page);
    // Install the newer pack first, then attempt the older one.
    await install(page, packAt("2.0.0", 2));
    await preview(page, packAt("1.0.0", 1));

    await expect(
      page.getByRole("heading", { name: "Not imported: a newer version is already installed" }),
    ).toBeVisible();
    // Both versions are stated, so the user can tell which way round this is.
    await expect(page.getByText(/version 1\.0\.0 is older than the installed version 2\.0\.0/)).toBeVisible();
    await expect(page.getByText(/newer installed content is kept and stays usable/)).toBeVisible();

    // The downgrade cannot be written.
    await expect(page.getByRole("button", { name: "Confirm atomic import" })).toBeDisabled();

    /*
     * And it does not imply there is no usable content: the installed ruleset
     * is named, and selecting it is one click from the refusal.
     */
    await page.getByRole("button", { name: /^Use Emberline acceptance slice$/ }).click();
    await expect(page.getByText(/Nothing was imported/)).toBeVisible();

    // It really is selectable in the builder.
    await page.getByRole("button", { name: "Characters", exact: true }).click();
    await page.getByRole("button", { name: "New character" }).last().click();
    await expect(page.getByRole("button", { name: /^Emberline acceptance slice/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

test.describe("higher installed entry revisions are reported precisely", () => {
  test("identifies installed against incoming, writes nothing, and leaves the profile usable", async ({ page }) => {
    await page.goto(APP_ROOT);
    await openImports(page);
    // Installed entries sit at revision 5; the incoming file carries 2 at a
    // newer pack version, so only the revisions can refuse it.
    await install(page, packAt("1.0.0", 5));
    await preview(page, packAt("1.1.0", 2));

    await expect(page.getByRole("heading", { name: "Not imported: the installed records are newer" })).toBeVisible();

    // The record is identified by ID and by both revisions — and by nothing else.
    const conflict = page.getByText(/revision 2 is older than the installed revision 5/).first();
    await expect(conflict).toBeVisible();
    await expect(page.getByText("ENTRY_REVISION_CONFLICT").first()).toBeVisible();

    // Nothing was written.
    await expect(page.getByRole("button", { name: "Confirm atomic import" })).toBeDisabled();

    // The existing profile is untouched and still usable.
    await expect(page.getByRole("button", { name: /^Use Emberline acceptance slice$/ })).toBeVisible();
    await page.getByRole("button", { name: "Back to Settings" }).click();
    await page.getByRole("button", { name: "Rulesets" }).click();
    await expect(page.getByRole("heading", { name: "Emberline acceptance slice" })).toBeVisible();
    await expect(page.getByText(/creation levels 1 to 5/)).toBeVisible();
  });
});

/**
 * The reported defect, end to end.
 *
 * A pack was updated and grew; the ruleset built from it kept the membership it
 * was created with, so Settings went on reporting the old entry count and New
 * character went on offering the old origins. The update is the only user action
 * here: no reinstall, no second ruleset and no reload.
 */
test.describe("updating an installed pack makes its new content reachable", () => {
  test("raises the ruleset's entry count and offers the new origin", async ({ page }) => {
    const before = acceptancePack().entries.length;
    const after = acceptancePackWithAddition().entries.length;
    expect(after).toBe(before + 2);

    await page.goto(APP_ROOT);
    await openImports(page);
    await install(page, packJson());

    await page.getByRole("button", { name: "Back to Settings" }).click();
    await page.getByRole("button", { name: "Rulesets" }).click();
    await expect(page.getByText(new RegExp(`${before} entries`))).toBeVisible();

    await page.getByRole("button", { name: "Back to Settings" }).click();
    await page.getByRole("button", { name: "Imports and exports" }).click();
    await preview(page, JSON.stringify(acceptancePackWithAddition()));

    // An update, and the existing ruleset is named as what will advance.
    await expect(page.getByRole("heading", { name: "Ready to update" })).toBeVisible();
    await expect(page.getByText(new RegExp(`will be updated to activate all ${after} entries`))).toBeVisible();
    await page.getByRole("button", { name: "Confirm atomic import" }).click();
    await expect(page.getByText(/existing ruleset\(s\) updated/)).toBeVisible();

    // One ruleset, at the new size.
    await page.getByRole("button", { name: "Back to Settings" }).click();
    await page.getByRole("button", { name: "Rulesets" }).click();
    await expect(page.getByRole("heading", { name: "Emberline acceptance slice" })).toHaveCount(1);
    await expect(page.getByText(new RegExp(`${after} entries`))).toBeVisible();

    // And the origin that only exists in the new version is offered in the
    // builder, which is where the defect was actually noticed.
    await page.getByRole("button", { name: "Characters", exact: true }).click();
    await page.getByRole("button", { name: "New character" }).last().click();
    await expect(page.getByText(/^Step 1 of/)).toBeVisible();
    await expect(page.getByRole("button", { name: /^Emberline acceptance slice/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.getByLabel("Character name", { exact: true }).fill("Sedge Marrick");
    await page.getByRole("button", { name: "All steps" }).click();
    await page.getByRole("button", { name: /^Species (Incomplete|Complete)$/ }).click();
    await expect(page.getByRole("button", { name: /^Reedfolk/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Cairnfolk/ })).toBeVisible();
  });
});
