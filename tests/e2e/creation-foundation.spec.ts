import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * The user-facing side of the real-content creation foundation.
 *
 * The service layer for these capabilities landed first and could not be
 * exercised by a person; these tests drive the actual UI. They use only the
 * public-original synthetic slice that ships with the app.
 */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const APP_ROOT = `${BASE_PATH}/`;
const BLOCKING = new Set(["serious", "critical"]);

const next = (page: Page) => page.getByRole("button", { name: "Continue" }).click();

async function openBuilder(page: Page) {
  await page.goto(APP_ROOT);
  await page.getByRole("button", { name: "New character" }).last().click();
  await expect(page.getByText(/^Step 1 of/)).toBeVisible();
}

test.describe("first creation step: identity, ruleset and level", () => {
  test("asks for the name first and saves it as it is typed", async ({ page }) => {
    await openBuilder(page);
    const name = page.getByLabel("Character name");
    await expect(name).toBeVisible();
    await name.fill("Wren Halloway");

    // Saved during entry, not only on Continue: leaving and returning keeps it.
    await next(page);
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByLabel("Character name")).toHaveValue("Wren Halloway");
  });

  test("keeps the name through a reload and a mode switch", async ({ page }) => {
    await openBuilder(page);
    await page.getByLabel("Character name").fill("Wren Halloway");
    await next(page);

    await page.getByRole("button", { name: /mode$/ }).click();
    await page.getByRole("button", { name: /mode$/ }).click();

    await page.reload();
    await page.getByRole("button", { name: /Resume building/ }).click();
    // Visible in the compact header after the first step.
    await expect(page.getByText("Wren Halloway").first()).toBeVisible();
  });

  test("shows the ruleset as an explicit choice", async ({ page }) => {
    await openBuilder(page);
    const ruleset = page.getByLabel("Build against");
    await expect(ruleset).toBeVisible();
    const options = await ruleset.locator("option").allTextContents();
    expect(options.length).toBeGreaterThan(0);
    // The installed synthetic profile is named, not silently assumed.
    expect(options.join(" ")).toMatch(/runefolio/i);
  });

  test("does not offer pronouns as a creation field", async ({ page }) => {
    await openBuilder(page);
    await expect(page.getByLabel("Pronouns")).toHaveCount(0);
  });

  test("changing the target level changes which choices are required", async ({ page }) => {
    await openBuilder(page);
    await page.getByLabel("Character name").fill("Wren Halloway");
    // The synthetic slice supports 1–2, so 2 is the reachable higher target.
    await page.getByLabel("Create at level").selectOption("2");
    await expect(page.getByText(/Every choice from level 1 to 2/)).toBeVisible();

    // Reducing it again is not destructive.
    await page.getByLabel("Create at level").selectOption("1");
    await expect(page.getByLabel("Create at level")).toHaveValue("1");
  });
});

test.describe("choices carry their source and level", () => {
  async function reachClassChoices(page: Page) {
    await openBuilder(page);
    await page.getByLabel("Character name").fill("Wren Halloway");
    await next(page);
    await page.getByRole("button", { name: /^Vanguard/ }).click();
    await next(page);
    await page.getByRole("button", { name: /^Riverborn/ }).click();
    await page.getByRole("button", { name: /^Caravan Warden/ }).click();
    await page.getByRole("button", { name: /^Trade Cant/ }).click();
    await next(page);
    for (const [ability, value] of [
      ["Strength", "15"], ["Dexterity", "14"], ["Constitution", "13"],
      ["Intelligence", "12"], ["Wisdom", "10"], ["Charisma", "8"],
    ] as const)
      await page.getByLabel(ability, { exact: true }).selectOption(value);
    await page.getByLabel("+2 to").selectOption("strength");
    await page.getByLabel("+1 to").selectOption("constitution");
    await next(page);
  }

  test("names the entry a choice comes from", async ({ page }) => {
    await reachClassChoices(page);
    // Every presented choice states its origin rather than floating free.
    await expect(page.locator(".m2-choice-source").first()).toBeVisible();
    await expect(page.locator(".m2-choice-source").first()).toContainText(/From /);
  });

  test("origin-step choices are grouped with their own source", async ({ page }) => {
    await openBuilder(page);
    await next(page);
    await page.getByRole("button", { name: /^Vanguard/ }).click();
    await next(page);
    await page.getByRole("button", { name: /^Riverborn/ }).click();
    await page.getByRole("button", { name: /^Caravan Warden/ }).click();
    // The background's language choice is discovered and attributed.
    await expect(page.locator(".m2-choice-source").first()).toContainText(/Caravan Warden/);
  });
});

test.describe("accessibility and layout of the new step", () => {
  for (const scheme of ["light", "dark"] as const) {
    test(`the first step has no serious or critical violations in ${scheme} mode`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await openBuilder(page);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      const blocking = results.violations.filter(violation => BLOCKING.has(violation.impact ?? ""));
      expect(
        blocking.map(violation => `${violation.impact}: ${violation.id}`),
        `violations on the first step in ${scheme} mode`,
      ).toEqual([]);
    });
  }

  test("the name field is readable under a dark colour preference", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await openBuilder(page);
    const name = page.getByLabel("Character name");
    await name.fill("Wren Halloway");
    const ratio = await name.evaluate(element => {
      const channel = (value: number) => (value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4));
      const parse = (value: string) => (value.match(/[\d.]+/g) ?? []).map(Number);
      const luminance = (value: string) => {
        const [r, g, b] = parse(value);
        return 0.2126 * channel(r / 255) + 0.7152 * channel(g / 255) + 0.0722 * channel(b / 255);
      };
      const style = getComputedStyle(element);
      const [high, low] = [luminance(style.color), luminance(style.backgroundColor)].sort((a, b) => b - a);
      return (high + 0.05) / (low + 0.05);
    });
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  for (const width of [320, 375, 390, 412, 768, 1280]) {
    test(`the first step does not overflow at ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await openBuilder(page);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `document overflows at ${width} px`).toBeLessThanOrEqual(0);
    });
  }

  test("is operable with the keyboard alone", async ({ page }) => {
    await openBuilder(page);
    const name = page.getByLabel("Character name");
    await name.focus();
    await expect(name).toBeFocused();
    await page.keyboard.type("Wren Halloway");
    await expect(name).toHaveValue("Wren Halloway");
    // Tab reaches the ruleset and level controls in order.
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Build against")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Create at level")).toBeFocused();
  });
});
