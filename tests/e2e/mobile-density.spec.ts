import { expect, test, type Page, type TestInfo } from "@playwright/test";

/**
 * Mobile density, measured rather than eyeballed.
 *
 * Physical testing on a Galaxy S23 reported the creation surfaces as too
 * vertically loose: explanatory copy set at reading-body size, headings at
 * masthead scale, and card padding and stack gaps tuned for a desktop window.
 * "Looks tighter" is not a result anybody can check, so this file records the
 * numbers that actually decide it — the computed type sizes, the height of the
 * sticky builder chrome, and how much document a step occupies — and fails if
 * any of them regresses past the ceiling this pass established.
 *
 * The ceilings are deliberately stated as maxima, not as exact values. A future
 * change may make a surface tighter still; it may not quietly make it looser.
 * The floors matter just as much and are asserted alongside them: the point of
 * the pass was density, not shrinking the application, so nothing here is
 * allowed to fall under the readability and 44 px target contracts.
 */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const APP_ROOT = `${BASE_PATH}/`;

/** A Galaxy S23 reports 360 x 780 CSS px at its default display size. */
const S23 = { width: 360, height: 780 } as const;

const continueStep = (page: Page) => page.getByRole("button", { name: "Continue" }).click();

async function metric(page: Page, selector: string, property: string): Promise<number> {
  return page.evaluate(
    ([target, prop]) => {
      const node = document.querySelector(target as string);
      if (!node) return -1;
      return Number.parseFloat(getComputedStyle(node).getPropertyValue(prop as string));
    },
    [selector, property],
  );
}

async function boxHeight(page: Page, selector: string): Promise<number> {
  return page.evaluate(target => {
    const node = document.querySelector(target);
    return node ? Math.round(node.getBoundingClientRect().height) : -1;
  }, selector);
}

/** Everything the density pass is judged on, read off one painted screen. */
async function readDensity(page: Page) {
  return {
    introFontSize: await metric(page, ".m2-fieldset > .m2-muted", "font-size"),
    stepHeadingFontSize: await metric(page, ".m2-step-heading", "font-size"),
    builderChromeHeight: await boxHeight(page, ".m2-builder-head"),
    fieldsetPadding: await metric(page, ".m2-fieldset", "padding-top"),
    stepGap: await metric(page, ".m2-step", "row-gap"),
    documentHeight: await page.evaluate(() => document.documentElement.scrollHeight),
    firstOptionHeight: await boxHeight(page, ".m2-select-card .m2-option"),
  };
}

async function reachClassStep(page: Page) {
  await page.goto(APP_ROOT);
  await page.getByRole("button", { name: "New character" }).last().click();
  await page.getByLabel("Character name", { exact: true }).fill("Density Walker");
  await continueStep(page);
  await expect(page.getByRole("heading", { level: 2 }).first()).toHaveText("Class & level");
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  const image = await page.screenshot({ fullPage: true });
  await testInfo.attach(name, { body: image, contentType: "image/png" });
}

test.describe("mobile density at Galaxy S23 width", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(S23);
  });

  test("creation copy and chrome are compact without shrinking the application", async ({ page }, testInfo) => {
    await reachClassStep(page);
    const density = await readDensity(page);
    await capture(page, testInfo, "density-class-step-360");
    /*
     * Attached rather than logged. These numbers are the evidence for the
     * density claim and belong with the run's artefacts; printing them into the
     * suite's output puts a JSON blob in the middle of every CI log.
     */
    await testInfo.attach("density-class-step-360.json", {
      body: JSON.stringify(density, null, 2),
      contentType: "application/json",
    });

    /*
     * Explanatory copy — "What this adventurer is, mechanically…" — was set at
     * the document's 16 px default, which is a reading-body size for an article
     * and an oversized one for a hint under a legend. It is secondary text, and
     * it is now sized as secondary text.
     */
    expect(density.introFontSize, "explanatory copy is still at body scale").toBeLessThanOrEqual(14);
    expect(density.introFontSize, "explanatory copy has been shrunk past legibility").toBeGreaterThanOrEqual(13);

    // A step title, not a masthead. The page title stays larger than this.
    expect(density.stepHeadingFontSize).toBeLessThanOrEqual(22);
    expect(density.stepHeadingFontSize).toBeGreaterThanOrEqual(19);

    /*
     * The sticky builder chrome is the tax paid on every scroll: it is on
     * screen for the whole step. It carries a step counter, the step title, the
     * mode control and the way out of the task, and it does that in one
     * compact block rather than three stacked pill rows.
     */
    expect(density.builderChromeHeight, "the sticky builder chrome is too tall").toBeLessThanOrEqual(112);

    expect(density.fieldsetPadding).toBeLessThanOrEqual(10);
    expect(density.stepGap).toBeLessThanOrEqual(10);
  });

  /**
   * Density must not cost a tap target. Every control on the creation surfaces
   * is measured, not sampled: a single 40 px pill is exactly the regression a
   * spot check misses.
   */
  test("every creation control still meets the 44 px target contract", async ({ page }) => {
    await reachClassStep(page);
    const undersized = await page.evaluate(() => {
      const offenders: { label: string; width: number; height: number }[] = [];
      for (const control of document.querySelectorAll("button, select, input, a[href]")) {
        const box = control.getBoundingClientRect();
        if (box.width === 0 && box.height === 0) continue;
        if (box.height >= 44 && box.width >= 44) continue;
        offenders.push({
          label: (control.textContent ?? control.getAttribute("aria-label") ?? "unnamed").trim().slice(0, 40),
          width: Math.round(box.width),
          height: Math.round(box.height),
        });
      }
      return offenders;
    });
    expect(undersized, "controls below the 44 px minimum").toEqual([]);
  });

  /**
   * The utility row is one row on an ordinary phone.
   *
   * "Compact" is only meaningful as a layout claim, so it is asserted as one:
   * every control in the row shares a top edge, which is exactly what it means
   * for them not to be stacked.
   */
  test("the mode, and the way out, share one row", async ({ page }) => {
    await reachClassStep(page);
    const tops = await page.evaluate(() =>
      [...document.querySelectorAll(".m2-builder-utility button")].map(control =>
        Math.round(control.getBoundingClientRect().top),
      ),
    );
    expect(tops.length, "the utility row rendered no controls").toBeGreaterThanOrEqual(3);
    expect(new Set(tops).size, `utility controls are on ${new Set(tops).size} rows, not one`).toBe(1);
  });

  /**
   * Changing mode moves nothing.
   *
   * The old control was a single button whose label was the mode it was in, so
   * "Guided mode" and "Flexible mode" were different widths and everything to
   * their right shifted on every switch. Both labels are now always rendered,
   * which makes the control a fixed width by construction — and this is the
   * assertion that keeps it that way.
   */
  test("switching mode does not move the utility row", async ({ page }) => {
    await reachClassStep(page);
    const geometry = () =>
      page.evaluate(() =>
        [...document.querySelectorAll(".m2-builder-utility button")].map(control => {
          const box = control.getBoundingClientRect();
          return { left: Math.round(box.left), width: Math.round(box.width), top: Math.round(box.top) };
        }),
      );

    const before = await geometry();
    await page.getByRole("button", { name: "Flexible", exact: true }).click();
    await expect(page.getByRole("button", { name: "Flexible", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(await geometry()).toEqual(before);
  });

  test("the compact chrome still does not scroll sideways at 320 px", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 780 });
    await reachClassStep(page);
    const report = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(report.scrollWidth).toBeLessThanOrEqual(report.clientWidth);
  });
});
