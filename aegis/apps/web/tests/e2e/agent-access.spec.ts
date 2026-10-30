import { test, expect, type Page } from "@playwright/test";

const PASSWORD = "AegisDemo2026!";
const OWNER = "nadia.haddad@meridian-demo.example";
const ENGINEER = "karim.nassar@meridian-demo.example";
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

async function openAccessTab(page: Page, agentName: string) {
  await page.goto("/agents");
  await page.locator("tbody tr", { hasText: agentName }).first().click();
  await page.waitForURL(/\/agents\/[0-9a-f-]{36}/);
  await page.getByRole("tab", { name: /Access/ }).click();
}

test.describe("agent identity and access", () => {
  test("a pending temporary access request is approved by someone other than the requester", async ({ page }) => {
    await login(page, ENGINEER);
    await openAccessTab(page, "Analytics Copilot");
    const pending = page.getByTestId("access-requests").locator("li", { hasText: "pending" }).first();
    await expect(pending).toContainText("export-customer-records");
    // The engineer asked for it: approving is not theirs to do.
    await expect(pending.getByRole("button", { name: "Approve" })).toBeDisabled();
    await page.context().clearCookies();
    await login(page, SECURITY);
    await openAccessTab(page, "Analytics Copilot");
    const row = page.getByTestId("access-requests").locator("li", { hasText: "pending" }).first();
    await row.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText("Approved", { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId("access-requests").locator("li", { hasText: "approved" }).first()).toContainText("export-customer-records");
  });

  test("the access tab shows the workload identity, purpose, delegation and narrower-access suggestions", async ({ page }) => {
    await login(page, OWNER);
    await openAccessTab(page, "Customer Support Refund Agent");
    await expect(page.getByText(/spiffe:\/\/aegis\/meridian\/agent\/support-refund-agent/)).toBeVisible();
    await expect(page.locator("#agent-purpose")).toHaveValue(/Refund customers/);
    await expect(page.getByTestId("delegations")).toContainText("KYC Document Review Agent may act for this agent");
    await expect(page.getByRole("heading", { name: "Narrower access" })).toBeVisible();
  });

  test("a viewer sees emergency revocation but cannot use it", async ({ page }) => {
    await login(page, VIEWER);
    await openAccessTab(page, "Treasury Transfer Agent");
    await expect(page.getByTestId("emergency-revoke")).toBeDisabled();
  });

  test("discovery lists agents nobody registered and a person dismisses one with a reason", async ({ page }) => {
    await login(page, OWNER);
    await page.goto("/agents/discovery");
    await expect(page.getByRole("heading", { level: 1, name: "Agent discovery" })).toBeVisible();
    const row = page.locator('tr[data-discovered="copilot-agent-hr-faq"]');
    await expect(row).toContainText("Not registered");
    await expect(page.locator('tr[data-discovered="support-refund-agent"]')).toContainText("Linked");
    await row.getByLabel("Why it can be dismissed").fill("HR assistant answers policy questions only and takes no actions");
    await row.getByRole("button", { name: "Dismiss" }).click();
    await expect(page.locator('tr[data-discovered="copilot-agent-hr-faq"]')).toContainText("Dismissed");
  });

  test("single sign-on can be configured in settings and started from the login page", async ({ page }) => {
    await login(page, OWNER);
    await page.goto("/org/settings");
    await page.getByTestId("configure-sso").click();
    await expect(page.getByRole("dialog", { name: "Single sign-on" })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.context().clearCookies();
    await page.goto("/login");
    await page.fill("#sso-org", "meridian");
    await page.getByRole("button", { name: "Continue" }).click();
    // Meridian has no single sign-on turned on, so the login page explains that in plain words.
    await expect(page.getByText("Single sign-on is not turned on for that organization.")).toBeVisible();
  });
});
