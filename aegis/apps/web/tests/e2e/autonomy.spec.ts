import { test, expect, type Page } from "@playwright/test";

const PASSWORD = "AegisDemo2026!";
const OWNER = "nadia.haddad@meridian-demo.example";
const GOVERNANCE = "omar.farouk@meridian-demo.example";
const SECURITY = "tariq.saleh@meridian-demo.example";
const VIEWER = "sara.khalil@meridian-demo.example";

test.setTimeout(180_000);

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/(overview|no-organization|platform|mfa)/);
}

async function openAutonomyTab(page: Page, agentName: string) {
  await page.goto("/agents/autonomy");
  await page.locator(`tr[data-agent-row="${agentName}"]`).getByRole("link", { name: agentName }).click();
  await page.waitForURL(/\/agents\/[0-9a-f-]{36}\?tab=autonomy/);
  await expect(page.getByTestId("autonomy-level")).toBeVisible();
}

test.describe("managed autonomy", () => {
  test("the overview shows agents by level, recent changes and the open raise", async ({ page }) => {
    await login(page, OWNER);
    await page.goto("/agents/autonomy");
    await expect(page.getByRole("heading", { level: 1, name: "Autonomy" })).toBeVisible();
    await expect(page.locator('tr[data-agent-row="Customer Support Refund Agent"]')).toContainText("Level 4: Policy autonomy");
    await expect(page.locator('tr[data-agent-row="Fraud Triage Agent"]')).toContainText("Level 2: Low-risk autonomy");
    await expect(page.getByTestId("autonomy-pending")).toContainText("Analytics Copilot");
    await expect(page.getByTestId("autonomy-settings")).toBeVisible();
    await page.goto("/agents");
    await expect(page.getByRole("columnheader", { name: "Autonomy" })).toBeVisible();
  });

  test("a raise needs a second person: the requester cannot approve it, another controller can", async ({ page }) => {
    await login(page, GOVERNANCE);
    await openAutonomyTab(page, "Analytics Copilot");
    await expect(page.getByTestId("autonomy-level")).toHaveAttribute("data-level", "1");
    const pending = page.locator('[data-request-status="pending"]').first();
    await expect(pending).toContainText("Level 1 to 2");
    await expect(pending.getByRole("button", { name: "Approve" })).toBeDisabled();
    await page.context().clearCookies();
    await login(page, SECURITY);
    await openAutonomyTab(page, "Analytics Copilot");
    await page.locator('[data-request-status="pending"]').first().getByRole("button", { name: "Approve" }).click();
    await expect(page.getByTestId("autonomy-level")).toHaveAttribute("data-level", "2");
    await expect(page.getByText("Raised (approved by a second person): level 1 to 2")).toBeVisible();
  });

  test("lowering applies at once and is recorded; the simulation replays recorded requests", async ({ page }) => {
    await login(page, OWNER);
    await openAutonomyTab(page, "KYC Document Review Agent");
    await page.getByLabel("Target level").click();
    await page.getByRole("option", { name: "Level 1: Approve every action" }).click();
    await expect(page.getByTestId("autonomy-direction")).toContainText("applies immediately");
    await page.getByTestId("autonomy-simulate").click();
    await expect(page.getByTestId("autonomy-simulation")).toContainText(/At Level 1: Approve every action, of \d+ recorded requests: 0 would run on their own/);
    await page.locator("#autonomy-reason").fill("Vendor outage: a person checks every document decision this week");
    await page.getByTestId("autonomy-submit").click();
    await expect(page.getByTestId("autonomy-level")).toHaveAttribute("data-level", "1");
    await expect(page.getByText("Lowered: level 3 to 1")).toBeVisible();
  });

  test("a viewer sees the levels but cannot change them", async ({ page }) => {
    await login(page, VIEWER);
    await openAutonomyTab(page, "Fraud Triage Agent");
    await expect(page.getByTestId("autonomy-submit")).toBeDisabled();
    await expect(page.getByTestId("autonomy-eligibility")).toBeVisible();
  });
});
