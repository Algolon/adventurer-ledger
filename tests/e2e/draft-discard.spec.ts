import { expect, test, type Page } from "@playwright/test";

/**
 * Getting rid of an unfinished build from the library.
 *
 * The pilot phone could not remove a draft at all: the only route was to finish
 * the character and then delete it. Discard is deliberately named apart from
 * Delete, and asks before it acts, matching the committed-character pattern.
 */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const APP_ROOT = `${BASE_PATH}/`;

const next = (page: Page) => page.getByRole("button", { name: "Continue" }).click();

/** Leaves one named, unfinished build under "Unfinished builds". */
async function startDraft(page: Page, name: string) {
  await page.goto(APP_ROOT);
  await page.getByRole("button", { name: "New character" }).last().click();
  await page.getByLabel("Character name", { exact: true }).fill(name);
  await next(page);
  await expect(page.getByRole("heading", { level: 2 })).toHaveText("Class & level");
  await page.getByRole("button", { name: "Save & close" }).click();
  await expect(page.getByRole("button", { name: new RegExp(`Resume building ${name}`) })).toBeVisible();
}

const openDraftMenu = (page: Page, name: string) =>
  page.getByRole("button", { name: `More actions for unfinished build ${name}` }).click();

test.describe("discarding an unfinished build", () => {
  test("asks before it removes anything, and Cancel keeps the build", async ({ page }) => {
    await startDraft(page, "Throwaway Build");

    await openDraftMenu(page, "Throwaway Build");
    await page.getByRole("button", { name: "Discard Throwaway Build" }).click();

    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Discard Throwaway Build?");
    // Says what actually goes, and what does not.
    await expect(dialog).toContainText("unfinished build");
    await expect(dialog).toContainText("content packs, rulesets and finished characters are not affected");
    // The safe answer holds focus.
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("alertdialog")).toBeHidden();
    await expect(page.getByRole("button", { name: /Resume building Throwaway Build/ })).toBeVisible();
  });

  test("removes only the build confirmed, leaving the others", async ({ page }) => {
    await startDraft(page, "Keeper Build");
    await startDraft(page, "Throwaway Build");

    await openDraftMenu(page, "Throwaway Build");
    await page.getByRole("button", { name: "Discard Throwaway Build" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Discard build" }).click();

    await expect(page.getByRole("button", { name: /Resume building Throwaway Build/ })).toBeHidden();
    await expect(page.getByRole("button", { name: /Resume building Keeper Build/ })).toBeVisible();
  });

  test("leaves installed content and rulesets alone", async ({ page }) => {
    await startDraft(page, "Throwaway Build");

    await openDraftMenu(page, "Throwaway Build");
    await page.getByRole("button", { name: "Discard Throwaway Build" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Discard build" }).click();
    await expect(page.getByRole("button", { name: /Resume building Throwaway Build/ })).toBeHidden();

    // A new build can still be started against the same installed content.
    await page.getByRole("button", { name: "New character" }).last().click();
    await expect(page.getByText("Step 1 of 9")).toBeVisible();
    await page.getByLabel("Character name", { exact: true }).fill("Proof");
    await next(page);
    await expect(page.getByRole("button", { name: /^Vanguard/ })).toBeVisible();
  });

  test("is distinguishable from the character an edit draft belongs to", async ({ page }) => {
    // An edit draft carries its character's name, so both rows sit in the
    // library under one name. The controls must still say which is which.
    await startDraft(page, "Twin Named");

    await expect(page.getByRole("button", { name: "More actions for unfinished build Twin Named" })).toHaveCount(1);
    await openDraftMenu(page, "Twin Named");
    // The build's menu discards; it never offers to delete a character.
    await expect(page.getByRole("button", { name: "Discard Twin Named" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete Twin Named" })).toBeHidden();
  });

  test("names the resume step in the user's words, not the engine's", async ({ page }) => {
    await startDraft(page, "Throwaway Build");
    // The step ID is `class`; the row must read its label.
    await expect(page.getByText(/Resume: Class & level/)).toBeVisible();
    await expect(page.getByText(/Resume: class/)).toBeHidden();
  });
});
