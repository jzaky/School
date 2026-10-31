import { test, expect, type Page } from "@playwright/test";

/** The personas' password: the published demo password, or the one a staging seed set (E2E_PERSONA_PASSWORD). */
const PASSWORD = process.env.E2E_PERSONA_PASSWORD || "AegisDemo2026!";
const ENGINEER = "karim.nassar@meridian-demo.example";

test.setTimeout(180_000);

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/(overview|no-organization|platform|mfa)/);
}

test.describe("integrations as engineer", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, ENGINEER);
  });

  test("the list distinguishes simulated systems from sandbox connectors", async ({ page }) => {
    await page.goto("/integrations");
    await expect(page.getByRole("heading", { level: 1, name: "Integrations" })).toBeVisible();
    await expect(page.locator("tbody tr", { hasText: "Stripe (test mode)" })).toContainText("Sandbox");
    await expect(page.locator("tbody tr", { hasText: "Stripe (test mode)" })).toContainText("Disabled");
    await expect(page.locator("tbody tr", { hasText: "Core Banking" })).toContainText("Simulated");
  });

  test("the Stripe detail page shows the sandbox badge, the connect hint, a working connection test and refuses a live key", async ({ page }) => {
    await page.goto("/integrations");
    await page.getByRole("link", { name: /Stripe \(test mode\)/ }).click();
    await page.waitForURL(/\/integrations\/[0-9a-f-]{36}/);
    await expect(page.getByRole("heading", { level: 1, name: "Stripe (test mode)" })).toBeVisible();
    await expect(page.getByText("Sandbox", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Connect your Stripe test-mode secret key to enable this integration.").first()).toBeVisible();
    await expect(page.getByText("Simulated system activity")).toHaveCount(0);

    // The connection test runs even without a key and reports why it cannot reach Stripe.
    await page.getByRole("button", { name: "Test connection" }).click();
    await expect(page.getByRole("status")).toContainText(/Failed/);
    await expect(page.getByRole("status")).toContainText(/credential/i);

    // Live keys are refused with a plain-language message and nothing is stored.
    await page.getByRole("button", { name: "Store credential" }).click();
    await expect(page.locator("#cred-name")).toHaveValue("secret-key");
    await page.fill("#cred-secret", ["sk", "live", "51ThisWouldMoveRealMoney000000"].join("_"));
    await page.getByRole("button", { name: "Store", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Only Stripe test-mode keys (sk_test_ or rk_test_) can be stored.");
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText("No credential stored.")).toBeVisible();
  });
});
