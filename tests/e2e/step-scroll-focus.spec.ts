import { expect, test, type Page } from "@playwright/test";

/**
 * A creation step begins at its own heading.
 *
 * On the Samsung pilot, scrolling down a step and pressing Continue opened the
 * next step at roughly the previous scroll offset: React swapped the content
 * under a scrolled window and nothing moved the viewport. The step change is
 * also a landmark, so focus goes to the heading rather than staying wherever
 * the previous step left it.
 */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const APP_ROOT = `${BASE_PATH}/`;

const next = (page: Page) => page.getByRole("button", { name: "Continue" }).click();

async function openBuilder(page: Page) {
  await page.goto(APP_ROOT);
  await page.getByRole("button", { name: "New character" }).last().click();
  await expect(page.getByText("Step 1 of 9")).toBeVisible();
}

/** Basics → Class & level, which is a long enough list to scroll on a phone. */
async function reachClass(page: Page) {
  await openBuilder(page);
  await page.getByLabel("Character name", { exact: true }).fill("Scroll Probe");
  await next(page);
  await expect(page.getByRole("heading", { level: 2 })).toHaveText("Class & level");
}

const scrollY = (page: Page) => page.evaluate(() => window.scrollY);

const settledAtTop = async (page: Page) => {
  await expect.poll(() => scrollY(page), { timeout: 5000 }).toBeLessThanOrEqual(4);
};

test.describe("step navigation resets scroll and focus", () => {
  test("Continue opens the next step at its top, not the previous offset", async ({ page }) => {
    await reachClass(page);
    await page.getByRole("button", { name: /^Vanguard/ }).click();

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect.poll(() => scrollY(page), { timeout: 5000 }).toBeGreaterThan(40);

    await next(page);
    await expect(page.getByRole("heading", { level: 2 })).toHaveText("Species");
    await settledAtTop(page);
  });

  test("moves focus to the heading of the step just entered", async ({ page }) => {
    await reachClass(page);
    await page.getByRole("button", { name: /^Vanguard/ }).click();
    await next(page);

    await expect(page.getByRole("heading", { level: 2 })).toBeFocused();
  });

  test("Back behaves the same way", async ({ page }) => {
    await reachClass(page);
    await page.getByRole("button", { name: /^Vanguard/ }).click();
    await next(page);
    await expect(page.getByRole("heading", { level: 2 })).toHaveText("Species");

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect.poll(() => scrollY(page), { timeout: 5000 }).toBeGreaterThan(40);

    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByRole("heading", { level: 2 })).toHaveText("Class & level");
    await settledAtTop(page);
    await expect(page.getByRole("heading", { level: 2 })).toBeFocused();
  });

  test("a validation failure keeps focus on the error summary, not the heading", async ({ page }) => {
    // Class & level with nothing chosen cannot advance.
    await reachClass(page);
    await next(page);

    const summary = page.locator(".m2-error-summary");
    await expect(summary).toBeVisible();
    await expect(summary).toBeFocused();
    // The step did not change, so the heading must not have stolen focus back.
    await expect(page.getByRole("heading", { level: 2 })).toHaveText("Class & level");
  });

  test("the heading shows no focus ring when focus was moved programmatically", async ({ page }) => {
    await reachClass(page);
    await page.getByRole("button", { name: /^Vanguard/ }).click();
    await next(page);

    const outline = await page
      .getByRole("heading", { level: 2 })
      .evaluate(node => getComputedStyle(node).outlineStyle);
    expect(outline).toBe("none");
  });
});
