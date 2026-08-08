import { expect, test, type Page } from "@playwright/test";

/**
 * Settings is a global destination with a way back out of it.
 *
 * Two defects were reported from the installed app on the pilot phone. The
 * large gear in the top-right of the app bar read as settings *for the screen
 * it sat above* — the character, the sheet — when it configures the
 * application. And Settings had no history entry behind it, so the Android Back
 * gesture from Settings closed Runefolio instead of returning to where the user
 * had come from. An installed app has no browser chrome, so that gesture is the
 * only Back there is, and losing the app to it is not a small annoyance.
 *
 * These tests drive the browser's real history, because that is what the system
 * Back gesture drives. `page.goBack()` is the same operation the gesture
 * performs; there is no separate "PWA back" to simulate.
 */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const APP_ROOT = `${BASE_PATH}/`;

const navButton = (page: Page, label: string) =>
  page.locator(".m2-rail").getByRole("button", { name: label, exact: true });

/**
 * The heading each destination puts on screen. Compendium's own title is
 * "Content compendium", so the nav label and the page heading are not the same
 * string and the test says which it is asserting.
 */
const PAGE_HEADING: Record<string, string> = {
  Characters: "Characters",
  Sheet: "Sheet",
  Compendium: "Content compendium",
  Settings: "Settings",
};

const heading = (page: Page, destination: string) =>
  page.getByRole("heading", { name: PAGE_HEADING[destination] ?? destination, exact: true });

async function openApp(page: Page) {
  await page.goto(APP_ROOT);
  await expect(heading(page, "Characters")).toBeVisible();
}

/** How many entries this document has added to the session history. */
const historyDepth = (page: Page) => page.evaluate(() => window.history.length);

test.describe("Settings is one of the global destinations", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
  });

  test("appears in the bottom navigation, and the top-right gear is gone", async ({ page }) => {
    await openApp(page);

    await expect(navButton(page, "Characters")).toBeVisible();
    await expect(navButton(page, "Sheet")).toBeVisible();
    await expect(navButton(page, "Compendium")).toBeVisible();
    await expect(navButton(page, "Settings")).toBeVisible();

    // The header carries the wordmark and the offline indicator, and no
    // application-configuration control at all.
    await expect(page.locator(".m2-appbar").getByRole("button")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open Settings" })).toHaveCount(0);
  });

  /**
   * The whole point of the move: Back returns to the screen Settings was
   * entered from, rather than leaving the app.
   */
  for (const origin of ["Characters", "Compendium"] as const)
    test(`system Back from Settings returns to ${origin}`, async ({ page }) => {
      await openApp(page);
      if (origin !== "Characters") await navButton(page, origin).click();
      await expect(heading(page, origin)).toBeVisible();

      await navButton(page, "Settings").click();
      await expect(heading(page, "Settings")).toBeVisible();
      await expect(navButton(page, "Settings")).toHaveAttribute("aria-current", "page");

      await page.goBack();

      await expect(heading(page, origin)).toBeVisible();
      await expect(navButton(page, origin)).toHaveAttribute("aria-current", "page");
      // Still inside the app: the document was never unloaded.
      await expect(page.locator(".m2-shell")).toBeVisible();
    });

  /**
   * Tab switching is not page navigation.
   *
   * If every destination pushed an entry, Back would walk backwards through
   * every tab the user had touched before it ever left the app. Only Settings
   * pushes, and it pushes exactly one entry however many times it is entered.
   */
  test("only Settings adds to the back stack, and only ever one entry", async ({ page }) => {
    await openApp(page);
    const atRoot = await historyDepth(page);

    await navButton(page, "Compendium").click();
    await expect(heading(page, "Compendium")).toBeVisible();
    await navButton(page, "Sheet").click();
    await expect(heading(page, "Sheet")).toBeVisible();
    expect(await historyDepth(page), "moving between tabs pushed history").toBe(atRoot);

    await navButton(page, "Settings").click();
    await expect(heading(page, "Settings")).toBeVisible();
    expect(await historyDepth(page), "entering Settings did not push an entry").toBe(atRoot + 1);

    // Entering Settings while already in Settings is a no-op, not a second entry.
    await navButton(page, "Settings").click();
    await expect(heading(page, "Settings")).toBeVisible();
    expect(await historyDepth(page), "a second Settings press pushed another entry").toBe(atRoot + 1);
  });

  /**
   * Leaving Settings by tapping a destination unwinds the entry Settings
   * pushed, rather than stacking a second one on top of it.
   *
   * Otherwise the number of Back presses needed to leave the app would grow
   * with how often the user had looked at Settings, which is the kind of
   * unpredictability that makes people stop trusting the gesture.
   */
  test("leaving Settings by tapping a destination unwinds its entry", async ({ page }) => {
    await openApp(page);

    await navButton(page, "Settings").click();
    await expect(heading(page, "Settings")).toBeVisible();

    await navButton(page, "Compendium").click();
    await expect(heading(page, "Compendium")).toBeVisible();
    await expect(navButton(page, "Compendium")).toHaveAttribute("aria-current", "page");
    await expect(navButton(page, "Settings")).not.toHaveAttribute("aria-current", "page");

    /*
     * The behavioural test, not a counting one. `history.length` includes
     * forward entries, so it does not fall when an entry is unwound and cannot
     * express "Settings is no longer behind us". What can is pressing Back: a
     * Settings entry left on the stack would reappear here, and a Settings
     * entry that was properly unwound cannot.
     */
    await page.goBack();
    await expect(heading(page, "Settings")).toHaveCount(0);

    // And the round trip is repeatable rather than stacking on each visit.
    await openApp(page);
    for (let visit = 0; visit < 3; visit += 1) {
      await navButton(page, "Settings").click();
      await expect(heading(page, "Settings")).toBeVisible();
      await navButton(page, "Characters").click();
      await expect(heading(page, "Characters")).toBeVisible();
    }
    // Three visits, and still exactly one Back between here and leaving the app.
    await page.goBack();
    await expect(heading(page, "Settings")).toHaveCount(0);
  });

  /**
   * A reload taken while in Settings must not leave a marker behind.
   *
   * An installed app gets reloaded, restored from the background, and opened
   * cold on whatever entry it was killed on — and it always comes back at
   * Characters, because none of its state is in the URL. The entry it comes
   * back on therefore must not still claim to be Settings: one that did left a
   * Settings entry on the stack with no screen behind it, and the next Back
   * landed on it and did nothing at all.
   */
  test("a reload taken in Settings leaves the back stack consistent", async ({ page }) => {
    await openApp(page);
    await navButton(page, "Settings").click();
    await expect(heading(page, "Settings")).toBeVisible();

    await page.reload();
    // A cold start always shows Characters.
    await expect(heading(page, "Characters")).toBeVisible();

    // And the stack agrees: entering and leaving Settings still behaves.
    await navButton(page, "Settings").click();
    await expect(heading(page, "Settings")).toBeVisible();
    await page.goBack();
    await expect(heading(page, "Characters")).toBeVisible();
    await expect(navButton(page, "Characters")).toHaveAttribute("aria-current", "page");
  });

  test("tapping the destination already showing changes nothing", async ({ page }) => {
    await openApp(page);
    const atRoot = await historyDepth(page);

    await navButton(page, "Characters").click();
    await expect(heading(page, "Characters")).toBeVisible();
    expect(await historyDepth(page)).toBe(atRoot);
  });

  /**
   * Settings is still reachable, and still leaves, while a build is open.
   *
   * The builder owns the whole surface and hides the bottom bar, so this is
   * driven from the wide layout where the rail is a side rail the task does not
   * cover — the same code path, at the width that can exercise it.
   */
  test("entering Settings from an open build closes the task and can return", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await openApp(page);
    await page.getByRole("button", { name: "New character" }).last().click();
    await expect(page.getByText("Step 1 of 9")).toBeVisible();

    await navButton(page, "Settings").click();
    await expect(heading(page, "Settings")).toBeVisible();

    await page.goBack();
    // Back returns to the destination Settings was entered from. The build is
    // not lost — it is autosaved and offered again under "Unfinished builds".
    await expect(heading(page, "Characters")).toBeVisible();
    await expect(page.getByRole("button", { name: /Resume building/ })).toBeVisible();
  });
});
