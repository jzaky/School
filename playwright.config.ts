import { defineConfig, devices } from "@playwright/test";

// Hero flow E2E suite. Point it at any running server with E2E_BASE_URL.
// The specs create their own requests and bookings, so they can run against the shared demo school
// without a reset and do not depend on exact counts.
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 240_000,
  expect: { timeout: 20_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    viewport: { width: 1300, height: 900 },
    actionTimeout: 30_000,
    navigationTimeout: 90_000,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1300, height: 900 } } }],
});
