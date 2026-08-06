/**
 * Captures the play-first review screenshots.
 *
 * Drives a real browser through the actual builder against a running dev or
 * preview server (SHEET_CAPTURE_URL, default http://localhost:3000), creates the
 * two synthetic fixture characters, applies a little session state, and writes
 * every review screen at each reviewed width and theme.
 *
 * The characters are built, never seeded, and the Edit character screen is
 * reached by pressing the real control — so a screenshot of a prefilled builder
 * is evidence that it prefills, not a picture of a fixture.
 *
 * Usage: node scripts/capture-sheet-screens.mjs
 */
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const BASE_URL = process.env.SHEET_CAPTURE_URL ?? "http://localhost:3000";
const OUT_DIR = "docs/product/play-sheet";

/** The review contexts: the phone widths and themes this iteration is judged at. */
const CONTEXTS = [
  { theme: "light", width: 360, height: 780 },
  { theme: "light", width: 390, height: 844 },
  { theme: "dark", width: 390, height: 844 },
  { theme: "dark", width: 412, height: 892 },
];

const ABILITIES_FIGHTER = [
  ["Strength", "14"],
  ["Dexterity", "15"],
  ["Constitution", "13"],
  ["Intelligence", "12"],
  ["Wisdom", "10"],
  ["Charisma", "8"],
];

const ABILITIES_CASTER = [
  ["Strength", "10"],
  ["Dexterity", "14"],
  ["Constitution", "13"],
  ["Intelligence", "12"],
  ["Wisdom", "15"],
  ["Charisma", "8"],
];

const continueStep = page => page.getByRole("button", { name: "Continue" }).click();

async function buildCharacter(page, options) {
  await page.getByRole("button", { name: "New character" }).last().click();
  await page.getByLabel("Character name", { exact: true }).fill(options.name);
  await continueStep(page);

  await page.getByRole("button", { name: options.classPattern }).click();
  await continueStep(page);

  await page.getByRole("button", { name: /^Riverborn/ }).click();
  await page.getByRole("button", { name: /^Caravan Warden/ }).click();
  await page.getByRole("button", { name: options.languagePattern }).click();
  await continueStep(page);

  for (const [ability, value] of options.abilities)
    await page.getByLabel(ability, { exact: true }).selectOption(value);
  await page.getByLabel("+2 to").selectOption(options.plusTwo);
  await page.getByLabel("+1 to").selectOption(options.plusOne);
  await continueStep(page);

  for (const pattern of options.classChoices) await page.getByRole("button", { name: pattern }).click();
  await continueStep(page);

  if (options.hasSpellsStep) {
    await page.getByText("Known spells").waitFor();
    await continueStep(page);
  }

  await page.getByRole("button", { name: options.gearPattern }).click();
  await continueStep(page);

  await continueStep(page); // Identity adds nothing mechanical here.
  await page.getByRole("button", { name: "Finish and open sheet" }).click();
  await page.getByRole("heading", { name: options.name, level: 2 }).waitFor();
}

async function openCharacter(page, name) {
  await page.getByRole("button", { name: "Characters", exact: true }).click();
  await page.getByRole("button", { name: new RegExp(`Open ${name}`) }).click();
  await page.getByRole("heading", { name, level: 2 }).waitFor();
}

/** A little mid-session state, so the sheet reads as played rather than mocked. */
async function applySessionState(page) {
  await page.getByRole("button", { name: /Open hit point actions/ }).click();
  await page.getByRole("spinbutton", { name: "Amount" }).fill("3");
  await page.getByRole("button", { name: /Apply 3 damage/ }).click();
  await page.getByRole("button", { name: /Close Hit points/ }).click();
  await page.getByRole("button", { name: /^Condition$/ }).click();
  await page.getByRole("button", { name: /Add the Winded condition/ }).click();
  await page.getByRole("button", { name: "Inspiration" }).click();
}

/**
 * The review screens, each described as how to reach it from the library.
 *
 * Edit character is reached through the sheet's own control and captured on the
 * Basics step, which is where the prefilled name is visible; Save & close then
 * leaves the draft exactly as it was for the next context.
 */
const SCREENS = [
  {
    id: "fighter-overview",
    async open(page) {
      await openCharacter(page, "Brammel Voss");
      await page.getByRole("tab", { name: "Overview" }).click();
    },
  },
  {
    id: "fighter-actions",
    async open(page) {
      await openCharacter(page, "Brammel Voss");
      await page.getByRole("tab", { name: "Actions" }).click();
    },
  },
  {
    id: "fighter-hp-drawer",
    async open(page) {
      await openCharacter(page, "Brammel Voss");
      await page.getByRole("button", { name: /Open hit point actions/ }).click();
    },
    async close(page) {
      await page.getByRole("button", { name: /Close Hit points/ }).click();
    },
  },
  {
    id: "fighter-character",
    async open(page) {
      await openCharacter(page, "Brammel Voss");
      await page.getByRole("tab", { name: "Character" }).click();
    },
  },
  {
    id: "caster-spells",
    async open(page) {
      await openCharacter(page, "Sereth Marsh");
      await page.getByRole("tab", { name: "Spells" }).click();
    },
  },
  {
    id: "edit-character",
    async open(page) {
      await openCharacter(page, "Brammel Voss");
      await page.getByRole("tab", { name: "Character" }).click();
      await page.getByRole("button", { name: "Edit character", exact: true }).click();
      // The prefilled name is the whole point of this screen.
      await page.getByLabel("Character name", { exact: true }).waitFor();
    },
    async close(page) {
      await page.getByRole("button", { name: "Save & close" }).click();
      await page.getByRole("heading", { name: "Brammel Voss", level: 2 }).waitFor();
    },
  },
];

async function shoot(page, file) {
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${OUT_DIR}/${file}`, fullPage: false });
  console.log(`captured ${file}`);
}

const run = async () => {
  mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  // One context for the whole run, so every screenshot is of the same two
  // characters in the same session state.
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    colorScheme: "light",
  });
  const page = await context.newPage();
  await page.goto(BASE_URL);
  await page.getByRole("heading", { name: "No characters on this device yet" }).waitFor();

  await buildCharacter(page, {
    name: "Brammel Voss",
    classPattern: /^Vanguard/,
    languagePattern: /^Trade Cant/,
    abilities: ABILITIES_FIGHTER,
    plusTwo: "strength",
    plusOne: "constitution",
    classChoices: [/^Guarded Hand/, /^Riverlore/, /^Haulage/],
    hasSpellsStep: false,
    gearPattern: /^Warden pack/,
  });
  await applySessionState(page);

  await page.getByRole("button", { name: "Characters", exact: true }).click();
  await buildCharacter(page, {
    name: "Sereth Marsh",
    classPattern: /^Runecaller/,
    languagePattern: /^River Signs/,
    abilities: ABILITIES_CASTER,
    plusTwo: "dexterity",
    plusOne: "constitution",
    classChoices: [/^Riverlore$/],
    hasSpellsStep: true,
    gearPattern: /^River kit/,
  });
  await page.getByRole("tab", { name: "Spells" }).click();
  await page.getByRole("button", { name: /Spend one Rune slots/ }).click();

  for (const { theme, width, height } of CONTEXTS) {
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width, height });
    for (const screen of SCREENS) {
      await screen.open(page);
      await shoot(page, `${screen.id}-${theme}-${width}.png`);
      if (screen.close) await screen.close(page);
    }
  }

  // The library, at the narrowest supported width.
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 360, height: 780 });
  await page.getByRole("button", { name: "Characters", exact: true }).click();
  await shoot(page, "library-light-360.png");

  await browser.close();
};

run().catch(error => {
  console.error(error);
  process.exit(1);
});
