import { expect, test, type Page } from "@playwright/test";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "",
  APP_ROOT = `${BASE_PATH}/`,
  scoped = (pathname: `/${string}`) => `${BASE_PATH}${pathname}`;

/**
 * Navigates the M2.1 information architecture: Characters, Sheet and Compendium
 * are primary destinations, and everything else is grouped under Settings.
 */
const SETTINGS_ITEMS = new Set([
  "Content packs",
  "Sources",
  "Rulesets",
  "Transfer",
  "Imports and exports",
  "Backups",
  "Storage",
  "Offline",
  "Updates",
]);

/** Settings is the app-bar button on mobile and a rail entry on desktop. */
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

async function navigate(page: Page, label: string) {
  if (SETTINGS_ITEMS.has(label)) {
    await openSettings(page);
    await page.getByRole("button", { name: new RegExp(`^${label}$`) }).click();
    return;
  }
  await page.getByRole("button", { name: label, exact: true }).click();
}
function pack(prefix: string, name: string, fullText: string) {
  return {
    schemaVersion: 1,
    pack: {
      id: `pack:${prefix}`,
      name: `${name} Pack`,
      version: "1.0.0",
      rulesEditions: ["homebrew"],
      visibility: "private",
      licenseType: "original",
      exportRestricted: false,
      includeFullText: true,
    },
    sources: [
      {
        id: `source:${prefix}`,
        name: `${name} Source`,
        abbreviation: "SYN",
        edition: "homebrew",
        type: "homebrew",
        licenseType: "original",
        visibility: "private",
        priority: 1,
        enabledByDefault: true,
        campaignIds: [],
        version: "1.0.0",
      },
    ],
    entries: [
      {
        id: `rule:${prefix}`,
        slug: prefix,
        name: `${name} Rule`,
        aliases: [],
        category: "rule",
        rulesEdition: "homebrew",
        sourceId: `source:${prefix}`,
        licenseType: "original",
        visibility: "private-user-entered",
        fullText,
        prerequisites: [],
        choices: [],
        effects: [],
        tags: ["synthetic"],
        version: "1.0.0",
        revision: 1,
        legacy: false,
        optional: true,
        private: true,
        exportRestricted: false,
        createdAt: "2026-08-03T08:00:00.000Z",
        updatedAt: "2026-08-03T08:00:00.000Z",
      },
    ],
  };
}

test("presents the Runefolio identity and scoped icon metadata", async ({ page }) => {
  await page.goto(APP_ROOT);
  await expect(page).toHaveTitle("Runefolio");
  await expect(page.locator(".m2-appbar-brand img")).toBeVisible();
  /*
   * Bumped to `runefolio-2` with the portrait-primary, dark-shell manifest.
   * The version is pinned rather than imported so that changing the installed
   * app's identity is a deliberate, reviewed edit here as well as there.
   */
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    "href",
    `${BASE_PATH}/manifest.webmanifest?v=runefolio-2`,
  );
  const iconLinks = await page
    .locator('link[rel~="icon"], link[rel="apple-touch-icon"]')
    .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  expect(iconLinks.length).toBeGreaterThanOrEqual(4);
  expect(iconLinks.every((href) => href?.startsWith(`${BASE_PATH}/`))).toBe(true);
  expect(iconLinks).toEqual(expect.arrayContaining([
    `${BASE_PATH}/brand/runefolio-favicon.svg`,
    `${BASE_PATH}/icons/runefolio-favicon-32.png`,
    `${BASE_PATH}/icons/runefolio-favicon-16.png`,
    `${BASE_PATH}/icons/runefolio-apple-touch-icon.png`,
  ]));
  const manifest = (await (
    await page.request.get(scoped("/manifest.webmanifest"))
  ).json()) as { name: string; short_name: string; id: string; scope: string; icons: Array<{ src: string }> };
  expect(manifest).toMatchObject({
    name: "Runefolio",
    short_name: "Runefolio",
    id: APP_ROOT,
    scope: APP_ROOT,
  });
  expect(manifest.icons.every((icon) => /\/runefolio-(?:icon|maskable)-/.test(icon.src))).toBe(true);
});

test("opens a real empty library rather than a fabricated active character", async ({
  page,
}) => {
  await page.goto(APP_ROOT);
  await expect(
    page.getByRole("heading", { name: "No characters on this device yet" }),
  ).toBeVisible();
  // The prototype's fake persisted character must not reappear.
  await expect(page.getByText("Brammel")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "New character" }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Import from another device" }),
  ).toBeVisible();
});
test("navigates to sources", async ({ page }) => {
  await page.goto(APP_ROOT);
  await navigate(page, "Sources");
  await expect(
    page.getByRole("heading", { name: "Source management" }),
  ).toBeVisible();
});
test("shows device-local storage health in settings", async ({ page }) => {
  await page.goto(APP_ROOT);
  await navigate(page, "Storage");
  await expect(
    page.getByRole("heading", { name: "Settings", level: 2 }),
  ).toBeVisible();
  await expect(page.getByText("Estimated usage")).toBeVisible();
  await expect(page.getByText("Estimated quota")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Request persistent storage/ }),
  ).toBeVisible();
});
test("previews, imports, and finds a synthetic compendium entry", async ({
  page,
}) => {
  await page.goto(APP_ROOT);
  await navigate(page, "Imports and exports");
  await page
    .getByLabel("Pack JSON")
    .fill(
      JSON.stringify(
        pack(
          "e2e-starlight",
          "E2E Starlight",
          "Original synthetic starlight text.",
        ),
      ),
    );
  await page.getByRole("button", { name: /Preview import/ }).click();
  await expect(
    page.getByRole("heading", { name: "Ready to import" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Confirm atomic import/ }).click();
  await expect(page.locator(".formmessage")).toContainText("completed atomically");
  await navigate(page, "Compendium");
  await expect(
    page.getByRole("heading", { name: "E2E Starlight Rule" }),
  ).toBeVisible();
});
test("blocks an invalid import without echoing private text in diagnostics", async ({
  page,
}) => {
  await page.goto(APP_ROOT);
  await navigate(page, "Imports and exports");
  await page
    .getByLabel("Pack JSON")
    .fill(JSON.stringify({ schemaVersion: 99, privateText: "DO-NOT-SHOW" }));
  await page.getByRole("button", { name: /Preview import/ }).click();
  const preview = page.getByLabel("Import preview");
  await expect(
    preview.getByRole("heading", { name: "Import blocked" }),
  ).toBeVisible();
  await expect(preview).not.toContainText("DO-NOT-SHOW");
  await expect(
    preview.getByRole("button", { name: /Confirm atomic import/ }),
  ).toBeDisabled();
});

test("works offline with local compendium edit, search, and export", async ({
  page,
  context,
}) => {
  const failed: string[] = [],
    responses: Array<{ url: string; fromWorker: boolean }> = [];
  await page.goto(APP_ROOT);
  await expect(page.locator(".offline")).toContainText("Offline ready");
  await navigate(page, "Imports and exports");
  const original = "Original offline-safe synthetic text without markup.";
  await page
    .getByLabel("Pack JSON")
    .fill(JSON.stringify(pack("offline-star", "Offline Star", original)));
  await page.getByRole("button", { name: /Preview import/ }).click();
  await page.getByRole("button", { name: /Confirm atomic import/ }).click();
  await expect(page.locator(".formmessage")).toContainText("completed atomically");
  page.on("requestfailed", (request) => failed.push(request.url()));
  page.on("response", (response) =>
    responses.push({
      url: response.url(),
      fromWorker: response.fromServiceWorker(),
    }),
  );
  await context.setOffline(true);
  await page.reload();
  await navigate(page, "Compendium");
  await page.getByLabel("Filter compendium").fill("Offline Star");
  const card = page.getByRole("article");
  await expect(
    card.getByRole("heading", { name: "Offline Star Rule" }),
  ).toBeVisible();
  await card.getByText(/Full text/).click();
  await expect(card).toContainText("Original offline-safe synthetic text");
  await expect(card.locator("img")).toHaveCount(0);
  expect(
    await page.evaluate(() => "PRIVATE_SYNTHETIC_EXECUTION" in window),
  ).toBe(false);
  await navigate(page, "Content packs");
  // The seeded synthetic slice also installs a pack, so target this pack's row.
  await page
    .locator(".registryrow")
    .filter({ hasText: "Offline Star Pack" })
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  const fullText = page.getByLabel("Full text");
  await expect(fullText).toHaveValue(original);
  await fullText.fill("Edited entirely offline with original synthetic text.");
  await page.getByRole("button", { name: /Save pack and entry/ }).click();
  await expect(page.locator(".formmessage")).toContainText("saved locally");
  await navigate(page, "Compendium");
  await page.getByLabel("Filter compendium").fill("Offline Star");
  await page.getByText(/Full text/).click();
  await expect(page.getByRole("article")).toContainText(
    "Edited entirely offline",
  );
  await navigate(page, "Imports and exports");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Create local export/ }).click();
  await download;
  expect(failed).toEqual([]);
  expect(
    responses.filter((response) =>
      response.url.startsWith("http://127.0.0.1:4173"),
    ),
  ).toEqual(
    expect.arrayContaining([expect.objectContaining({ fromWorker: true })]),
  );
  await context.setOffline(false);
});

test("serves a scoped versioned worker through the preview contract", async ({
  page,
}) => {
  const requested: string[] = [];
  page.on("request", (request) => requested.push(new URL(request.url()).pathname));
  await page.goto(APP_ROOT);
  await expect(page.locator(".offline")).toContainText("Offline ready");
  const worker = await page.request.get(scoped("/sw.js")),
    source = await worker.text();
  expect(worker.headers()["content-type"]).toContain("application/javascript");
  expect(worker.headers()["cache-control"]).toContain("no-cache");
  expect(worker.headers()["service-worker-allowed"]).toBeUndefined();
  expect(source).not.toContain("__CACHE_VERSION__");
  expect(source).toContain("adventurer-ledger-shell-");
  const precache = JSON.parse(
    source.match(/const PRECACHE=(\[[^;]+\]);/)?.[1] ?? "[]",
  ) as string[];
  expect(precache.length).toBeGreaterThan(10);
  expect(precache.every((asset) => asset.startsWith(APP_ROOT))).toBe(true);
  const cachesAfterInstall = await page.evaluate(async () => {
    return (await caches.keys()).filter((key) =>
      key.startsWith("adventurer-ledger-shell-"),
    );
  });
  expect(cachesAfterInstall).toHaveLength(1);
  const registration = await page.evaluate(async () => ({
    scope: (await navigator.serviceWorker.ready).scope,
    controller: navigator.serviceWorker.controller?.scriptURL,
  }));
  expect(new URL(registration.scope).pathname).toBe(APP_ROOT);
  expect(new URL(registration.controller ?? "").pathname).toBe(
    scoped("/sw.js"),
  );
  const manifestResponse = await page.request.get(scoped("/manifest.webmanifest"));
  expect(manifestResponse.ok()).toBe(true);
  const manifest = (await manifestResponse.json()) as {
    id: string;
    start_url: string;
    scope: string;
    icons: Array<{ src: string }>;
  };
  expect(manifest).toMatchObject({
    id: APP_ROOT,
    start_url: APP_ROOT,
    scope: APP_ROOT,
  });
  for (const icon of manifest.icons) {
    expect(icon.src.startsWith(scoped("/icons/"))).toBe(true);
    expect((await page.request.get(icon.src)).ok()).toBe(true);
  }
  for (const asset of [
    scoped("/icons/runefolio-icon-192.png"),
    scoped("/icons/runefolio-icon-512.png"),
    scoped("/icons/runefolio-maskable-192.png"),
    scoped("/icons/runefolio-maskable-512.png"),
    scoped("/icons/runefolio-apple-touch-icon.png"),
    scoped("/icons/runefolio-favicon-16.png"),
    scoped("/icons/runefolio-favicon-32.png"),
    scoped("/runefolio-favicon.ico"),
  ]) expect(precache).toContain(asset);
  expect(precache.some((asset) => /\/icons\/(?:icon-|maskable-|apple-touch-icon|favicon-(?:16|32))|\/favicon\.ico$/.test(asset))).toBe(false);
  const shellAssets = await page.locator('script[src],link[rel="stylesheet"]').evaluateAll(
    (elements) => elements.map((element) => element.getAttribute("src") ?? element.getAttribute("href")),
  );
  expect(shellAssets.length).toBeGreaterThan(0);
  expect(shellAssets.every((asset) => asset?.startsWith(`${BASE_PATH}/_next/`))).toBe(true);
  if (BASE_PATH) {
    expect((await page.request.get("/")).status()).toBe(404);
    expect(requested).not.toContain("/sw.js");
    expect(requested.some((path) => path.startsWith("/icons/"))).toBe(false);
  }
});
