import { defineConfig, devices } from "@playwright/test";

const production = process.env.TEST_BASE_URL;
export default defineConfig({
  testDir: "./tests",
  testMatch: "browser.spec.js",
  timeout: 60000,
  expect: { timeout: 15000 },
  workers: 1,
  reporter: "list",
  use: {
    baseURL: production || "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: production ? undefined : {
    command: "node tests/server.js",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
    timeout: 120000,
  },
});
