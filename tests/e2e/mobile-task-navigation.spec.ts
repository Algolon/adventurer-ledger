import { expect, test, type Page } from "@playwright/test";

/**
 * The creation task is operable on a phone.
 *
 * The primary navigation and the builder's action row are both pinned to the
 * bottom edge, and the action row is painted over the top of it. On a phone that
 * left every navigation button visible, focusable, announced by `aria-current` —
 * and impossible to press, because the hit test landed on Back. Nothing was
 * broken enough to fail a desktop journey, and the flow was unusable on the
 * device it is about to be piloted on.
 *
 * The task now hides the bottom bar while it owns the surface and carries its
 * own Save & close. These specs pin both halves at the widths a pilot phone
 * actually reports, using the built-in synthetic ruleset so they stay fast.
 */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const APP_ROOT = `${BASE_PATH}/`;

/** Widths a current Android or iPhone reports in CSS pixels. */
const PHONE_WIDTHS = [360, 375, 390, 412] as const;

const stepTitle = (page: Page) => page.locator(".m2-builder-head h2");
const levelSelect = (page: Page) => page.getByLabel("Create this character at level");

/**
 * Whether any primary navigation control is on screen but not pressable.
 *
 * Asserted by hit test rather than by z-index or geometry: what matters is
 * whether a press at the control's own centre reaches it, which is the thing
 * the user is actually doing.
 */
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
      const reaches = hit ? button.contains(hit) || hit === button : false;
      if (!reaches) blocked.push(button.textContent?.trim() ?? "(unlabelled)");
    }
    return blocked;
  });
}

for (const width of PHONE_WIDTHS) {
  test.describe(`creation at ${width} px`, () => {
    test.use({ viewport: { width, height: 780 } });

    test("runs Basics to Save & close and resumes exactly where it left off", async ({ page }) => {
      // ---- 1. start a new character ---------------------------------------
      await page.goto(APP_ROOT);
      await page.getByRole("button", { name: "New character" }).last().click();
      await expect(stepTitle(page)).toHaveText("Basics");

      // ---- 9a. nothing in the primary navigation is visible-but-dead -------
      expect(await blockedNavControls(page)).toEqual([]);

      // ---- 2. Basics -------------------------------------------------------
      await page.getByLabel("Character name", { exact: true }).fill("Pocket Pilot");
      await page.getByRole("button", { name: "Continue" }).click();

      // ---- 3. class and level ---------------------------------------------
      await expect(stepTitle(page)).toHaveText("Class & level");
      await page.getByRole("button", { name: /^Vanguard/ }).click();
      await levelSelect(page).selectOption("2");
      expect(await blockedNavControls(page)).toEqual([]);

      // ---- 4. the next step ------------------------------------------------
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(stepTitle(page)).toHaveText("Origin");
      await page.getByRole("button", { name: /^Riverborn/ }).click();
      expect(await blockedNavControls(page)).toEqual([]);

      // ---- 5. Save & close -------------------------------------------------
      const saveClose = page.getByRole("button", { name: /^(Save & close|Saving…)$/ });
      await expect(saveClose).toBeVisible();
      await saveClose.click();

      // ---- 6. the draft is listed as unfinished ----------------------------
      await expect(page.getByRole("heading", { name: "Characters", exact: true })).toBeVisible();
      await expect(page.getByText("Unfinished builds")).toBeVisible();
      await expect(page.getByRole("button", { name: /Resume building Pocket Pilot/ })).toBeVisible();

      // ---- 7. resume -------------------------------------------------------
      await page.getByRole("button", { name: /Resume building Pocket Pilot/ }).click();

      // ---- 8. the same step, with every value intact -----------------------
      await expect(stepTitle(page)).toHaveText("Origin");
      await expect(page.getByRole("button", { name: /^Riverborn/ })).toHaveAttribute("aria-pressed", "true");
      await page.getByRole("button", { name: "All steps" }).click();
      await page.getByRole("button", { name: /Class & level/ }).click();
      await expect(page.getByRole("button", { name: /^Vanguard/ })).toHaveAttribute("aria-pressed", "true");
      await expect(levelSelect(page)).toHaveValue("2");
      await page.getByRole("button", { name: "All steps" }).click();
      await page.getByRole("button", { name: /Basics/ }).click();
      await expect(page.getByLabel("Character name", { exact: true })).toHaveValue("Pocket Pilot");

      // ---- 9b. still nothing visible-but-dead, and no sideways scroll ------
      expect(await blockedNavControls(page)).toEqual([]);
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth);
    });

    test("hides the bottom bar during the task and restores it after", async ({ page }) => {
      await page.goto(APP_ROOT);
      // Outside a task the bottom bar is the way around the app.
      await expect(page.locator(".m2-rail")).toBeVisible();

      await page.getByRole("button", { name: "New character" }).last().click();
      await expect(stepTitle(page)).toHaveText("Basics");
      /*
       * Hidden, not merely covered. A control that cannot be operated should
       * not be on screen claiming otherwise.
       */
      await expect(page.locator(".m2-rail")).toBeHidden();

      await page.getByRole("button", { name: /^(Save & close|Saving…)$/ }).click();
      await expect(page.locator(".m2-rail")).toBeVisible();
    });

    test("Save & close persists the last edit and cannot be pressed twice", async ({ page }) => {
      await page.goto(APP_ROOT);
      await page.getByRole("button", { name: "New character" }).last().click();

      /*
       * Typed and immediately closed. The name is debounced, so it is still
       * unsent when the press lands; Save & close has to flush it rather than
       * race it.
       */
      await page.getByLabel("Character name", { exact: true }).fill("Unflushed Name");
      await page
        .getByRole("button", { name: "Save & close" })
        .evaluate((button: HTMLButtonElement) => {
          // Two presses in one tick, before React can re-render it disabled.
          button.click();
          button.click();
        });

      await expect(page.getByText("Unfinished builds")).toBeVisible();
      // One draft, not two, and it kept the edit that had not been sent yet.
      await expect(page.getByRole("button", { name: /Resume building Unflushed Name/ })).toHaveCount(1);
      await page.getByRole("button", { name: /Resume building Unflushed Name/ }).click();
      await expect(page.getByLabel("Character name", { exact: true })).toHaveValue("Unflushed Name");
    });
  });
}

test.describe("the desktop rail is untouched", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("stays visible and operable while the task is open", async ({ page }) => {
    await page.goto(APP_ROOT);
    await page.getByRole("button", { name: "New character" }).last().click();
    await expect(stepTitle(page)).toHaveText("Basics");

    // The side rail is beside the task, not beneath it, so it stays.
    await expect(page.locator(".m2-rail")).toBeVisible();
    expect(await blockedNavControls(page)).toEqual([]);

    // And it still navigates, closing the task on the way.
    await page.getByRole("button", { name: "Compendium" }).click();
    await expect(stepTitle(page)).toHaveCount(0);
  });
});
