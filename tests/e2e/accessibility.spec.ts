import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * AC-17: automated accessibility checks must report no serious or critical
 * violations on the slice routes. Only serious and critical impacts fail the
 * build; moderate and minor findings are printed for review so a cosmetic
 * finding never silently blocks a release.
 */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const APP_ROOT = `${BASE_PATH}/`;
const BLOCKING = new Set(["serious", "critical"]);

async function scan(page: Page, surface: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const blocking = results.violations.filter(violation => BLOCKING.has(violation.impact ?? ""));
  expect(
    blocking.map(violation => `${violation.impact}: ${violation.id} (${violation.nodes.length} node(s))`),
    `serious or critical accessibility violations on ${surface}`,
  ).toEqual([]);
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

const ABILITY_ASSIGNMENT: readonly [string, string][] = [
  ["Strength", "14"],
  ["Dexterity", "15"],
  ["Constitution", "13"],
  ["Intelligence", "12"],
  ["Wisdom", "10"],
  ["Charisma", "8"],
];

async function buildBrammel(page: Page) {
  const next = () => page.getByRole("button", { name: "Continue" }).click();
  await next();
  await page.getByRole("button", { name: /^Vanguard/ }).click();
  await next();
  await page.getByRole("button", { name: /^Riverborn/ }).click();
  await page.getByRole("button", { name: /^Caravan Warden/ }).click();
  await page.getByRole("button", { name: /^Trade Cant/ }).click();
  await next();
  for (const [ability, value] of ABILITY_ASSIGNMENT) await page.getByLabel(ability, { exact: true }).selectOption(value);
  await page.getByLabel("+2 to").selectOption("strength");
  await page.getByLabel("+1 to").selectOption("constitution");
  await next();
  await page.getByRole("button", { name: /^Guarded Hand/ }).click();
  await page.getByRole("button", { name: /^Watchcraft/ }).click();
  await page.getByRole("button", { name: /^Haulage/ }).click();
  await next();
  await page.getByRole("button", { name: /^Warden pack/ }).click();
  await next();
  await page.getByLabel("Name", { exact: true }).fill("Brammel Voss");
  await next();
  await page.getByRole("button", { name: "Finish and open sheet" }).click();
  await expect(page.getByRole("heading", { name: "Brammel Voss", level: 2 })).toBeVisible();
}

test("the empty library has no serious or critical violations", async ({ page }) => {
  await page.goto(APP_ROOT);
  await expect(page.getByRole("heading", { name: "No characters on this device yet" })).toBeVisible();
  await scan(page, "empty library");
});

test("the builder has no serious or critical violations", async ({ page }) => {
  await page.goto(APP_ROOT);
  await page.getByRole("button", { name: "New character" }).last().click();
  await expect(page.getByText("Step 1 of 8")).toBeVisible();
  await scan(page, "builder, step 1");

  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Step 2 of 8")).toBeVisible();
  await scan(page, "builder, class step");
});

test("the play sheet and its details surface have no serious or critical violations", async ({ page }) => {
  await page.goto(APP_ROOT);
  await page.getByRole("button", { name: "New character" }).last().click();
  await buildBrammel(page);
  await scan(page, "play sheet");

  await page.getByRole("button", { name: /Explain Armour class/ }).click();
  await expect(page.getByRole("dialog", { name: "Armour class" })).toBeVisible();
  await scan(page, "value details dialog");
});

test("the level-up dialog has no serious or critical violations", async ({ page }) => {
  await page.goto(APP_ROOT);
  await page.getByRole("button", { name: "New character" }).last().click();
  await buildBrammel(page);
  await page.getByRole("button", { name: "Level up" }).click();
  await expect(page.getByRole("dialog", { name: "Level 1 to 2" })).toBeVisible();
  await scan(page, "level-up dialog");
});

test("settings and transfer have no serious or critical violations", async ({ page }) => {
  await page.goto(APP_ROOT);
  await openSettings(page);
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await scan(page, "settings");

  await page.getByRole("button", { name: /^Transfer$/ }).click();
  await expect(page.getByRole("heading", { name: "Transfer" })).toBeVisible();
  await scan(page, "transfer");
});
