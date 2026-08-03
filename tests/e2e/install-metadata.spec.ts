import { expect, test } from "@playwright/test";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "",
  APP_ROOT = `${BASE_PATH}/`;

test("Chrome resolves only the fresh Runefolio install metadata", async ({
  page,
  context,
}) => {
  await page.goto(APP_ROOT);
  await expect(page.locator(".offline")).toContainText("Offline ready");

  const session = await context.newCDPSession(page),
    appManifest = await session.send("Page.getAppManifest"),
    installability = await session.send("Page.getInstallabilityErrors");

  expect(new URL(appManifest.url).pathname).toBe(
    `${BASE_PATH}/manifest.webmanifest`,
  );
  expect(new URL(appManifest.url).search).toBe("?v=runefolio-1");
  expect(appManifest.errors).toEqual([]);
  expect(appManifest.manifest.name).toBe("Runefolio");
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
