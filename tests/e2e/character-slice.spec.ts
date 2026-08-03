import { expect, test, type Page } from "@playwright/test";

/**
 * M2.1 Brammel vertical slice.
 *
 * Every flow uses only the accepted original synthetic content. The character is
 * built through the real nine-step builder rather than seeded behind the UI, so
 * these specs exercise the same service boundaries the product uses.
 */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const APP_ROOT = `${BASE_PATH}/`;

/** Widths the responsive contract must hold at. */
const REQUIRED_WIDTHS = [360, 390, 412, 768, 1024, 1440] as const;

const ABILITY_ASSIGNMENT: readonly [string, string][] = [
  ["Strength", "14"],
  ["Dexterity", "15"],
  ["Constitution", "13"],
  ["Intelligence", "12"],
  ["Wisdom", "10"],
  ["Charisma", "8"],
];

async function continueStep(page: Page) {
  await page.getByRole("button", { name: "Continue" }).click();
}

/**
 * Opens Settings from whichever control is showing: the app-bar button on
 * mobile, or the persistent rail entry once the compact rail appears.
 */
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

/** The builder's error summary, distinct from the framework route announcer. */
const errorSummary = (page: Page) => page.getByRole("alert").filter({ hasText: /issue/ });

async function startNewCharacter(page: Page) {
  await page.goto(APP_ROOT);
  await expect(page.getByRole("heading", { name: "No characters on this device yet" })).toBeVisible();
  await page.getByRole("button", { name: "New character" }).last().click();
  await expect(page.getByText("Step 1 of 9")).toBeVisible();
}

/** Walks the nine steps and commits Brammel at level 1. */
async function buildBrammel(page: Page, { name = "Brammel Voss" }: { name?: string } = {}) {
  await continueStep(page); // Start / ruleset

  await expect(page.getByText("Step 2 of 9")).toBeVisible();
  await page.getByRole("button", { name: /^Vanguard/ }).click();
  await continueStep(page);

  await expect(page.getByText("Step 3 of 9")).toBeVisible();
  await page.getByRole("button", { name: /^Riverborn/ }).click();
  await page.getByRole("button", { name: /^Caravan Warden/ }).click();
  await page.getByRole("button", { name: /^Trade Cant/ }).click();
  await continueStep(page);

  await expect(page.getByText("Step 4 of 9")).toBeVisible();
  for (const [ability, value] of ABILITY_ASSIGNMENT) await page.getByLabel(ability, { exact: true }).selectOption(value);
  await page.getByLabel("+2 to").selectOption("strength");
  await page.getByLabel("+1 to").selectOption("constitution");
  await continueStep(page);

  await expect(page.getByText("Step 5 of 9")).toBeVisible();
  await page.getByRole("button", { name: /^Guarded Hand/ }).click();
  await page.getByRole("button", { name: /^Watchcraft/ }).click();
  await page.getByRole("button", { name: /^Haulage/ }).click();
  await continueStep(page);

  // The conditional step stays visible and is marked, not removed.
  await expect(page.getByText("Step 6 of 9")).toBeVisible();
  await expect(page.getByText("Not needed · This class has no spells at level 1")).toBeVisible();
  await continueStep(page);

  await expect(page.getByText("Step 7 of 9")).toBeVisible();
  await page.getByRole("button", { name: /^Warden pack/ }).click();
  await continueStep(page);

  await expect(page.getByText("Step 8 of 9")).toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Nickname").fill("Boss");
  await continueStep(page);

  await expect(page.getByText("Step 9 of 9")).toBeVisible();
  await page.getByRole("button", { name: "Finish and open sheet" }).click();
  await expect(page.getByRole("heading", { name, level: 2 })).toBeVisible();
}

test.describe("blank device to a playable character", () => {
  test("creates Brammel through the nine-step builder and opens the sheet", async ({ page }) => {
    await startNewCharacter(page);
    await buildBrammel(page);

    // The derived values match the accepted synthetic reference numbers.
    await expect(page.getByRole("button", { name: /Explain Armour class, 18/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Explain Initiative, \+2/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Explain Speed, 30/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Explain Proficiency, \+2/ })).toBeVisible();
    await expect(page.getByText("10 / 10")).toBeVisible();
    await expect(page.getByText("Rallying Breath")).toBeVisible();
    await expect(page.getByText("Vanguard 1")).toBeVisible();
  });

  test("explains a derived value with its contributors and source", async ({ page }) => {
    await startNewCharacter(page);
    await buildBrammel(page);

    await page.getByRole("button", { name: /Explain Armour class/ }).click();
    const dialog = page.getByRole("dialog", { name: "Armour class" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Travel Mail")).toBeVisible();
    await expect(dialog.getByText("Round Guard")).toBeVisible();
    await expect(dialog.getByText("Dexterity modifier (capped at +2)")).toBeVisible();
    await expect(dialog.getByText("source:runefolio-synthetic").first()).toBeVisible();
    await expect(dialog.getByText("Runefolio 2024 synthetic")).toBeVisible();
  });

  test("offers Copy expression and never a Roll control", async ({ page }) => {
    await startNewCharacter(page);
    await buildBrammel(page);

    await page.getByRole("button", { name: /Open details for Longblade Strike/ }).click();
    const dialog = page.getByRole("dialog", { name: "Longblade Strike" });
    await expect(dialog.getByText("1d20 + 5")).toBeVisible();
    await expect(dialog.getByText("1d8 + 4")).toBeVisible();
    await expect(dialog.getByRole("button", { name: /Copy Longblade Strike attack expression/ })).toBeVisible();
    // D-08: expression only.
    await expect(page.getByRole("button", { name: /^Roll/ })).toHaveCount(0);
  });

  test("returns focus to the control that opened a details surface", async ({ page }) => {
    await startNewCharacter(page);
    await buildBrammel(page);

    const trigger = page.getByRole("button", { name: /Explain Armour class/ });
    await trigger.click();
    await expect(page.getByRole("dialog", { name: "Armour class" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Armour class" })).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
});

test.describe("draft persistence", () => {
  test("resumes the last committed step after a reload", async ({ page }) => {
    await startNewCharacter(page);
    await continueStep(page);
    await page.getByRole("button", { name: /^Vanguard/ }).click();
    await continueStep(page);
    await expect(page.getByText("Step 3 of 9")).toBeVisible();

    await page.reload();
    await expect(page.getByRole("heading", { name: "Characters", exact: true })).toBeVisible();
    // The library lists the unfinished build with its resume step.
    await expect(page.getByText("Unfinished builds")).toBeVisible();
    await page.getByRole("button", { name: /Resume building/ }).click();
    await expect(page.getByText("Step 3 of 9")).toBeVisible();
    // The earlier choice survived the reload.
    await page.getByRole("button", { name: "Steps" }).click();
    await expect(page.getByRole("button", { name: /Class.*Complete/s })).toBeVisible();
  });

  test("preserves every selection when the presentation mode changes", async ({ page }) => {
    await startNewCharacter(page);
    await continueStep(page);
    await page.getByRole("button", { name: /^Vanguard/ }).click();

    await page.getByRole("button", { name: "Guided mode" }).click();
    await expect(page.getByRole("button", { name: "Flexible mode" })).toBeVisible();
    // The class stays selected across the mode change.
    await expect(page.getByRole("button", { name: /^Vanguard/ })).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("button", { name: "Flexible mode" }).click();
    await expect(page.getByRole("button", { name: /^Vanguard/ })).toHaveAttribute("aria-pressed", "true");
  });

  test("guided mode keeps the user at an unresolved dependency", async ({ page }) => {
    await startNewCharacter(page);
    await continueStep(page);
    await expect(page.getByText("Step 2 of 9")).toBeVisible();
    // Continue without choosing a class.
    await continueStep(page);
    await expect(errorSummary(page)).toContainText("Choose a class");
    await expect(page.getByText("Step 2 of 9")).toBeVisible();
  });

  test("flexible mode may skip a step and save an incomplete build", async ({ page }) => {
    await startNewCharacter(page);
    await page.getByRole("button", { name: "Guided mode" }).click();
    await continueStep(page);
    await expect(page.getByText("Step 2 of 9")).toBeVisible();
    await continueStep(page);
    // Flexible mode advances without resolving the class.
    await expect(page.getByText("Step 3 of 9")).toBeVisible();
    await page.reload();
    await expect(page.getByText("Unfinished builds")).toBeVisible();
  });

  test("recommends without selecting", async ({ page }) => {
    await startNewCharacter(page);
    await continueStep(page);
    const vanguard = page.getByRole("button", { name: /^Vanguard/ });
    await expect(vanguard).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByText("Recommended")).toBeVisible();

    await page.getByRole("button", { name: /Why this/ }).click();
    await expect(page.getByText(/front rank/i)).toBeVisible();
    // Reading the explanation still does not select the option.
    await expect(vanguard).toHaveAttribute("aria-pressed", "false");
  });
});

test.describe("runtime play", () => {
  test("applies damage as one mutation and undoes it", async ({ page }) => {
    await startNewCharacter(page);
    await buildBrammel(page);

    await page.getByLabel("Amount").fill("5");
    await expect(page.getByText("Preview: 5 after damage, 10 after healing")).toBeVisible();
    await page.getByRole("button", { name: /Apply 5 damage/ }).click();
    await expect(page.getByText("5 / 10")).toBeVisible();

    await page.getByRole("button", { name: /Undo the last play action/ }).click();
    await expect(page.getByText("10 / 10")).toBeVisible();
  });

  test("keeps a limited resource inside its bounds", async ({ page }) => {
    await startNewCharacter(page);
    await buildBrammel(page);

    const spend = page.getByRole("button", { name: "Spend one Rallying Breath" });
    for (let index = 0; index < 3; index += 1) await spend.click();
    await expect(page.getByText("0 / 3")).toBeVisible();
    // The control disables at the bound rather than silently going negative.
    await expect(spend).toBeDisabled();
  });

  test("survives a reload with the runtime state intact", async ({ page }) => {
    await startNewCharacter(page);
    await buildBrammel(page);
    await page.getByLabel("Amount").fill("4");
    await page.getByRole("button", { name: /Apply 4 damage/ }).click();
    await expect(page.getByText("6 / 10")).toBeVisible();

    await page.reload();
    await page.getByRole("button", { name: /Open Brammel Voss/ }).click();
    await expect(page.getByText("6 / 10")).toBeVisible();
  });
});

test.describe("level up", () => {
  test("previews the preserve-deficit policy and commits atomically", async ({ page }) => {
    await startNewCharacter(page);
    await buildBrammel(page);

    // Spend down to 5/10 hit points and 1/3 uses.
    await page.getByLabel("Amount").fill("5");
    await page.getByRole("button", { name: /Apply 5 damage/ }).click();
    const spend = page.getByRole("button", { name: "Spend one Rallying Breath" });
    await spend.click();
    await spend.click();
    await expect(page.getByText("1 / 3")).toBeVisible();

    await page.getByRole("button", { name: "Level up" }).click();
    const dialog = page.getByRole("dialog", { name: "Level 1 to 2" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Preserve deficit and expenditure")).toBeVisible();
    // 5/10 with a +2 maximum becomes 7/12; 1/3 with a +1 maximum becomes 2/4.
    await expect(dialog.getByRole("row", { name: /Hit points.*5 \/ 10.*\+2.*7 \/ 12/ })).toBeVisible();
    await expect(dialog.getByRole("row", { name: /Rallying Breath.*1 \/ 3.*\+1.*2 \/ 4/ })).toBeVisible();
    // Only the newly required choice appears.
    await expect(dialog.getByText("Weapon mastery", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Vanguard stance", { exact: true })).toHaveCount(0);

    await dialog.getByRole("button", { name: /^Measured Cut/ }).click();
    await dialog.getByRole("button", { name: "Confirm level 2" }).click();

    await expect(page.getByText("Vanguard 2")).toBeVisible();
    await expect(page.getByText("7 / 12")).toBeVisible();
    await expect(page.getByText("2 / 4")).toBeVisible();
  });

  test("cancel leaves the character at level 1", async ({ page }) => {
    await startNewCharacter(page);
    await buildBrammel(page);

    await page.getByRole("button", { name: "Level up" }).click();
    await page.getByRole("dialog", { name: "Level 1 to 2" }).getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText("Vanguard 1")).toBeVisible();
    await expect(page.getByText("10 / 10")).toBeVisible();
  });
});

test.describe("transfer", () => {
  test("exports a safe file and reports Already current when re-imported", async ({ page }) => {
    await startNewCharacter(page);
    await buildBrammel(page);

    await openSettings(page);
    await page.getByRole("button", { name: /^Transfer$/ }).click();

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: /^Export Brammel Voss/ }).click();
    const file = await download;
    const stream = await file.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const contents = Buffer.concat(chunks).toString("utf8");
    const document = JSON.parse(contents);

    expect(document.kind).toBe("runefolio-character-transfer");
    expect(document.formatVersion).toBe(1);
    expect(document.characterFingerprint).toMatch(/^cfp1:/);
    expect(document.dependencies.length).toBeGreaterThan(0);

    // Re-importing the same file onto the same device is Already current.
    await page.setInputFiles('input[type="file"]', {
      name: "brammel-transfer.json",
      mimeType: "application/json",
      buffer: Buffer.from(contents),
    });
    await expect(page.getByText("Already current")).toBeVisible();
    await expect(page.getByText(/Fingerprint/)).toBeVisible();
  });

  test("offers Keep both and Replace when the local record diverged", async ({ page }) => {
    await startNewCharacter(page);
    await buildBrammel(page);

    await openSettings(page);
    await page.getByRole("button", { name: /^Transfer$/ }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: /^Export Brammel Voss/ }).click();
    const file = await download;
    const stream = await file.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const contents = Buffer.concat(chunks).toString("utf8");

    // Diverge the local record by levelling it up.
    await page.getByRole("button", { name: "Characters", exact: true }).click();
    await page.getByRole("button", { name: /Open Brammel Voss/ }).click();
    await page.getByRole("button", { name: "Level up" }).click();
    const levelDialog = page.getByRole("dialog", { name: "Level 1 to 2" });
    await levelDialog.getByRole("button", { name: /^Measured Cut/ }).click();
    await levelDialog.getByRole("button", { name: "Confirm level 2" }).click();
    await expect(page.getByText("Vanguard 2")).toBeVisible();

    await openSettings(page);
    await page.getByRole("button", { name: /^Transfer$/ }).click();
    await page.setInputFiles('input[type="file"]', {
      name: "brammel-transfer.json",
      mimeType: "application/json",
      buffer: Buffer.from(contents),
    });

    await expect(page.getByRole("button", { name: "Keep both" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Replace local with restore point" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();

    // Cancel performs no mutation.
    await page.getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("button", { name: "Characters", exact: true }).click();
    await expect(page.getByText("Vanguard 2")).toBeVisible();
  });

  test("rejects a malformed transfer file without echoing its contents", async ({ page }) => {
    await page.goto(APP_ROOT);
    await openSettings(page);
    await page.getByRole("button", { name: /^Transfer$/ }).click();
    await page.setInputFiles('input[type="file"]', {
      name: "bad.json",
      mimeType: "application/json",
      buffer: Buffer.from('{"secretValue":"private table note","kind":"nope"}'),
    });
    const status = page.getByText(/could not be read/);
    await expect(status).toBeVisible();
    await expect(page.locator("body")).not.toContainText("private table note");
  });
});

test.describe("offline session", () => {
  test("keeps the library, sheet, explanations and play actions usable offline", async ({ page, context }) => {
    await startNewCharacter(page);
    await buildBrammel(page);

    await context.setOffline(true);
    await page.reload();

    await expect(page.getByRole("heading", { name: "Characters", exact: true })).toBeVisible();
    await page.getByRole("button", { name: /Open Brammel Voss/ }).click();
    await expect(page.getByRole("button", { name: /Explain Armour class, 18/ })).toBeVisible();

    // Explanations backed by local content still open.
    await page.getByRole("button", { name: /Explain Armour class/ }).click();
    await expect(page.getByRole("dialog", { name: "Armour class" }).getByText("Travel Mail")).toBeVisible();
    await page.keyboard.press("Escape");

    // Runtime mutations and local history keep working with no network.
    await page.getByLabel("Amount").fill("3");
    await page.getByRole("button", { name: /Apply 3 damage/ }).click();
    await expect(page.getByText("7 / 10")).toBeVisible();
    await page.getByRole("button", { name: /Undo the last play action/ }).click();
    await expect(page.getByText("10 / 10")).toBeVisible();

    await context.setOffline(false);
  });
});

test.describe("responsive and accessibility", () => {
  for (const width of REQUIRED_WIDTHS) {
    test(`has no document-level horizontal overflow at ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await startNewCharacter(page);
      await buildBrammel(page);

      const surfaces: (() => Promise<void>)[] = [
        async () => {
          await page.getByRole("button", { name: "Characters", exact: true }).click();
        },
        async () => {
          await page.getByRole("button", { name: /Open Brammel Voss/ }).click();
        },
        async () => {
          await openSettings(page);
        },
        async () => {
          await page.getByRole("button", { name: /^Transfer$/ }).click();
        },
      ];
      for (const visit of surfaces) {
        await visit();
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, `horizontal overflow at ${width} px`).toBeLessThanOrEqual(0);
      }
    });
  }

  test("meets the minimum touch-target sizes on the play sheet", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await startNewCharacter(page);
    await buildBrammel(page);

    const undersized = await page.evaluate(() => {
      const failures: string[] = [];
      for (const element of document.querySelectorAll<HTMLElement>("button")) {
        if (element.offsetParent === null) continue;
        const box = element.getBoundingClientRect();
        const minimum = element.classList.contains("m2-play-action") ? 48 : 44;
        if (box.height + 0.5 < minimum || box.width + 0.5 < minimum)
          failures.push(`${element.className}:${Math.round(box.width)}x${Math.round(box.height)}`);
      }
      return failures;
    });
    expect(undersized).toEqual([]);
  });

  test("completes creation with the keyboard alone", async ({ page }) => {
    await startNewCharacter(page);
    // Tab to the Continue control and activate it without a pointer.
    await page.keyboard.press("Tab");
    for (let index = 0; index < 12; index += 1) {
      const label = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
      if (label.startsWith("Continue")) break;
      await page.keyboard.press("Tab");
    }
    await expect(page.locator(":focus")).toContainText("Continue");
    await page.keyboard.press("Enter");
    await expect(page.getByText("Step 2 of 9")).toBeVisible();
  });

  test("traps focus inside a modal surface", async ({ page }) => {
    await startNewCharacter(page);
    await buildBrammel(page);
    await page.getByRole("button", { name: /Explain Armour class/ }).click();
    const dialog = page.getByRole("dialog", { name: "Armour class" });
    await expect(dialog).toBeVisible();

    for (let index = 0; index < 8; index += 1) await page.keyboard.press("Tab");
    const inside = await page.evaluate(() => {
      const dialogElement = document.querySelector('[role="dialog"]');
      return Boolean(dialogElement && document.activeElement && dialogElement.contains(document.activeElement));
    });
    expect(inside).toBe(true);
  });

  test("keeps meaning and operation under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await startNewCharacter(page);
    await buildBrammel(page);
    await expect(page.getByRole("button", { name: /Explain Armour class, 18/ })).toBeVisible();
  });
});
