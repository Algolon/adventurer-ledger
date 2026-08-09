import { expect, test, type Page } from "@playwright/test";
import { scalePackJson, SCALE_SPELL_COUNT } from "@/tests/fixtures/sheet-scale-ruleset";

/**
 * The character sheet's information architecture, driven through the real UI.
 *
 * The subject is scale. A level 1 martial and a level 12 one are the same
 * screen, and the second is where a flat sheet stops working: fifteen features,
 * four resource pools, a fourteen-line kit. The shapes that only exist at that
 * size are built as original content in `tests/fixtures/sheet-scale-ruleset.ts`
 * and imported here through the ordinary pipeline, so what these tests measure
 * is the sheet rendering real projected data rather than a mock.
 *
 * Two properties are load-bearing throughout:
 *
 * - **Character is progressive disclosure.** Groups are closed, they say what is
 *   inside them, and opening one is a keyboard operation as much as a tap.
 * - **The management boundary holds.** Play state is spendable from the sheet;
 *   build state has exactly one route, and it is not an inline control.
 */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const APP_ROOT = `${BASE_PATH}/`;
const S23 = { width: 360, height: 780 } as const;

const next = (page: Page) => page.getByRole("button", { name: "Continue" }).click();

/** Builds the shipped synthetic martial at level 1. */
async function buildMartial(page: Page, name: string) {
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

/** Builds one of the scale classes straight at a target level. */
async function buildScale(
  page: Page,
  options: { name: string; className: RegExp; level: number; subclass: RegExp; skills: readonly string[]; caster: boolean },
) {
  await page.getByRole("button", { name: "Characters", exact: true }).click();
  await page.getByRole("button", { name: "New character" }).last().click();
  await page.getByLabel("Character name", { exact: true }).fill(options.name);
  await next(page);

  await page.getByRole("button", { name: options.className }).click();
  await page.getByLabel("Create this character at level").selectOption(String(options.level));
  await next(page);

  await page.getByRole("button", { name: /^Holdborn/ }).click();
  await next(page);
  await page.getByRole("button", { name: /^Toll Warden/ }).click();
  await next(page);

  const scores = options.caster
    ? ["8", "13", "14", "15", "12", "10"]
    : ["15", "13", "14", "10", "12", "8"];
  for (const [index, ability] of (["Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma"] as const).entries())
    await page.getByLabel(ability, { exact: true }).selectOption(scores[index]);
  await page.getByLabel("+2 to").selectOption(options.caster ? "intelligence" : "strength");
  await page.getByLabel("+1 to").selectOption("constitution");
  await next(page);

  /*
   * The remaining steps differ per class and per level, so they are walked
   * rather than enumerated: answer whatever the step is asking, then Continue,
   * until Review offers to finish.
   */
  for (let guard = 0; guard < 8; guard += 1) {
    for (const skill of options.skills) {
      const option = page.getByRole("button", { name: new RegExp(`^${skill}`) }).first();
      if ((await option.count()) > 0 && (await option.isVisible())) await option.click();
    }
    const subclass = page.getByRole("button", { name: options.subclass }).first();
    if ((await subclass.count()) > 0 && (await subclass.isVisible())) await subclass.click();
    const finish = page.getByRole("button", { name: "Finish and open sheet" });
    if ((await finish.count()) > 0 && (await finish.isVisible())) {
      await finish.click();
      break;
    }
    await next(page);
  }
  await expect(page.getByRole("heading", { name: options.name, level: 2 })).toBeVisible({ timeout: 20000 });
}

const buildHighLevelMartial = (page: Page, name = "Halric Stonewatch") =>
  buildScale(page, {
    name,
    className: /^Bastionward/,
    level: 12,
    subclass: /^Shieldwall/,
    skills: ["Gatecraft", "Haulage"],
    caster: false,
  });

const buildHighLevelCaster = (page: Page, name = "Maerin Deepscript") =>
  buildScale(page, {
    name,
    className: /^Runespeaker/,
    level: 9,
    subclass: /^Deepscript/,
    skills: ["Holdlore", "Stonecraft"],
    caster: true,
  });

const characterTab = (page: Page) => page.getByRole("tab", { name: "Character" }).click();
const group = (page: Page, name: string | RegExp) => page.getByRole("button", { name }).first();

test.describe("the Character workspace discloses progressively", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(S23);
    test.slow();
  });

  test("opens as closed groups that each say what is inside them", async ({ page }) => {
    await importScalePack(page);
    await buildHighLevelMartial(page);
    await characterTab(page);

    // Every group states its own contents before it is opened — and states them
    // rather than restating the identity line already in the glance header.
    await expect(group(page, /^Class & subclass/)).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByText("Hit dice 12d10 · 15 entries")).toBeVisible();
    await expect(group(page, /^Species/)).toHaveAttribute("aria-expanded", "false");
    await expect(group(page, /^Proficiencies & training/)).toHaveAttribute("aria-expanded", "false");

    // Class, level, subclass and species are said once, on the glance header.
    await expect(page.getByText("Bastionward 12", { exact: false })).toHaveCount(1);
    await expect(page.getByText("Holdborn", { exact: false })).toHaveCount(1);

    // Fifteen class features exist and none of them is on screen yet.
    await expect(page.getByRole("button", { name: /^Set Footing/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Named Warden/ })).toHaveCount(0);

    // The whole workspace fits inside about one phone screen while closed.
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(height, "a closed Character workspace should not be a long scroll").toBeLessThan(1000);
  });

  test("each group is a heading as well as a control", async ({ page }) => {
    await buildMartial(page, "Landmark Walker");
    await characterTab(page);
    // Navigable by landmark, operable as a control: both roles resolve.
    await expect(page.getByRole("heading", { name: /Class & subclass/ })).toBeVisible();
    await expect(group(page, /^Class & subclass/)).toBeVisible();
    await expect(page.getByRole("heading", { name: /Proficiencies & training/ })).toBeVisible();
  });

  test("opening one group shows its features and closes the previous one", async ({ page }) => {
    await importScalePack(page);
    await buildHighLevelMartial(page);
    await characterTab(page);

    await group(page, /^Class & subclass/).click();
    await expect(group(page, /^Class & subclass/)).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("button", { name: /^Set Footing/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Named Warden/ })).toBeVisible();
    // Subclass features are here too, under the class that granted them.
    await expect(page.getByRole("button", { name: /^Shieldwall Drill/ })).toBeVisible();

    await group(page, /^Species/).click();
    await expect(group(page, /^Species/)).toHaveAttribute("aria-expanded", "true");
    await expect(group(page, /^Class & subclass/)).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("button", { name: /^Set Footing/ })).toHaveCount(0);
  });

  test("a group opens and closes from the keyboard", async ({ page }) => {
    await buildMartial(page, "Keyboard Walker");
    await characterTab(page);

    const header = group(page, /^Class & subclass/);
    await header.focus();
    await expect(header).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(header).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Enter");
    await expect(header).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("Space");
    await expect(header).toHaveAttribute("aria-expanded", "true");
  });

  test("opening a group never widens the document", async ({ page }) => {
    await importScalePack(page);
    await buildHighLevelMartial(page);
    await characterTab(page);

    for (const name of [/^Class & subclass/, /^Species/, /^Background/, /^Proficiencies & training/]) {
      const header = group(page, name);
      if ((await header.count()) === 0) continue;
      await header.click();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `opening ${name} pushed the document sideways`).toBeLessThanOrEqual(0);
    }
  });

  test("a feature's details are readable words, not identifiers", async ({ page }) => {
    await buildMartial(page, "Detail Walker");
    await characterTab(page);
    await group(page, /^Class & subclass/).click();
    await page.getByRole("button", { name: /^Hold the Line/ }).click();
    const dialog = page.getByRole("dialog", { name: "Hold the Line" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/feature:|source:|effect:/)).toHaveCount(0);
  });
});

test.describe("Edit character and Level up live in the Character workspace", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(S23);
    test.slow();
  });

  test("are together under Manage, and nowhere else on the sheet", async ({ page }) => {
    await buildMartial(page, "Boundary Walker");

    // Not on Overview, Actions or Inventory.
    for (const tab of ["Overview", "Actions", "Inventory"]) {
      await page.getByRole("tab", { name: tab }).click();
      await expect(page.getByRole("button", { name: "Edit character", exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Level up", exact: true })).toHaveCount(0);
    }

    await characterTab(page);
    await expect(page.getByRole("heading", { name: "Manage" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit character", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Level up", exact: true })).toBeVisible();
    // The boundary is stated once, in one place.
    await expect(page.getByText(/Edit character changes the build itself/)).toHaveCount(1);
  });

  test("no build decision has an inline control on the sheet", async ({ page }) => {
    await importScalePack(page);
    await buildHighLevelMartial(page);

    for (const tab of ["Overview", "Actions", "Inventory", "Character"]) {
      await page.getByRole("tab", { name: tab }).click();
      for (const forbidden of [/^Equip /, /^Unequip/, /^Attune/, /^Drop /, /^Change class/, /^Override/])
        await expect(page.getByRole("button", { name: forbidden })).toHaveCount(0);
    }
  });

  test("play state is still spendable from the sheet, and undoable", async ({ page }) => {
    await importScalePack(page);
    await buildHighLevelMartial(page);

    await page.getByRole("tab", { name: "Actions" }).click();
    await page.getByRole("button", { name: /Spend one Bracing/ }).click();
    await expect(page.getByText("5 / 6")).toBeVisible();

    await page.getByRole("button", { name: /Open hit point actions/ }).click();
    await page.getByRole("spinbutton", { name: "Amount" }).fill("7");
    await page.getByRole("button", { name: /Apply 7 damage/ }).click();
    await expect(page.getByText("93 / 100").first()).toBeVisible();
    await page.getByRole("button", { name: /Undo the last play action/ }).click();
    await expect(page.getByText("100 / 100").first()).toBeVisible();
  });
});

test.describe("Spells scales to a real repertoire", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(S23);
    test.slow();
  });

  test("groups by level, marks what the content declares, and offers a filter", async ({ page }) => {
    await importScalePack(page);
    await buildHighLevelCaster(page);
    await page.getByRole("tab", { name: "Spells" }).click();

    // The casting facts, then the five slot pools, then the levels.
    await expect(page.getByRole("button", { name: /Spell attack \+7\. Open details/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Save DC 15\. Open details/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Spell slots" })).toBeVisible();
    for (const level of [1, 2, 3, 4, 5])
      await expect(page.getByRole("button", { name: new RegExp(`Spend one Level ${level} script slots`) })).toBeVisible();
    // The shared recharge is said once above the group, not on all five rows.
    await expect(page.getByText("Back on a long rest")).toHaveCount(1);

    await expect(page.getByRole("heading", { name: "Cantrips" })).toBeVisible();
    // A section heading may carry a count beside its name, so it is matched by
    // what it is called rather than by the whole of its accessible name.
    for (const level of [1, 2, 3, 4, 5])
      await expect(page.getByRole("heading", { name: new RegExp(`^Level ${level}\\b`) })).toBeVisible();

    // Content-declared markers, on the rows the content declared them for.
    await expect(page.getByRole("button", { name: /^Chalkmark.*always prepared/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Salt Line.*ritual/ })).toBeVisible();

    // The filter exists because there is genuinely something to find.
    const filter = page.getByLabel("Find a spell");
    await expect(filter).toBeVisible();
    await expect(filter).toHaveAttribute("placeholder", `${SCALE_SPELL_COUNT} spells`);
    await filter.fill("gate");
    await expect(page.getByRole("button", { name: /^Gate Unmade/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Chalkmark/ })).toHaveCount(0);
    await filter.fill("nothing at all");
    await expect(page.getByText(/No spell matches/)).toBeVisible();
  });

  test("a small repertoire gets no filter, because there is nothing to filter", async ({ page }) => {
    await page.goto(APP_ROOT);
    await page.getByRole("button", { name: "New character" }).last().click();
    await page.getByLabel("Character name", { exact: true }).fill("Sereth Marsh");
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
    await next(page);
    await page.getByRole("button", { name: /^River kit/ }).click();
    await next(page);
    await next(page);
    await page.getByRole("button", { name: "Finish and open sheet" }).click();

    await page.getByRole("tab", { name: "Spells" }).click();
    await expect(page.getByRole("heading", { name: "Cantrips" })).toBeVisible();
    await expect(page.getByLabel("Find a spell")).toHaveCount(0);
  });
});

test.describe("Inventory is a scannable list with the detail one tap away", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(S23);
    test.slow();
  });

  test("rows carry the facts that change use, and the drawer carries the rest", async ({ page }) => {
    await importScalePack(page);
    await buildHighLevelMartial(page);
    await page.getByRole("tab", { name: "Inventory" }).click();

    await expect(page.getByRole("heading", { name: "Equipped" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Carried" })).toBeVisible();
    // Facts that change how an item is used are on the row.
    await expect(page.getByRole("button", { name: /^Hold Plate, AC 17/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Keeper's Signet.*Attunement/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Belt Axe, 2/ })).toBeVisible();

    // The description is one tap away, not thirteen paragraphs deep.
    await page.getByRole("button", { name: /^Keeper's Signet/ }).click();
    const dialog = page.getByRole("dialog", { name: "Keeper's Signet" });
    await expect(dialog.getByText("Required")).toBeVisible();
    await expect(dialog.getByText("Uncommon")).toBeVisible();
    await expect(dialog.getByText(/ring of grey metal/)).toBeVisible();
    // Item state is not editable here, and the drawer says where it is.
    await expect(dialog.getByRole("button", { name: /Equip|Attune|Drop/ })).toHaveCount(0);
    await expect(dialog.getByText(/part of Edit character/)).toBeVisible();
  });
});

test.describe("changing section starts at that section", () => {
  test("a switch made from the bottom of a long section opens the next at its top", async ({ page }) => {
    await page.setViewportSize(S23);
    test.slow();
    // Both of these sections are several screens long for this character, which
    // is what makes the correction observable rather than a clamp to zero.
    await importScalePack(page);
    await buildHighLevelMartial(page);

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const before = await page.evaluate(() => Math.round(window.scrollY));
    expect(before, "Overview should be long enough for this to mean anything").toBeGreaterThan(200);

    await page.getByRole("tab", { name: "Inventory" }).click();
    const after = await page.evaluate(() => ({
      scrollY: Math.round(window.scrollY),
      documentHeight: document.documentElement.scrollHeight,
      viewportHeight: document.documentElement.clientHeight,
      tabsTop: Math.round(document.querySelector(".sheet-tabs")!.getBoundingClientRect().top),
      panelTop: Math.round(document.querySelector(".sheet-panel")!.getBoundingClientRect().top),
      appbarBottom: Math.round(document.querySelector(".m2-appbar")!.getBoundingClientRect().bottom),
    }));
    expect(after.documentHeight, "the destination has to overflow for this to test anything").toBeGreaterThan(
      after.viewportHeight,
    );
    // The strip is back under the app bar and the new section starts on screen.
    expect(after.tabsTop).toBeGreaterThanOrEqual(after.appbarBottom - 1);
    expect(after.tabsTop).toBeLessThanOrEqual(after.appbarBottom + 1);
    expect(after.panelTop).toBeGreaterThan(0);
    expect(after.panelTop).toBeLessThan(after.viewportHeight);
    expect(after.scrollY).toBeLessThan(before);
  });

  test("a switch made from the top of a section does not move the page", async ({ page }) => {
    await page.setViewportSize(S23);
    test.slow();
    await buildMartial(page, "Still Walker");

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole("tab", { name: "Actions" }).click();
    expect(await page.evaluate(() => Math.round(window.scrollY))).toBe(0);
  });
});
