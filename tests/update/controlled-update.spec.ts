import { expect, test, type Page } from "@playwright/test";

/** Settings is the app-bar button on mobile and a rail entry once the rail appears. */
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

test("keeps the old shell active until explicit update consent", async ({
  page,
  request,
}) => {
  await page.goto("/adventurer-ledger/");
  await expect(page.locator("body")).toHaveAttribute("data-app-build", "old");
  await expect(page.locator("html")).toHaveAttribute("data-offline-state", "ready");

  // Imports and exports moved under Settings in the M2.1 information architecture.
  await openSettings(page);
  await page.getByRole("button", { name: /^Imports and exports$/ }).click();
  await page.getByLabel("Pack JSON").fill(JSON.stringify({
    schemaVersion: 1,
    pack: {id:"pack:controlled-update",name:"Controlled Update Pack",version:"1.0.0",rulesEditions:["homebrew"],visibility:"private",licenseType:"original",exportRestricted:false,includeFullText:true},
    sources: [{id:"source:controlled-update",name:"Controlled Update Source",abbreviation:"CUS",edition:"homebrew",type:"homebrew",licenseType:"original",visibility:"private",priority:1,enabledByDefault:true,campaignIds:[],version:"1.0.0"}],
    entries: [{id:"rule:controlled-update",slug:"controlled-update",name:"Controlled Update Rule",aliases:[],category:"rule",rulesEdition:"homebrew",sourceId:"source:controlled-update",licenseType:"original",visibility:"private-user-entered",fullText:"Original synthetic update fixture.",prerequisites:[],choices:[],effects:[],tags:["synthetic"],version:"1.0.0",revision:1,legacy:false,optional:true,private:true,exportRestricted:false,createdAt:"2026-08-03T08:00:00.000Z",updatedAt:"2026-08-03T08:00:00.000Z"}],
  }));
  await page.getByRole("button", { name: /Preview import/ }).click();
  await page.getByRole("button", { name: /Confirm atomic import/ }).click();
  await expect(page.locator(".formmessage")).toContainText("completed atomically");

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
  await expect(page.locator("html")).toHaveAttribute("data-offline-state", "ready");
  await page.getByRole("button", { name: "Compendium", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Controlled Update Rule" })).toBeVisible();
});
