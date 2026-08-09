import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { largeImportJson, LARGE_PACK_NAME } from "@/tests/fixtures/large-import-fixture";

/**
 * The pilot's Settings and content-management session, reproduced.
 *
 * A human imported a substantial pack and could not answer four questions from
 * the screen in front of them: did it work, were there errors, how many warnings
 * were there, and is anything required of me. The result was a vertical stream
 * of `EFFECT_REVIEW_REQUIRED` rows in the danger palette, and a successful
 * import read as a broken app. Beside it: no useful feedback while a long import
 * ran, one unexplained sentence when Save source failed, and no way to
 * understand what could be removed or what removing it would do.
 *
 * Every fixture here is original synthetic content. The pilot's own pack, its
 * screenshots and its private material are not in this repository and are not
 * needed: the failure mode is a function of *how many* repeated advisories a
 * file produces, which invented drills reproduce exactly.
 */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const APP_ROOT = `${BASE_PATH}/`;
const BLOCKING_IMPACTS = new Set(["serious", "critical"]);

/** Big enough that its notices are unreadable one-per-row, as the pilot's was. */
const PILOT_SCALE = largeImportJson();
/** Big enough that checking and writing it are visibly non-instant. */
const SLOW_SCALE = largeImportJson({ entryCount: 3000, reviewCount: 2400 });
/** The same pack with one unresolvable required reference. */
const BLOCKED = largeImportJson({ entryCount: 40, reviewCount: 30, withBlockingError: true });

async function openSettings(page: Page) {
  const candidates = page.getByRole("button", { name: /^(Open Settings|Settings)$/ });
  for (let index = 0; index < (await candidates.count()); index += 1) {
    const candidate = candidates.nth(index);
    if (await candidate.isVisible()) {
      await candidate.click();
      return;
    }
  }
  throw new Error("No visible Settings control was found");
}

async function openSettingsPage(page: Page, label: string) {
  await page.goto(APP_ROOT);
  await openSettings(page);
  await page.getByRole("button", { name: new RegExp(`^${label}$`) }).click();
}

/** Chosen as a file, which is how a pack of this size actually arrives. */
const chooseFile = (page: Page, body: string) =>
  page.getByLabel("Choose JSON file").setInputFiles({
    name: "lantern-observatory.json",
    mimeType: "application/json",
    buffer: Buffer.from(body, "utf8"),
  });

async function importPack(page: Page, body: string) {
  await chooseFile(page, body);
  await page.getByRole("button", { name: "Preview import" }).click();
  await expect(page.getByRole("button", { name: "Confirm atomic import" })).toBeEnabled({ timeout: 60_000 });
  await page.getByRole("button", { name: "Confirm atomic import" }).click();
  await expect(page.getByRole("heading", { name: /^Import completed/ })).toBeVisible({ timeout: 60_000 });
}

/*
 * These tests import hundreds — in one case thousands — of entries through the
 * real pipeline, which is the point of them and is not fast. The budget is
 * stated rather than left to the 30-second default, where a loaded machine
 * turns a passing contract into an intermittent failure that says nothing about
 * the product.
 */
test.describe.configure({ timeout: 180_000 });

const result = (page: Page) => page.locator(".importresult");
const issueGroups = (page: Page) => page.locator(".issuegroup");

test.describe("a successful import reads as a success", () => {
  test("answers did-it-work, were-there-errors and how-many-warnings above the fold", async ({ page }) => {
    await openSettingsPage(page, "Imports and exports");
    await importPack(page, PILOT_SCALE);

    // Outcome first, and it is not the word "failed".
    await expect(result(page)).toHaveAttribute("data-tone", "review");
    await expect(result(page).getByRole("heading")).toHaveText(/^Import completed/);
    await expect(result(page)).toContainText("installed and usable");

    // The counts, as numbers rather than as a list to be counted by hand.
    const cell = (label: string) => result(page).locator(".countcell", { hasText: label });
    await expect(cell("Added").locator("dd")).toHaveText("600");
    await expect(cell("Updated").locator("dd")).toHaveText("0");
    await expect(cell("Errors").locator("dd")).toHaveText("0");
    await expect(cell("Need review").locator("dd")).toHaveText("486");
  });

  test("bounds the result surface by kind of issue, not by number of issues", async ({ page }) => {
    await openSettingsPage(page, "Imports and exports");
    await importPack(page, PILOT_SCALE);

    /*
     * 486 notices. Before this change that was 486 paragraphs; the whole point
     * of the corrective is that it is now a handful of rows whatever the file
     * contains.
     */
    await expect(issueGroups(page)).toHaveCount(2);
    const review = issueGroups(page).filter({ hasText: "Needs a ruling at the table" });
    await expect(review.locator(".issuegroup-count")).toHaveText("480");

    // Detail is on demand, and the row is collapsed until it is asked for.
    await expect(review.locator("summary")).toBeVisible();
    await expect(review).not.toHaveAttribute("open", /.*/);
    await review.locator("summary").click();
    await expect(review).toHaveAttribute("open", /.*/);
    // Bounded inside as well: a sample, then a count of the rest.
    await expect(review.locator(".issuegroup-records li")).toHaveCount(12);
    await expect(review).toContainText("468 more of the same kind");
    // The machine code is still available for reporting a problem.
    await expect(review).toContainText("EFFECT_REVIEW_REQUIRED");
  });

  test("distinguishes an advisory from a blocking error in words, not only in colour", async ({ page }) => {
    await openSettingsPage(page, "Imports and exports");
    await importPack(page, PILOT_SCALE);

    const review = issueGroups(page).filter({ hasText: "Needs a ruling at the table" });
    await expect(review.locator(".issuebadge")).toHaveText("Review");
    await expect(review.locator(".issuebadge")).not.toHaveText("Blocking");
    // And the notice itself says what it is asking for, which is nothing yet.
    await review.locator("summary").click();
    await expect(review).toContainText("Nothing is required of you now");
  });

  test("a genuinely blocked import says so, and its errors lead", async ({ page }) => {
    await openSettingsPage(page, "Imports and exports");
    await chooseFile(page, BLOCKED);
    await page.getByRole("button", { name: "Preview import" }).click();

    const preview = page.getByLabel("Import preview");
    await expect(preview.getByRole("heading", { name: "Import blocked" })).toBeVisible({ timeout: 60_000 });
    await expect(preview.getByRole("button", { name: "Confirm atomic import" })).toBeDisabled();

    // The blocking group is first, is badged as blocking, and is already open.
    const groups = preview.locator(".issuegroup");
    await expect(groups.first().locator(".issuebadge")).toHaveText("Blocking");
    await expect(groups.first()).toHaveAttribute("open", /.*/);
    // The advisories are still present, still marked as advisories, still below.
    await expect(groups.filter({ hasText: "Needs a ruling at the table" }).locator(".issuebadge")).toHaveText("Review");
  });
});

/**
 * What the panel did while it worked, recorded rather than sampled.
 *
 * A pending state is by definition transient, and polling for it is a race the
 * test loses whenever the machine is fast or the assertion arrives late — which
 * says nothing about whether the state existed. A MutationObserver installed
 * before the operation starts sees every intermediate state the DOM passed
 * through, so the contract asserted is "this was announced and locked while it
 * ran", not "it was still running when I happened to look".
 */
interface PendingLog {
  statuses: string[];
  sawIndeterminateProgress: boolean;
  sawDeterminateProgress: boolean;
  sawBusyConfirm: boolean;
  sawLockedPreview: boolean;
}

async function recordPendingStates(page: Page) {
  await page.evaluate(() => {
    const log = {
      statuses: [] as string[],
      sawIndeterminateProgress: false,
      sawDeterminateProgress: false,
      sawBusyConfirm: false,
      sawLockedPreview: false,
    };
    (window as unknown as { __pendingLog: typeof log }).__pendingLog = log;
    const record = () => {
      for (const node of Array.from(document.querySelectorAll("[role='status']"))) {
        const text = node.textContent?.trim() ?? "";
        if (text && log.statuses[log.statuses.length - 1] !== text) log.statuses.push(text);
      }
      for (const bar of Array.from(document.querySelectorAll("[role='progressbar']"))) {
        if (bar.hasAttribute("aria-valuenow")) log.sawDeterminateProgress = true;
        else log.sawIndeterminateProgress = true;
      }
      for (const button of Array.from(document.querySelectorAll("button"))) {
        if (button.getAttribute("aria-busy") === "true") log.sawBusyConfirm = true;
        if (/Checking file/.test(button.textContent ?? "") && button.disabled) log.sawLockedPreview = true;
      }
    };
    record();
    new MutationObserver(record).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
  });
}

const pendingLog = (page: Page) =>
  page.evaluate(() => (window as unknown as { __pendingLog: PendingLog }).__pendingLog);

test.describe("a long import says that it started, and cannot be started twice", () => {
  test("acknowledges the operation, shows indeterminate progress, and blocks a second press", async ({ page }) => {
    await openSettingsPage(page, "Imports and exports");
    await chooseFile(page, SLOW_SCALE);
    await recordPendingStates(page);

    await page.getByRole("button", { name: /^(Preview import|Checking file…)$/ }).click();
    const confirm = page.getByRole("button", { name: /^(Confirm atomic import|Importing…)$/ });
    await expect(confirm).toBeEnabled({ timeout: 120_000 });
    await confirm.click();

    // It transitions clearly into the result rather than simply going quiet.
    await expect(page.getByRole("heading", { name: /^Import completed/ })).toBeVisible({ timeout: 180_000 });
    await expect(page.getByRole("progressbar")).toHaveCount(0);

    const log = await pendingLog(page);
    // Both operations were acknowledged before their work, in order.
    const checking = log.statuses.findIndex(text => text.includes("Checking this file"));
    const started = log.statuses.findIndex(text => text.includes("Import started"));
    expect(checking, "the check acknowledged itself").toBeGreaterThanOrEqual(0);
    expect(started, "the write acknowledged itself").toBeGreaterThan(checking);
    // A second press was impossible while either ran.
    expect(log.sawLockedPreview, "the check locked its own control").toBe(true);
    expect(log.sawBusyConfirm, "the write marked itself busy").toBe(true);
    // Progress was shown, and claimed no percentage it could not know.
    expect(log.sawIndeterminateProgress).toBe(true);
    expect(log.sawDeterminateProgress, "no fabricated completion percentage").toBe(false);
    // And the last thing said is the outcome.
    expect(log.statuses[log.statuses.length - 1]).toMatch(/Import completed/);
  });
});

test.describe("Save source says why it refused", () => {
  test("names a duplicate ID instead of the generic catch-all", async ({ page }) => {
    await openSettingsPage(page, "Sources");

    // The form reopens holding the ID it just saved, so the second press is the
    // collision the pilot met.
    await page.getByRole("button", { name: "Save source" }).click();
    await expect(page.locator(".formmessage")).toContainText("Source saved locally");
    await page.getByRole("button", { name: "Save source" }).click();

    // Scoped to the form's own message: Next renders a route announcer that is
    // also `role="alert"`, and matching by role alone catches both.
    const problem = page.locator(".formproblem");
    await expect(problem).toHaveAttribute("role", "alert");
    await expect(problem).toContainText("already on this device");
    await expect(problem).toContainText("Edit that source instead");
    await expect(problem).not.toContainText("The operation could not be completed");
    // The reason is attached to the control it is about.
    await expect(page.getByLabel("Stable ID")).toHaveAttribute("aria-invalid", "true");
  });

  test("names a malformed version against the version field", async ({ page }) => {
    await openSettingsPage(page, "Sources");
    await page.getByLabel("Stable ID").fill("source:e2e-version-check");
    await page.getByLabel("Version").fill("one");
    await page.getByRole("button", { name: "Save source" }).click();

    await expect(page.locator(".formproblem")).toContainText("three numbers separated by dots");
    await expect(page.getByLabel("Version")).toHaveAttribute("aria-invalid", "true");
  });

  test("names a malformed identifier and shows the shape one takes", async ({ page }) => {
    await openSettingsPage(page, "Sources");
    await page.getByLabel("Stable ID").fill("My Source");
    await page.getByRole("button", { name: "Save source" }).click();

    await expect(page.locator(".formproblem")).toContainText("source:my-source");
    await expect(page.getByLabel("Stable ID")).toHaveAttribute("aria-invalid", "true");
  });
});

test.describe("removal explains itself before it happens", () => {
  test("a source other entries depend on cannot be removed, and says what to do", async ({ page }) => {
    await openSettingsPage(page, "Imports and exports");
    await importPack(page, largeImportJson({ entryCount: 12, reviewCount: 6 }));

    await openSettingsPage(page, "Sources");
    await page.getByRole("button", { name: "Remove Lantern Observatory Handbook" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("cannot be removed yet");
    await expect(dialog).toContainText("12 installed entries still name this source");
    await expect(dialog).toContainText("Remove the packs that own them first");
    // Cannot-remove is not offered as a remove-anyway.
    await expect(dialog.getByRole("button", { name: "Remove this source" })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Close" }).click();

    // And the source is, of course, still there.
    await expect(page.getByRole("button", { name: "Remove Lantern Observatory Handbook" })).toBeVisible();
  });

  test("a source nothing depends on says what removing it means, then removes it", async ({ page }) => {
    await openSettingsPage(page, "Sources");
    await page.getByLabel("Stable ID").fill("source:e2e-unused");
    await page.getByLabel("Name").fill("Unused E2E Source");
    await page.getByRole("button", { name: "Save source" }).click();
    await expect(page.locator(".formmessage")).toContainText("Source saved locally");

    await page.getByRole("button", { name: "Remove Unused E2E Source" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("affects nothing else");
    await expect(dialog).toContainText("cannot be undone");

    // Declining leaves it alone.
    await dialog.getByRole("button", { name: "Keep it" }).click();
    await expect(page.getByRole("button", { name: "Remove Unused E2E Source" })).toBeVisible();

    await page.getByRole("button", { name: "Remove Unused E2E Source" }).click();
    await page.getByRole("button", { name: "Remove this source" }).click();
    await expect(page.locator(".formmessage")).toContainText("was removed from this device");
    await expect(page.getByRole("button", { name: "Remove Unused E2E Source" })).toHaveCount(0);
  });

  test("removing a pack says what it takes with it before it is confirmed", async ({ page }) => {
    await openSettingsPage(page, "Imports and exports");
    await importPack(page, largeImportJson({ entryCount: 8, reviewCount: 4 }));

    await openSettingsPage(page, "Content packs");
    await page.getByRole("button", { name: `Remove ${LARGE_PACK_NAME}` }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("8 entries");
    await expect(dialog).toContainText("ruleset built from it stops offering that content");
    await dialog.getByRole("button", { name: "Remove this pack" }).click();
    await expect(page.locator(".formmessage")).toContainText("was removed from the installed list");
  });
});

test.describe("the result of a large import survives a small screen", () => {
  for (const width of [320, 360, 375, 390, 412]) {
    test(`fits at ${width} px with no horizontal overflow and reachable targets`, async ({ page }) => {
      await page.setViewportSize({ width, height: 780 });
      await openSettingsPage(page, "Imports and exports");
      await importPack(page, PILOT_SCALE);

      const overflow = await page.evaluate(() => {
        const offenders: string[] = [];
        for (const element of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
          if (element.scrollWidth <= element.clientWidth + 1) continue;
          if (getComputedStyle(element).overflowX !== "visible") continue;
          offenders.push(`${element.tagName.toLowerCase()}.${element.className}`);
        }
        return {
          document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          offenders: offenders.slice(0, 5),
        };
      });
      expect(overflow.offenders, `elements overflowing at ${width} px`).toEqual([]);
      expect(overflow.document, `document overflow at ${width} px`).toBeLessThanOrEqual(1);

      /*
       * The outcome is near the top of the result, not below a scroll of
       * warnings. Measured against the result panel itself so the assertion is
       * about this hierarchy rather than about where the page happens to sit.
       */
      const headline = await result(page).getByRole("heading").boundingBox();
      const panel = await result(page).boundingBox();
      expect(headline && panel && headline.y - panel.y).toBeLessThan(40);

      // Every control the result offers can be hit with a thumb.
      const targets = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>(".importresult summary, .actions button, .registryrow button"))
          .filter(element => element.offsetParent !== null)
          .map(element => element.getBoundingClientRect().height),
      );
      expect(targets.length).toBeGreaterThan(0);
      expect(Math.min(...targets)).toBeGreaterThanOrEqual(44);
    });
  }
});

test.describe("the corrected surfaces are accessible", () => {
  test("import result, grouped detail and removal confirmation report no serious violations", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await openSettingsPage(page, "Imports and exports");
    await importPack(page, PILOT_SCALE);

    // Expanded as well as collapsed: the detail is markup the audit must see.
    await issueGroups(page).filter({ hasText: "Needs a ruling at the table" }).locator("summary").click();
    const importResults = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      importResults.violations
        .filter(violation => BLOCKING_IMPACTS.has(violation.impact ?? ""))
        .map(violation => `${violation.impact}: ${violation.id}`),
      "import result accessibility",
    ).toEqual([]);

    await openSettingsPage(page, "Sources");
    await page.getByRole("button", { name: "Remove Lantern Observatory Handbook" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    const removalResults = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      removalResults.violations
        .filter(violation => BLOCKING_IMPACTS.has(violation.impact ?? ""))
        .map(violation => `${violation.impact}: ${violation.id}`),
      "removal confirmation accessibility",
    ).toEqual([]);
  });

  test("a destructive confirmation is reachable and operable from the keyboard", async ({ page }) => {
    await openSettingsPage(page, "Sources");
    await page.getByLabel("Stable ID").fill("source:e2e-keyboard");
    await page.getByLabel("Name").fill("Keyboard E2E Source");
    await page.getByRole("button", { name: "Save source" }).click();
    await expect(page.locator(".formmessage")).toContainText("Source saved locally");

    await page.getByRole("button", { name: "Remove Keyboard E2E Source" }).focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    await dialog.getByRole("button", { name: "Remove this source" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".formmessage")).toContainText("was removed from this device");
  });

  test("the import outcome is announced, counts and all", async ({ page }) => {
    await openSettingsPage(page, "Imports and exports");
    await importPack(page, PILOT_SCALE);

    // One live region carrying the whole answer, so it is heard as one sentence
    // rather than assembled from a row of numbers that read as nothing.
    const status = page.locator(".formmessage");
    await expect(status).toHaveAttribute("role", "status");
    await expect(status).toContainText("Import completed");
    await expect(status).toContainText("600 entries processed");
    await expect(status).toContainText("No errors");
    await expect(status).toContainText("486 items to review");
    await expect(status).toContainText("completed atomically");
  });
});
