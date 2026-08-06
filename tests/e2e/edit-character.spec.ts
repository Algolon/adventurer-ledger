import { expect, test, type Page } from "@playwright/test";

/**
 * The Edit character journey, driven through the real UI.
 *
 * Every character here is created by walking the actual builder and committing
 * it, so what Edit reopens is a genuinely committed record rather than a seeded
 * one. That matters: the defect this journey exists to catch was Edit opening a
 * blank builder, which a seeded fixture would have hidden.
 *
 * Only original synthetic content is used.
 */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const APP_ROOT = `${BASE_PATH}/`;

const ABILITY_ASSIGNMENT: readonly [string, string][] = [
  ["Strength", "14"],
  ["Dexterity", "15"],
  ["Constitution", "13"],
  ["Intelligence", "12"],
  ["Wisdom", "10"],
  ["Charisma", "8"],
];

const continueStep = (page: Page) => page.getByRole("button", { name: "Continue" }).click();

async function startNewCharacter(page: Page) {
  await page.goto(APP_ROOT);
  await expect(page.getByRole("heading", { name: "No characters on this device yet" })).toBeVisible();
  await page.getByRole("button", { name: "New character" }).last().click();
  await expect(page.getByText("Step 1 of 8")).toBeVisible();
}

async function buildBrammel(page: Page) {
  await page.getByLabel("Character name", { exact: true }).fill("Brammel Voss");
  await continueStep(page);
  await page.getByRole("button", { name: /^Vanguard/ }).click();
  await continueStep(page);
  await page.getByRole("button", { name: /^Riverborn/ }).click();
  await page.getByRole("button", { name: /^Caravan Warden/ }).click();
  await page.getByRole("button", { name: /^Trade Cant/ }).click();
  await continueStep(page);
  for (const [ability, value] of ABILITY_ASSIGNMENT) await page.getByLabel(ability, { exact: true }).selectOption(value);
  await page.getByLabel("+2 to").selectOption("strength");
  await page.getByLabel("+1 to").selectOption("constitution");
  await continueStep(page);
  await page.getByRole("button", { name: /^Guarded Hand/ }).click();
  await page.getByRole("button", { name: /^Riverlore/ }).click();
  await page.getByRole("button", { name: /^Haulage/ }).click();
  await continueStep(page);
  await page.getByRole("button", { name: /^Warden pack/ }).click();
  await continueStep(page);
  await page.getByLabel("Nickname").fill("Boss");
  await continueStep(page);
  await expect(page.getByText("Step 8 of 8")).toBeVisible();
  await page.getByRole("button", { name: "Finish and open sheet" }).click();
  await expect(page.getByRole("heading", { name: "Brammel Voss", level: 2 })).toBeVisible();
}

async function buildSereth(page: Page) {
  await page.getByLabel("Character name", { exact: true }).fill("Sereth Marsh");
  await continueStep(page);
  await page.getByRole("button", { name: /^Runecaller/ }).click();
  await continueStep(page);
  await page.getByRole("button", { name: /^Riverborn/ }).click();
  await page.getByRole("button", { name: /^Caravan Warden/ }).click();
  await page.getByRole("button", { name: /^River Signs/ }).click();
  await continueStep(page);
  const abilities: readonly [string, string][] = [
    ["Strength", "10"],
    ["Dexterity", "14"],
    ["Constitution", "13"],
    ["Intelligence", "12"],
    ["Wisdom", "15"],
    ["Charisma", "8"],
  ];
  for (const [ability, value] of abilities) await page.getByLabel(ability, { exact: true }).selectOption(value);
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
}

/** Presses Edit character from the sheet's Character section. */
async function openEdit(page: Page) {
  await page.getByRole("tab", { name: "Character" }).click();
  await page.getByRole("button", { name: "Edit character", exact: true }).click();
  await expect(page.getByText(/^Step \d of \d$/)).toBeVisible();
}

/** Leaves whatever view is showing for the library. */
async function goToCharacters(page: Page) {
  await page.getByRole("button", { name: "Characters", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Characters", exact: true })).toBeVisible();
}

/** Walks forward to Review from wherever the builder currently is. */
async function goToReview(page: Page) {
  await page.getByRole("button", { name: "All steps" }).click();
  await page.getByRole("button", { name: /^Review/ }).click();
  await expect(page.getByRole("button", { name: /Save changes and open sheet/ })).toBeVisible();
}

/** Damages, spends and toggles enough that a reset would be unmistakable. */
async function dirtyPlayState(page: Page) {
  await page.getByRole("button", { name: /Open hit point actions/ }).click();
  await page.getByRole("spinbutton", { name: "Amount" }).fill("4");
  await page.getByRole("button", { name: /^Apply 4 damage/ }).click();
  await page.getByRole("button", { name: /Spend one hit die/ }).click();
  await page.getByRole("button", { name: "Close Hit points" }).click();

  await page.getByRole("button", { name: "Inspiration" }).click();
  await expect(page.getByRole("button", { name: "Inspiration" })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: /^Condition$/ }).click();
  await page.getByRole("button", { name: /Increase exhaustion/ }).click();
  await page.getByRole("button", { name: "Close Conditions & exhaustion" }).click();
}

/** The play state that must survive an edit, read back off the sheet. */
async function playStateSurvived(page: Page) {
  await expect(page.getByText("6 / 10")).toBeVisible();
  await expect(page.getByRole("button", { name: "Inspiration" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: /Exhaustion level 1/ })).toBeVisible();
}

test.describe("editing a martial character", () => {
  test("opens prefilled, saves through Review, and updates the same character", async ({ page }) => {
    await startNewCharacter(page);
    await buildBrammel(page);
    await dirtyPlayState(page);

    await openEdit(page);

    // 4. Every current build field is prefilled, step by step.
    await expect(page.getByLabel("Character name", { exact: true })).toHaveValue("Brammel Voss");
    await page.getByRole("button", { name: "All steps" }).click();
    await page.getByRole("button", { name: /^Class & level/ }).click();
    await expect(page.getByRole("button", { name: /^Vanguard/ })).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("button", { name: "All steps" }).click();
    await page.getByRole("button", { name: /^Origin/ }).click();
    await expect(page.getByRole("button", { name: /^Riverborn/ })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: /^Caravan Warden/ })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: /^Trade Cant/ })).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("button", { name: "All steps" }).click();
    await page.getByRole("button", { name: /^Abilities/ }).click();
    await expect(page.getByLabel("Strength", { exact: true })).toHaveValue("14");
    await expect(page.getByLabel("Dexterity", { exact: true })).toHaveValue("15");

    await page.getByRole("button", { name: "All steps" }).click();
    await page.getByRole("button", { name: /^Class choices/ }).click();
    await expect(page.getByRole("button", { name: /^Guarded Hand/ })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: /^Riverlore/ })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: /^Haulage/ })).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("button", { name: "All steps" }).click();
    await page.getByRole("button", { name: /^Equipment/ }).click();
    await expect(page.getByRole("button", { name: /^Warden pack/ })).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("button", { name: "All steps" }).click();
    await page.getByRole("button", { name: /^Identity/ }).click();
    await expect(page.getByLabel("Nickname")).toHaveValue("Boss");

    // 5. Change one ability allocation: the origin's +2 moves to Dexterity.
    await page.getByRole("button", { name: "All steps" }).click();
    await page.getByRole("button", { name: /^Abilities/ }).click();
    await expect(page.getByLabel("+2 to")).toHaveValue("strength");
    await expect(page.getByLabel("+1 to")).toHaveValue("constitution");
    await page.getByLabel("+2 to").selectOption("dexterity");

    // 6. Save & close returns to the sheet, and the committed values are
    // untouched: Strength is still 16 and armour class still 18.
    await page.getByRole("button", { name: "Save & close" }).click();
    await expect(page.getByRole("heading", { name: "Brammel Voss", level: 2 })).toBeVisible();
    await expect(page.getByRole("button", { name: /Armour class 18\. Open details/ })).toBeVisible();
    await page.getByRole("tab", { name: "Overview" }).click();
    await expect(page.getByRole("button", { name: /Strength \+3, score 16\. Open details/ })).toBeVisible();

    // Resuming shows the unsaved change still sitting in the draft.
    await openEdit(page);
    await page.getByRole("button", { name: "All steps" }).click();
    await page.getByRole("button", { name: /^Abilities/ }).click();
    await expect(page.getByLabel("+2 to")).toHaveValue("dexterity");

    // 7. Complete Review.
    await goToReview(page);
    await page.getByRole("button", { name: /Save changes and open sheet/ }).click();
    await expect(page.getByRole("heading", { name: "Brammel Voss", level: 2 })).toBeVisible();

    // 8. The same character, updated: Strength 14 and Dexterity 17 now.
    await page.getByRole("tab", { name: "Overview" }).click();
    await expect(page.getByRole("button", { name: /Strength \+2, score 14\. Open details/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Dexterity \+3, score 17\. Open details/ })).toBeVisible();

    // 9. No duplicate character, and no leftover unfinished build.
    await goToCharacters(page);
    await expect(page.getByRole("button", { name: /Open Brammel Voss/ })).toHaveCount(1);
    await expect(page.getByText("Unfinished builds")).toHaveCount(0);

    // 10. Transient state survived the whole journey.
    await page.getByRole("button", { name: /Open Brammel Voss/ }).click();
    await playStateSurvived(page);
  });

  test("discarding an edit writes nothing and reopens from the committed values", async ({ page }) => {
    await startNewCharacter(page);
    await buildBrammel(page);
    await dirtyPlayState(page);

    await openEdit(page);
    await page.getByLabel("Character name", { exact: true }).fill("Someone Else");
    await page.getByRole("button", { name: "Discard changes" }).click();
    const dialog = page.getByRole("alertdialog", { name: "Discard these changes?" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Keep editing" })).toBeFocused();
    await dialog.getByRole("button", { name: "Discard changes" }).click();

    // Discarding closes the task and leaves the sheet exactly as it was.
    await expect(page.getByRole("heading", { name: "Brammel Voss", level: 2 })).toBeVisible();
    await playStateSurvived(page);

    await goToCharacters(page);
    await expect(page.getByRole("button", { name: /Open Brammel Voss/ })).toHaveCount(1);
    await expect(page.getByText("Unfinished builds")).toHaveCount(0);

    // Reopening starts from the commit again, not from the discarded attempt.
    await page.getByRole("button", { name: /Open Brammel Voss/ }).click();
    await openEdit(page);
    await expect(page.getByLabel("Character name", { exact: true })).toHaveValue("Brammel Voss");
  });

  test("two presses of Edit open one draft, not two", async ({ page }) => {
    await startNewCharacter(page);
    await buildBrammel(page);

    await page.getByRole("tab", { name: "Character" }).click();
    const edit = page.getByRole("button", { name: "Edit character", exact: true });
    await edit.click({ clickCount: 2, delay: 0 });
    await expect(page.getByText(/^Step \d of \d$/)).toBeVisible();

    await page.getByRole("button", { name: "Save & close" }).click();
    await goToCharacters(page);
    await expect(page.getByRole("button", { name: /Resume building/ })).toHaveCount(1);
  });

  test("survives a reload in the middle of an edit", async ({ page }) => {
    await startNewCharacter(page);
    await buildBrammel(page);

    await openEdit(page);
    await page.getByRole("button", { name: "All steps" }).click();
    await page.getByRole("button", { name: /^Identity/ }).click();
    await page.getByLabel("Nickname").fill("Reloaded");
    // The step write settles before the reload; reloading sooner tests a torn
    // write rather than the resume contract.
    await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();
    await page.getByRole("button", { name: "Save & close" }).click();
    await expect(page.getByRole("heading", { name: "Brammel Voss", level: 2 })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("heading", { name: "Characters", exact: true })).toBeVisible();
    await page.getByRole("button", { name: /Resume building/ }).click();
    await page.getByRole("button", { name: "All steps" }).click();
    await page.getByRole("button", { name: /^Identity/ }).click();
    await expect(page.getByLabel("Nickname")).toHaveValue("Reloaded");
    // The committed character still says Boss until Review is completed.
    await page.getByRole("button", { name: "Save & close" }).click();
    await goToCharacters(page);
    await page.getByRole("button", { name: /Open Brammel Voss/ }).click();
    await page.getByRole("tab", { name: "Character" }).click();
    await expect(page.getByText("“Boss”")).toBeVisible();
  });

  test("refuses to overwrite a character that changed elsewhere", async ({ page }) => {
    await startNewCharacter(page);
    await buildBrammel(page);

    await openEdit(page);
    await page.getByRole("button", { name: "Save & close" }).click();
    await goToCharacters(page);

    // The character moves on while the edit draft is parked: archiving is a
    // durable write, so the draft's recorded revision is now behind.
    await page.getByRole("button", { name: /More actions for Brammel Voss/ }).click();
    await page.getByRole("button", { name: /^Archive Brammel Voss/ }).click();
    await expect(page.getByRole("button", { name: /Open Brammel Voss/ })).toHaveCount(0);

    await page.getByRole("button", { name: /Resume building/ }).click();
    await goToReview(page);
    await page.getByRole("button", { name: /Save changes and open sheet/ }).click();

    // A refusal that says what happened, rather than a silent overwrite.
    await expect(page.getByRole("alert").filter({ hasText: /changed somewhere else/ })).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: /Nothing has been overwritten/ })).toBeVisible();
  });
});

test.describe("editing a caster", () => {
  test("opens prefilled and updates the same character", async ({ page }) => {
    await startNewCharacter(page);
    await buildSereth(page);

    // A spent slot is the play state that must survive.
    await page.getByRole("tab", { name: "Spells" }).click();
    await page.getByRole("button", { name: /Spend one Rune slots/ }).click();
    await expect(page.getByText("1 / 2")).toBeVisible();

    await openEdit(page);
    await expect(page.getByLabel("Character name", { exact: true })).toHaveValue("Sereth Marsh");
    await page.getByRole("button", { name: "All steps" }).click();
    await page.getByRole("button", { name: /^Class & level/ }).click();
    await expect(page.getByRole("button", { name: /^Runecaller/ })).toHaveAttribute("aria-pressed", "true");

    // The conditional Spells step is in the sequence for a caster's edit too.
    await page.getByRole("button", { name: "All steps" }).click();
    await page.getByRole("button", { name: /^Spells & resources/ }).click();
    await expect(page.getByText("Known spells")).toBeVisible();

    // Change one equipment choice.
    await page.getByRole("button", { name: "All steps" }).click();
    await page.getByRole("button", { name: /^Equipment/ }).click();
    await expect(page.getByRole("button", { name: /^River kit/ })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: /^Warden pack/ }).click();

    await goToReview(page);
    await page.getByRole("button", { name: /Save changes and open sheet/ }).click();
    await expect(page.getByRole("heading", { name: "Sereth Marsh", level: 2 })).toBeVisible();

    await page.getByRole("tab", { name: "Inventory" }).click();
    await expect(page.getByText("Warden pack")).toBeVisible();

    // One character, and the spent slot is still spent.
    await goToCharacters(page);
    await expect(page.getByRole("button", { name: /Open Sereth Marsh/ })).toHaveCount(1);
    await page.getByRole("button", { name: /Open Sereth Marsh/ }).click();
    await page.getByRole("tab", { name: "Spells" }).click();
    await expect(page.getByText("1 / 2")).toBeVisible();
  });
});

/**
 * The library's own Edit route, which is the second way in.
 *
 * The missing-source and changed-content cases are covered at the service level
 * in `tests/edit-character.integration.test.ts` rather than here, deliberately:
 * there is no UI route that uninstalls or disables installed content, so an
 * end-to-end test of it would have to reach past the product to set up a state
 * the product cannot produce — and a test that quietly skips its own setup when
 * the control is absent reports a pass for something it never exercised.
 */
test.describe("the library's Edit build route", () => {
  test("opens the same hydrated draft as the sheet's Edit character", async ({ page }) => {
    await startNewCharacter(page);
    await buildBrammel(page);

    await goToCharacters(page);
    await page.getByRole("button", { name: /More actions for Brammel Voss/ }).click();
    await page.getByRole("button", { name: /^Edit build for Brammel Voss/ }).click();

    await expect(page.getByLabel("Character name", { exact: true })).toHaveValue("Brammel Voss");
    await page.getByRole("button", { name: "All steps" }).click();
    await page.getByRole("button", { name: /^Class & level/ }).click();
    await expect(page.getByRole("button", { name: /^Vanguard/ })).toHaveAttribute("aria-pressed", "true");

    // One draft, whichever door was used.
    await page.getByRole("button", { name: "Save & close" }).click();
    await goToCharacters(page);
    await expect(page.getByRole("button", { name: /Resume building/ })).toHaveCount(1);
  });
});

test.describe("the edit route at phone widths and in both themes", () => {
  for (const width of [360, 390, 412] as const)
    test(`opens prefilled and reaches Review at ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 780 });
      await startNewCharacter(page);
      await buildBrammel(page);
      await openEdit(page);

      await expect(page.getByLabel("Character name", { exact: true })).toHaveValue("Brammel Voss");
      // The task footer's primary action stays reachable without horizontal scroll.
      await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      await goToReview(page);
      await expect(page.getByRole("button", { name: /Save changes and open sheet/ })).toBeVisible();
    });

  for (const scheme of ["light", "dark"] as const)
    test(`is legible in ${scheme} mode`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: 390, height: 780 });
      await startNewCharacter(page);
      await buildBrammel(page);
      await openEdit(page);

      await expect(page.getByLabel("Character name", { exact: true })).toHaveValue("Brammel Voss");
      await expect(page.getByRole("button", { name: "Discard changes" })).toBeVisible();
    });
});

test.describe("death saves are not an ordinary control", () => {
  test("appear only at zero hit points and disappear again on healing", async ({ page }) => {
    await startNewCharacter(page);
    await buildBrammel(page);

    await expect(page.getByRole("heading", { name: "Death saves" })).toHaveCount(0);

    await page.getByRole("button", { name: /Open hit point actions/ }).click();
    await page.getByRole("spinbutton", { name: "Amount" }).fill("99");
    await page.getByRole("button", { name: /^Apply 99 damage/ }).click();
    await page.getByRole("button", { name: "Close Hit points" }).click();

    await expect(page.getByRole("heading", { name: "Death saves" })).toBeVisible();
    await page.getByRole("button", { name: "Failure", exact: true }).click();
    await page.getByRole("button", { name: "Success", exact: true }).click();

    await page.getByRole("button", { name: /Open hit point actions/ }).click();
    await page.getByRole("spinbutton", { name: "Amount" }).fill("5");
    await page.getByRole("button", { name: /^Heal Brammel Voss by 5/ }).click();
    await page.getByRole("button", { name: "Close Hit points" }).click();

    // Healing above zero removes the card and the tally with it.
    await expect(page.getByRole("heading", { name: "Death saves" })).toHaveCount(0);
    await expect(page.getByText("5 / 10")).toBeVisible();
  });
});
