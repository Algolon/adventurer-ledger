import { expect, test, type Page } from "@playwright/test";

/**
 * A creation step begins at its own heading, and gets there without travelling.
 *
 * On the first Samsung pilot, scrolling down a step and pressing Continue opened
 * the next step at roughly the previous scroll offset: React swapped the content
 * under a scrolled window and nothing moved the viewport. The step change is
 * also a landmark, so focus goes to the heading rather than staying wherever
 * the previous step left it.
 *
 * The second pilot found the *fix* was visible: Continue, the old step sliding
 * upward, then the new step. Settling at the top is therefore not enough to
 * assert, because an animated scroll settles at the top too. The tests below
 * check the two things that distinguish navigation from animation — that no
 * painted frame ever shows an intermediate offset, and that the app never asks
 * for a smooth scroll in the first place.
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

/**
 * Scrolls to the bottom of the step and makes sure it stuck.
 *
 * Two things fight a one-shot scroll here. Choosing an option expands its panel,
 * and `ContentSelection` holds a short-lived anchor that keeps the tapped row
 * under the finger while the panel grows — so a scroll issued during that window
 * can be corrected straight back. And the step's height settles over a couple of
 * frames as the plan supplies its nested decisions.
 *
 * Re-issuing the scroll on every poll beats both without weakening anything:
 * the assertion is still that the viewport ends up genuinely scrolled, which is
 * the precondition the travel tests below depend on.
 */
async function scrollToBottom(page: Page) {
  await expect
    .poll(
      async () => {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        return scrollY(page);
      },
      { timeout: 5000 },
    )
    .toBeGreaterThan(40);
}

/**
 * Records every scroll position the viewport actually visits, and the
 * `behavior` of every programmatic scroll the app asks for.
 *
 * Scroll events are the right instrument for this, and animation frames are
 * not. A smooth scroll is delivered as a run of scroll events with decreasing
 * offsets — that run *is* the travel the pilot saw — while an instant one
 * delivers a single event at the destination. Sampling frames instead measures
 * how fast the test machine paints, which is not the property under test.
 *
 * Both hooks are installed before any application script runs, because the
 * thing being measured happens inside the commit that swaps the step in; there
 * is no later moment at which to start watching.
 */
async function instrumentScrolling(page: Page) {
  await page.addInitScript(() => {
    const probe = window as unknown as { __visited: number[]; __behaviours: string[]; __watch: boolean };
    probe.__visited = [];
    probe.__behaviours = [];
    probe.__watch = false;

    const original = window.scrollTo.bind(window);
    window.scrollTo = ((...args: unknown[]) => {
      const [first] = args;
      probe.__behaviours.push(
        args.length === 1 && typeof first === "object" && first !== null
          ? String((first as ScrollToOptions).behavior ?? "auto")
          : "positional",
      );
      return (original as (...rest: unknown[]) => void)(...args);
    }) as typeof window.scrollTo;

    window.addEventListener(
      "scroll",
      () => {
        if (probe.__watch) probe.__visited.push(Math.round(window.scrollY));
      },
      { passive: true },
    );
  });
}

const startWatching = (page: Page) =>
  page.evaluate(() => {
    const probe = window as unknown as { __visited: number[]; __watch: boolean };
    probe.__visited = [];
    probe.__watch = true;
  });

/**
 * Stops watching and returns the offsets visited.
 *
 * Two animation frames are awaited first. `window.scrollY` updates
 * synchronously but the matching scroll *event* is only dispatched at the next
 * rendering opportunity, so reading the log the instant the position settles
 * reports an empty list for a scroll that plainly happened.
 */
const visitedOffsets = (page: Page) =>
  page.evaluate(async () => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const probe = window as unknown as { __visited: number[]; __watch: boolean };
    probe.__watch = false;
    return probe.__visited;
  });

const requestedBehaviours = (page: Page) =>
  page.evaluate(() => (window as unknown as { __behaviours: string[] }).__behaviours);

/**
 * A step change may visit the old offset or the new top, and nothing between.
 *
 * Any intermediate offset is scroll travel the user can see, which is the whole
 * complaint. The tolerance covers sub-pixel settling and the browser clamping
 * the old offset when the incoming step is shorter than the outgoing one.
 */
function expectNoVisibleTravel(visited: readonly number[], from: number, where: string) {
  const travelling = visited.filter(offset => offset > 4 && offset < from - 4);
  expect(
    travelling,
    `${where} travelled through ${travelling.join(", ")} on its way to the top (visited ${visited.join(", ")})`,
  ).toEqual([]);
  // The reset must be observable at all: a step change that scrolled nothing is
  // the original defect, not a fix for it.
  expect(visited.length, `${where} produced no scroll at all`).toBeGreaterThan(0);
  expect(visited.at(-1), `${where} did not land at the top; visited ${visited.join(", ")}`).toBeLessThanOrEqual(4);
}

test.describe("step navigation resets scroll and focus", () => {
  /*
   * A phone viewport for every test in this file, in both projects.
   *
   * These are phone-navigation tests — the defect was reported from a handset —
   * and they all begin by scrolling a step to its bottom. At a desktop width the
   * creation steps are short enough that there may be nothing to scroll at all,
   * which makes the precondition, and therefore the test, depend on how tall the
   * content happens to be that week rather than on the behaviour under test.
   */
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
  });

  test("Continue opens the next step at its top, not the previous offset", async ({ page }) => {
    await reachClass(page);
    await page.getByRole("button", { name: /^Vanguard/ }).click();

    await scrollToBottom(page);

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

    await scrollToBottom(page);

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

  /**
   * The pilot's actual complaint, on the viewport it was reported from.
   *
   * Continue is pressed from the bottom of a scrolled step and every painted
   * frame is inspected. An animated reset would paint the whole way up; a
   * page-like one paints the old offset, then the top.
   */
  test("Continue shows no scroll travel on a phone viewport", async ({ page }) => {
    await instrumentScrolling(page);
    await reachClass(page);
    await page.getByRole("button", { name: /^Vanguard/ }).click();

    await scrollToBottom(page);
    const from = await scrollY(page);

    await startWatching(page);
    await next(page);
    await expect(page.getByRole("heading", { level: 2 })).toHaveText("Species");
    await settledAtTop(page);

    expectNoVisibleTravel(await visitedOffsets(page), from, "Continue");
  });

  test("Back shows no scroll travel either", async ({ page }) => {
    await instrumentScrolling(page);
    await reachClass(page);
    await page.getByRole("button", { name: /^Vanguard/ }).click();
    await next(page);
    await expect(page.getByRole("heading", { level: 2 })).toHaveText("Species");

    await scrollToBottom(page);
    const from = await scrollY(page);

    await startWatching(page);
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByRole("heading", { level: 2 })).toHaveText("Class & level");
    await settledAtTop(page);

    expectNoVisibleTravel(await visitedOffsets(page), from, "Back");
  });

  /**
   * The mechanism, not just its result.
   *
   * A frame check can pass by luck on a fast machine that happens to finish an
   * animation between two samples. The app must never ask for the animation at
   * all, so every scroll it requests is inspected directly.
   */
  test("the app never requests a smooth scroll between steps", async ({ page }) => {
    await instrumentScrolling(page);
    await reachClass(page);
    await page.getByRole("button", { name: /^Vanguard/ }).click();
    await next(page);
    await expect(page.getByRole("heading", { level: 2 })).toHaveText("Species");
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByRole("heading", { level: 2 })).toHaveText("Class & level");

    const behaviours = await requestedBehaviours(page);
    expect(behaviours.length, "no programmatic scroll was recorded at all").toBeGreaterThan(0);
    expect(behaviours.filter(value => value === "smooth")).toEqual([]);
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

/**
 * Builds the martial fixture and stops on Review, without committing.
 *
 * The same walk the rest of the suite uses; it lives here rather than being
 * imported so this file stays runnable on its own.
 */
async function reachReview(page: Page) {
  await openBuilder(page);
  await page.getByLabel("Character name", { exact: true }).fill("Brammel Voss");
  await next(page);
  await page.getByRole("button", { name: /^Vanguard/ }).click();
  await next(page);
  await page.getByRole("button", { name: /^Riverborn/ }).click();
  await next(page);
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
  await page.getByRole("button", { name: /^Riverlore/ }).click();
  await page.getByRole("button", { name: /^Haulage/ }).click();
  await next(page);
  await page.getByRole("button", { name: /^Warden pack/ }).click();
  await next(page);
  await next(page); // Identity
  await expect(page.getByRole("heading", { level: 2 })).toHaveText("Review");
}

/**
 * Leaving creation for the sheet is navigation to a different workspace.
 *
 * The pilot's report: scroll part-way down Review, commit, and the character
 * opens half way down its own sheet. It is the step-transition defect one level
 * up — the builder reset the viewport between its own steps and then handed the
 * user to an entirely different screen without doing it again — so the fix and
 * these tests are deliberately the same shape as the ones above.
 */
test.describe("committing a character opens the sheet at its top", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    test.slow();
  });

  /**
   * A floor under the document height, for the whole session.
   *
   * Without it these tests cannot fail, and would therefore prove nothing. The
   * sheet paints a short "Opening the sheet…" frame while its record loads, and
   * a document that suddenly becomes shorter than the current offset has that
   * offset *clamped* by the browser — so on this engine the viewport happened to
   * land at zero whether or not the app asked for it, which is exactly why the
   * defect survived to a physical device. Pinning the document tall removes the
   * accident from the measurement: whatever the offset ends up being after the
   * commit, the app is the only thing that can have chosen it.
   */
  const pinDocumentHeight = (page: Page) =>
    page.addInitScript(() => {
      const style = document.createElement("style");
      style.textContent = "body { min-height: 4000px; }";
      document.addEventListener("DOMContentLoaded", () => document.head.append(style));
    });

  test("a scrolled Review cannot transfer its scroll position to the sheet", async ({ page }) => {
    await pinDocumentHeight(page);
    await reachReview(page);

    // Part-way down, which is how the defect was reported: not at an end, where
    // a clamp or a coincidence could produce the right answer for free.
    await page.evaluate(() => window.scrollTo(0, 320));
    expect(await scrollY(page), "the precondition — Review really is scrolled").toBeGreaterThan(300);

    await page.getByRole("button", { name: "Finish and open sheet" }).click();
    await expect(page.getByRole("heading", { name: "Brammel Voss", level: 2 })).toBeVisible();

    // The first thing true of the sheet is where it starts.
    expect(await scrollY(page), "the sheet opened at Review's offset").toBeLessThanOrEqual(4);
    await settledAtTop(page);
  });

  test("the sheet arrives without any visible scroll travel", async ({ page }) => {
    await pinDocumentHeight(page);
    await instrumentScrolling(page);
    await reachReview(page);

    await page.evaluate(() => window.scrollTo(0, 320));
    const from = await scrollY(page);

    await startWatching(page);
    await page.getByRole("button", { name: "Finish and open sheet" }).click();
    await expect(page.getByRole("heading", { name: "Brammel Voss", level: 2 })).toBeVisible();
    await settledAtTop(page);

    expectNoVisibleTravel(await visitedOffsets(page), from, "Opening the sheet");
  });

  test("the app never animates its way from Review to the sheet", async ({ page }) => {
    await pinDocumentHeight(page);
    await instrumentScrolling(page);
    await reachReview(page);
    await page.evaluate(() => window.scrollTo(0, 320));

    await page.getByRole("button", { name: "Finish and open sheet" }).click();
    await expect(page.getByRole("heading", { name: "Brammel Voss", level: 2 })).toBeVisible();

    const behaviours = await requestedBehaviours(page);
    expect(behaviours.length, "no programmatic scroll was recorded at all").toBeGreaterThan(0);
    expect(behaviours.filter(value => value === "smooth")).toEqual([]);
  });

  /**
   * The workspace is still a workspace: nothing about starting at the top may
   * cost the user the navigation or the heading they arrived at.
   */
  test("the sheet is navigable and announced after the commit", async ({ page }) => {
    await pinDocumentHeight(page);
    await reachReview(page);
    await page.evaluate(() => window.scrollTo(0, 320));
    await page.getByRole("button", { name: "Finish and open sheet" }).click();

    await expect(page.getByRole("heading", { name: "Brammel Voss", level: 2 })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sheet" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");

    // Every root destination is reachable, and each one also starts at its top.
    await page.evaluate(() => window.scrollTo(0, 320));
    await page.getByRole("button", { name: "Compendium" }).click();
    await expect(page.getByRole("heading", { name: "Compendium", level: 2 })).toBeVisible();
    await settledAtTop(page);

    await page.evaluate(() => window.scrollTo(0, 320));
    await page.getByRole("button", { name: "Characters" }).click();
    await expect(page.getByRole("heading", { name: "Characters", level: 2 })).toBeVisible();
    await settledAtTop(page);
  });
});
