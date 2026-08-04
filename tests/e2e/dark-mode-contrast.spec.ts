import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Dark browser preference must not make typed text invisible.
 *
 * The app is a light-only design. When it declared `color-scheme: light dark`
 * without shipping any dark rules, Chromium applied its dark user-agent colour
 * to form controls — white text — while the app's own CSS kept forcing a light
 * background. Every text field rendered at roughly 1.04:1, so a name could be
 * typed, stored and read back from the DOM while being completely unreadable.
 *
 * These tests therefore assert *contrast*, not presence: a value being in the
 * DOM proves nothing about whether a person can see it. The whole suite runs
 * under `prefers-color-scheme: dark`, which is the majority setting on phones
 * and the one the rest of the browser matrix never exercised.
 */
test.use({ colorScheme: "dark" });

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const APP_ROOT = `${BASE_PATH}/`;
/** WCAG 2.1 AA for normal-size body text. */
const AA_NORMAL_TEXT = 4.5;
const BLOCKING = new Set(["serious", "critical"]);

/**
 * Computed foreground/background contrast for one element.
 *
 * The background is walked up the ancestor chain because a transparent control
 * takes the colour painted behind it, which is exactly the case that produced
 * the original defect.
 */
async function contrastOf(target: Locator): Promise<{ color: string; background: string; ratio: number }> {
  return target.evaluate(element => {
    const channel = (value: number) => (value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4));
    const parse = (value: string) => (value.match(/[\d.]+/g) ?? []).map(Number);
    const luminance = (value: string) => {
      const [r, g, b] = parse(value);
      return 0.2126 * channel(r / 255) + 0.7152 * channel(g / 255) + 0.0722 * channel(b / 255);
    };
    const opaqueBackground = (node: Element | null): string => {
      for (let current = node; current; current = current.parentElement) {
        const value = getComputedStyle(current).backgroundColor;
        const parts = parse(value);
        if (parts.length >= 3 && (parts[3] === undefined || parts[3] > 0)) return value;
      }
      return "rgb(255, 255, 255)";
    };
    const style = getComputedStyle(element);
    const color = style.color;
    const background = opaqueBackground(element);
    const [high, low] = [luminance(color), luminance(background)].sort((left, right) => right - left);
    return { color, background, ratio: (high + 0.05) / (low + 0.05) };
  });
}

async function expectReadable(target: Locator, label: string) {
  const measured = await contrastOf(target);
  expect(
    measured.ratio,
    `${label} must be readable in dark mode, but ${measured.color} on ${measured.background} is ${measured.ratio.toFixed(2)}:1`,
  ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
}

async function scan(page: Page, surface: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const blocking = results.violations.filter(violation => BLOCKING.has(violation.impact ?? ""));
  expect(
    blocking.map(violation => `${violation.impact}: ${violation.id} (${violation.nodes.length} node(s))`),
    `serious or critical accessibility violations on ${surface}`,
  ).toEqual([]);
}

const next = (page: Page) => page.getByRole("button", { name: "Continue" }).click();

/**
 * Advances until `target` is on screen.
 *
 * The number of steps between Class choices and Equipment depends on whether
 * the ruleset's class has applicable spell choices, so this walks rather than
 * assuming a fixed count.
 */
async function advanceUntil(page: Page, target: Locator, limit = 3) {
  for (let attempt = 0; attempt < limit; attempt += 1) {
    if (await target.isVisible().catch(() => false)) return;
    await next(page);
  }
  await expect(target).toBeVisible();
}

async function openBuilder(page: Page) {
  await page.goto(APP_ROOT);
  await page.getByRole("button", { name: "New character" }).first().click();
  await expect(page.getByText("Step 1 of")).toBeVisible();
}

/** Walks to Identity so a real text field can be typed into and measured. */
async function reachIdentity(page: Page) {
  await openBuilder(page);
  await next(page);
  await page.getByRole("button", { name: /^Vanguard/ }).click();
  await next(page);
  await page.getByRole("button", { name: /^Riverborn/ }).click();
  await page.getByRole("button", { name: /^Caravan Warden/ }).click();
  await page.getByRole("button", { name: /^Trade Cant/ }).click();
  await next(page);
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
  await page.getByRole("button", { name: /^Watchcraft/ }).click();
  await page.getByRole("button", { name: /^Haulage/ }).click();
  const wardenPack = page.getByRole("button", { name: /^Warden pack/ });
  await advanceUntil(page, wardenPack);
  await wardenPack.click();
  await next(page);
  await expect(page.getByRole("heading", { name: "Identity", level: 3 })).toBeVisible();
}

test.describe("dark browser preference keeps typed text readable", () => {
  test("a character name is visible, not merely present in the DOM", async ({ page }) => {
    await reachIdentity(page);
    const name = page.getByLabel("Name", { exact: true });
    await name.fill("Brammel Voss");

    // The value round-trips...
    await expect(name).toHaveValue("Brammel Voss");
    // ...and, critically, a person can actually see it.
    await expectReadable(name, "the Name field");
  });

  test("the ability selects and their values are readable", async ({ page }) => {
    await openBuilder(page);
    await next(page);
    await page.getByRole("button", { name: /^Vanguard/ }).click();
    await next(page);
    await page.getByRole("button", { name: /^Riverborn/ }).click();
    await page.getByRole("button", { name: /^Caravan Warden/ }).click();
    await page.getByRole("button", { name: /^Trade Cant/ }).click();
    await next(page);

    const strength = page.getByLabel("Strength", { exact: true });
    await strength.selectOption("14");
    await expect(strength).toHaveValue("14");
    await expectReadable(strength, "the Strength ability select");
  });

  test("the play sheet damage amount input is readable", async ({ page }) => {
    await reachIdentity(page);
    await page.getByLabel("Name", { exact: true }).fill("Brammel Voss");
    await next(page);
    await page.getByRole("button", { name: "Finish and open sheet" }).click();
    await expect(page.getByRole("heading", { name: "Brammel Voss", level: 2 })).toBeVisible();

    const amount = page.getByLabel("Amount", { exact: true });
    await amount.fill("3");
    await expect(amount).toHaveValue("3");
    await expectReadable(amount, "the play-sheet Amount input");
  });

  test("every form control on the builder meets AA contrast", async ({ page }) => {
    await reachIdentity(page);
    const controls = page.locator("input:visible, select:visible, textarea:visible");
    const total = await controls.count();
    expect(total, "expected the Identity step to expose text fields").toBeGreaterThan(0);
    for (let index = 0; index < total; index += 1)
      await expectReadable(controls.nth(index), `builder control #${index + 1}`);
  });

  test("axe reports no serious or critical violations on the builder", async ({ page }) => {
    await reachIdentity(page);
    await scan(page, "the builder in dark mode");
  });

  test("axe reports no serious or critical violations on the play sheet", async ({ page }) => {
    await reachIdentity(page);
    await page.getByLabel("Name", { exact: true }).fill("Brammel Voss");
    await next(page);
    await page.getByRole("button", { name: "Finish and open sheet" }).click();
    await expect(page.getByRole("heading", { name: "Brammel Voss", level: 2 })).toBeVisible();
    await scan(page, "the play sheet in dark mode");
  });
});
