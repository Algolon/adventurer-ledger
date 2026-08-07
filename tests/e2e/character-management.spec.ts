import { expect, test, type Page } from "@playwright/test";

/**
 * The character overflow menu and safe deletion.
 *
 * The menu is a floating surface anchored to a row that can sit anywhere in a
 * long list, including hard against the bottom of a phone. Its containment is
 * asserted against the viewport rather than against its own container, because
 * "inside its row" and "on screen" are different properties.
 *
 * Deletion is destructive and local-first, so the tests prove both halves: the
 * character goes when it is confirmed, and nothing goes when it is not.
 */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const APP_ROOT = `${BASE_PATH}/`;
const PHONE_WIDTHS = [320, 360, 375, 390, 412] as const;

const next = (page: Page) => page.getByRole("button", { name: "Continue" }).click();

/** Builds and commits one character, so the library has a real record in it. */
async function createCharacter(page: Page, name: string) {
  await page.getByRole("button", { name: "New character" }).last().click();
  await page.getByLabel("Character name", { exact: true }).fill(name);
  await next(page);
  await page.getByRole("button", { name: /^Vanguard/ }).click();
  await next(page);
  await page.getByRole("button", { name: /^Riverborn/ }).click();
  await next(page);
  await page.getByRole("button", { name: /^Caravan Warden/ }).click();
  await page.getByRole("button", { name: /^Trade Cant/ }).click();
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
  await page.getByLabel("+1 to").selectOption("constitution");
  await next(page);
  await page.getByRole("button", { name: /^Guarded Hand/ }).click();
  await page.getByRole("button", { name: /^Riverlore/ }).click();
  await page.getByRole("button", { name: /^Haulage/ }).click();
  await next(page);
  await page.getByRole("button", { name: /^Warden pack/ }).click();
  await next(page);
  await next(page);
  await page.getByRole("button", { name: "Finish and open sheet" }).click();
  await expect(page.getByRole("heading", { name, level: 2 })).toBeVisible();
  await page.getByRole("button", { name: "Characters" }).click();
  await expect(page.getByRole("heading", { name: "Characters", exact: true })).toBeVisible();
}

const openMenuFor = (page: Page, name: string) =>
  page.getByRole("button", { name: `More actions for ${name}` }).click();

/** Every menu edge measured against the viewport, not against its own row. */
async function menuContainment(page: Page) {
  return page.evaluate(() => {
    const menu = document.querySelector<HTMLElement>(".m2-anchored-menu");
    if (!menu) return null;
    const rect = menu.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      viewportWidth: document.documentElement.clientWidth,
      viewportHeight: document.documentElement.clientHeight,
      documentScrollWidth: document.documentElement.scrollWidth,
    };
  });
}

test.describe("the character overflow menu stays on screen", () => {
  for (const width of PHONE_WIDTHS) {
    test(`is fully inside the viewport at ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 720 });
      await page.goto(APP_ROOT);
      await createCharacter(page, "Menu Probe");

      await openMenuFor(page, "Menu Probe");
      const box = (await menuContainment(page))!;
      expect(box).not.toBeNull();
      expect(box.left, `menu overhangs left at ${width} px`).toBeGreaterThanOrEqual(0);
      expect(box.right, `menu overhangs right at ${width} px`).toBeLessThanOrEqual(box.viewportWidth);
      expect(box.documentScrollWidth, `menu widened the document at ${width} px`).toBeLessThanOrEqual(
        box.viewportWidth,
      );
    });
  }

  /**
   * The regression case: a trigger deliberately near the bottom edge. The menu
   * used to open downwards into the fixed navigation bar, where its last item —
   * the destructive one — was unreachable.
   */
  test("flips above the trigger when the row is near the bottom edge", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 620 });
    await page.goto(APP_ROOT);
    for (const name of ["First Walker", "Second Walker", "Third Walker"]) await createCharacter(page, name);

    // The last row in the library is the one hard against the bottom.
    const last = page.getByRole("button", { name: /^More actions for / }).last();
    await last.scrollIntoViewIfNeeded();
    await last.click();

    const box = (await menuContainment(page))!;
    expect(box.top).toBeGreaterThanOrEqual(0);
    // Clear of the fixed bottom bar, not merely inside the viewport.
    expect(box.bottom).toBeLessThanOrEqual(box.viewportHeight);
    await expect(page.getByRole("button", { name: /^Delete / })).toBeInViewport();
  });

  test("the first row's menu is contained too", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 720 });
    await page.goto(APP_ROOT);
    for (const name of ["First Walker", "Second Walker"]) await createCharacter(page, name);

    await page.getByRole("button", { name: /^More actions for / }).first().click();
    const box = (await menuContainment(page))!;
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(box.viewportWidth);
    expect(box.bottom).toBeLessThanOrEqual(box.viewportHeight);
  });

  test("a long character name does not widen the menu past the viewport", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto(APP_ROOT);
    await createCharacter(page, "Aurelia Thundermarch of the Long Crossing Reach");

    await openMenuFor(page, "Aurelia Thundermarch of the Long Crossing Reach");
    const box = (await menuContainment(page))!;
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(box.viewportWidth);
    expect(box.documentScrollWidth).toBeLessThanOrEqual(box.viewportWidth);
  });

  test("opening the menu shifts nothing else on the page", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 720 });
    await page.goto(APP_ROOT);
    await createCharacter(page, "Layout Probe");

    // Measured in document space, so a scroll the click performed is not
    // mistaken for the menu reflowing the page.
    const heading = page.getByRole("heading", { name: "Characters", exact: true });
    const position = () => heading.evaluate(element => element.getBoundingClientRect().top + window.scrollY);

    // Settle first: the library list loads asynchronously, and a measurement
    // taken across that render would be reporting the load, not the menu.
    await expect(page.getByRole("button", { name: "More actions for Layout Probe" })).toBeVisible();
    let before = await position();
    await expect.poll(async () => {
      const now = await position();
      const stable = now === before;
      before = now;
      return stable;
    }).toBe(true);

    await openMenuFor(page, "Layout Probe");
    expect(await position()).toBe(before);
  });

  test("closes on Escape and on a tap outside", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 720 });
    await page.goto(APP_ROOT);
    await createCharacter(page, "Dismiss Probe");

    await openMenuFor(page, "Dismiss Probe");
    await expect(page.getByRole("button", { name: /^Delete / })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: /^Delete / })).toHaveCount(0);

    await openMenuFor(page, "Dismiss Probe");
    await expect(page.getByRole("button", { name: /^Delete / })).toBeVisible();
    await page.getByRole("heading", { name: "Characters", exact: true }).click();
    await expect(page.getByRole("button", { name: /^Delete / })).toHaveCount(0);
  });

  test("the trigger reports its expanded state", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 720 });
    await page.goto(APP_ROOT);
    await createCharacter(page, "Aria Probe");

    const trigger = page.getByRole("button", { name: "More actions for Aria Probe" });
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
  });
});

test.describe("deleting a character", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 720 });
  });

  /**
   * The safety property: neither opening the menu nor choosing the item may
   * delete anything. Only the confirmation does.
   */
  test("selecting Delete only asks; it does not delete", async ({ page }) => {
    await page.goto(APP_ROOT);
    await createCharacter(page, "Careful Walker");

    await openMenuFor(page, "Careful Walker");
    await page.getByRole("button", { name: "Delete Careful Walker" }).click();

    await expect(page.getByRole("alertdialog", { name: "Delete Careful Walker?" })).toBeVisible();
    // Still in the library, untouched, behind the confirmation.
    await expect(page.getByRole("button", { name: /Open Careful Walker/ })).toBeAttached();
  });

  test("names the character, says the deletion is permanent and local, and separates the actions", async ({ page }) => {
    await page.goto(APP_ROOT);
    await createCharacter(page, "Named Walker");

    await openMenuFor(page, "Named Walker");
    await page.getByRole("button", { name: "Delete Named Walker" }).click();

    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("Named Walker");
    await expect(dialog).toContainText(/permanently/i);
    await expect(dialog).toContainText(/this device/i);
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Delete character" })).toBeVisible();
    // Focus opens on the safe action, never on the destructive one.
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  });

  test("cancel leaves everything exactly as it was", async ({ page }) => {
    await page.goto(APP_ROOT);
    await createCharacter(page, "Kept Walker");
    await createCharacter(page, "Other Walker");

    await openMenuFor(page, "Kept Walker");
    await page.getByRole("button", { name: "Delete Kept Walker" }).click();
    await page.getByRole("button", { name: "Cancel" }).click();

    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Open Kept Walker/ })).toBeAttached();
    await expect(page.getByRole("button", { name: /Open Other Walker/ })).toBeAttached();
    // Focus returns to the control the menu was opened from.
    await expect(page.getByRole("button", { name: "More actions for Kept Walker" })).toBeFocused();
  });

  test("confirming removes that character and returns to the library", async ({ page }) => {
    await page.goto(APP_ROOT);
    await createCharacter(page, "Doomed Walker");
    await createCharacter(page, "Surviving Walker");

    await openMenuFor(page, "Doomed Walker");
    await page.getByRole("button", { name: "Delete Doomed Walker" }).click();
    await page.getByRole("button", { name: "Delete character" }).click();

    await expect(page.getByRole("heading", { name: "Characters", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Open Doomed Walker/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Open Surviving Walker/ })).toBeAttached();
  });

  test("the deletion survives a reload, and the other character does too", async ({ page }) => {
    await page.goto(APP_ROOT);
    await createCharacter(page, "Doomed Walker");
    await createCharacter(page, "Surviving Walker");

    await openMenuFor(page, "Doomed Walker");
    await page.getByRole("button", { name: "Delete Doomed Walker" }).click();
    await page.getByRole("button", { name: "Delete character" }).click();
    await expect(page.getByRole("button", { name: /Open Doomed Walker/ })).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole("button", { name: /Open Doomed Walker/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Open Surviving Walker/ })).toBeAttached();
  });

  test("deleting the character that is currently open returns to the library", async ({ page }) => {
    await page.goto(APP_ROOT);
    await createCharacter(page, "Open Walker");

    // Open its sheet, then come back and delete it.
    await page.getByRole("button", { name: /Open Open Walker/ }).click();
    await expect(page.getByRole("heading", { name: "Open Walker", level: 2 })).toBeVisible();
    await page.getByRole("button", { name: "Characters" }).click();

    await openMenuFor(page, "Open Walker");
    await page.getByRole("button", { name: "Delete Open Walker" }).click();
    await page.getByRole("button", { name: "Delete character" }).click();

    await expect(page.getByRole("heading", { name: "Characters", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Open Open Walker/ })).toHaveCount(0);
  });

  test("deleting a character that has an edit draft removes the draft too", async ({ page }) => {
    await page.goto(APP_ROOT);
    await createCharacter(page, "Drafted Walker");

    // Opening the build is what creates the character-bound edit draft.
    await openMenuFor(page, "Drafted Walker");
    await page.getByRole("button", { name: "Edit build for Drafted Walker" }).click();
    await expect(page.getByText(/Step \d+ of \d+/)).toBeVisible();
    await page.getByRole("button", { name: /^(Save & close|Saving…)$/ }).click();
    await expect(page.getByRole("heading", { name: "Characters", exact: true })).toBeVisible();

    await openMenuFor(page, "Drafted Walker");
    await page.getByRole("button", { name: "Delete Drafted Walker" }).click();
    await page.getByRole("button", { name: "Delete character" }).click();

    await expect(page.getByRole("button", { name: /Open Drafted Walker/ })).toHaveCount(0);
    // No orphaned unfinished build is left behind pointing at nothing.
    await expect(page.getByRole("button", { name: /Resume building Drafted Walker/ })).toHaveCount(0);
  });

  test("shared content is untouched by a delete", async ({ page }) => {
    await page.goto(APP_ROOT);
    await createCharacter(page, "Temporary Walker");

    await openMenuFor(page, "Temporary Walker");
    await page.getByRole("button", { name: "Delete Temporary Walker" }).click();
    await page.getByRole("button", { name: "Delete character" }).click();
    await expect(page.getByRole("button", { name: /Open Temporary Walker/ })).toHaveCount(0);

    // The ruleset and its content are still installed: a new build still works.
    await page.getByRole("button", { name: "New character" }).last().click();
    await next(page);
    await expect(page.getByRole("button", { name: /^Vanguard/ })).toBeVisible();
  });
});
