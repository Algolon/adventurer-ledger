import { expect, test, type Page } from "@playwright/test";

async function navigate(page: Page, label: string) {
  const toggle = page.getByRole("button", { name: "Toggle navigation" });
  if (await toggle.isVisible()) await toggle.click();
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

test("opens and advances Brammel builder", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Brammel “Boss” Voss" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Continue character/ }).click();
  await expect(
    page.getByRole("dialog", { name: "Brammel “Boss” Voss" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByText("Step 6 of 6")).toBeVisible();
});
test("navigates to sources", async ({ page }) => {
  await page.goto("/");
  await navigate(page, "Sources");
  await expect(
    page.getByRole("heading", { name: "Source management" }),
  ).toBeVisible();
});
test("shows device-local storage health in settings", async ({ page }) => {
  await page.goto("/");
  await navigate(page, "Settings");
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
  await page.goto("/");
  await navigate(page, "Imports & exports");
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
  await expect(page.getByRole("status")).toContainText("completed atomically");
  await navigate(page, "Compendium");
  await expect(
    page.getByRole("heading", { name: "E2E Starlight Rule" }),
  ).toBeVisible();
});
test("blocks an invalid import without echoing private text in diagnostics", async ({
  page,
}) => {
  await page.goto("/");
  await navigate(page, "Imports & exports");
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
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener(
          "controllerchange",
          () => resolve(),
          { once: true },
        ),
      );
  });
  await navigate(page, "Imports & exports");
  const original =
    "<img src=x onerror=PRIVATE_SYNTHETIC_EXECUTION()> Original offline-safe text.";
  await page
    .getByLabel("Pack JSON")
    .fill(JSON.stringify(pack("offline-star", "Offline Star", original)));
  await page.getByRole("button", { name: /Preview import/ }).click();
  await page.getByRole("button", { name: /Confirm atomic import/ }).click();
  await expect(page.getByRole("status")).toContainText("completed atomically");
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
  await expect(card).toContainText("Original offline-safe text");
  await expect(card.locator("img")).toHaveCount(0);
  expect(
    await page.evaluate(() => "PRIVATE_SYNTHETIC_EXECUTION" in window),
  ).toBe(false);
  await navigate(page, "Content packs");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const fullText = page.getByLabel("Full text");
  await expect(fullText).toHaveValue(original);
  await fullText.fill("Edited entirely offline with original synthetic text.");
  await page.getByRole("button", { name: /Save pack and entry/ }).click();
  await expect(page.getByRole("status")).toContainText("saved locally");
  await navigate(page, "Compendium");
  await page.getByLabel("Filter compendium").fill("Offline Star");
  await page.getByText(/Full text/).click();
  await expect(page.getByRole("article")).toContainText(
    "Edited entirely offline",
  );
  await navigate(page, "Imports & exports");
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

test("serves versioned worker and safe service-worker headers", async ({
  page,
}) => {
  await page.goto("/");
  const worker = await page.request.get("/sw.js"),
    source = await worker.text();
  expect(worker.headers()["content-type"]).toContain("application/javascript");
  expect(worker.headers()["cache-control"]).toContain("no-cache");
  expect(worker.headers()["service-worker-allowed"]).toBe("/");
  expect(source).not.toContain("__CACHE_VERSION__");
  expect(source).toContain("adventurer-ledger-shell-");
  const cachesAfterInstall = await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    return (await caches.keys()).filter((key) =>
      key.startsWith("adventurer-ledger-shell-"),
    );
  });
  expect(cachesAfterInstall).toHaveLength(1);
});
