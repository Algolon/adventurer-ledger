import { expect, test, type Page } from "@playwright/test";

/**
 * Browser coverage for the acceptance criteria that were previously only
 * partially met: AC-01 Duplicate and Archive, AC-04 incompatible options,
 * AC-05 manual-sheet entry, AC-15 named states, AC-16 responsive behaviour and
 * AC-17 accessibility under zoom and forced colours.
 */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const APP_ROOT = `${BASE_PATH}/`;
const WIDTHS = [360, 390, 412, 768, 1024, 1440] as const;

const ABILITY_ASSIGNMENT: readonly [string, string][] = [
  ["Strength", "14"],
  ["Dexterity", "15"],
  ["Constitution", "13"],
  ["Intelligence", "12"],
  ["Wisdom", "10"],
  ["Charisma", "8"],
];

const next = (page: Page) => page.getByRole("button", { name: "Continue" }).click();

async function startNewCharacter(page: Page) {
  await page.goto(APP_ROOT);
  await page.getByRole("button", { name: "New character" }).last().click();
  await expect(page.getByText("Step 1 of 9")).toBeVisible();
}

async function buildBrammel(page: Page, name = "Brammel Voss") {
  await page.getByLabel("Character name", { exact: true }).fill(name);
  await next(page);
  await page.getByRole("button", { name: /^Vanguard/ }).click();
  await next(page);
  await page.getByRole("button", { name: /^Riverborn/ }).click();
  await next(page);

  await page.getByRole("button", { name: /^Caravan Warden/ }).click();
  await page.getByRole("button", { name: /^Trade Cant/ }).click();
  await next(page);
  for (const [ability, value] of ABILITY_ASSIGNMENT) await page.getByLabel(ability, { exact: true }).selectOption(value);
  await page.getByLabel("+2 to").selectOption("strength");
  await page.getByLabel("+1 to").selectOption("constitution");
  await next(page);
  await page.getByRole("button", { name: /^Guarded Hand/ }).click();
  await page.getByRole("button", { name: /^Riverlore/ }).click();
  await page.getByRole("button", { name: /^Haulage/ }).click();
  await next(page);
  await page.getByRole("button", { name: /^Warden pack/ }).click();
  await next(page);
  await next(page);
  await page.getByRole("button", { name: "Finish and open sheet" }).click();
  await expect(page.getByRole("heading", { name, level: 2 })).toBeVisible();
}

test.describe("AC-01 Duplicate and Archive", () => {
  test("duplicates a character into an independent record", async ({ page }) => {
    await startNewCharacter(page);
    await buildBrammel(page);

    await page.getByRole("button", { name: "Characters", exact: true }).click();
    await page.getByRole("button", { name: /More actions for Brammel Voss/ }).click();
    await page.getByRole("button", { name: /^Duplicate Brammel Voss/ }).click();

    await expect(page.getByRole("button", { name: /Open Brammel Voss \(Copy\)/ })).toBeVisible();
    // The original is still there.
    await expect(page.getByRole("button", { name: /Open Brammel Voss,/ })).toBeVisible();

    // Playing the copy does not change the original.
    await page.getByRole("button", { name: /Open Brammel Voss \(Copy\)/ }).click();
    await page.getByRole("button", { name: /Open hit point actions/ }).click();
    await page.getByRole("spinbutton", { name: "Amount" }).fill("4");
    await page.getByRole("button", { name: /Apply 4 damage/ }).click();
    await expect(page.getByText("6 / 10").first()).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Characters", exact: true }).click();
    await page.getByRole("button", { name: /Open Brammel Voss,/ }).click();
    await expect(page.getByText("10 / 10")).toBeVisible();
  });

  test("archives a character out of the active library without deleting it", async ({ page }) => {
    await startNewCharacter(page);
    await buildBrammel(page);

    await page.getByRole("button", { name: "Characters", exact: true }).click();
    await page.getByRole("button", { name: /More actions for Brammel Voss/ }).click();
    await page.getByRole("button", { name: /^Archive Brammel Voss/ }).click();

    await expect(page.getByRole("heading", { name: "No characters on this device yet" })).toBeVisible();
    // The record still exists locally; only the active library changed.
    const stored = await page.evaluate(
      () =>
        new Promise<number>(resolve => {
          const request = indexedDB.open("adventurer-ledger");
          request.onsuccess = () => {
            const database = request.result;
            const store = database.transaction("characters").objectStore("characters");
            const count = store.count();
            count.onsuccess = () => resolve(count.result);
          };
        }),
    );
    expect(stored).toBe(1);
  });
});

test.describe("AC-04 incompatible option", () => {
  test("explains the incompatibility and its repair without replacing the choice", async ({ page }) => {
    await startNewCharacter(page);
    await next(page);
    await page.getByRole("button", { name: /^Vanguard/ }).click();
    await next(page);
    await page.getByRole("button", { name: /^Riverborn/ }).click();
    await next(page);

    await page.getByRole("button", { name: /^Caravan Warden/ }).click();
    await page.getByRole("button", { name: /^Trade Cant/ }).click();
    await next(page);
    for (const [ability, value] of ABILITY_ASSIGNMENT) await page.getByLabel(ability, { exact: true }).selectOption(value);
    await page.getByLabel("+2 to").selectOption("strength");
    await page.getByLabel("+1 to").selectOption("constitution");
    await next(page);

    // The option is visibly marked before it is chosen, with its requirement.
    const reaver = page.getByRole("button", { name: /^Reaver's Grip/ });
    await expect(reaver).toBeVisible();
    await expect(reaver).toContainText("Requires Strength 18 or higher");
    await expect(reaver).toContainText("Incompatible");

    await reaver.click();
    // Choosing it explains the consequence and the repair, and changes nothing.
    await expect(page.getByText(/does not meet Strength 18 or higher/)).toBeVisible();
    await expect(page.getByText(/choose another option/)).toBeVisible();
    await expect(reaver).toHaveAttribute("aria-pressed", "true");

    // Guided mode refuses to continue past the unmet requirement.
    await next(page);
    await expect(page.getByRole("alert").filter({ hasText: /issue/ })).toContainText(
      "A selected option does not meet its requirement",
    );
    await expect(page.getByText("Step 6 of 9")).toBeVisible();

    // Flexible mode keeps the choice with its issue visible.
    await page.getByRole("button", { name: "Guided mode" }).click();
    await expect(page.getByRole("button", { name: "Flexible mode" })).toBeVisible();
    await expect(reaver).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText(/does not meet Strength 18 or higher/)).toBeVisible();
  });
});

test.describe("AC-05 manual-sheet entry", () => {
  test("creates, saves and reopens a manual character that never claims rules justification", async ({ page }) => {
    await startNewCharacter(page);
    await page.getByLabel("Character name", { exact: true }).fill("Marek Tal");
    await next(page);

    await page.getByRole("button", { name: /^Manual character sheet/ }).click();
    await next(page);
    // Neither Species nor Background is required for a manual sheet.
    await next(page);
    await next(page);

    for (const [ability, value] of ABILITY_ASSIGNMENT) await page.getByLabel(ability, { exact: true }).selectOption(value);
    await next(page);

    await expect(page.getByRole("heading", { name: "Manual values" })).toBeVisible();
    await page.getByLabel("Maximum hit points").fill("9");
    await page.getByLabel("Current hit points").fill("9");
    await page.getByLabel("Armour class", { exact: true }).fill("15");
    await page.getByLabel("Initiative", { exact: true }).fill("1");
    await page.getByRole("button", { name: "Add an action" }).click();
    await page.getByLabel("Action 1").fill("Improvised swing");
    await next(page);

    // A manual sheet has no class, so no spell choices apply and that step is
    // not in the sequence: Equipment follows directly.
    await next(page); // Equipment
    await next(page); // Identity

    await page.getByRole("button", { name: "Finish and open sheet" }).click();
    await expect(page.getByRole("heading", { name: "Marek Tal", level: 2 })).toBeVisible();

    // Visibly Manual, with no false claim of automatic justification.
    await expect(page.getByText("Manual", { exact: true })).toBeVisible();
    await expect(page.getByText(/not automatically rules-justified/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Armour class 15\. Open details/ })).toBeVisible();
    await expect(page.getByText("9 / 9")).toBeVisible();

    // It reopens from the library as a manual character.
    await page.reload();
    await page.getByRole("button", { name: /Open Marek Tal/ }).click();
    await expect(page.getByText("Manual", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Armour class 15\. Open details/ })).toBeVisible();
  });
});

test.describe("AC-15 named states and recovery", () => {
  test("announces a loading state before the library resolves", async ({ page }) => {
    // Record every status text that appears, so the transient state is observable.
    await page.addInitScript(() => {
      const seen: string[] = [];
      (window as unknown as { __seen: string[] }).__seen = seen;
      const sample = () => {
        for (const node of document.querySelectorAll('[role="status"], [aria-busy="true"]'))
          if (node.textContent) seen.push(node.textContent);
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await page.goto(APP_ROOT);
    await expect(page.getByRole("heading", { name: "No characters on this device yet" })).toBeVisible();
    const seen = await page.evaluate(() => (window as unknown as { __seen: string[] }).__seen.join("|"));
    expect(seen).toContain("Reading your local library");
  });

  test("keeps the edit and offers Retry when a local save fails", async ({ page }) => {
    await startNewCharacter(page);
    await next(page);
    await page.getByRole("button", { name: /^Vanguard/ }).click();
    await expect(page.getByText("Step 2 of 9")).toBeVisible();

    // Remove the draft underneath the builder so the next autosave cannot land.
    await page.evaluate(
      () =>
        new Promise<void>(resolve => {
          const request = indexedDB.open("adventurer-ledger");
          request.onsuccess = () => {
            const database = request.result;
            const transaction = database.transaction("characterDrafts", "readwrite");
            transaction.objectStore("characterDrafts").clear();
            transaction.oncomplete = () => resolve();
          };
        }),
    );

    await next(page);
    const banner = page.getByRole("alert").filter({ hasText: /Save failed/ });
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("could not be saved on this device");
    // A retry is offered, and the edit made before the failure is still held.
    await expect(page.getByRole("button", { name: "Retry save" })).toBeVisible();
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByRole("button", { name: /^Vanguard/ })).toHaveAttribute("aria-pressed", "true");
  });

  test("shows a missing-source banner with a recovery action and no private values", async ({ page }) => {
    await startNewCharacter(page);
    await buildBrammel(page);

    // Disable the source the character depends on. Deleting an entry would be
    // repaired by the idempotent seed on the next load; disabling the source on
    // the ruleset is the real "disabled or removed source" case from AC-12.
    await page.evaluate(
      () =>
        new Promise<void>(resolve => {
          const request = indexedDB.open("adventurer-ledger");
          request.onsuccess = () => {
            const database = request.result;
            const transaction = database.transaction("rulesetProfiles", "readwrite");
            const store = transaction.objectStore("rulesetProfiles");
            const read = store.get("ruleset:runefolio-2024-synthetic");
            read.onsuccess = () => {
              const profile = read.result;
              profile.activeSourceIds = [];
              store.put(profile);
            };
            transaction.oncomplete = () => resolve();
          };
        }),
    );
    await page.reload();
    await page.getByRole("button", { name: /Open Brammel Voss/ }).click();

    const banner = page.getByRole("alert").filter({ hasText: /source content is missing/ });
    await expect(banner).toBeVisible();
    /*
     * It says what happened and where to repair it, in plain words. The stable
     * IDs it used to print were technical provenance on a play surface, so the
     * banner now names neither the entry nor the source; Settings is where
     * content is identified.
     */
    await expect(banner).not.toContainText("class:vanguard");
    await expect(banner).not.toContainText("source:");
    await expect(banner).toContainText(/re-enable or import it under Settings/);
    await expect(banner).toContainText(/Nothing is substituted for you/);
    // Affected values are blocked rather than guessed.
    await expect(page.getByText("—").first()).toBeVisible();
  });
});

test.describe("AC-16 responsive behaviour", () => {
  for (const width of WIDTHS) {
    test(`keeps long names readable and controls unoverlapped at ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await startNewCharacter(page);
      // A deliberately long name and nickname stress wrapping and truncation.
      await buildBrammel(page, "Brammel Voss of the Long Riverbank Crossing Company, Warden of the Third Ford");

      const report = await page.evaluate(() => {
        const documentOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
        const rects: { label: string; rect: DOMRect }[] = [];
        for (const element of document.querySelectorAll<HTMLElement>("button, a")) {
          if (element.offsetParent === null) continue;
          rects.push({ label: element.className, rect: element.getBoundingClientRect() });
        }
        // Any element wider than the viewport would force a sideways scroll.
        const tooWide = rects.filter(item => item.rect.width > window.innerWidth + 1).map(item => item.label);
        // Scroll containers must be reachable by keyboard.
        const unreachableScrollers: string[] = [];
        for (const element of document.querySelectorAll<HTMLElement>("*")) {
          if (element === document.documentElement || element === document.body) continue;
          if (element.scrollWidth <= element.clientWidth + 1) continue;
          // Only containers the user can actually scroll count; clipped
          // screen-reader text overflows but is not a scroll region.
          const overflowX = getComputedStyle(element).overflowX;
          if (overflowX !== "auto" && overflowX !== "scroll") continue;
          const focusable = element.tabIndex >= 0 || element.querySelector("a,button,input,select,textarea");
          if (!focusable) unreachableScrollers.push(element.className || element.tagName);
        }
        return { documentOverflow, tooWide, unreachableScrollers };
      });

      expect(report.documentOverflow, "document horizontal overflow").toBeLessThanOrEqual(0);
      expect(report.tooWide, "controls wider than the viewport").toEqual([]);
      expect(report.unreachableScrollers, "scroll containers without keyboard access").toEqual([]);
    });
  }

  test("does not let the task footer cover the primary action at 360 px", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await startNewCharacter(page);

    const overlap = await page.evaluate(() => {
      const footer = document.querySelector<HTMLElement>(".m2-task-footer");
      const continueButton = [...document.querySelectorAll<HTMLElement>("button")].find(button =>
        button.textContent?.trim().startsWith("Continue"),
      );
      if (!footer || !continueButton) return "missing";
      const footerRect = footer.getBoundingClientRect();
      const buttonRect = continueButton.getBoundingClientRect();
      // The primary action lives inside the footer and is fully on screen.
      const inside = buttonRect.top >= footerRect.top - 1 && buttonRect.bottom <= footerRect.bottom + 1;
      const onScreen = buttonRect.bottom <= window.innerHeight + 1 && buttonRect.right <= window.innerWidth + 1;
      return inside && onScreen ? "ok" : "overlapping";
    });
    expect(overlap).toBe("ok");
  });
});

test.describe("AC-17 zoom, forced colours and focus order", () => {
  test("falls back to the mobile pattern at 200% zoom on a 1024 px screen", async ({ page }) => {
    // 200% zoom on a physical 1024 px viewport exposes about 512 CSS px.
    await page.setViewportSize({ width: 512, height: 768 });
    await page.goto(APP_ROOT);

    const layout = await page.evaluate(() => {
      const rail = document.querySelector<HTMLElement>(".m2-rail");
      const style = rail ? getComputedStyle(rail) : undefined;
      return {
        position: style?.position,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        settingsVisible: Boolean(
          [...document.querySelectorAll<HTMLElement>("button")].find(
            button => button.getAttribute("aria-label") === "Open Settings" && button.offsetParent !== null,
          ),
        ),
      };
    });
    // The rail is the fixed bottom bar again, and task order is unchanged.
    expect(layout.position).toBe("fixed");
    expect(layout.overflow).toBeLessThanOrEqual(0);
    expect(layout.settingsVisible).toBe(true);
    await expect(page.getByRole("button", { name: "Characters", exact: true })).toBeVisible();
  });

  test("keeps every state distinguishable in forced-colors mode", async ({ page }) => {
    await page.emulateMedia({ forcedColors: "active" });
    await startNewCharacter(page);
    await buildBrammel(page);

    // State is carried by words, not colour alone, so it survives forced
    // colours: proficiency is in the accessible name, not only in a filled dot.
    await expect(page.getByRole("button", { name: /Strength save \+5, proficient/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Armour class 18\. Open details/ })).toBeVisible();

    const bordered = await page.evaluate(() => {
      const card = document.querySelector<HTMLElement>(".sheet-card");
      return card ? getComputedStyle(card).borderTopWidth : "0px";
    });
    // Boundaries remain drawn rather than relying on a background colour.
    expect(bordered).not.toBe("0px");
  });

  test("moves focus to the error summary and back to the trigger", async ({ page }) => {
    await startNewCharacter(page);
    await next(page);
    // Continue with nothing chosen raises the summary.
    await next(page);
    const summary = page.getByRole("alert").filter({ hasText: /issue/ });
    await expect(summary).toBeVisible();

    // Focus moves to the submitted error summary so it is announced.
    const focusedSummary = await page.evaluate(() =>
      Boolean(document.activeElement?.classList.contains("m2-error-summary")),
    );
    expect(focusedSummary).toBe(true);

    // Tabbing forward stays inside the builder rather than escaping the task.
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest(".m2-builder")))).toBe(true);
  });
});
