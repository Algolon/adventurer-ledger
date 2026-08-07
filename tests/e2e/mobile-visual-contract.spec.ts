import { expect, test, type Page } from "@playwright/test";

/**
 * The global mobile visual contract.
 *
 * Three product rules are asserted here, because none of them can be checked by
 * reading the DOM:
 *
 *   1. Runefolio is dark, and the operating system does not get a vote.
 *   2. No normal surface scrolls horizontally, at any required phone width.
 *   3. Every sheet section is reachable without swiping a hidden strip.
 *
 * The overflow assertions are the reason `overflow-x: clip` was removed from
 * the shell, the main region and the page. With the clip in place
 * `document.documentElement.scrollWidth` can never exceed `clientWidth`, so
 * every assertion below would have passed while the layout was still broken —
 * the content was merely hidden. These tests are only meaningful against a
 * layout that is actually allowed to overflow.
 */

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const APP_ROOT = `${BASE_PATH}/`;

/** The phone widths the contract must hold at, in CSS pixels. */
const REQUIRED_WIDTHS = [320, 360, 375, 390, 412] as const;

/**
 * Containers that must never become their own horizontal scroller.
 *
 * The document assertions alone would miss these: a nested scroll region keeps
 * the document honest while still hiding content behind a drag gesture that has
 * no affordance on a touch screen. Each is checked only when it is present.
 */
const TASK_CONTAINERS: readonly { selector: string; description: string }[] = [
  { selector: ".m2-main", description: "the main content region" },
  { selector: ".m2-rail", description: "primary navigation" },
  { selector: ".m2-page", description: "the page" },
  { selector: ".sheet-tabs", description: "the sheet section tabs" },
  { selector: ".sheet-panel", description: "the open sheet section" },
  { selector: ".m2-step-list ol", description: "builder step navigation" },
  { selector: ".m2-task-footer", description: "the task footer" },
  { selector: ".m2-dialog-body", description: "the dialog body" },
  { selector: ".preview", description: "the import preview" },
  { selector: ".registry", description: "the pack and source registry" },
];

interface OverflowReport {
  readonly documentScrollWidth: number;
  readonly documentClientWidth: number;
  readonly bodyScrollWidth: number;
  readonly bodyClientWidth: number;
  readonly containers: readonly { selector: string; scrollWidth: number; clientWidth: number; overflowX: string }[];
  readonly offenders: readonly string[];
  readonly hiddenSideways: readonly string[];
}

/**
 * Measures the page for sideways overflow.
 *
 * Three different things are reported, because "scrolls horizontally" and "is
 * wider than the viewport" are not the same defect and only one of them is a
 * bare `scrollWidth` comparison:
 *
 *   `offenders`      — elements whose box actually sticks out past the viewport.
 *                      This is what a user sees as the page being too wide, and
 *                      naming the element is what makes the failure fixable.
 *   `hiddenSideways` — elements that *can* clip or scroll on the x-axis and have
 *                      content wider than themselves. This is the "solved it by
 *                      hiding it" case the contract rules out, and it is the
 *                      only case where content is genuinely out of reach.
 *   `containers`     — the named navigation and task regions, with their
 *                      computed `overflow-x`, so the assertions can tell a
 *                      deliberate full-bleed from a real scroll region.
 *
 * The distinction matters: the sticky tab strip is intentionally full-bleed
 * through a negative margin, so it reaches both viewport edges and makes its
 * `overflow: visible` parent report a larger `scrollWidth`. Nothing is hidden
 * and nothing scrolls — an element that cannot scroll does not scroll.
 */
async function measureOverflow(page: Page, selectors: readonly string[]): Promise<OverflowReport> {
  return page.evaluate(containerSelectors => {
    const documentElement = document.documentElement;
    const limit = documentElement.clientWidth;
    const offenders: string[] = [];
    const hiddenSideways: string[] = [];
    /** Values of `overflow-x` that can put content beyond reach. */
    const CONCEALING = new Set(["auto", "scroll", "hidden", "clip"]);

    const describe = (element: Element) => {
      const classes =
        element.className && typeof element.className === "string"
          ? `.${element.className.trim().split(/\s+/).join(".")}`
          : "";
      return `${element.tagName.toLowerCase()}${classes}`;
    };

    for (const element of Array.from(document.body.querySelectorAll("*"))) {
      const rect = element.getBoundingClientRect();
      // Zero-area nodes and the visually-hidden pattern cannot push anything.
      if (rect.width <= 1 || rect.height <= 1) continue;
      const style = getComputedStyle(element);
      if (style.visibility === "hidden" || style.display === "none") continue;

      // A tolerance of 1 px absorbs sub-pixel rounding in the layout engine.
      const overhang = Math.max(rect.right - limit, -rect.left);
      if (overhang > 1)
        offenders.push(
          `${describe(element)} overhangs by ${overhang.toFixed(1)}px (left ${rect.left.toFixed(1)}, right ${rect.right.toFixed(1)}, limit ${limit})`,
        );

      if (CONCEALING.has(style.overflowX) && element.scrollWidth > element.clientWidth + 1)
        hiddenSideways.push(
          `${describe(element)} has overflow-x: ${style.overflowX} concealing ${element.scrollWidth - element.clientWidth}px of content`,
        );
    }

    const containers = containerSelectors.flatMap(selector => {
      const node = document.querySelector(selector);
      if (!node) return [];
      return [
        {
          selector,
          scrollWidth: node.scrollWidth,
          clientWidth: node.clientWidth,
          overflowX: getComputedStyle(node).overflowX,
        },
      ];
    });

    return {
      documentScrollWidth: documentElement.scrollWidth,
      documentClientWidth: documentElement.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
      bodyClientWidth: document.body.clientWidth,
      containers,
      offenders: offenders.slice(0, 12),
      hiddenSideways: hiddenSideways.slice(0, 12),
    };
  }, selectors);
}

/** Asserts the contract's two document rules, plus every task container. */
async function expectNoHorizontalScroll(page: Page, surface: string) {
  const report = await measureOverflow(
    page,
    TASK_CONTAINERS.map(container => container.selector),
  );

  expect(report.offenders, `elements wider than the viewport on ${surface}`).toEqual([]);
  // Overflow must be fixed, not clipped or scrolled out of sight.
  expect(report.hiddenSideways, `content concealed on the x-axis on ${surface}`).toEqual([]);

  expect(
    report.documentScrollWidth,
    `document.documentElement.scrollWidth must not exceed clientWidth on ${surface}`,
  ).toBeLessThanOrEqual(report.documentClientWidth);
  expect(report.bodyScrollWidth, `document.body.scrollWidth must not exceed clientWidth on ${surface}`).toBeLessThanOrEqual(
    report.bodyClientWidth,
  );

  for (const container of report.containers) {
    const described = TASK_CONTAINERS.find(entry => entry.selector === container.selector)?.description ?? container.selector;
    /*
     * A region that cannot scroll does not scroll. Asserting `scrollWidth` on
     * an `overflow: visible` box measures ink overflow instead — which the
     * deliberate full-bleed of the sticky tab strip produces by design, and
     * which the viewport-overhang check above already covers properly.
     */
    if (container.overflowX === "visible") continue;
    expect(container.scrollWidth, `${described} must not scroll horizontally on ${surface}`).toBeLessThanOrEqual(
      container.clientWidth,
    );
  }
}

const continueStep = (page: Page) => page.getByRole("button", { name: "Continue" }).click();

async function openBuilder(page: Page) {
  await page.goto(APP_ROOT);
  await page.getByRole("button", { name: "New character" }).last().click();
  await expect(page.getByText("Step 1 of")).toBeVisible();
}

/** Builds the martial fixture, whose sheet has four sections. */
async function buildMartial(page: Page, name: string) {
  await openBuilder(page);
  await page.getByLabel("Character name", { exact: true }).fill(name);
  await continueStep(page);
  await page.getByRole("button", { name: /^Vanguard/ }).click();
  await continueStep(page);
  await page.getByRole("button", { name: /^Riverborn/ }).click();
  await page.getByRole("button", { name: /^Caravan Warden/ }).click();
  await page.getByRole("button", { name: /^Trade Cant/ }).click();
  await continueStep(page);
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
  await continueStep(page);
  await page.getByRole("button", { name: /^Guarded Hand/ }).click();
  await page.getByRole("button", { name: /^Riverlore/ }).click();
  await page.getByRole("button", { name: /^Haulage/ }).click();
  await continueStep(page);
  await page.getByRole("button", { name: /^Warden pack/ }).click();
  await continueStep(page);
  await continueStep(page); // Identity
  await page.getByRole("button", { name: "Finish and open sheet" }).click();
  await expect(page.getByRole("heading", { name, level: 2 })).toBeVisible();
}

/** Builds the caster fixture, whose sheet has five sections. */
async function buildCaster(page: Page, name: string) {
  await openBuilder(page);
  await page.getByLabel("Character name", { exact: true }).fill(name);
  await continueStep(page);
  await page.getByRole("button", { name: /^Runecaller/ }).click();
  await continueStep(page);
  await page.getByRole("button", { name: /^Riverborn/ }).click();
  await page.getByRole("button", { name: /^Caravan Warden/ }).click();
  await page.getByRole("button", { name: /^River Signs/ }).click();
  await continueStep(page);
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
  await continueStep(page);
  await page.getByRole("button", { name: /^Riverlore/ }).click();
  await continueStep(page);
  await expect(page.getByText("Known spells")).toBeVisible();
  await continueStep(page);
  await page.getByRole("button", { name: /^River kit/ }).click();
  await continueStep(page);
  await continueStep(page); // Identity
  await page.getByRole("button", { name: "Finish and open sheet" }).click();
  await expect(page.getByRole("heading", { name, level: 2 })).toBeVisible();
}

/** Opens Settings from whichever control is showing at this width. */
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

/**
 * The width matrix.
 *
 * It runs in the mobile project only. This is the phone contract, and the
 * project carries the coarse pointer and touch emulation that the sheet tabs,
 * the bottom bar and the portrait guard are all specified against.
 */
test.describe("no Runefolio surface scrolls horizontally on a phone", () => {
  for (const width of REQUIRED_WIDTHS) {
    test(`every primary surface fits at ${width} px`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "mobile", "The phone width matrix runs once, in the mobile project.");
      test.slow();
      await page.setViewportSize({ width, height: 780 });

      await page.goto(APP_ROOT);
      await expectNoHorizontalScroll(page, `Characters at ${width} px`);

      // Builder: Basics, then Class & level, then the step navigation itself.
      await page.getByRole("button", { name: "New character" }).last().click();
      await expect(page.getByText("Step 1 of")).toBeVisible();
      await expectNoHorizontalScroll(page, `builder Basics at ${width} px`);

      await page.getByLabel("Character name", { exact: true }).fill("Sereth Marsh");
      await continueStep(page);
      await expect(page.getByText("Step 2 of")).toBeVisible();
      await expectNoHorizontalScroll(page, `builder Class & level at ${width} px`);

      // The step list is the navigation that used to be a sideways strip.
      await page.getByRole("button", { name: "All steps" }).click();
      await expectNoHorizontalScroll(page, `builder step navigation at ${width} px`);
      await page.getByRole("button", { name: "All steps" }).click();

      // A five-section caster sheet is the widest tab strip the app produces.
      await page.getByRole("button", { name: /^Runecaller/ }).click();
      await continueStep(page);
      await page.getByRole("button", { name: /^Riverborn/ }).click();
      await page.getByRole("button", { name: /^Caravan Warden/ }).click();
      await page.getByRole("button", { name: /^River Signs/ }).click();
      await continueStep(page);
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
      await continueStep(page);
      await page.getByRole("button", { name: /^Riverlore/ }).click();
      await continueStep(page);
      await expect(page.getByText("Known spells")).toBeVisible();
      await continueStep(page);
      await page.getByRole("button", { name: /^River kit/ }).click();
      await continueStep(page);
      await continueStep(page);
      await page.getByRole("button", { name: "Finish and open sheet" }).click();
      await expect(page.getByRole("heading", { name: "Sereth Marsh", level: 2 })).toBeVisible();

      for (const section of ["Overview", "Actions", "Spells", "Inventory", "Character"]) {
        await page.getByRole("tab", { name: section }).click();
        await expectNoHorizontalScroll(page, `sheet ${section} at ${width} px`);
      }

      // Settings, including the pages that print machine identifiers.
      await openSettings(page);
      await expectNoHorizontalScroll(page, `Settings at ${width} px`);
      for (const settingsPage of ["Rulesets", "Content packs", "Sources", "Storage"]) {
        await page.getByRole("button", { name: settingsPage, exact: true }).click();
        /*
         * Storage renders a narrow "not supported" line until
         * `navigator.storage.estimate()` resolves, and only then paints the
         * figures and the persistence button that actually set the card's
         * width. Measuring without this wait raced the estimate: the sweep
         * passed whenever it measured the placeholder, and the same tree that
         * passed Verify twice failed the deploy on the third run. Waiting for
         * the real content makes the surface deterministic.
         */
        if (settingsPage === "Storage") await expect(page.locator(".storage-card dl")).toBeVisible();
        await expectNoHorizontalScroll(page, `Settings · ${settingsPage} at ${width} px`);
        await page.getByRole("button", { name: "Back to Settings" }).click();
      }

      await page.getByRole("button", { name: "Compendium" }).click();
      // The entry list is loaded asynchronously; measuring before it arrives
      // would check an empty page and pass for the wrong reason.
      await expect(page.locator(".entrycard").first()).toBeVisible();
      await expectNoHorizontalScroll(page, `Compendium at ${width} px`);

      /*
       * The raw entry data, expanded.
       *
       * Every `pre` of effect JSON lives inside a collapsed `<details>`, so a
       * check that only loads the Compendium never measures the widest content
       * the app renders — unbroken machine output that used to be its own
       * horizontal scroll container. Opening them is the whole point.
       */
      const details = page.locator(".entrycard details");
      expect(await details.count(), "expected the Compendium to render collapsed entry data").toBeGreaterThan(0);
      await details.evaluateAll(nodes => nodes.forEach(node => node.setAttribute("open", "")));
      await expectNoHorizontalScroll(page, `Compendium with entry data expanded at ${width} px`);
    });
  }

  /**
   * A four-section sheet, and a name long enough to be a real problem.
   *
   * The tab grid is sized from the number of sections, so four and five are
   * genuinely different layouts and both have to be exercised. The name is the
   * other half: it is the one string on the sheet that the user supplies, and a
   * long one used to set the width of the header.
   */
  test("a four-section sheet and a very long character name both fit at 320 px", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "The phone width matrix runs once, in the mobile project.");
    test.slow();
    await page.setViewportSize({ width: 320, height: 780 });
    await buildMartial(page, "Brammel Voss of the Long Riverlands Caravan Company");

    await expect(page.getByRole("tab", { name: "Spells" })).toHaveCount(0);
    await expect(page.getByRole("tab")).toHaveCount(4);

    for (const section of ["Overview", "Actions", "Inventory", "Character"]) {
      await page.getByRole("tab", { name: section }).click();
      await expectNoHorizontalScroll(page, `four-section sheet ${section} with a long name at 320 px`);
    }
  });

  /**
   * Settings · Storage, measured against its own card rather than the viewport.
   *
   * The viewport check could not catch this reliably. `width: max-content` on
   * the persistence button made the card as wide as the button's unwrapped
   * label, and whether that reached past the viewport edge depended on the
   * platform's font metrics: it stayed inside by 14 px on macOS and went
   * outside on the Linux CI image. Verify passed twice and the deploy failed on
   * the identical tree.
   *
   * Comparing each child with the card's own content box removes the font from
   * the question. A child wider than the box it sits in is a defect at every
   * width, on every platform, whether or not it happens to reach the edge of
   * this particular screen.
   */
  test("nothing in the Storage card is wider than the card at 320 px", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "The phone width matrix runs once, in the mobile project.");
    await page.setViewportSize({ width: 320, height: 780 });
    await page.goto(APP_ROOT);
    await openSettings(page);
    await page.getByRole("button", { name: "Storage", exact: true }).click();
    // The figures and the button arrive only once the estimate resolves.
    await expect(page.locator(".storage-card dl")).toBeVisible();

    const overflowing = await page.evaluate(() => {
      const card = document.querySelector(".storage-card");
      if (!(card instanceof HTMLElement)) return ["the Storage card did not render"];
      const style = getComputedStyle(card);
      const box = card.getBoundingClientRect();
      const left = box.left + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth);
      const right = box.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth);
      return Array.from(card.querySelectorAll("*")).flatMap(node => {
        const rect = node.getBoundingClientRect();
        if (rect.width <= 1 || rect.height <= 1) return [];
        const over = Math.max(rect.right - right, left - rect.left);
        // 1 px absorbs sub-pixel rounding, as elsewhere in this suite.
        if (over <= 1) return [];
        const name = node.tagName.toLowerCase() + (node.className ? `.${String(node.className).split(" ")[0]}` : "");
        return [`${name} is ${over.toFixed(1)}px wider than the card's content box (${(right - left).toFixed(1)}px)`];
      });
    });

    expect(overflowing, "elements wider than the Storage card they sit in").toEqual([]);
  });

  /**
   * Level up is the widest thing the app renders: two comparison tables that
   * used to be `white-space: nowrap` inside a horizontal scroller.
   */
  test("the level-up comparison tables wrap rather than scroll at 320 px", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "The phone width matrix runs once, in the mobile project.");
    test.slow();
    await page.setViewportSize({ width: 320, height: 780 });
    await buildMartial(page, "Brammel Voss");

    await page.getByRole("tab", { name: "Character" }).click();
    await page.getByRole("button", { name: /^Level up/ }).click();
    await expect(page.getByRole("heading", { name: /Level up/ })).toBeVisible();
    await expectNoHorizontalScroll(page, "the level-up dialog at 320 px");

    // The scroll region that used to wrap these tables is gone, not merely
    // hidden: nothing on this surface claims to be scrollable any more.
    await expect(page.getByRole("group", { name: /scrollable/ })).toHaveCount(0);
  });
});

/**
 * Every sheet section is visible at once.
 *
 * The strip used to scroll, so at 360 px a caster's fifth section sat off the
 * right edge. "Reachable by dragging" is not reachable: there was no affordance
 * saying the strip could be dragged. Each tab is now asserted to be inside the
 * strip's own box, which is the property a fixed grid guarantees and a
 * scrolling flex row does not.
 */
test.describe("every sheet section is visible without swiping", () => {
  for (const width of REQUIRED_WIDTHS) {
    test(`all five caster sections are fully on screen at ${width} px`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "mobile", "The phone tab contract runs once, in the mobile project.");
      test.slow();
      await page.setViewportSize({ width, height: 780 });
      await buildCaster(page, "Sereth Marsh");

      const strip = page.locator(".sheet-tabs");
      await expect(page.getByRole("tab")).toHaveCount(5);

      const geometry = await strip.evaluate(element => {
        const container = element.getBoundingClientRect();
        return {
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          tabs: Array.from(element.querySelectorAll('[role="tab"]')).map(tab => {
            const rect = tab.getBoundingClientRect();
            return {
              label: (tab.textContent ?? "").trim(),
              clippedLeft: rect.left < container.left - 1,
              clippedRight: rect.right > container.right + 1,
              // A label that has been squeezed narrower than its own text.
              truncated: tab.scrollWidth > tab.clientWidth + 1,
              height: rect.height,
            };
          }),
        };
      });

      expect(geometry.scrollWidth, `the tab strip must not scroll at ${width} px`).toBeLessThanOrEqual(geometry.clientWidth);
      expect(
        geometry.tabs.filter(tab => tab.clippedLeft || tab.clippedRight).map(tab => tab.label),
        `no tab may be clipped at ${width} px`,
      ).toEqual([]);
      expect(
        geometry.tabs.filter(tab => tab.truncated).map(tab => tab.label),
        `no tab label may be cut off at ${width} px`,
      ).toEqual([]);
      // Full words, so no abbreviation can become ambiguous.
      expect(geometry.tabs.map(tab => tab.label)).toEqual([
        "Overview",
        "Actions",
        "Spells",
        "Inventory",
        "Character",
      ]);
      // The 44 px minimum target survives being squeezed into a fifth of 320 px.
      for (const tab of geometry.tabs)
        expect(tab.height, `the ${tab.label} tab must stay a 44 px target at ${width} px`).toBeGreaterThanOrEqual(44);
    });
  }

  /**
   * Selection is not carried by colour alone.
   *
   * A filled surface, a brass edge, a brass underline and `aria-selected` all
   * say the same thing, so losing any one of them — a monochrome display, a
   * forced-colours mode, a colour vision deficiency — still leaves the answer.
   */
  test("the selected section is marked by more than its colour", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "The phone tab contract runs once, in the mobile project.");
    test.slow();
    await page.setViewportSize({ width: 360, height: 780 });
    await buildCaster(page, "Sereth Marsh");

    await page.getByRole("tab", { name: "Actions" }).click();
    const selected = page.getByRole("tab", { name: "Actions" });
    await expect(selected).toHaveAttribute("aria-selected", "true");

    const marks = await selected.evaluate(element => {
      const style = getComputedStyle(element);
      return { boxShadow: style.boxShadow, background: style.backgroundColor, weight: style.fontWeight };
    });
    expect(marks.boxShadow, "the selected tab keeps its underline").not.toBe("none");
    expect(marks.background, "the selected tab keeps its filled surface").not.toBe("rgba(0, 0, 0, 0)");
  });
});

/**
 * Mobile chrome.
 *
 * The app bar, the sticky sheet tabs and the bottom bar are three separately
 * positioned layers that only interact at runtime, so the ways they get this
 * wrong — one sticking under another, the last card trapped behind the bar —
 * are invisible to any check that reads a single element.
 */
test.describe("the app bar, sticky tabs and bottom bar coexist", () => {
  test("sticky sheet navigation clears the app bar and the last card clears the bottom bar", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "This is the phone chrome contract.");
    test.slow();
    await page.setViewportSize({ width: 360, height: 780 });
    await buildCaster(page, "Sereth Marsh");

    const chrome = await page.evaluate(() => {
      // Scroll to the end, which is where both defects show.
      window.scrollTo(0, document.body.scrollHeight);
      const box = (selector: string) => document.querySelector(selector)?.getBoundingClientRect() ?? null;
      const appbar = box(".m2-appbar");
      const tabs = box(".sheet-tabs");
      const rail = box(".m2-rail");
      const cards = Array.from(document.querySelectorAll(".sheet-card, .m2-card"));
      const last = cards.at(-1)?.getBoundingClientRect() ?? null;
      return {
        appbarBottom: appbar?.bottom ?? 0,
        tabsTop: tabs?.top ?? 0,
        railTop: rail?.top ?? 0,
        lastCardBottom: last?.bottom ?? 0,
        // The rail must actually be pinned to the bottom edge.
        railBottom: rail?.bottom ?? 0,
        viewportHeight: innerHeight,
      };
    });

    // The tab strip sticks *below* the app bar, not underneath it.
    expect(chrome.tabsTop, "the sticky tabs must not slide under the app bar").toBeGreaterThanOrEqual(
      chrome.appbarBottom - 1,
    );
    // Nothing is trapped behind the bottom bar at the end of the longest section.
    expect(chrome.lastCardBottom, "the last card must clear the bottom bar").toBeLessThanOrEqual(chrome.railTop);
    expect(chrome.railBottom, "the bottom bar is pinned to the bottom edge").toBeGreaterThanOrEqual(
      chrome.viewportHeight - 1,
    );
  });

  /**
   * Overscroll.
   *
   * Rubber-banding past either end of the document exposes the root element's
   * background, which the user agent would otherwise paint white. This is one
   * of the four places a light flash could survive an otherwise dark app.
   */
  test("no light band is exposed behind the document", async ({ page }) => {
    await page.goto(APP_ROOT);
    const behind = await page.evaluate(() => {
      const luminance = (value: string) => {
        const [r, g, b] = (value.match(/[\d.]+/g) ?? []).map(Number);
        const channel = (part: number) => (part <= 0.03928 ? part / 12.92 : Math.pow((part + 0.055) / 1.055, 2.4));
        return 0.2126 * channel(r / 255) + 0.7152 * channel(g / 255) + 0.0722 * channel(b / 255);
      };
      const style = getComputedStyle(document.documentElement);
      return { background: style.backgroundColor, luminance: luminance(style.backgroundColor) };
    });
    expect(behind.luminance, `the root background painted ${behind.background}`).toBeLessThan(0.02);
  });

  /**
   * Branding is stated once.
   *
   * The wordmark is a label in the app bar, not a masthead. On the sheet the
   * character's name is the title of the screen, and the two must not read as
   * competing headings.
   */
  test("the sheet does not add a second piece of branding", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "This is the phone chrome contract.");
    test.slow();
    await page.setViewportSize({ width: 360, height: 780 });
    await buildCaster(page, "Sereth Marsh");

    const branding = await page.evaluate(() => {
      const wordmark = document.querySelector(".m2-appbar-brand strong");
      const title = document.querySelector(".sheet-identity h2");
      const size = (node: Element | null) => (node ? parseFloat(getComputedStyle(node).fontSize) : 0);
      return {
        occurrences: Array.from(document.querySelectorAll("body *")).filter(
          node => node.children.length === 0 && node.textContent?.trim() === "Runefolio",
        ).length,
        wordmarkSize: size(wordmark),
        titleSize: size(title),
      };
    });

    expect(branding.occurrences, "Runefolio is named once on the sheet").toBe(1);
    expect(branding.wordmarkSize, "the wordmark is subordinate to the character's name").toBeLessThan(branding.titleSize);
  });
});

/**
 * Dark under a light operating system.
 *
 * This is the assertion the product rule actually needs. Every other dark check
 * in the suite runs under `prefers-color-scheme: dark`, which is exactly the
 * case that would keep passing if the app went back to following the OS.
 */
test.describe("the operating system does not choose Runefolio's theme", () => {
  test.use({ colorScheme: "light" });

  test("an OS set to light still renders Runefolio dark", async ({ page }) => {
    await page.goto(APP_ROOT);

    // The preference really is light, so this is a genuine negative test.
    expect(await page.evaluate(() => matchMedia("(prefers-color-scheme: light)").matches)).toBe(true);

    const painted = await page.evaluate(() => {
      const luminance = (value: string) => {
        const [r, g, b] = (value.match(/[\d.]+/g) ?? []).map(Number);
        const channel = (part: number) => (part <= 0.03928 ? part / 12.92 : Math.pow((part + 0.055) / 1.055, 2.4));
        return 0.2126 * channel(r / 255) + 0.7152 * channel(g / 255) + 0.0722 * channel(b / 255);
      };
      const read = (selector: string) => {
        const node = document.querySelector(selector);
        if (!node) return null;
        const style = getComputedStyle(node);
        return { background: style.backgroundColor, luminance: luminance(style.backgroundColor) };
      };
      return {
        colorScheme: getComputedStyle(document.documentElement).colorScheme,
        html: read("html"),
        body: read("body"),
        shell: read(".m2-shell"),
        appbar: read(".m2-appbar"),
        rail: read(".m2-rail"),
        card: read(".m2-row"),
      };
    });

    expect(painted.colorScheme, "the document declares a dark colour scheme").toBe("dark");
    for (const [surface, measured] of Object.entries(painted)) {
      if (surface === "colorScheme" || measured === null || typeof measured === "string") continue;
      expect(
        measured.luminance,
        `${surface} must be a dark surface under a light OS, but it painted ${measured.background}`,
      ).toBeLessThan(0.1);
    }
  });

  test("no stylesheet reintroduces a light branch through the OS preference", async ({ page }) => {
    await page.goto(APP_ROOT);
    const branches = await page.evaluate(() => {
      const found: string[] = [];
      for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRuleList;
        try {
          rules = sheet.cssRules;
        } catch {
          continue;
        }
        for (const rule of Array.from(rules))
          if (rule instanceof CSSMediaRule && rule.conditionText.includes("prefers-color-scheme"))
            found.push(rule.conditionText);
      }
      return found;
    });
    expect(branches, "the OS colour preference must not select any Runefolio styling").toEqual([]);
  });
});

/**
 * The portrait guard.
 *
 * Emulated rotation is not evidence that a physical device locks — that is a
 * required manual test after deployment, recorded in
 * `docs/MOBILE_VISUAL_CONTRACT.md`. What these prove is the fallback: that a
 * phone which does rotate is covered, that nothing behind the cover can be
 * reached, and that rotating back restores the app rather than restarting it.
 */
test.describe("mobile landscape is covered, not redesigned", () => {
  test("landscape covers the app and portrait restores it with state intact", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "The guard is scoped to coarse-pointer phone contexts.");
    test.slow();

    await page.setViewportSize({ width: 390, height: 780 });
    await page.goto(APP_ROOT);
    await page.getByRole("button", { name: "New character" }).last().click();
    await expect(page.getByText("Step 1 of")).toBeVisible();

    // Type a draft value, so "state is preserved" has something to measure.
    const name = page.getByLabel("Character name", { exact: true });
    await name.fill("Sereth Marsh");
    await expect(name).toHaveValue("Sereth Marsh");

    // Rotate.
    await page.setViewportSize({ width: 780, height: 390 });
    const guard = page.getByRole("alert").filter({ hasText: "Turn your phone upright" });
    await expect(guard).toBeVisible();

    // No squeezed landscape UI is revealed behind it: the guard is opaque, and
    // the app is inert, so nothing underneath is focusable or hit-testable.
    const blocked = await page.evaluate(() => {
      const shell = document.querySelector(".m2-shell");
      const cover = document.querySelector(".portrait-guard");
      if (!shell || !cover) return null;
      const rect = cover.getBoundingClientRect();
      return {
        inert: shell.hasAttribute("inert"),
        coversViewport: rect.width >= innerWidth && rect.height >= innerHeight,
        opaque: getComputedStyle(cover).backgroundColor,
        // What the browser would actually hand a tap in the middle of the app.
        elementAtCentre: (document.elementFromPoint(innerWidth / 2, innerHeight / 2) as HTMLElement | null)?.closest(
          ".portrait-guard, .m2-shell",
        )?.className,
      };
    });
    expect(blocked?.inert, "the app is inert while the guard is up").toBe(true);
    expect(blocked?.coversViewport, "the guard covers the complete app").toBe(true);
    expect(blocked?.opaque, "the guard is opaque").not.toBe("rgba(0, 0, 0, 0)");
    expect(blocked?.elementAtCentre, "a tap lands on the guard, not the UI behind it").toBe("portrait-guard");

    // Focus cannot escape into the covered UI.
    await page.keyboard.press("Tab");
    const focusedInsideShell = await page.evaluate(
      () => document.activeElement?.closest(".m2-shell") !== null && document.activeElement !== document.body,
    );
    expect(focusedInsideShell, "tabbing must not reach the covered UI").toBe(false);

    // Rotate back: the app returns exactly as it was, not restarted.
    await page.setViewportSize({ width: 390, height: 780 });
    await expect(guard).toBeHidden();
    await expect(page.getByText("Step 1 of")).toBeVisible();
    await expect(page.getByLabel("Character name", { exact: true })).toHaveValue("Sereth Marsh");
  });

  test("the guard never appears on a desktop window", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "This is the desktop half of the same rule.");
    // A landscape window narrow enough to be phone-sized, but with a fine
    // pointer: the guard must not fire on it.
    await page.setViewportSize({ width: 900, height: 500 });
    await page.goto(APP_ROOT);
    await expect(page.locator(".portrait-guard")).toHaveCount(0);

    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.locator(".portrait-guard")).toHaveCount(0);
  });
});

/**
 * Browser zoom.
 *
 * Zoom shrinks the viewport measured in CSS pixels, which is the unit every
 * media query in the app is written in, so 200% on a 1280 px window reports
 * 640 px and the layout falls back to the phone pattern by itself. These widths
 * are the ones that fallback has to survive.
 */
test.describe("200% browser zoom", () => {
  for (const [label, width] of [
    ["a 1280 px window", 640],
    ["a 1024 px window", 512],
    ["a 768 px tablet", 384],
  ] as const) {
    test(`${label} at 200% zoom does not scroll sideways`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop", "Zoom fallback is a desktop-window rule.");
      await page.setViewportSize({ width, height: 640 });
      await page.goto(APP_ROOT);
      await expectNoHorizontalScroll(page, `${label} at 200% zoom`);

      await page.getByRole("button", { name: "New character" }).last().click();
      await expect(page.getByText("Step 1 of")).toBeVisible();
      await expectNoHorizontalScroll(page, `the builder in ${label} at 200% zoom`);
    });
  }
});
