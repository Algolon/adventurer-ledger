import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  LARGE_ARRAY,
  MASTERY_LABELS,
  MASTERY_OPTION_COUNT,
  MASTERY_PICKS,
  TRAINING_LABELS,
  TRAINING_OPTION_COUNT,
  largeChoicePackJson,
} from "@/tests/fixtures/large-choice-ruleset";

/**
 * Large class choices, driven through the UI at phone width.
 *
 * Physical testing found Weapon Mastery and the level-based ability-score
 * improvement difficult to scan: a generic class choice renders every
 * possibility it has, so a decision with a dozen answers arrived as a wall of
 * near-identical rows with no way to see how many decisions were on the screen
 * or which of them were done.
 *
 * Neither surface can be reproduced from the content this repository ships — the
 * built-in weapon-mastery choice has exactly one option — so both shapes are
 * rebuilt as original material in `tests/fixtures/large-choice-ruleset.ts` and
 * imported here through the real pipeline. Twelve-of-two at level 2 is the
 * mastery shape; ten-of-one at level 4 is the improvement shape.
 *
 * The behaviour under test is the whole loop the redesign promises: a compact
 * task summary, one picker open at a time, a choice made or changed inside it,
 * and a collapse back to the selected result.
 */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const APP_ROOT = `${BASE_PATH}/`;

const next = (page: Page) => page.getByRole("button", { name: "Continue" }).click();
const stepTitle = (page: Page) => page.getByRole("heading", { level: 2 }).first();

/** The collapsed summary card for one decision, by its legend. */
const task = (page: Page, label: string) => page.locator("fieldset.m2-task").filter({ hasText: label });

async function openSettings(page: Page) {
  await page.getByRole("button", { name: "Settings", exact: true }).last().click();
}

async function importLargeChoicePack(page: Page) {
  await page.goto(APP_ROOT);
  await openSettings(page);
  await page.getByRole("button", { name: "Imports and exports" }).click();
  await page.getByLabel("Pack JSON").fill(largeChoicePackJson());
  await page.getByRole("button", { name: "Preview import" }).click();
  await expect(page.getByRole("heading", { name: "Ready to import" })).toBeVisible();
  await page.getByLabel("Create a ruleset profile so this content can be selected in the builder").check();
  await page.getByRole("button", { name: "Confirm atomic import" }).click();
  await expect(page.getByText(/ruleset profile\(s\) created and ready to select/)).toBeVisible();
}

/** Builds a Tidewarden at level 4, stopping on the Class choices step. */
async function reachClassChoices(page: Page) {
  await importLargeChoicePack(page);
  await page.getByRole("button", { name: "Characters", exact: true }).click();
  await page.getByRole("button", { name: "New character" }).last().click();
  await page.getByLabel("Character name", { exact: true }).fill("Scan Probe");
  await next(page);

  await page.getByRole("button", { name: /^Tidewarden/ }).click();
  // Level 4 is what makes the improvement-shaped decision exist at all.
  await page.getByLabel("Create this character at level").selectOption("4");
  await next(page);

  await page.getByRole("button", { name: /^Quaymark/ }).click();
  await next(page);
  await page.getByRole("button", { name: /^Lamp Tender/ }).click();
  await next(page);

  const abilities = ["Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma"];
  for (const [index, ability] of abilities.entries())
    await page.getByLabel(ability, { exact: true }).selectOption(String(LARGE_ARRAY[index]));
  await next(page);

  await expect(stepTitle(page)).toHaveText("Class choices");
}

test.describe("a large class choice arrives as a task, not a wall", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    test.slow();
  });

  /**
   * The step opens as a list of decisions rather than a list of options.
   *
   * Both large decisions state what is being decided and that nothing is
   * chosen; neither has put its options on screen. The small decision beside
   * them is untouched, because the disclosure is keyed on size alone.
   */
  test("opens as a compact summary of what has to be decided", async ({ page }) => {
    await reachClassChoices(page);

    for (const label of ["Tideworn mastery", "Seasoned training"]) {
      const card = task(page, label);
      await expect(card).toBeVisible();
      await expect(card.getByText("Nothing chosen yet")).toBeVisible();
      await expect(card.getByRole("button", { name: new RegExp(`^Choose \\d+ more — ${label}$`) })).toBeVisible();
    }

    // Twenty-two options between them, and none of them on screen yet.
    for (const label of [...MASTERY_LABELS, ...TRAINING_LABELS])
      await expect(page.getByRole("button", { name: label, exact: true })).toHaveCount(0);

    // The two-option decision is a plain list, exactly as before.
    await expect(page.getByRole("button", { name: "Braced", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Loose", exact: true })).toBeVisible();
  });

  /**
   * How many are still wanted, on the summary, before anything is opened.
   * "2 of 2 chosen" answers the question the pilot could not answer while
   * scrolling: how much of this is left.
   */
  test("states what is being decided, and how many remain", async ({ page }) => {
    await reachClassChoices(page);
    const mastery = task(page, "Tideworn mastery");

    // The legend states the size of the decision, next to its name.
    await expect(mastery.getByText(`choose ${MASTERY_PICKS}`, { exact: true })).toBeVisible();
    await expect(mastery.getByText("Nothing chosen yet")).toBeVisible();
    await expect(mastery.getByRole("button", { name: /^Choose 2 more/ })).toBeVisible();
    /*
     * With nothing chosen, "Nothing chosen yet" and "Choose 2 more" already say
     * it: a third line reading "0 of 2 chosen" would be the same fact a third
     * time, on the surface this pass exists to thin out.
     */
    await expect(mastery.getByText(`0 of ${MASTERY_PICKS} chosen`)).toHaveCount(0);

    await mastery.getByRole("button", { name: /^Choose 2 more/ }).click();
    await mastery.getByRole("button", { name: MASTERY_LABELS[0], exact: true }).click();

    // One down, and the remaining count moves with it.
    await expect(mastery.getByText(`1 of ${MASTERY_PICKS} chosen`)).toBeVisible();
    await expect(mastery.getByText(MASTERY_LABELS[0], { exact: true }).first()).toBeVisible();
  });

  test("opens one picker at a time", async ({ page }) => {
    await reachClassChoices(page);
    const mastery = task(page, "Tideworn mastery");
    const training = task(page, "Seasoned training");

    await mastery.getByRole("button", { name: /^Choose 2 more/ }).click();
    await expect(mastery.getByRole("button", { name: MASTERY_LABELS[0], exact: true })).toBeVisible();
    // The whole list is here once it is asked for — the options were never the
    // problem, having them all on screen unbidden was.
    await expect(mastery.locator("li .m2-option")).toHaveCount(MASTERY_OPTION_COUNT);

    await training.getByRole("button", { name: /^Choose 1 more/ }).click();
    await expect(training.locator("li .m2-option")).toHaveCount(TRAINING_OPTION_COUNT);
    // Opening the second closed the first, rather than stacking two walls.
    await expect(mastery.locator("li .m2-option")).toHaveCount(0);
    await expect(mastery.getByRole("button", { name: /^Choose 2 more/ })).toHaveAttribute("aria-expanded", "false");
  });

  /**
   * The end of the loop: choose, collapse, and the summary now states the
   * result rather than the task.
   */
  test("collapses to the selected result, and offers a way to change it", async ({ page }) => {
    await reachClassChoices(page);
    const mastery = task(page, "Tideworn mastery");

    await mastery.getByRole("button", { name: /^Choose 2 more/ }).click();
    await mastery.getByRole("button", { name: MASTERY_LABELS[0], exact: true }).click();
    await mastery.getByRole("button", { name: MASTERY_LABELS[3], exact: true }).click();

    // Satisfied, so the control becomes a way back in rather than a demand.
    const done = mastery.getByRole("button", { name: /^Done/ });
    await expect(done).toBeVisible();
    await done.click();

    await expect(mastery.locator("li .m2-option")).toHaveCount(0);
    await expect(mastery.getByText(`${MASTERY_LABELS[0]}, ${MASTERY_LABELS[3]}`)).toBeVisible();
    await expect(mastery.getByText("Nothing chosen yet")).toHaveCount(0);
    await expect(mastery.getByRole("button", { name: /^Change/ })).toBeVisible();

    // Changing it reopens the same picker with the selection intact.
    await mastery.getByRole("button", { name: /^Change/ }).click();
    await expect(mastery.getByRole("button", { name: MASTERY_LABELS[0], exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  /**
   * The observed level-4 surface, all the way through to a committed
   * character. A decision presented as a task still has to be a decision.
   */
  test("the level-4 decision commits the choice made inside it", async ({ page }) => {
    await reachClassChoices(page);

    const mastery = task(page, "Tideworn mastery");
    await mastery.getByRole("button", { name: /^Choose 2 more/ }).click();
    await mastery.getByRole("button", { name: MASTERY_LABELS[0], exact: true }).click();
    await mastery.getByRole("button", { name: MASTERY_LABELS[1], exact: true }).click();
    await mastery.getByRole("button", { name: /^Done/ }).click();

    const training = task(page, "Seasoned training");
    await training.getByRole("button", { name: /^Choose 1 more/ }).click();
    await training.getByRole("button", { name: TRAINING_LABELS[6], exact: true }).click();
    await training.getByRole("button", { name: /^Done/ }).click();
    await expect(training.getByText(TRAINING_LABELS[6], { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Braced", exact: true }).click();
    await next(page);

    // Equipment, identity, then Review names the decisions back.
    while (!(await stepTitle(page).textContent())?.includes("Review")) await next(page);
    await expect(page.getByText(`Tideworn mastery: ${MASTERY_LABELS[0]}, ${MASTERY_LABELS[1]}`)).toBeVisible();
    await expect(page.getByText(`Seasoned training: ${TRAINING_LABELS[6]}`)).toBeVisible();
  });

  /**
   * The task presentation introduces a disclosure control and a panel, so it is
   * checked with the same automated audit the rest of the creation surfaces get
   * — in both states, because a collapsed disclosure and an open one are
   * different trees.
   */
  test("passes an accessibility audit collapsed and open", async ({ page }) => {
    await reachClassChoices(page);

    const audit = async (state: string) => {
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
      expect(
        results.violations.map(violation => `${state}: ${violation.id} (${violation.nodes.length})`),
      ).toEqual([]);
    };

    await audit("collapsed");
    await task(page, "Tideworn mastery")
      .getByRole("button", { name: /^Choose 2 more/ })
      .click();
    await audit("open");
  });

  test("does not scroll sideways at 320 px, open or closed", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 780 });
    await reachClassChoices(page);

    const overflow = async () =>
      page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(await overflow(), "the collapsed summaries overflow at 320 px").toBeLessThanOrEqual(0);

    await task(page, "Tideworn mastery")
      .getByRole("button", { name: /^Choose 2 more/ })
      .click();
    expect(await overflow(), "the open picker overflows at 320 px").toBeLessThanOrEqual(0);
  });
});
