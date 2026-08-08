import { expect, test, type Page } from "@playwright/test";

/**
 * Guidance must not change the shape of what it is guiding.
 *
 * On the Samsung pilot, switching a build into guided mode visibly rebuilt the
 * class cards: the "Recommended" badge took a column out of the row's grid, the
 * at-a-glance facts underneath lost about a hundred pixels of width, and labels
 * such as "Saves" and "Primary" broke across lines. Flexible mode, with no badge
 * to place, laid the same option out differently.
 *
 * That is a recommendation editing the information geometry of the option it is
 * recommending. The option is the same option in both modes, so it has to
 * measure the same in both modes — and "measure" is meant literally here: these
 * tests read the boxes rather than the pixels, because a screenshot comparison
 * would pass on a machine that happened to round the same way.
 */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const APP_ROOT = `${BASE_PATH}/`;

const continueStep = (page: Page) => page.getByRole("button", { name: "Continue" }).click();

/** The mode control, whichever half of it is currently the way out of the mode. */
const modeButton = (page: Page, mode: "Guided" | "Flexible") =>
  page.getByRole("button", { name: mode, exact: true });

async function reachClassStep(page: Page, name = "Guidance Probe") {
  await page.goto(APP_ROOT);
  await page.getByRole("button", { name: "New character" }).last().click();
  await page.getByLabel("Character name", { exact: true }).fill(name);
  await continueStep(page);
  await expect(page.getByRole("heading", { level: 2 }).first()).toHaveText("Class & level");
}

/**
 * The geometry of the first class option: the row itself, its facts strip, and
 * every individual fact chip.
 */
async function optionGeometry(page: Page) {
  return page.evaluate(() => {
    const row = document.querySelector(".m2-select-card .m2-option");
    if (!row) throw new Error("No class option row was rendered");
    const facts = row.querySelector(".m2-facts");
    const round = (box: DOMRect) => ({
      width: Math.round(box.width),
      height: Math.round(box.height),
      left: Math.round(box.left),
    });
    return {
      row: round(row.getBoundingClientRect()),
      facts: facts ? round(facts.getBoundingClientRect()) : null,
      chips: [...row.querySelectorAll(".m2-fact")].map(chip => ({
        text: (chip.textContent ?? "").trim(),
        ...round(chip.getBoundingClientRect()),
        /*
         * One client rect per line box. These are plain inline spans, so a
         * count above one is the precise definition of "this ran onto another
         * line" — including a break inside a word, which is what
         * `overflow-wrap: anywhere` produces when a column is too narrow.
         */
        lines: [...chip.querySelectorAll("span")].map(part => ({
          text: (part.textContent ?? "").trim(),
          rects: part.getClientRects().length,
        })),
      })),
    };
  });
}

test.describe("guided and flexible present the same option", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
  });

  test("switching modes does not move or reflow the class facts", async ({ page }) => {
    await reachClassStep(page);

    // A new draft opens guided, which is the mode that carried the defect.
    await expect(page.getByText("Recommended").first()).toBeVisible();
    const guided = await optionGeometry(page);

    await modeButton(page, "Flexible").click();
    await expect(page.getByText("Recommended")).toHaveCount(0);
    const flexible = await optionGeometry(page);

    expect(guided.facts, "the class option renders no facts to compare").not.toBeNull();
    /*
     * The facts strip is the thing the pilot watched change. Same width, same
     * height, same left edge in both modes: the recommendation is now beside
     * the option rather than inside its layout.
     */
    expect(flexible.facts).toEqual(guided.facts);
    expect(flexible.chips).toEqual(guided.chips);
    // The row itself keeps its dimensions too, so the selected card does not
    // resize under the user when guidance is toggled.
    expect(flexible.row).toEqual(guided.row);
  });

  test("no fact wraps inside itself in either mode", async ({ page }) => {
    await reachClassStep(page);

    for (const mode of ["Guided", "Flexible"] as const) {
      if (mode === "Flexible") await modeButton(page, "Flexible").click();
      const { chips } = await optionGeometry(page);
      expect(chips.length, `${mode} mode rendered no facts`).toBeGreaterThan(0);
      /*
       * Every label and value occupies exactly one line box. The chips wrap as
       * whole units within the strip; nothing breaks inside a word, which is
       * what "Saves" and "Primary" were doing once the badge took their width.
       */
      const broken = chips
        .flatMap(chip => chip.lines.map(part => ({ chip: chip.text, ...part })))
        .filter(part => part.rects > 1);
      expect(
        broken,
        `${mode}: ${broken.map(part => `"${part.text}"`).join(", ")} wrapped across lines at 360 px`,
      ).toEqual([]);
    }
  });

  /**
   * The recommendation still has to be findable. Removing it from the row's
   * layout is only correct if it remains visible on the card and attached to
   * the option for a screen reader.
   */
  test("the recommendation stays discoverable and attached to its option", async ({ page }) => {
    await reachClassStep(page);

    const badge = page.getByText("Recommended").first();
    await expect(badge).toBeVisible();

    // The option announces its own recommendation, though the badge is no
    // longer one of its children.
    const described = await page.evaluate(() => {
      const recommended = document.querySelector(".m2-select-card-recommended .m2-option");
      const id = recommended?.getAttribute("aria-describedby");
      return id ? (document.getElementById(id)?.textContent ?? "").trim() : null;
    });
    expect(described).toBe("Recommended");

    // And it is still secondary: guidance never selects anything for the user.
    await expect(page.locator(".m2-option[aria-pressed='true']")).toHaveCount(0);
  });
});
