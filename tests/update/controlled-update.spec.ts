import { expect, test } from "@playwright/test";

test("keeps the old shell active until explicit update consent", async ({
  page,
  request,
}) => {
  await page.goto("/adventurer-ledger/");
  await expect(page.locator("body")).toHaveAttribute("data-app-build", "old");
  await expect(page.locator(".offline")).toContainText("Offline ready");

  expect((await request.post("/__test__/activate-next")).status()).toBe(204);
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    await registration.update();
  });
  await expect(page.getByText("Update ready", { exact: true }).first()).toBeVisible();

  await page.reload();
  await expect(page.locator("body")).toHaveAttribute("data-app-build", "old");
  await expect(page.getByRole("button", { name: "Update now" })).toBeVisible();

  await page.getByRole("button", { name: "Update now" }).click();
  await expect(page.locator("body")).toHaveAttribute("data-app-build", "new");
  await expect(page.locator(".offline")).toContainText("Offline ready");
});
