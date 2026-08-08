import { expect, test } from "@playwright/test";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "",
  APP_ROOT = `${BASE_PATH}/`;

test("Chrome resolves only the fresh Runefolio install metadata", async ({
  page,
  context,
}) => {
  await page.goto(APP_ROOT);
  await expect(page.locator("html")).toHaveAttribute("data-offline-state", "ready");

  const session = await context.newCDPSession(page),
    appManifest = await session.send("Page.getAppManifest"),
    installability = await session.send("Page.getInstallabilityErrors");

  expect(new URL(appManifest.url).pathname).toBe(
    `${BASE_PATH}/manifest.webmanifest`,
  );
  expect(new URL(appManifest.url).search).toBe("?v=runefolio-2");
  expect(appManifest.errors).toEqual([]);
  expect(appManifest.manifest.name).toBe("Runefolio");

  /*
   * The shape and the colours the installed app declares.
   *
   * Neither is observable in the running page: `orientation` governs how the
   * platform launches the installed app, and `background_color` paints the
   * splash screen before the app's first frame — which is exactly where the old
   * parchment value showed as a white flash on every launch.
   *
   * The orientation is taken from Chrome's own parse, which proves the value
   * was understood rather than merely served; Chrome reports the enum, not the
   * manifest's spelling. The colours are read from the served document instead,
   * because Chrome normalises colours into its own representation.
   */
  expect(appManifest.manifest.orientation?.toLowerCase().replace(/_/g, "-")).toBe("portrait-primary");
  const served = await (await page.request.get(appManifest.url)).json();
  expect(served.orientation).toBe("portrait-primary");
  expect(served.background_color).toBe("#08121B");
  expect(served.theme_color).toBe("#0F1D29");
  expect(new URL(appManifest.manifest.id ?? "").pathname).toBe(APP_ROOT);
  expect(new URL(appManifest.manifest.scope ?? "").pathname).toBe(APP_ROOT);
  expect(new URL(appManifest.manifest.startUrl ?? "").pathname).toBe(APP_ROOT);
  expect(appManifest.manifest.icons?.map((icon) => new URL(icon.url).pathname)).toEqual([
    `${BASE_PATH}/icons/runefolio-icon-192.png`,
    `${BASE_PATH}/icons/runefolio-icon-512.png`,
    `${BASE_PATH}/icons/runefolio-maskable-192.png`,
    `${BASE_PATH}/icons/runefolio-maskable-512.png`,
  ]);
  expect(installability.installabilityErrors).toEqual([]);
});
