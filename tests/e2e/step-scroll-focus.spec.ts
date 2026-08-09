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

/** One programmatic scroll the app asked for, as it asked for it. */
interface ScrollRequest {
  /** `behavior` as passed, `"auto"` when omitted, `"positional"` for `scrollTo(x, y)`. */
  readonly behavior: string;
  /** The requested offset, or `null` for a positional call. */
  readonly top: number | null;
}

/**
 * Records what the app *asked* the viewport to do, and where the viewport
 * actually went.
 *
 * Two instruments, because they answer two different questions and only one of
 * them is reliable.
 *
 * `__requests` is the app's own intent, captured by wrapping `window.scrollTo`.
 * Every reset the application performs appears here exactly once, on every
 * engine, whatever the incoming page's height turns out to be. This is the
 * signal that proves the app reset the viewport deliberately.
 *
 * `__visited` is what the user could have seen, captured from scroll events. A
 * smooth scroll is delivered as a run of events with decreasing offsets — that
 * run *is* the travel the pilot reported — while an instant one delivers at
 * most a single event at the destination. It is the right instrument for
 * "nothing intermediate was ever painted" and the wrong one for "a reset
 * happened at all": when the incoming step is shorter than the outgoing offset
 * the browser clamps the position during layout, and a subsequent
 * `scrollTo(0, 0)` from an already-clamped zero moves nothing and dispatches
 * nothing. That is a correct page-like navigation with an empty event log, and
 * it is what failed this file on CI while the application was behaving
 * perfectly.
 *
 * Both hooks are installed before any application script runs, because the
 * thing being measured happens inside the commit that swaps the step in; there
 * is no later moment at which to start watching.
 */
async function instrumentScrolling(page: Page) {
  await page.addInitScript(() => {
    const probe = window as unknown as {
      __visited: number[];
      __requests: { behavior: string; top: number | null }[];
      __watch: boolean;
    };
    probe.__visited = [];
    probe.__requests = [];
    probe.__watch = false;

    const original = window.scrollTo.bind(window);
    window.scrollTo = ((...args: unknown[]) => {
      const [first] = args;
      const options = args.length === 1 && typeof first === "object" && first !== null ? (first as ScrollToOptions) : null;
      probe.__requests.push(
        options
          ? { behavior: String(options.behavior ?? "auto"), top: typeof options.top === "number" ? options.top : null }
          : { behavior: "positional", top: null },
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

/**
 * Opens a fresh window over one navigation.
 *
 * Both logs are cleared, not just the offsets. The tests scroll the outgoing
 * step to its bottom themselves, and that setup scroll is a `scrollTo` call
 * like any other — left in the log it would satisfy "the app requested a
 * reset" without the app having done anything at all. Scoping the window to
 * the navigation is what makes the request assertions mean what they say.
 */
const watchNavigation = (page: Page) =>
  page.evaluate(() => {
    const probe = window as unknown as { __visited: number[]; __requests: unknown[]; __watch: boolean };
    probe.__visited = [];
    probe.__requests = [];
    probe.__watch = true;
  });

/**
 * Closes the window and returns everything recorded in it.
 *
 * Two animation frames are awaited first. `window.scrollY` updates
 * synchronously but the matching scroll *event* is only dispatched at the next
 * rendering opportunity, so reading the log the instant the position settles
 * reports an empty list for a scroll that plainly happened.
 */
const navigationRecord = (page: Page) =>
  page.evaluate(async () => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const probe = window as unknown as {
      __visited: number[];
      __requests: { behavior: string; top: number | null }[];
      __watch: boolean;
    };
    probe.__watch = false;
    return { visited: probe.__visited, requests: probe.__requests };
  });

const requestedBehaviours = (page: Page) =>
  page.evaluate(() => (window as unknown as { __requests: { behavior: string }[] }).__requests.map(r => r.behavior));

/**
 * The behaviours that move the viewport in one go rather than over time.
 *
 * `instant` is what the application asks for. `auto` is accepted because with
 * no `scroll-behavior: smooth` anywhere in the stylesheets it resolves to the
 * same jump — but the app must still be *asking* for a reset, and the assertion
 * below requires one of these on a request that targets the top.
 */
const NON_ANIMATED = new Set(["instant", "auto"]);

/**
 * One page-like navigation, proved from what the app asked for and from what
 * the viewport could have shown.
 *
 * The invariant is not "a scroll event fired". It is:
 *
 *   - the outgoing surface really was scrolled (the caller's precondition);
 *   - the app made a *new* reset request during this navigation;
 *   - that request targets the top and is not animated;
 *   - nothing in the window asked for a smooth scroll;
 *   - the viewport ended at the top;
 *   - and if any scroll events were dispatched, none of them shows an
 *     intermediate position between the old offset and the top.
 *
 * The last clause is conditional on purpose, and it is the only thing that
 * changed about the strength of this file. An empty event log is a legitimate
 * outcome — the browser can clamp a too-large offset during layout, leaving the
 * app's reset with nothing left to move — and it is not evidence of anything,
 * good or bad. The evidence that the app did its job is the request log, which
 * is deterministic; the evidence that no travel was visible is the event log,
 * which only speaks when it has something to say.
 */
function expectPageLikeNavigation(
  record: { visited: readonly number[]; requests: readonly ScrollRequest[] },
  from: number,
  where: string,
) {
  const { visited, requests } = record;
  const described = `requests ${JSON.stringify(requests)}, visited ${visited.join(", ") || "nothing"}`;

  // The app asked, during this navigation, rather than at some earlier point.
  expect(requests.length, `${where} made no programmatic scroll request at all (${described})`).toBeGreaterThan(0);
  const resets = requests.filter(request => request.top !== null && request.top <= 4);
  expect(resets.length, `${where} requested no reset to the top (${described})`).toBeGreaterThan(0);
  expect(
    resets.filter(request => !NON_ANIMATED.has(request.behavior)),
    `${where} asked for an animated reset (${described})`,
  ).toEqual([]);
  // Nothing in the whole window may animate, not merely the reset itself.
  expect(
    requests.filter(request => request.behavior === "smooth"),
    `${where} requested a smooth scroll (${described})`,
  ).toEqual([]);

  // Nothing between the old offset and the top was ever painted. The tolerance
  // covers sub-pixel settling and the browser clamping the old offset when the
  // incoming step is shorter than the outgoing one.
  const travelling = visited.filter(offset => offset > 4 && offset < from - 4);
  expect(travelling, `${where} travelled through ${travelling.join(", ")} on its way to the top (${described})`).toEqual(
    [],
  );
  if (visited.length)
    expect(visited.at(-1), `${where} did not land at the top (${described})`).toBeLessThanOrEqual(4);
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
   * Continue is pressed from the bottom of a scrolled step, and the whole
   * navigation is inspected: what the app asked the viewport to do, what the
   * viewport could have shown on the way, where it ended, and where focus went.
   * An animated reset would paint the whole way up and would show in the
   * request log; a page-like one asks once, instantly, for the top.
   */
  test("Continue shows no scroll travel on a phone viewport", async ({ page }) => {
    await instrumentScrolling(page);
    await reachClass(page);
    await page.getByRole("button", { name: /^Vanguard/ }).click();

    await scrollToBottom(page);
    const from = await scrollY(page);
    expect(from, "the precondition — the outgoing step really is scrolled").toBeGreaterThan(40);

    await watchNavigation(page);
    await next(page);
    await expect(page.getByRole("heading", { level: 2 })).toHaveText("Species");
    await settledAtTop(page);

    expectPageLikeNavigation(await navigationRecord(page), from, "Continue");
    // The step change is still a landmark, not merely a scroll.
    await expect(page.getByRole("heading", { level: 2 })).toBeFocused();
  });

  test("Back shows no scroll travel either", async ({ page }) => {
    await instrumentScrolling(page);
    await reachClass(page);
    await page.getByRole("button", { name: /^Vanguard/ }).click();
    await next(page);
    await expect(page.getByRole("heading", { level: 2 })).toHaveText("Species");

    await scrollToBottom(page);
    const from = await scrollY(page);
    expect(from, "the precondition — the outgoing step really is scrolled").toBeGreaterThan(40);

    await watchNavigation(page);
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByRole("heading", { level: 2 })).toHaveText("Class & level");
    await settledAtTop(page);

    expectPageLikeNavigation(await navigationRecord(page), from, "Back");
    await expect(page.getByRole("heading", { level: 2 })).toBeFocused();
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
    expect(from, "the precondition — Review really is scrolled").toBeGreaterThan(40);

    await watchNavigation(page);
    await page.getByRole("button", { name: "Finish and open sheet" }).click();
    await expect(page.getByRole("heading", { name: "Brammel Voss", level: 2 })).toBeVisible();
    await settledAtTop(page);

    expectPageLikeNavigation(await navigationRecord(page), from, "Opening the sheet");
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
