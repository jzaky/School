import { test, expect, type Page } from "@playwright/test";

const PASSWORD = "AegisDemo2026!";
const OWNER = "nadia.haddad@meridian-demo.example";
const VIEWER = "sara.khalil@meridian-demo.example";

test.setTimeout(180_000);

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/(overview|no-organization|platform|mfa)/);
}

test.describe("pilots", () => {
  test("an owner installs a sector kit in watch-only mode, then switches the agent to enforcing", async ({ page }) => {
    await login(page, OWNER);
    await page.goto("/pilots");
    await expect(page.getByRole("heading", { name: "Pilots" })).toBeVisible();
    await expect(page.getByTestId("pilot-kits").locator("[data-testid^=pilot-kit-]")).toHaveCount(11);
    await expect(page.getByTestId("pilot-report")).toContainText("Evidence ledger");
    await page.getByTestId("pilot-install-ports-customs").click();
    await expect(page.getByTestId("pilot-kit-ports-customs")).toContainText("Installed");
    const row = page.locator("tr", { hasText: "Cargo Release Agent" });
    await expect(row).toContainText("Watch-only");
    await row.getByRole("button", { name: "Switch to enforcing" }).click();
    await expect(row).toContainText("Enforcing");
  });

  test("a viewer sees the report but cannot install kits", async ({ page }) => {
    await login(page, VIEWER);
    await page.goto("/pilots");
    await expect(page.getByTestId("pilot-report")).toBeVisible();
    await expect(page.getByTestId("pilot-install-healthcare")).toBeDisabled();
  });
});
