import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * The creation information architecture, exercised through the UI.
 *
 * Species and Background are separate steps; each selectable option is a
 * compact row until it is chosen, and then explains itself in place with its own
 * nested decisions inside it. Everything here is driven against the seeded
 * public-original synthetic ruleset.
 */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const APP_ROOT = `${BASE_PATH}/`;
const PHONE_WIDTHS = [320, 360, 375, 390, 412] as const;

const next = (page: Page) => page.getByRole("button", { name: "Continue" }).click();
const stepTitle = (page: Page) => page.getByRole("heading", { level: 2 }).first();

async function openBuilder(page: Page) {
  await page.goto(APP_ROOT);
  await page.getByRole("button", { name: "New character" }).last().click();
  await expect(page.getByText("Step 1 of 9")).toBeVisible();
}

/** Basics → Class → Species. */
async function reachSpecies(page: Page) {
  await openBuilder(page);
  await page.getByLabel("Character name", { exact: true }).fill("Fixture Walker");
  await next(page);
  await page.getByRole("button", { name: /^Vanguard/ }).click();
  await next(page);
  await expect(stepTitle(page)).toHaveText("Species");
}

/** Measures the document, not a container: this is the phone contract. */
async function expectNoHorizontalOverflow(page: Page, where: string) {
  const report = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(report.scrollWidth, `${where} scrolls sideways`).toBeLessThanOrEqual(report.clientWidth);
}

test.describe("Species and Background are their own steps", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
  });

  test("the sequence asks one question per step", async ({ page }) => {
    await reachSpecies(page);
    await expect(page.getByText("Step 3 of 9")).toBeVisible();
    await page.getByRole("button", { name: /^Riverborn/ }).click();
    await next(page);

    await expect(stepTitle(page)).toHaveText("Background");
    await expect(page.getByText("Step 4 of 9")).toBeVisible();
  });

  /**
   * The compatibility guarantee, seen from the outside: a draft saved on the
   * species step resumes on the species step, and its selection is intact.
   */
  test("a saved draft resumes on Species with its work intact", async ({ page }) => {
    await reachSpecies(page);
    await page.getByRole("button", { name: /^Stonevigil/ }).click();
    await page.getByRole("button", { name: /^Deepdelve/ }).click();

    await page.getByRole("button", { name: /^(Save & close|Saving…)$/ }).click();
    await expect(page.getByRole("heading", { name: "Characters", exact: true })).toBeVisible();
    await page.getByRole("button", { name: /Resume building Fixture Walker/ }).click();

    await expect(stepTitle(page)).toHaveText("Species");
    await expect(page.getByRole("button", { name: /^Stonevigil/ })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: /^Deepdelve/ })).toHaveAttribute("aria-pressed", "true");
  });

  test("a nested species selection survives a reload", async ({ page }) => {
    await reachSpecies(page);
    await page.getByRole("button", { name: /^Emberkin/ }).click();
    await page.getByRole("button", { name: /^Hearth-kept/ }).click();
    await expect(page.getByRole("button", { name: /^Hearth-kept/ })).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("button", { name: /^(Save & close|Saving…)$/ }).click();
    await expect(page.getByRole("heading", { name: "Characters", exact: true })).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: /Resume building Fixture Walker/ }).click();

    await expect(page.getByRole("button", { name: /^Emberkin/ })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: /^Hearth-kept/ })).toHaveAttribute("aria-pressed", "true");
  });

  test("a background selection and its nested choice survive a reload", async ({ page }) => {
    await reachSpecies(page);
    await page.getByRole("button", { name: /^Riverborn/ }).click();
    await next(page);

    await page.getByRole("button", { name: /^Ferry Hand/ }).click();
    await page.getByRole("button", { name: /^Reading the water/ }).click();

    await page.getByRole("button", { name: /^(Save & close|Saving…)$/ }).click();
    await expect(page.getByRole("heading", { name: "Characters", exact: true })).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: /Resume building Fixture Walker/ }).click();

    await expect(stepTitle(page)).toHaveText("Background");
    await expect(page.getByRole("button", { name: /^Ferry Hand/ })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: /^Reading the water/ })).toHaveAttribute("aria-pressed", "true");
  });

  test("back and forward navigation preserves completed work", async ({ page }) => {
    await reachSpecies(page);
    await page.getByRole("button", { name: /^Riverborn/ }).click();
    await next(page);
    await page.getByRole("button", { name: /^Caravan Warden/ }).click();

    await page.getByRole("button", { name: "Back" }).click();
    await expect(stepTitle(page)).toHaveText("Species");
    await expect(page.getByRole("button", { name: /^Riverborn/ })).toHaveAttribute("aria-pressed", "true");

    await next(page);
    await expect(stepTitle(page)).toHaveText("Background");
    await expect(page.getByRole("button", { name: /^Caravan Warden/ })).toHaveAttribute("aria-pressed", "true");
  });
});

test.describe("progressive disclosure", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
  });

  test("an unselected option shows no expanded panel; the selected one does", async ({ page }) => {
    await reachSpecies(page);
    // Nothing is expanded before a choice is made.
    await expect(page.locator(".m2-select-panel")).toHaveCount(0);

    await page.getByRole("button", { name: /^Riverborn/ }).click();
    await expect(page.locator(".m2-select-panel")).toHaveCount(1);
    await expect(page.getByRole("heading", { name: "What you get" })).toBeVisible();
    await expect(page.getByText("River Footing")).toBeVisible();
  });

  test("changing selection collapses the previous option and expands the new one", async ({ page }) => {
    await reachSpecies(page);
    await page.getByRole("button", { name: /^Riverborn/ }).click();
    await expect(page.getByText("River Footing")).toBeVisible();

    await page.getByRole("button", { name: /^Emberkin/ }).click();
    await expect(page.locator(".m2-select-panel")).toHaveCount(1);
    await expect(page.getByText("River Footing")).toHaveCount(0);
    await expect(page.getByText("Cinder Step")).toBeVisible();
  });

  /**
   * A species with nothing to decide must not show an empty decisions section:
   * a "Choices to make" heading with nothing under it reads as a decision the
   * user has failed to find.
   */
  test("a simple species shows no empty Choices section", async ({ page }) => {
    await reachSpecies(page);
    await page.getByRole("button", { name: /^Riverborn/ }).click();
    await expect(page.getByRole("heading", { name: "What you get" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Choices to make" })).toHaveCount(0);
  });

  test("a species with a nested decision shows it inside the selected species", async ({ page }) => {
    await reachSpecies(page);
    await page.getByRole("button", { name: /^Stonevigil/ }).click();

    const panel = page.locator(".m2-select-panel");
    await expect(panel.getByRole("heading", { name: "Choices to make" })).toBeVisible();
    // The decision is inside the expanded species, not on a later screen.
    await expect(panel.getByRole("button", { name: /^Deepdelve/ })).toBeVisible();
    // And it does not restate the card it is already sitting in.
    await expect(panel.getByText("From Stonevigil")).toHaveCount(0);
  });

  test("automatic benefits are told apart from ones needing a ruling", async ({ page }) => {
    await reachSpecies(page);
    await page.getByRole("button", { name: /^Emberkin/ }).click();

    const cinder = page.locator(".m2-grant", { hasText: "Cinder Step" });
    const ember = page.locator(".m2-grant", { hasText: "Ember Memory" });
    await expect(cinder.getByText("Applied for you")).toBeVisible();
    await expect(ember.getByText("Track at the table")).toBeVisible();
  });

  test("the expanded background explains what it gives and what is still open", async ({ page }) => {
    await reachSpecies(page);
    await page.getByRole("button", { name: /^Riverborn/ }).click();
    await next(page);
    await page.getByRole("button", { name: /^Ferry Hand/ }).click();

    const panel = page.locator(".m2-select-panel");
    await expect(panel.getByText("Ferry Sense")).toBeVisible();
    await expect(panel.getByText("Ferrywright's tools")).toBeVisible();
    await expect(panel.getByRole("heading", { name: "Choices to make" })).toBeVisible();
    await expect(page.getByText(/decisions? still to make/)).toBeVisible();
  });

  test("the class step explains the class and defers its decisions", async ({ page }) => {
    await openBuilder(page);
    await next(page);
    await page.getByRole("button", { name: /^Vanguard/ }).click();

    // The at-a-glance facts sit on the row itself, so they are readable while
    // scanning; the explanation of what the class grants is in the panel.
    const card = page.locator(".m2-select-card", { hasText: "Vanguard" });
    await expect(card.getByText("Hit die")).toBeVisible();
    await expect(card.getByText("Subclass")).toBeVisible();
    const panel = page.locator(".m2-select-panel");
    await expect(panel.getByRole("heading", { name: "At your starting level" })).toBeVisible();
    // It says how many decisions are coming without presenting them here.
    await expect(panel.getByText(/on Class choices/)).toBeVisible();
    await expect(panel.getByRole("button", { name: /^Guarded Hand/ })).toHaveCount(0);
  });

  test("secondary detail stays behind a disclosure", async ({ page }) => {
    await reachSpecies(page);
    await page.getByRole("button", { name: /^Riverborn/ }).click();
    const more = page.getByRole("group").getByText("More details");
    await expect(more).toBeVisible();
    await expect(page.getByText("Creature type")).toBeHidden();
    await more.click();
    await expect(page.getByText("Creature type")).toBeVisible();
  });
});

test.describe("choice ownership on the phone", () => {
  test("species choices are on Species and background choices are on Background", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await reachSpecies(page);
    await page.getByRole("button", { name: /^Emberkin/ }).click();
    // A species-owned decision, on the species step.
    await expect(page.getByRole("button", { name: /^Hearth-kept/ })).toBeVisible();
    await page.getByRole("button", { name: /^Hearth-kept/ }).click();
    await next(page);

    // Nothing species-owned followed it here.
    await expect(page.getByRole("button", { name: /^Hearth-kept/ })).toHaveCount(0);
    await page.getByRole("button", { name: /^Ferry Hand/ }).click();
    await expect(page.getByRole("button", { name: /^Reading the water/ })).toBeVisible();
  });

  test("class choices remain on Class choices", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await reachSpecies(page);
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

    await expect(stepTitle(page)).toHaveText("Class choices");
    await expect(page.getByRole("button", { name: /^Guarded Hand/ })).toBeVisible();
  });
});

test.describe("changing an origin clears only what it owned", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
  });

  test("changing Species keeps the background's own answer", async ({ page }) => {
    await reachSpecies(page);
    await page.getByRole("button", { name: /^Riverborn/ }).click();
    await next(page);
    await page.getByRole("button", { name: /^Caravan Warden/ }).click();
    await page.getByRole("button", { name: /^Trade Cant/ }).click();

    await page.getByRole("button", { name: "Back" }).click();
    await page.getByRole("button", { name: /^Emberkin/ }).click();
    await page.getByRole("button", { name: /^Ash-walking/ }).click();
    await next(page);

    // The background and its language survived a species change.
    await expect(page.getByRole("button", { name: /^Caravan Warden/ })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: /^Trade Cant/ })).toHaveAttribute("aria-pressed", "true");
  });

  test("changing Background clears its own nested answer and keeps the species", async ({ page }) => {
    await reachSpecies(page);
    await page.getByRole("button", { name: /^Emberkin/ }).click();
    await page.getByRole("button", { name: /^Hearth-kept/ }).click();
    await next(page);

    await page.getByRole("button", { name: /^Caravan Warden/ }).click();
    await page.getByRole("button", { name: /^Trade Cant/ }).click();
    await expect(page.getByRole("button", { name: /^Trade Cant/ })).toHaveAttribute("aria-pressed", "true");

    // Switching background retires the decision the old one owned.
    await page.getByRole("button", { name: /^Ferry Hand/ }).click();
    await expect(page.getByRole("button", { name: /^Trade Cant/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Reading the water/ })).toHaveAttribute("aria-pressed", "false");

    // The species and its own nested answer are untouched.
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByRole("button", { name: /^Emberkin/ })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: /^Hearth-kept/ })).toHaveAttribute("aria-pressed", "true");
  });
});

test.describe("alternative ability-increase distributions", () => {
  test("a background offering two shapes lets the user pick one", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await reachSpecies(page);
    await page.getByRole("button", { name: /^Riverborn/ }).click();
    await next(page);
    await page.getByRole("button", { name: /^Ferry Hand/ }).click();
    await page.getByRole("button", { name: /^Reading the water/ }).click();
    await next(page);

    await expect(stepTitle(page)).toHaveText("Abilities");
    // Stated in plain words, never as a pattern index or a slot vector.
    await expect(page.getByRole("button", { name: /\+2 and \+1 across two abilities/ })).toBeVisible();
    const spread = page.getByRole("button", { name: /\+1 to three abilities/ });
    await expect(spread).toBeVisible();

    await spread.click();
    // Three slots, one per +1.
    await expect(page.getByLabel("+1 to")).toHaveCount(3);
  });

  test("a single-pattern background offers no shape choice at all", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await reachSpecies(page);
    await page.getByRole("button", { name: /^Riverborn/ }).click();
    await next(page);
    await page.getByRole("button", { name: /^Caravan Warden/ }).click();
    await page.getByRole("button", { name: /^Trade Cant/ }).click();
    await next(page);

    await expect(page.getByText("How to spend it")).toHaveCount(0);
    await expect(page.getByLabel("+2 to")).toHaveCount(1);
    await expect(page.getByLabel("+1 to")).toHaveCount(1);
  });
});

test.describe("the phone contract holds on the new steps", () => {
  for (const width of PHONE_WIDTHS) {
    test(`no horizontal scrolling at ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 780 });
      await reachSpecies(page);
      await expectNoHorizontalOverflow(page, `Species at ${width} px`);

      await page.getByRole("button", { name: /^Stonevigil/ }).click();
      await expectNoHorizontalOverflow(page, `expanded Species at ${width} px`);
      await page.getByRole("button", { name: /^Deepdelve/ }).click();
      await expectNoHorizontalOverflow(page, `Species with a nested choice at ${width} px`);

      await next(page);
      await expectNoHorizontalOverflow(page, `Background at ${width} px`);
      await page.getByRole("button", { name: /^Ferry Hand/ }).click();
      await expectNoHorizontalOverflow(page, `expanded Background at ${width} px`);
    });
  }

  /**
   * Expanding must not move the row that was touched. The previous selection
   * collapses above it, and without correction the page slides under the
   * user's finger.
   */
  test("expanding does not move the option that was pressed", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 620 });
    await reachSpecies(page);
    await page.getByRole("button", { name: /^Riverborn/ }).click();
    // Let the autosave settle first. Measuring across an in-flight save would
    // be measuring the save's own re-render, not the expansion.
    await expect(page.getByRole("button", { name: "Save & close" })).toBeVisible();

    /*
     * Parked mid-viewport and activated in place. Playwright's own click would
     * scroll the row clear of the sticky app bar first, and that scroll — not
     * the expansion — is what the measurement would then be reporting.
     */
    const emberkin = page.getByRole("button", { name: /^Emberkin/ });
    await emberkin.evaluate(element => element.scrollIntoView({ block: "center" }));
    const before = await emberkin.evaluate(element => element.getBoundingClientRect().top);

    await emberkin.evaluate(element => (element as HTMLElement).click());
    await expect(page.locator(".m2-select-panel")).toHaveCount(1);
    // The nested decisions arrive with the next plan, growing the panel a
    // second time. The row must still be where it was pressed afterwards.
    await expect(page.getByRole("button", { name: /^Hearth-kept/ })).toBeVisible();
    const after = await emberkin.evaluate(element => element.getBoundingClientRect().top);

    expect(Math.abs(after - before)).toBeLessThanOrEqual(4);
  });

  test("interactive controls stay at least 44 px tall", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 780 });
    await reachSpecies(page);
    await page.getByRole("button", { name: /^Stonevigil/ }).click();

    const short = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>(".m2-select-card button, .m2-select-more > summary")]
        .filter(element => element.getBoundingClientRect().height > 0)
        .filter(element => element.getBoundingClientRect().height < 44)
        .map(element => `${element.className || element.tagName}: ${element.getBoundingClientRect().height}`),
    );
    expect(short).toEqual([]);
  });
});

test.describe("keyboard and assistive technology", () => {
  test("the selected option is announced as pressed and expanded, and its panel is grouped", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await reachSpecies(page);
    const riverborn = page.getByRole("button", { name: /^Riverborn/ });
    await expect(riverborn).toHaveAttribute("aria-pressed", "false");
    await expect(riverborn).toHaveAttribute("aria-expanded", "false");

    await riverborn.click();
    await expect(riverborn).toHaveAttribute("aria-pressed", "true");
    await expect(riverborn).toHaveAttribute("aria-expanded", "true");

    // The control names the region it reveals, and that region really is there.
    const panelId = await riverborn.getAttribute("aria-controls");
    expect(panelId).toBeTruthy();
    // An attribute selector, because React's generated ids contain characters
    // that are not valid in a bare CSS id selector.
    await expect(page.locator(`[id="${panelId}"]`)).toBeVisible();
    await expect(page.getByRole("group", { name: /Riverborn — what this gives you/ })).toBeVisible();
  });

  /**
   * A collapsed option is not rendered at all rather than hidden with CSS, so
   * there is nothing behind it for Tab or a screen reader to reach.
   */
  test("a collapsed option exposes no reachable controls", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await reachSpecies(page);
    await page.getByRole("button", { name: /^Stonevigil/ }).click();
    await expect(page.getByRole("button", { name: /^Deepdelve/ })).toBeVisible();

    // Selecting elsewhere collapses it; its nested control goes with it.
    await page.getByRole("button", { name: /^Riverborn/ }).click();
    await expect(page.getByRole("button", { name: /^Deepdelve/ })).toHaveCount(0);
    await expect(page.locator(".m2-select-panel")).toHaveCount(1);
  });

  /** An unmet nested decision is reported inside the option that asks for it. */
  test("an outstanding nested decision is reported in context", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await reachSpecies(page);
    await page.getByRole("button", { name: /^Stonevigil/ }).click();

    const panel = page.locator(".m2-select-panel");
    await expect(panel.getByText(/of 1 chosen/)).toBeVisible();
    await expect(page.getByText(/decisions? still to make/)).toBeVisible();

    await page.getByRole("button", { name: /^Deepdelve/ }).click();
    await expect(page.getByText(/decisions? still to make/)).toHaveCount(0);
  });

  test("an option can be selected from the keyboard alone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await reachSpecies(page);
    await page.getByRole("button", { name: /^Riverborn/ }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: /^Riverborn/ })).toHaveAttribute("aria-pressed", "true");

    // Focus stays on the control that was operated, not on the new panel.
    await expect(page.getByRole("button", { name: /^Riverborn/ })).toBeFocused();
  });

  test("the expanded selection state has no axe violations", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await reachSpecies(page);
    await page.getByRole("button", { name: /^Stonevigil/ }).click();
    await page.getByRole("button", { name: /^Deepdelve/ }).click();

    const species = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(species.violations).toEqual([]);

    await next(page);
    await page.getByRole("button", { name: /^Ferry Hand/ }).click();
    const background = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(background.violations).toEqual([]);
  });
});
