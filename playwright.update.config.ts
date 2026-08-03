import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/update",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4173",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "npm run preview:update",
    url: "http://127.0.0.1:4173/adventurer-ledger/",
    reuseExistingServer: false,
    timeout: 300000,
  },
});
