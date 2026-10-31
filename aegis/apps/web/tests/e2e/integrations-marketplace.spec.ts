import { test, expect, type Page } from "@playwright/test";

/** The personas' password: the published demo password, or the one a staging seed set (E2E_PERSONA_PASSWORD). */
const PASSWORD = process.env.E2E_PERSONA_PASSWORD || "AegisDemo2026!";
const TARIQ = "tariq.saleh@meridian-demo.example";
const SARA = "sara.khalil@meridian-demo.example";

test.setTimeout(180_000);

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/(overview|no-organization|platform|mfa)/);
}

test.describe("integration marketplace and event destinations", () => {
  test("the marketplace states how far each integration is verified, and claims no live verification", async ({ page }) => {
    await login(page, TARIQ);
    await page.goto("/integrations/marketplace");
    await expect(page.getByRole("heading", { level: 1, name: "Integration Marketplace" })).toBeVisible();
    await expect(page.getByText("No integration here has been verified by AEGIS against the real vendor service yet")).toBeVisible();
    for (const key of ["stripe-test", "alpaca-paper", "oidc", "saml", "scim", "webhook", "slack", "teams", "splunk_hec", "datadog_logs", "servicenow", "mcp"]) await expect(page.locator(`[data-entry="${key}"]`)).toBeVisible();
    await expect(page.locator('[data-entry="slack"]')).toContainText("tested against a local stand-in");
    await expect(page.locator('[data-entry="slack"]')).toContainText("1 set up");
    // The paused demo destinations were never tested, so nothing shows as verified.
    await expect(page.getByTestId("verified-in-org")).toHaveCount(0);
  });

  test("seeded destinations are paused and untested; unsafe URLs are refused when adding one", async ({ page }) => {
    await login(page, TARIQ);
    await page.goto("/integrations/destinations");
    const slack = page.locator('[data-kind="slack"]');
    await expect(slack).toContainText("paused");
    await slack.getByRole("link").click();
    await page.waitForURL(/\/integrations\/destinations\/[0-9a-f-]{36}$/);
    await expect(page.getByText("Not yet: send a test event")).toBeVisible();
    await expect(page.getByText("ending real")).toBeVisible();

    await page.goto("/integrations/destinations");
    await page.getByTestId("destination-add-open").click();
    await page.locator("#ds-kind").click();
    await page.getByRole("option", { name: "Signed webhook" }).click();
    await page.fill("#ds-name", "Internal collector");
    await page.fill("#ds-url", "http://169.254.169.254/latest/meta-data");
    await page.getByTestId("destination-add-submit").click();
    await expect(page.getByText("Destinations must use HTTPS")).toBeVisible();
    await page.fill("#ds-url", "https://localhost/collect");
    await page.getByTestId("destination-add-submit").click();
    await expect(page.getByText("Destinations must be reachable on the public internet")).toBeVisible();
  });

  test("a viewer cannot add destinations or see the integration pages", async ({ page }) => {
    await login(page, SARA);
    await page.goto("/integrations/destinations");
    // The viewer role has no integrations:read, so the page redirects to the forbidden explanation.
    await expect(page).toHaveURL(/\/forbidden\?need=integrations%3Aread/);
    await expect(page.getByTestId("destination-add-open")).toHaveCount(0);
  });
});
