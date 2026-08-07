import { expect, test, type Page } from "@playwright/test";
import { acceptancePackJson } from "@/tests/fixtures/acceptance-ruleset";

/**
 * The flow keeps its place and its work across ordinary use.
 *
 * A pilot review described creation as "unstable" without a single failing
 * value: everything the user typed survived, but the builder kept putting them
 * somewhere they had not asked to be, and pressing Continue produced no visible
 * response until it had finished writing. Both read as the app losing track of
 * what is happening, which is what "unstable" meant.
 *
 * These specs pin the two behaviours that fixes: reopening lands where the user
 * left off, and any action waiting on persistence says so and cannot be pressed
 * twice. Content is the original synthetic acceptance slice.
 */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const APP_ROOT = `${BASE_PATH}/`;

const next = (page: Page) => page.getByRole("button", { name: "Continue" }).click();
const stepTitle = (page: Page) => page.locator(".m2-builder-head h2");

/**
 * Waits until nothing is being written.
 *
 * The footer controls are disabled for exactly as long as a navigation or a
 * commit is in flight, so their returning to enabled is the observable signal
 * that the draft — including `lastStepId` — is durable. Reloading before that
 * is testing a torn write, not the resume contract.
 */
async function settled(page: Page) {
  await expect(page.getByRole("button", { name: "Back" })).toBeEnabled();
  await expect(page.getByRole("button", { name: /^(Continue|Finish and open sheet)$/ })).toBeEnabled();
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

async function importAcceptancePack(page: Page) {
  await page.goto(APP_ROOT);
  await openSettings(page);
  await page.getByRole("button", { name: "Imports and exports" }).click();
  await page.getByLabel("Pack JSON").fill(acceptancePackJson());
  await page.getByRole("button", { name: "Preview import" }).click();
  await page.getByLabel("Create a ruleset profile so this content can be selected in the builder").check();
  await page.getByRole("button", { name: "Confirm atomic import" }).click();
  await expect(page.getByText(/Import completed atomically/)).toBeVisible();
}

/** A build carried as far as Origin, with class and level already settled. */
async function buildToOrigin(page: Page, name: string) {
  await page.getByRole("button", { name: "Characters", exact: true }).click();
  await page.getByRole("button", { name: "New character" }).last().click();
  await page.getByLabel("Character name", { exact: true }).fill(name);
  await next(page);
  await page.getByRole("button", { name: /^Beaconkeeper/ }).click();
  await page.getByLabel("Create this character at level").selectOption("5");
  await next(page);
  await expect(stepTitle(page)).toHaveText("Species");
  await page.getByRole("button", { name: /^Cairnfolk/ }).click();
  await page.getByRole("button", { name: /^Ferry Clerk/ }).click();
  await page.getByRole("button", { name: /^Cairnlore/ }).click();
  await settled(page);
}

test.describe("reopening lands where the user left off", () => {
  test("a reload and a resume return to the same step, not a later one", async ({ page }) => {
    await importAcceptancePack(page);
    await buildToOrigin(page, "Kept Place");

    /*
     * Origin is fully answered here, so the plan's next unresolved step is
     * Abilities. Resuming used to take whichever was further along and would
     * therefore open on Abilities — a step the user had never visited.
     */
    await page.reload();
    await page.getByRole("button", { name: "Characters", exact: true }).click();
    await page.getByRole("button", { name: /Resume building/ }).click();

    await expect(stepTitle(page)).toHaveText("Species");
    await expect(page.getByRole("button", { name: /^Cairnfolk/ })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: /^Ferry Clerk/ })).toHaveAttribute("aria-pressed", "true");
  });

  test("stepping back and reloading returns to the step stepped back to", async ({ page }) => {
    await importAcceptancePack(page);
    await buildToOrigin(page, "Went Back");
    await next(page);
    await expect(stepTitle(page)).toHaveText("Abilities");
    await settled(page);

    // Deliberately go back to re-read something.
    await page.getByRole("button", { name: "Back" }).click();
    await expect(stepTitle(page)).toHaveText("Species");
    await settled(page);

    await page.reload();
    await page.getByRole("button", { name: "Characters", exact: true }).click();
    await page.getByRole("button", { name: /Resume building/ }).click();

    // The place the user chose, not the place the plan would prefer.
    await expect(stepTitle(page)).toHaveText("Species");
  });

  test("class and level survive a reload taken from a later step", async ({ page }) => {
    await importAcceptancePack(page);
    await buildToOrigin(page, "Deep Reload");
    await next(page);
    await expect(stepTitle(page)).toHaveText("Abilities");
    await settled(page);

    await page.reload();
    await page.getByRole("button", { name: "Characters", exact: true }).click();
    await page.getByRole("button", { name: /Resume building/ }).click();
    await expect(stepTitle(page)).toHaveText("Abilities");

    await page.getByRole("button", { name: "All steps" }).click();
    await page.getByRole("button", { name: /Class & level/ }).click();
    await expect(page.getByRole("button", { name: /^Beaconkeeper/ })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByLabel("Create this character at level")).toHaveValue("5");
  });
});

test.describe("an action waiting on persistence cannot be double-submitted", () => {
  test("pressing Continue twice advances exactly one step", async ({ page }) => {
    await importAcceptancePack(page);
    await page.getByRole("button", { name: "Characters", exact: true }).click();
    await page.getByRole("button", { name: "New character" }).last().click();
    await page.getByLabel("Character name", { exact: true }).fill("Busy Button");
    await settled(page);

    /*
     * Continue flushes the autosave queue before it judges the step, so there is
     * a real window in which the button has been pressed and nothing has
     * visibly changed. That window used to accept a second press, which walked
     * the user two steps forward from one intent.
     */
    // Two clicks in one tick, before React can re-render the button as
    // disabled. This is what a real double press looks like to the handler.
    await page
      .getByRole("button", { name: "Continue" })
      .evaluate((button: HTMLButtonElement) => {
        button.click();
        button.click();
      });

    await expect(stepTitle(page)).toHaveText("Class & level");
    await expect(page.getByText("Step 2 of 9")).toBeVisible();
  });

  test("pressing Finish twice creates exactly one character", async ({ page }) => {
    await importAcceptancePack(page);
    await page.getByRole("button", { name: "Characters", exact: true }).click();
    await page.getByRole("button", { name: "New character" }).last().click();
    await page.getByLabel("Character name", { exact: true }).fill("One Commit");
    await next(page);
    await page.getByRole("button", { name: /^Beaconkeeper/ }).click();
    await page.getByLabel("Create this character at level").selectOption("5");
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
    await page.getByRole("button", { name: /^Attentive Clerk/ }).click();
    await page.getByRole("button", { name: /^Signal lamp/ }).click();
    await next(page);

    await page.getByRole("button", { name: /^Ledger case/ }).click();
    await page.getByRole("button", { name: /^Ink set/ }).click();
    await next(page);
    await next(page); // identity

    await expect(page.getByRole("heading", { name: "Review", level: 3 })).toBeVisible();
    // The control must be idle before this means anything: a press made while
    // the previous navigation is still writing is refused by design.
    await settled(page);

    /*
     * Two presses in quick succession must produce one character. The service
     * makes a repeated commit idempotent through its operationId, but the
     * control must not invite the second press in the first place: the first is
     * still in flight and, before this pass, nothing on screen said so.
     */
    await page
      .getByRole("button", { name: "Finish and open sheet" })
      .evaluate((button: HTMLButtonElement) => {
        button.click();
        button.click();
      });

    // The commit lands and opens the sheet, once.
    await expect(page.getByRole("heading", { name: "Review", level: 3 })).toHaveCount(0, {
      timeout: 20_000,
    });
    await page.getByRole("button", { name: "Characters", exact: true }).click();
    await expect(page.getByRole("button", { name: /Open One Commit/ })).toHaveCount(1);
    // And no half-finished draft was left behind beside it.
    await expect(page.getByRole("button", { name: /Resume building One Commit/ })).toHaveCount(0);
  });
});

/**
 * Desktop only, deliberately.
 *
 * At mobile widths the rail is a fixed bottom bar and the builder's own task
 * footer sits on top of it, so the nav is visible and enabled but intercepted —
 * unreachable rather than dead. That is a separate layering defect and fixing
 * it is a mobile layout change, which this pass is explicitly not making. What
 * is pinned here is the behaviour on the surface this pass exists to make
 * reviewable.
 */
test.describe("the primary nav is not a dead control while building", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 960, "the rail is under the task footer at mobile widths");

  test("Characters leaves the builder and lists the draft as resumable", async ({ page }) => {
    await importAcceptancePack(page);
    await buildToOrigin(page, "Nav Exit");

    /*
     * The builder owns the whole surface, so a nav button that only moved the
     * view left the user looking at exactly what they were looking at before —
     * a visible, enabled control that did nothing, while the rail marked itself
     * current for a page that was not on screen.
     */
    await page.getByRole("button", { name: "Characters", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Characters", exact: true })).toBeVisible();
    await expect(stepTitle(page)).toHaveCount(0);

    // Nothing was lost: the draft is listed and resumes where it was left.
    await expect(page.getByText("Unfinished builds")).toBeVisible();
    await page.getByRole("button", { name: /Resume building/ }).click();
    await expect(stepTitle(page)).toHaveText("Species");
    await expect(page.getByRole("button", { name: /^Cairnfolk/ })).toHaveAttribute("aria-pressed", "true");
  });

  test("Settings leaves the builder too", async ({ page }) => {
    await importAcceptancePack(page);
    await buildToOrigin(page, "Settings Exit");

    await page.getByRole("button", { name: /^(Open Settings|Settings)$/ }).first().click();
    await expect(stepTitle(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Imports and exports" })).toBeVisible();
  });
});
