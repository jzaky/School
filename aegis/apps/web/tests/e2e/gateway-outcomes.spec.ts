import { test, expect, type Page } from "@playwright/test";

const PASSWORD = "AegisDemo2026!";
const OWNER = "nadia.haddad@meridian-demo.example";
const SECURITY = "tariq.saleh@meridian-demo.example";
const VIEWER = "sara.khalil@meridian-demo.example";
const ENGINEER = "karim.nassar@meridian-demo.example";

test.setTimeout(240_000);

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/(overview|no-organization|platform|mfa)/);
}

/** Runs the outcomes scenario so each test has a fresh quarantined request of its own. */
async function runOutcomesScenario(page: Page) {
  await page.goto("/gateway/demos");
  const card = page.locator('[data-scenario="outcomes"]');
  await card.getByRole("button", { name: /Run/ }).click();
  await expect(card.getByText("Quarantined for security review")).toBeVisible({ timeout: 90_000 });
}

async function openNewestQuarantined(page: Page) {
  await page.goto("/gateway?status=quarantined");
  const row = page.locator("tbody tr", { hasText: "issue-refund" }).first();
  await expect(row).toBeVisible();
  await row.click();
  await page.waitForURL(/\/gateway\/[0-9a-f-]{36}/);
}

test.describe("gateway outcomes between allow and deny", () => {
  test("a security reviewer sends a quarantined refund to an approver", async ({ page }) => {
    await login(page, OWNER);
    await runOutcomesScenario(page);
    await page.context().clearCookies();
    await login(page, SECURITY);
    await openNewestQuarantined(page);
    const controls = page.getByTestId("quarantine-controls");
    await expect(controls).toContainText("Held for security review");
    await expect(controls.getByTestId("quarantine-to-approval")).toBeDisabled();
    await controls.locator("#quarantine-reason").fill("Spoke to the customer on a verified number; card change is genuine");
    await controls.getByTestId("quarantine-to-approval").click();
    await expect(page.getByText("Sent to an approver. It runs only if a person approves it.")).toBeVisible();
    await expect(page.getByTestId("quarantine-controls")).toHaveCount(0);
    await expect(page.getByText("Approval required").first()).toBeVisible();
  });

  test("a viewer sees the quarantine but cannot release it", async ({ page }) => {
    await login(page, VIEWER);
    await openNewestQuarantined(page);
    const controls = page.getByTestId("quarantine-controls");
    await expect(controls.getByTestId("quarantine-refuse")).toBeDisabled();
    await expect(controls.locator("#quarantine-reason")).toBeDisabled();
  });

  test("a narrowed refund explains what policy changed", async ({ page }) => {
    await login(page, OWNER);
    await page.goto("/gateway?q=demo-outcomes");
    const row = page.locator("tbody tr", { hasText: "Allowed with limits" }).first();
    await expect(row).toBeVisible();
    await row.click();
    await page.waitForURL(/\/gateway\/[0-9a-f-]{36}/);
    await expect(page.getByTestId("restrictions-note")).toContainText("amount capped from 420 to 250");
  });

  test("the enforcement check on a simulated system finds every action went through AEGIS", async ({ page }) => {
    await login(page, ENGINEER);
    await page.goto("/integrations");
    await page.getByRole("link", { name: /Support Platform \(simulated\)/ }).first().click();
    await page.waitForURL(/\/integrations\/[0-9a-f-]{36}/);
    const panel = page.getByTestId("enforcement-panel");
    await panel.getByTestId("run-enforcement-audit").click();
    await expect(page.getByText(/recent actions in this system went through AEGIS/).first()).toBeVisible({ timeout: 30_000 });
  });
});
