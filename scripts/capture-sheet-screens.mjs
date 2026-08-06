/**
 * Captures the play-first sheet review screenshots.
 *
 * Drives a real browser through the actual builder against a running dev or
 * preview server (SHEET_CAPTURE_URL, default http://localhost:3000), creates
 * the two synthetic fixture characters, applies a little session state, and
 * writes phone-width screenshots (light and dark) to docs/product/play-sheet/.
 *
 * Usage: node scripts/capture-sheet-screens.mjs
 */
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const BASE_URL = process.env.SHEET_CAPTURE_URL ?? "http://localhost:3000";
const OUT_DIR = "docs/product/play-sheet";

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

async function continueStep(page) {
  await page.getByRole("button", { name: "Continue" }).click();
}

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

  // Identity step adds nothing mechanical; skip straight to review.
  await continueStep(page);
  await page.getByRole("button", { name: "Finish and open sheet" }).click();
  await page.getByRole("heading", { name: options.name, level: 2 }).waitFor();
}

async function openCharacter(page, name) {
  await page.getByRole("button", { name: "Characters", exact: true }).click();
  await page.getByRole("button", { name: new RegExp(`Open ${name}`) }).click();
  await page.getByRole("heading", { name, level: 2 }).waitFor();
}

async function shoot(page, file) {
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${OUT_DIR}/${file}`, fullPage: false });
  console.log(`captured ${file}`);
}

const run = async () => {
  mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
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

  // A little session state so the sheet reads as mid-session, not a mockup.
  await page.getByRole("button", { name: /Open hit point actions/ }).click();
  await page.getByRole("spinbutton", { name: "Amount" }).fill("3");
  await page.getByRole("button", { name: /Apply 3 damage/ }).click();
  await page.getByRole("button", { name: /Close Hit points/ }).click();
  await page.getByRole("button", { name: /^Condition$/ }).click();
  await page.getByRole("button", { name: /Add the Winded condition/ }).click();
  await page.getByRole("button", { name: "Inspiration" }).click();

  await shoot(page, "fighter-overview-light-390.png");
  await page.getByRole("tab", { name: "Actions" }).click();
  await shoot(page, "fighter-actions-light-390.png");
  await page.getByRole("button", { name: /Open hit point actions/ }).click();
  await shoot(page, "fighter-hp-drawer-light-390.png");
  await page.keyboard.press("Escape");

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
  await shoot(page, "caster-spells-light-390.png");
  await page.getByRole("tab", { name: "Character" }).click();
  await shoot(page, "caster-character-light-390.png");

  // Same storage, dark scheme.
  await page.emulateMedia({ colorScheme: "dark" });
  await page.getByRole("tab", { name: "Overview" }).click();
  await shoot(page, "caster-overview-dark-390.png");
  await page.getByRole("tab", { name: "Spells" }).click();
  await shoot(page, "caster-spells-dark-390.png");

  await openCharacter(page, "Brammel Voss");
  await shoot(page, "fighter-overview-dark-390.png");

  // Narrowest supported width.
  await page.setViewportSize({ width: 360, height: 780 });
  await shoot(page, "fighter-overview-dark-360.png");

  await page.emulateMedia({ colorScheme: "light" });
  await page.getByRole("button", { name: "Characters", exact: true }).click();
  await shoot(page, "library-light-360.png");

  await browser.close();
};

run().catch(error => {
  console.error(error);
  process.exit(1);
});
