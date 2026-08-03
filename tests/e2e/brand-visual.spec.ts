import { expect, test } from "@playwright/test";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "",
  APP_ROOT = `${BASE_PATH}/`,
  viewports = [
    { width: 360, height: 800 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ];

for (const viewport of viewports) {
  test(`keeps Runefolio branding intact at ${viewport.width}x${viewport.height}`, async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop",
      "The explicit viewport matrix runs once in the desktop Chromium project.",
    );
    const failed: string[] = [];
    page.on("requestfailed", (request) => failed.push(request.url()));
    await page.setViewportSize(viewport);
    await page.goto(APP_ROOT);
    await expect(page).toHaveTitle("Runefolio");
    const headerMark = page.locator(".m2-appbar-brand img");
    await expect(headerMark).toBeVisible();
    const imageState = await headerMark.evaluate((image: HTMLImageElement) => ({
        complete: image.complete,
        naturalHeight: image.naturalHeight,
        naturalWidth: image.naturalWidth,
      }));
    expect(imageState.complete).toBe(true);
    expect(imageState.naturalHeight).toBeGreaterThan(0);
    expect(imageState.naturalWidth).toBe(imageState.naturalHeight);
    expect(
      await page.evaluate(() => ({
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: innerWidth,
      })),
    ).toEqual({ documentWidth: viewport.width, viewportWidth: viewport.width });

    // The wordmark and mark now live in the persistent app bar at every width,
    // so no navigation has to be opened to see the branding.
    await expect(page.locator(".m2-appbar-brand").getByText("Runefolio")).toBeVisible();
    await expect(page.locator(".m2-appbar-brand img")).toBeVisible();

    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await expect(headerMark).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath(`${colorScheme}-${viewport.width}x${viewport.height}.png`),
        fullPage: false,
      });
    }
    expect(failed).toEqual([]);
  });
}
