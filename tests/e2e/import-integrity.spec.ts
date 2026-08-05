import { expect, test, type Page } from "@playwright/test";
import { acceptancePackJson, standalonePackJson, STANDALONE_PACK_NAME } from "@/tests/fixtures/acceptance-ruleset";

/**
 * Import integrity: a preview may only ever describe the input in front of it.
 *
 * The import panel is a two-step commitment — preview, then confirm — and the
 * whole value of that shape is that the thing confirmed is the thing shown. A
 * preview that outlives the input it was computed from turns the second step
 * into a trap: the user chooses a different file, sees a summary that is no
 * longer about it, and confirms content they did not select.
 *
 * All content is the original synthetic acceptance slice and its add-on.
 */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const APP_ROOT = `${BASE_PATH}/`;

/** Deliberately not valid JSON, so the parse fails rather than the schema. */
const MALFORMED = '{ "schemaVersion": 2, "pack": { "id": "pack:broken", ';

async function openImports(page: Page) {
  await page.goto(APP_ROOT);
  const candidates = page.getByRole("button", { name: /^(Open Settings|Settings)$/ });
  for (let index = 0; index < (await candidates.count()); index += 1) {
    const candidate = candidates.nth(index);
    if (await candidate.isVisible()) {
      await candidate.click();
      break;
    }
  }
  await page.getByRole("button", { name: "Imports and exports" }).click();
}

const chooseFile = (page: Page, name: string, body: string) =>
  page.getByLabel("Choose JSON file").setInputFiles({
    name,
    mimeType: "application/json",
    buffer: Buffer.from(body, "utf8"),
  });

const previewButton = (page: Page) => page.getByRole("button", { name: "Preview import" });
const confirmButton = (page: Page) => page.getByRole("button", { name: "Confirm atomic import" });
const readyHeading = (page: Page) => page.getByRole("heading", { name: "Ready to import" });

/** What the builder offers, which is the honest test of what actually installed. */
async function installedRulesetNames(page: Page): Promise<string[]> {
  await page.goto(APP_ROOT);
  await page.getByRole("button", { name: "Characters", exact: true }).click();
  await page.getByRole("button", { name: "New character" }).last().click();
  await expect(page.getByText(/^Step 1 of/)).toBeVisible();
  return page.locator("[aria-pressed]").allInnerTexts();
}

test.describe("a preview never outlives the input it describes", () => {
  test("choosing a second file discards the first file's preview", async ({ page }) => {
    await openImports(page);

    await chooseFile(page, "a-acceptance.json", acceptancePackJson());
    await previewButton(page).click();
    await expect(readyHeading(page)).toBeVisible();

    // Choosing B must invalidate A's preview immediately — before any click.
    await chooseFile(page, "b-almanac.json", standalonePackJson());
    await expect(readyHeading(page)).toHaveCount(0);
    await expect(confirmButton(page)).toHaveCount(0);

    // Previewing again describes B, and confirming installs B.
    await previewButton(page).click();
    await expect(readyHeading(page)).toBeVisible();
    await expect(page.getByText(new RegExp(STANDALONE_PACK_NAME)).first()).toBeVisible();
    await confirmButton(page).click();
    await expect(page.getByText(/Import completed atomically/)).toBeVisible();

    // B really is installed: Settings lists it as an installed pack.
    await page.getByRole("button", { name: "Back to Settings" }).click();
    await page.getByRole("button", { name: "Rulesets" }).click();
    await expect(page.locator(".m2-card").filter({ hasText: STANDALONE_PACK_NAME }).first()).toBeVisible();

    // A was never installed, so the builder never offers its ruleset.
    const offered = (await installedRulesetNames(page)).join(" ");
    expect(offered).not.toContain("Emberline acceptance slice");
  });

  test("a malformed second file discards the first file's preview and cannot be confirmed", async ({ page }) => {
    await openImports(page);

    await chooseFile(page, "a-acceptance.json", acceptancePackJson());
    await previewButton(page).click();
    await expect(readyHeading(page)).toBeVisible();

    await chooseFile(page, "b-broken.json", MALFORMED);
    await expect(readyHeading(page)).toHaveCount(0);
    await expect(confirmButton(page)).toHaveCount(0);

    // Previewing the malformed input reports it and offers no confirmation.
    await previewButton(page).click();
    await expect(page.getByRole("heading", { name: "Import blocked" })).toBeVisible();
    await expect(confirmButton(page)).toBeDisabled();

    // Neither pack was installed.
    const offered = (await installedRulesetNames(page)).join(" ");
    expect(offered).not.toContain("Emberline acceptance slice");
    
  });

  test("replacing the pasted text discards the pasted preview", async ({ page }) => {
    await openImports(page);

    await page.getByLabel("Pack JSON").fill(acceptancePackJson());
    await previewButton(page).click();
    await expect(readyHeading(page)).toBeVisible();

    await page.getByLabel("Pack JSON").fill(standalonePackJson());
    await expect(readyHeading(page)).toHaveCount(0);
    await expect(confirmButton(page)).toHaveCount(0);

    await previewButton(page).click();
    await expect(readyHeading(page)).toBeVisible();
    await confirmButton(page).click();
    await expect(page.getByText(/Import completed atomically/)).toBeVisible();

    const offered = (await installedRulesetNames(page)).join(" ");
    expect(offered).not.toContain("Emberline acceptance slice");
  });

  test("a file chosen after pasted text follows the same rule", async ({ page }) => {
    await openImports(page);

    await page.getByLabel("Pack JSON").fill(acceptancePackJson());
    await previewButton(page).click();
    await expect(readyHeading(page)).toBeVisible();

    // Crossing input modes must not preserve the previous preview either.
    await chooseFile(page, "b-almanac.json", standalonePackJson());
    await expect(readyHeading(page)).toHaveCount(0);
    await expect(confirmButton(page)).toHaveCount(0);
  });

  test("cancelling clears the input as well as the preview", async ({ page }) => {
    await openImports(page);

    await chooseFile(page, "a-acceptance.json", acceptancePackJson());
    await previewButton(page).click();
    await expect(readyHeading(page)).toBeVisible();

    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(readyHeading(page)).toHaveCount(0);
    await expect(page.getByLabel("Pack JSON")).toHaveValue("");
    // With no input there is nothing to preview.
    await expect(previewButton(page)).toBeDisabled();
  });
});
