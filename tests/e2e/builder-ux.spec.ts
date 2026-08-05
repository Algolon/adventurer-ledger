import { expect, test, type Page } from "@playwright/test";

/**
 * Builder interaction corrections from the owner's exploratory review:
 * an honest starting-level presentation, a conditional step that is omitted
 * rather than shown empty, one coherent navigation row, and a standard-array
 * assignment that shows its consequences.
 */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const APP_ROOT = `${BASE_PATH}/`;

const next = (page: Page) => page.getByRole("button", { name: "Continue" }).click();

async function openBuilder(page: Page) {
  await page.goto(APP_ROOT);
  await page.getByRole("button", { name: "New character" }).last().click();
  await expect(page.getByText("Step 1 of 8")).toBeVisible();
}

async function reachAbilities(page: Page) {
  await openBuilder(page);
  await next(page);
  await page.getByRole("button", { name: /^Vanguard/ }).click();
  await next(page);
  await page.getByRole("button", { name: /^Riverborn/ }).click();
  await page.getByRole("button", { name: /^Caravan Warden/ }).click();
  await page.getByRole("button", { name: /^Trade Cant/ }).click();
  await next(page);
  await expect(page.getByText("Step 4 of 8")).toBeVisible();
}

/**
 * Supersedes the earlier requirement that the starting level be a static fact.
 * Creating directly at a higher level is supported now, so the level is a real
 * decision on the first step — offered only as far as the installed content
 * actually covers, rather than up to an arbitrary maximum.
 */
test.describe("name, ruleset and starting level come first", () => {
  test("the first step holds all three decisions", async ({ page }) => {
    await openBuilder(page);
    await expect(page.getByLabel("Character name", { exact: true })).toBeVisible();
    await expect(page.getByRole("group", { name: "Ruleset" })).toBeVisible();
    await expect(page.getByLabel("Create this character at level")).toBeVisible();
  });

  test("offers only the levels the installed content covers", async ({ page }) => {
    await openBuilder(page);
    // This ruleset's class progression defines levels 1 and 2 and no further.
    await expect(page.getByLabel("Create this character at level").locator("option")).toHaveText(["1", "2"]);
  });

  test("the review reports the level that was chosen", async ({ page }) => {
    await openBuilder(page);
    await page.getByLabel("Create this character at level").selectOption("2");
    await page.getByRole("button", { name: "All steps" }).click();
    await page.getByRole("button", { name: /Review/ }).click();
    await expect(page.getByRole("term").filter({ hasText: "Level" })).toBeVisible();
    await expect(page.getByRole("definition").filter({ hasText: "Level 2" })).toBeVisible();
  });

  test("the name autosaves and survives navigation and a reload", async ({ page }) => {
    await openBuilder(page);
    await page.getByLabel("Character name", { exact: true }).fill("Brammel Voss");
    await next(page);
    await expect(page.getByText("Step 2 of 8")).toBeVisible();
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByLabel("Character name", { exact: true })).toHaveValue("Brammel Voss");

    await page.reload();
    await page.getByRole("button", { name: /Resume building/ }).click();
    await page.getByRole("button", { name: "All steps" }).click();
    await page.getByRole("button", { name: /Name, ruleset and level/ }).click();
    await expect(page.getByLabel("Character name", { exact: true })).toHaveValue("Brammel Voss");
  });
});

test.describe("a step with nothing to decide is omitted", () => {
  test("Equipment follows Class choices directly, and Review states the absence", async ({ page }) => {
    await reachAbilities(page);
    for (const [ability, value] of [
      ["Strength", "14"],
      ["Dexterity", "15"],
      ["Constitution", "13"],
      ["Intelligence", "12"],
      ["Wisdom", "10"],
      ["Charisma", "8"],
    ] as const)
      await page.getByLabel(ability, { exact: true }).selectOption(value);
    await page.getByLabel("+2 to").selectOption("strength");
    await page.getByLabel("+1 to").selectOption("constitution");
    await next(page);

    await expect(page.getByText("Step 5 of 8")).toBeVisible();
    await page.getByRole("button", { name: /^Guarded Hand/ }).click();
    await page.getByRole("button", { name: /^Riverlore/ }).click();
    await page.getByRole("button", { name: /^Haulage/ }).click();
    await next(page);

    // Straight to Equipment: no empty "Not needed" screen in between.
    await expect(page.getByText("Step 6 of 8")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Warden pack/ })).toBeVisible();
    await expect(page.getByText("Not needed")).toHaveCount(0);

    // The step list agrees.
    await page.getByRole("button", { name: "All steps" }).click();
    await expect(page.getByRole("navigation", { name: "Build steps" }).getByText("Spells & resources")).toHaveCount(0);
    await page.getByRole("button", { name: "All steps" }).click();

    await page.getByRole("button", { name: /^Warden pack/ }).click();
    await next(page);
    await next(page);

    // Review records the absence rather than leaving it unexplained.
    await expect(page.getByRole("term").filter({ hasText: "Spellcasting" })).toBeVisible();
    await expect(page.getByText("None at this level")).toBeVisible();
  });
});

test.describe("builder navigation is one coherent structure", () => {
  test("the footer holds exactly two actions at the same height", async ({ page }) => {
    await openBuilder(page);
    const footer = page.locator(".m2-task-footer");
    const buttons = footer.locator("button");
    await expect(buttons).toHaveCount(2);
    await expect(buttons.nth(0)).toHaveText(/Back/);
    await expect(buttons.nth(1)).toHaveText(/Continue/);

    const [back, forward] = await Promise.all([
      buttons.nth(0).boundingBox(),
      buttons.nth(1).boundingBox(),
    ]);
    expect(back && forward).toBeTruthy();
    // Same vertical position and the same height: one row, not a stack.
    expect(Math.abs((back?.y ?? 0) - (forward?.y ?? 0))).toBeLessThanOrEqual(1);
    expect(Math.abs((back?.height ?? 0) - (forward?.height ?? 0))).toBeLessThanOrEqual(1);
  });

  test("progress and the step list live above the content, not in the action row", async ({ page }) => {
    await openBuilder(page);
    await expect(page.locator(".m2-task-footer").getByRole("button", { name: "All steps" })).toHaveCount(0);
    const steps = page.getByRole("button", { name: "All steps" });
    await expect(steps).toBeVisible();

    const [stepsBox, footerBox] = await Promise.all([
      steps.boundingBox(),
      page.locator(".m2-task-footer").boundingBox(),
    ]);
    expect((stepsBox?.y ?? 0) + (stepsBox?.height ?? 0)).toBeLessThanOrEqual(footerBox?.y ?? 0);

    const progress = page.getByRole("progressbar");
    await expect(progress).toHaveAttribute("aria-valuenow", "1");
    await expect(progress).toHaveAttribute("aria-valuemax", "8");
  });

  for (const width of [320, 375, 390, 412, 768, 1280]) {
    test(`the footer never covers content or overflows at ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await openBuilder(page);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `document overflows horizontally at ${width} px`).toBeLessThanOrEqual(0);

      const buttons = page.locator(".m2-task-footer button");
      await expect(buttons).toHaveCount(2);
      const [back, forward] = await Promise.all([buttons.nth(0).boundingBox(), buttons.nth(1).boundingBox()]);
      expect(Math.abs((back?.y ?? 0) - (forward?.y ?? 0)), `footer wrapped at ${width} px`).toBeLessThanOrEqual(1);
      // Both remain inside the viewport.
      for (const box of [back, forward]) expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width + 1);
    });
  }

  test("a long name does not push the document sideways", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await reachAbilities(page);
    for (const [ability, value] of [
      ["Strength", "14"],
      ["Dexterity", "15"],
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
    await page.getByLabel("Nickname").fill("Brammel Voss of the Long River Crossing and the Farther Shore");

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("standard array assignment", () => {
  test("shows remaining slots and the modifier each assignment produces", async ({ page }) => {
    await reachAbilities(page);
    const remaining = page.locator(".m2-remaining-chip");
    // Six unassigned slots, one chip each.
    await expect(remaining).toHaveCount(6);

    await page.getByLabel("Strength", { exact: true }).selectOption("15");
    await expect(remaining).toHaveCount(5);
    // 15 + the origin increase is not applied yet, so the modifier is for 15.
    await expect(page.getByLabel("Strength final")).toContainText("+2");

    await page.getByLabel("Dexterity", { exact: true }).selectOption("14");
    await expect(page.getByLabel("Dexterity final")).toContainText("+2");
    await expect(remaining).toHaveCount(4);
  });

  test("one value instance cannot be assigned twice", async ({ page }) => {
    await reachAbilities(page);
    await page.getByLabel("Strength", { exact: true }).selectOption("15");
    // Wait for the assignment to settle before reading the other selects: the
    // remaining pool is what the option lists are derived from.
    await expect(page.locator(".m2-remaining-chip")).toHaveCount(5);

    // The array holds a single 15, so no other ability may still offer it.
    const dexterityOptions = await page
      .getByLabel("Dexterity", { exact: true })
      .locator("option")
      .allTextContents();
    expect(dexterityOptions).not.toContain("15");
  });

  test("reassignment returns the value without clearing unrelated abilities", async ({ page }) => {
    await reachAbilities(page);
    await page.getByLabel("Strength", { exact: true }).selectOption("15");
    await page.getByLabel("Dexterity", { exact: true }).selectOption("14");

    await page.getByLabel("Strength", { exact: true }).selectOption("");
    // Dexterity is untouched and 15 is back in the pool.
    await expect(page.getByLabel("Dexterity", { exact: true })).toHaveValue("14");
    await expect(page.locator(".m2-remaining-chip").filter({ hasText: /^15$/ })).toHaveCount(1);
  });

  test("assignments survive autosave, reopening and a mode round trip", async ({ page }) => {
    await reachAbilities(page);
    await page.getByLabel("Strength", { exact: true }).selectOption("15");
    await page.getByLabel("Dexterity", { exact: true }).selectOption("14");

    // Guided -> flexible -> guided must not reset anything.
    await page.getByRole("button", { name: /mode$/ }).click();
    await page.getByRole("button", { name: /mode$/ }).click();
    await expect(page.getByLabel("Strength", { exact: true })).toHaveValue("15");

    await page.reload();
    await page.getByRole("button", { name: /Resume building/ }).click();
    await expect(page.getByLabel("Strength", { exact: true })).toHaveValue("15");
    await expect(page.getByLabel("Dexterity", { exact: true })).toHaveValue("14");
  });

  test("is fully operable with the keyboard", async ({ page }) => {
    await reachAbilities(page);
    // Every ability control is a native select, reachable in source order by
    // Tab alone. Whether a given key opens the popup or moves the selection is
    // platform behaviour; being in the tab order is what the app owns.
    const abilities = ["Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma"];
    await page.getByLabel(abilities[0], { exact: true }).focus();
    await expect(page.getByLabel(abilities[0], { exact: true })).toBeFocused();

    for (const ability of abilities.slice(1)) {
      await page.keyboard.press("Tab");
      await expect(page.getByLabel(ability, { exact: true }), `${ability} should follow in the tab order`).toBeFocused();
    }

    // A keyboard-driven change is reflected in the remaining pool.
    await page.getByLabel("Charisma", { exact: true }).selectOption("8");
    await expect(page.locator(".m2-remaining-chip")).toHaveCount(5);
    await expect(page.getByLabel("Charisma final")).toContainText("-1");
  });

  test("stays usable at 320 px without horizontal drift", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await reachAbilities(page);
    await page.getByLabel("Strength", { exact: true }).selectOption("15");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
