import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { ADOBE_FONTS_ORIGIN } from "@/src/config/fonts";
import { scalePackJson } from "@/tests/fixtures/sheet-scale-ruleset";

/**
 * The evidence for the Character-management pass, measured rather than eyeballed.
 *
 * "The sheet is denser now" is not something anybody can check. This file
 * records the numbers that decide it — the height of the glance header, how much
 * of the first phone screen is the section the user actually opened, what a row
 * costs, and what a closed Character workspace costs — and fails if any of them
 * regresses past the ceiling this pass established. It attaches the screenshots
 * at the same time, so the picture and the number come from one run of one build.
 *
 * The ceilings are maxima, not exact values. A later change may make a surface
 * tighter still; it may not quietly make it looser. The floors are asserted
 * alongside them, because the point was density and not shrinkage: every control
 * on every screen measured here is still a 44 px target.
 *
 * Measured against the baseline at 9b09605 on a 360 x 780 Galaxy S23-class
 * viewport:
 *
 *   glance header            265 px → 156 px
 *   first-screen content     44-46% → 51-60%
 *   action row                57 px →  50 px
 *   inventory row             48 px →  48 px (with the description moved off it)
 *   Character, level 12     2314 px → 790 px, four closed groups
 */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const APP_ROOT = `${BASE_PATH}/`;
const S23 = { width: 360, height: 780 } as const;
const PHONE_WIDTHS = [320, 360, 375, 390, 412] as const;

/** Ceilings this pass established. Exceeding one is a density regression. */
const MAX_GLANCE_HEIGHT = 175;
const MAX_ACTION_ROW = 56;
const MAX_INVENTORY_ROW = 56;
const MAX_CLOSED_GROUP = 64;
const MAX_CLOSED_CHARACTER_DOCUMENT = 1000;
/** Floors. Nothing here may shrink below the readability and target contracts. */
const MIN_TOUCH_TARGET = 44;

const next = (page: Page) => page.getByRole("button", { name: "Continue" }).click();
const blockAdobeFonts = (page: Page) => page.route(`${ADOBE_FONTS_ORIGIN}/**`, route => route.abort());

async function attach(page: Page, testInfo: TestInfo, name: string) {
  await testInfo.attach(name, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
}

async function buildMartial(page: Page, name = "Brammel Voss") {
  await page.goto(APP_ROOT);
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
}

async function buildCaster(page: Page, name = "Sereth Marsh") {
  await page.goto(APP_ROOT);
  await page.getByRole("button", { name: "New character" }).last().click();
  await page.getByLabel("Character name", { exact: true }).fill(name);
  await next(page);
  await page.getByRole("button", { name: /^Runecaller/ }).click();
  await next(page);
  await page.getByRole("button", { name: /^Riverborn/ }).click();
  await next(page);
  await page.getByRole("button", { name: /^Caravan Warden/ }).click();
  await page.getByRole("button", { name: /^River Signs/ }).click();
  await next(page);
  for (const [ability, value] of [
    ["Strength", "10"],
    ["Dexterity", "14"],
    ["Constitution", "13"],
    ["Intelligence", "12"],
    ["Wisdom", "15"],
    ["Charisma", "8"],
  ] as const)
    await page.getByLabel(ability, { exact: true }).selectOption(value);
  await page.getByLabel("+2 to").selectOption("dexterity");
  await page.getByLabel("+1 to").selectOption("constitution");
  await next(page);
  await page.getByRole("button", { name: /^Riverlore/ }).click();
  await next(page);
  // Spells & resources owes two cantrips and two runes since the caster
  // spell-selection slice landed, so the step is answered rather than skipped.
  for (const spell of ["Silt Whisper", "Tally Mark", "Stone Reading", "Quiet the Wake"])
    await page.getByRole("button", { name: new RegExp(`^${spell}`) }).click();
  await next(page);
  await page.getByRole("button", { name: /^River kit/ }).click();
  await next(page);
  await next(page);
  await page.getByRole("button", { name: "Finish and open sheet" }).click();
  await expect(page.getByRole("heading", { name, level: 2 })).toBeVisible();
}

async function importScalePack(page: Page) {
  await page.goto(APP_ROOT);
  await page.getByRole("button", { name: "Settings", exact: true }).last().click();
  await page.getByRole("button", { name: "Imports and exports" }).click();
  await page.getByLabel("Pack JSON").fill(scalePackJson());
  await page.getByRole("button", { name: "Preview import" }).click();
  await expect(page.getByRole("heading", { name: "Ready to import" })).toBeVisible();
  await page.getByLabel("Create a ruleset profile so this content can be selected in the builder").check();
  await page.getByRole("button", { name: "Confirm atomic import" }).click();
  await expect(page.getByText(/ruleset profile\(s\) created and ready to select/)).toBeVisible();
}

/** Polls a condition to a deadline and reports whether it became true. */
async function became(condition: () => Promise<boolean>, timeout = 10000): Promise<boolean> {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await condition()) return true;
    if (Date.now() > deadline) return false;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

const isShowing = (locator: ReturnType<Page["getByRole"]>) => locator.isVisible().catch(() => false);

/**
 * Walks whatever creation steps a build still owes, and commits it.
 *
 * Driven by the step counter the builder prints rather than by a fixed number of
 * presses: an iteration that does not advance answers the same step again
 * instead of spending one of a small budget, which is how this used to fail on a
 * loaded runner with a timeout twenty seconds away from its actual cause.
 */
async function finishRemainingSteps(page: Page, options: { skills: readonly string[]; subclass: RegExp }) {
  const counter = page.getByText(/Step \d+ of \d+/).first();
  const finish = page.getByRole("button", { name: "Finish and open sheet" });
  const stepNumber = async () =>
    Number.parseInt(/Step (\d+) of/.exec((await counter.textContent().catch(() => "")) ?? "")?.[1] ?? "0", 10);

  for (let attempt = 0; attempt < 16; attempt += 1) {
    const advance = page.getByRole("button", { name: "Continue" });
    /*
     * Wait for a way forward, not for the step counter. The counter is how
     * progress is detected, and it is briefly detached while the builder swaps
     * one step for the next — so requiring it before acting made a transition
     * into a failure. What has to be on screen is a control.
     */
    if (!(await became(async () => (await isShowing(advance)) || (await isShowing(finish))))) break;
    if (await isShowing(finish)) {
      await finish.click();
      return;
    }

    const before = await stepNumber();

    for (const skill of options.skills) {
      const option = page.getByRole("button", { name: new RegExp(`^${skill}`) }).first();
      if (await isShowing(option)) await option.click();
    }
    const subclass = page.getByRole("button", { name: options.subclass }).first();
    if (await isShowing(subclass)) await subclass.click();

    // The footer re-enables only once the step's navigation is persisted.
    await expect(advance).toBeEnabled();
    await advance.click();
    await became(async () => (await isShowing(finish)) || (await stepNumber()) !== before);
  }
  throw new Error("the builder never reached Review");
}

/** Builds the level 12 Bastionward: fifteen features, four pools, fourteen items. */
async function buildHighLevelMartial(page: Page, name = "Halric Stonewatch") {
  await page.getByRole("button", { name: "Characters", exact: true }).click();
  await page.getByRole("button", { name: "New character" }).last().click();
  await page.getByLabel("Character name", { exact: true }).fill(name);
  await next(page);
  await page.getByRole("button", { name: /^Bastionward/ }).click();
  await page.getByLabel("Create this character at level").selectOption("12");
  await next(page);
  await page.getByRole("button", { name: /^Holdborn/ }).click();
  await next(page);
  await page.getByRole("button", { name: /^Toll Warden/ }).click();
  await next(page);
  for (const [index, ability] of (["Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma"] as const).entries())
    await page.getByLabel(ability, { exact: true }).selectOption(["15", "13", "14", "10", "12", "8"][index]);
  await page.getByLabel("+2 to").selectOption("strength");
  await page.getByLabel("+1 to").selectOption("constitution");
  await next(page);
  await finishRemainingSteps(page, { skills: ["Gatecraft", "Haulage"], subclass: /^Shieldwall/ });
  await expect(page.getByRole("heading", { name, level: 2 })).toBeVisible({ timeout: 20000 });
}

/** Everything the density comparison is judged on, read off one painted screen. */
async function density(page: Page) {
  await page.evaluate(() => window.scrollTo(0, 0));
  return page.evaluate(() => {
    const heights = (selector: string) =>
      Array.from(document.querySelectorAll(selector))
        .map(node => Math.round(node.getBoundingClientRect().height))
        .filter(value => value > 1);
    const median = (values: number[]) =>
      values.length ? [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)] : null;
    const panel = document.querySelector(".sheet-panel")?.getBoundingClientRect();
    const viewport = document.documentElement.clientHeight;
    const visible = panel ? Math.max(0, Math.min(viewport, panel.bottom) - Math.max(0, panel.top)) : 0;
    const glance = document.querySelector(".sheet-glance")?.getBoundingClientRect();
    const tabs = document.querySelector(".sheet-tabs");
    return {
      glanceHeight: glance ? Math.round(glance.height) : null,
      documentHeight: document.documentElement.scrollHeight,
      viewportHeight: viewport,
      firstScreenContentPct: Math.round((visible / viewport) * 100),
      rowHeight: median(heights(".sheet-panel .sheet-row")),
      closedGroupHeight: median(heights(".sheet-group:not(.sheet-group-open)")),
      groupCount: document.querySelectorAll(".sheet-panel .sheet-group").length,
      tabCount: document.querySelectorAll(".sheet-tabs [role=tab]").length,
      tabStripOverflow: tabs ? tabs.scrollWidth - tabs.clientWidth : null,
      tabWidths: Array.from(document.querySelectorAll<HTMLElement>(".sheet-tabs [role=tab]")).map(node =>
        Math.round(node.getBoundingClientRect().width),
      ),
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      undersized: Array.from(document.querySelectorAll<HTMLElement>("button"))
        .filter(node => node.offsetParent !== null)
        .map(node => ({ node, rect: node.getBoundingClientRect() }))
        .filter(item => item.rect.height + 0.5 < 44 || item.rect.width + 0.5 < 44)
        .map(item => `${item.node.className}:${Math.round(item.rect.width)}x${Math.round(item.rect.height)}`),
    };
  });
}

async function record(page: Page, testInfo: TestInfo, label: string) {
  const measured = await density(page);
  await testInfo.attach(`${label}.json`, {
    body: JSON.stringify(measured, null, 2),
    contentType: "application/json",
  });
  await attach(page, testInfo, `${label}.png`);
  return measured;
}

test.describe("sheet density at Galaxy S23 width", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(S23);
    test.slow();
  });

  test("a level 1 martial: every section, measured and pictured", async ({ page }, testInfo) => {
    await buildMartial(page);

    const overview = await record(page, testInfo, "martial-l1-overview");
    expect(overview.glanceHeight!, "the glance header has grown back").toBeLessThanOrEqual(MAX_GLANCE_HEIGHT);
    expect(overview.firstScreenContentPct, "less of the first screen is content").toBeGreaterThanOrEqual(55);
    expect(overview.undersized, "a control fell under the 44 px target").toEqual([]);
    expect(overview.tabCount, "a non-caster sheet has four sections").toBe(4);
    expect(overview.tabStripOverflow, "the four-tab strip must not scroll").toBeLessThanOrEqual(0);

    await page.getByRole("tab", { name: "Actions" }).click();
    const actions = await record(page, testInfo, "martial-l1-actions");
    expect(actions.rowHeight!, "an action row has grown").toBeLessThanOrEqual(MAX_ACTION_ROW);
    expect(actions.rowHeight!, "an action row is no longer a touch target").toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
    expect(actions.undersized).toEqual([]);

    await page.getByRole("tab", { name: "Inventory" }).click();
    const inventory = await record(page, testInfo, "martial-l1-inventory");
    expect(inventory.rowHeight!).toBeLessThanOrEqual(MAX_INVENTORY_ROW);
    expect(inventory.rowHeight!).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);

    await page.getByRole("tab", { name: "Character" }).click();
    const character = await record(page, testInfo, "martial-l1-character-closed");
    expect(character.closedGroupHeight!, "a closed group has grown").toBeLessThanOrEqual(MAX_CLOSED_GROUP);
    expect(character.closedGroupHeight!).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
    expect(character.documentHeight, "a closed Character workspace is a long scroll again").toBeLessThanOrEqual(
      MAX_CLOSED_CHARACTER_DOCUMENT,
    );
    expect(character.groupCount, "Character rendered no groups").toBeGreaterThanOrEqual(3);

    await page.getByRole("button", { name: /^Class & subclass/ }).first().click();
    await record(page, testInfo, "martial-l1-character-expanded");
  });

  test("a level 1 caster: five sections, all of them on screen", async ({ page }, testInfo) => {
    await buildCaster(page);
    const overview = await record(page, testInfo, "caster-l1-overview");
    expect(overview.tabCount, "a caster sheet has five sections").toBe(5);
    expect(overview.tabStripOverflow, "the five-tab strip must not scroll").toBeLessThanOrEqual(0);
    expect(Math.max(...overview.tabWidths) - Math.min(...overview.tabWidths), "the tabs are an equal grid").toBeLessThanOrEqual(1);

    await page.getByRole("tab", { name: "Spells" }).click();
    const spells = await record(page, testInfo, "caster-l1-spells");
    expect(spells.glanceHeight!).toBeLessThanOrEqual(MAX_GLANCE_HEIGHT);
    expect(spells.undersized).toEqual([]);
  });

  /**
   * The size the flat sheet actually broke at. Twelve levels of features, four
   * resource pools and a fourteen-line kit, on a phone.
   */
  test("a level 12 martial and a level 9 caster stay operable", async ({ page }, testInfo) => {
    await importScalePack(page);
    await buildHighLevelMartial(page);

    const overview = await record(page, testInfo, "martial-l12-overview");
    expect(overview.glanceHeight!).toBeLessThanOrEqual(MAX_GLANCE_HEIGHT);
    expect(overview.firstScreenContentPct).toBeGreaterThanOrEqual(55);

    await page.getByRole("tab", { name: "Actions" }).click();
    const actions = await record(page, testInfo, "martial-l12-actions");
    expect(actions.rowHeight!).toBeLessThanOrEqual(MAX_ACTION_ROW);
    expect(actions.undersized).toEqual([]);

    await page.getByRole("tab", { name: "Inventory" }).click();
    const inventory = await record(page, testInfo, "martial-l12-inventory");
    expect(inventory.rowHeight!).toBeLessThanOrEqual(MAX_INVENTORY_ROW);

    await page.getByRole("tab", { name: "Character" }).click();
    const character = await record(page, testInfo, "martial-l12-character-closed");
    expect(
      character.documentHeight,
      "fifteen features must not be fifteen open rows",
    ).toBeLessThanOrEqual(MAX_CLOSED_CHARACTER_DOCUMENT);
    await page.getByRole("button", { name: /^Class & subclass/ }).first().click();
    await record(page, testInfo, "martial-l12-character-expanded");
  });
});

test.describe("the phone contract holds on the rebuilt sheet", () => {
  for (const width of PHONE_WIDTHS) {
    test(`every section fits at ${width} px`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "mobile", "The phone contract runs once, in the mobile project.");
      test.slow();
      await page.setViewportSize({ width, height: 780 });
      await buildCaster(page, "Width Walker");

      for (const tab of ["Overview", "Actions", "Spells", "Inventory", "Character"]) {
        await page.getByRole("tab", { name: tab }).click();
        const measured = await density(page);
        expect(measured.documentOverflow, `${tab} scrolls sideways at ${width} px`).toBeLessThanOrEqual(0);
        expect(measured.tabStripOverflow, `the tab strip scrolls at ${width} px`).toBeLessThanOrEqual(0);
        expect(measured.undersized, `a control is under 44 px on ${tab} at ${width} px`).toEqual([]);
      }

      // And with every Character group open, which is the widest state it has.
      await page.getByRole("tab", { name: "Character" }).click();
      const groups = page.getByRole("button", { name: /^(Class & subclass|Species|Background|Proficiencies & training)/ });
      for (let index = 0; index < (await groups.count()); index += 1) {
        await groups.nth(index).click();
        const measured = await density(page);
        expect(measured.documentOverflow, `an open group overflows at ${width} px`).toBeLessThanOrEqual(0);
      }
    });
  }

  test("the layout survives Adobe Fonts never arriving", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "The phone contract runs once, in the mobile project.");
    test.slow();
    await blockAdobeFonts(page);
    await page.setViewportSize(S23);
    await buildCaster(page, "Fallback Walker");

    expect(await page.evaluate(() => document.fonts.size), "the typekit was not actually blocked").toBe(0);
    for (const tab of ["Overview", "Actions", "Spells", "Inventory", "Character"]) {
      await page.getByRole("tab", { name: tab }).click();
      const measured = await density(page);
      expect(measured.documentOverflow, `${tab} scrolls sideways with the fallback`).toBeLessThanOrEqual(0);
      expect(measured.undersized, `a control is under 44 px on ${tab} with the fallback`).toEqual([]);
      expect(measured.glanceHeight!, "the fallback glance header is looser").toBeLessThanOrEqual(MAX_GLANCE_HEIGHT + 12);
    }
    await attach(page, testInfo, "caster-fallback-character.png");
  });
});

test.describe("the Runefolio brand header", () => {
  test("is one centred unit, larger than before and still not a masthead", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "This is the phone chrome contract.");
    test.slow();
    await page.setViewportSize(S23);
    await buildMartial(page, "Brand Walker");

    const measured = await page.evaluate(() => {
      const bar = document.querySelector(".m2-appbar")!.getBoundingClientRect();
      const brand = document.querySelector(".m2-appbar-brand")!.getBoundingClientRect();
      const wordmark = document.querySelector<HTMLElement>(".m2-appbar-brand strong")!;
      const logo = document.querySelector<HTMLElement>(".m2-appbar-brand img");
      const name = document.querySelector<HTMLElement>(".sheet-identity h2")!;
      const style = getComputedStyle(wordmark);
      return {
        leftGap: Math.round(brand.left - bar.left),
        rightGap: Math.round(bar.right - brand.right),
        barHeight: Math.round(bar.height),
        wordmarkSize: Number.parseFloat(style.fontSize),
        wordmarkWeight: Number.parseInt(style.fontWeight, 10),
        wordmarkFamily: style.fontFamily,
        logoWidth: logo ? Math.round(logo.getBoundingClientRect().width) : null,
        characterNameSize: Number.parseFloat(getComputedStyle(name).fontSize),
        // Nothing but the wordmark is in the bar, and no spacer is holding it.
        barChildren: document.querySelectorAll(".m2-appbar > *").length,
      };
    });
    await testInfo.attach("brand-header.json", { body: JSON.stringify(measured, null, 2), contentType: "application/json" });
    await attach(page, testInfo, "brand-header.png");

    // Centred as one unit: equal space either side, to within a rounding pixel.
    expect(Math.abs(measured.leftGap - measured.rightGap), "the brand is not centred").toBeLessThanOrEqual(1);
    // No phantom spacer keeping it there.
    expect(measured.barChildren, "the app bar holds something besides the brand").toBe(1);
    // Visibly larger than the 17 px it was, and still Bookmania Bold.
    expect(measured.wordmarkSize).toBeGreaterThanOrEqual(20);
    expect(measured.wordmarkWeight).toBeGreaterThanOrEqual(700);
    expect(measured.wordmarkFamily).toContain("bookmania");
    // The logo scaled with it rather than staying at its old size.
    expect(measured.logoWidth!).toBeGreaterThanOrEqual(32);
    // Compact, not a hero banner, and still subordinate to the character's name.
    expect(measured.barHeight, "the app bar has become a banner").toBeLessThanOrEqual(64);
    expect(measured.wordmarkSize).toBeLessThan(measured.characterNameSize);
  });

  /**
   * The rule that actually caps the wordmark: it must not match or outgrow the
   * title of the screen underneath it, and the smallest of those is a creation
   * step heading. Read from the painted page rather than restated as a number.
   */
  test("stays smaller than the smallest screen title in the app", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "This is the phone chrome contract.");
    await page.setViewportSize(S23);
    await page.goto(APP_ROOT);
    await page.getByRole("button", { name: "New character" }).last().click();
    await page.getByLabel("Character name", { exact: true }).fill("Type Probe");
    await next(page);
    await expect(page.getByRole("heading", { level: 2 }).first()).toHaveText("Class & level");

    const sizes = await page.evaluate(() => ({
      wordmark: Number.parseFloat(getComputedStyle(document.querySelector(".m2-appbar-brand strong")!).fontSize),
      stepTitle: Number.parseFloat(getComputedStyle(document.querySelector(".m2-builder-head h2")!).fontSize),
    }));
    expect(sizes.wordmark, "the wordmark has become a masthead").toBeLessThan(sizes.stepTitle);
  });

  test("keeps the same geometry on every surface", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "This is the phone chrome contract.");
    test.slow();
    await page.setViewportSize(S23);

    const geometry = () =>
      page.evaluate(() => {
        const bar = document.querySelector(".m2-appbar")!.getBoundingClientRect();
        const brand = document.querySelector(".m2-appbar-brand")!.getBoundingClientRect();
        return {
          height: Math.round(bar.height),
          leftGap: Math.round(brand.left - bar.left),
          rightGap: Math.round(bar.right - brand.right),
        };
      });

    const measured: Awaited<ReturnType<typeof geometry>>[] = [];
    await page.goto(APP_ROOT);
    measured.push(await geometry());
    await buildMartial(page, "Geometry Walker");
    measured.push(await geometry());
    await page.getByRole("button", { name: "Compendium" }).click();
    await expect(page.locator(".entrycard").first()).toBeVisible();
    measured.push(await geometry());
    await page.getByRole("button", { name: "Settings", exact: true }).last().click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    measured.push(await geometry());

    expect(new Set(measured.map(item => item.height)).size, "the bar changes height between surfaces").toBe(1);
    expect(new Set(measured.map(item => item.leftGap)).size, "the brand moves between surfaces").toBe(1);
    for (const item of measured) expect(Math.abs(item.leftGap - item.rightGap)).toBeLessThanOrEqual(1);
  });
});
