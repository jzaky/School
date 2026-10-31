import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The personas' password: the published demo password, or the one a staging seed set (E2E_PERSONA_PASSWORD). */
const PASSWORD = process.env.E2E_PERSONA_PASSWORD || "AegisDemo2026!";
const NADIA = "nadia.haddad@meridian-demo.example";
const VIEWER = "sara.khalil@meridian-demo.example";

test.setTimeout(240_000);

function platformAdminPassword(): string {
  const keys = JSON.parse(readFileSync(join(process.cwd(), "..", "..", ".demo-keys.json"), "utf8")) as { platformAdmin?: { password?: string } };
  return keys.platformAdmin!.password!;
}

async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/(overview|no-organization|platform|mfa)/);
}

test.describe("commercial platform", () => {
  test("billing shows the plan, usage against limits and which features are only planned, and says no payment is collected", async ({ page }) => {
    await login(page, NADIA);
    await page.goto("/org/billing");
    await expect(page.getByTestId("billing-plan")).toHaveAttribute("data-plan", "trial");
    await expect(page.getByText("It never charges a card or collects payment")).toBeVisible();
    await expect(page.getByTestId("usage-lines").locator("[data-metric]")).toHaveCount(3);
    await expect(page.locator('[data-feature="secure_execution"]')).toHaveAttribute("data-included", "no");
    await expect(page.locator('[data-feature="secure_execution"]')).toContainText("planned, not built");
  });

  test("a viewer opens a support request and sees it listed", async ({ page }) => {
    await login(page, VIEWER);
    await page.goto("/org/support");
    const subject = `Approval emails ${Date.now().toString(36)}`;
    await page.fill("#sr-subject", subject);
    await page.fill("#sr-body", "Approvers say they did not get the notification for a pending request.");
    await page.getByRole("button", { name: "Send to support" }).click();
    await expect(page.getByTestId("support-requests")).toContainText(subject);
  });

  test("getting started shows the enterprise rollout from organization to first audit report", async ({ page }) => {
    await login(page, NADIA);
    await page.goto("/getting-started");
    const steps = page.getByTestId("enterprise-rollout").locator("[data-rollout-step]");
    await expect(steps).toHaveCount(8);
    await expect(page.locator('[data-rollout-step="protected_action"]')).toHaveAttribute("data-done", "yes");
  });

  test("a platform administrator creates a customer with a first-administrator invitation, records a contract and issues an invoice", async ({ page }) => {
    await login(page, "admin@aegis.local", platformAdminPassword());
    await page.goto("/platform/customers");
    await expect(page.getByTestId("customer-rows").locator('[data-org="meridian"]')).toBeVisible();
    await page.goto("/platform/tenants");
    const slug = `cust-${Date.now().toString(36)}`;
    await page.fill("#cc-name", "Example Customer (test)");
    await page.fill("#cc-slug", slug);
    await page.fill("#cc-email", `${slug}@test.aegis.local`);
    await page.selectOption("#cc-plan", "core");
    await page.getByRole("button", { name: "Create organization" }).click();
    await expect(page.getByTestId("invite-link")).toContainText("/invite/");
    await page.goto("/platform/customers");
    await page.getByTestId("customer-rows").locator(`[data-org="${slug}"]`).getByRole("link").click();
    await page.waitForURL(/\/platform\/customers\/[0-9a-f-]{36}/);
    await page.fill("#ct-fee", "12500");
    await page.fill("#ct-inc", "1000");
    await page.fill("#ct-tax", "5");
    await page.getByRole("button", { name: "Record contract" }).click();
    await expect(page.getByText(/Active: Core, AED.12,500\.00 per monthly period/)).toBeVisible();
    await page.getByRole("button", { name: "Draft invoice" }).click();
    const row = page.locator("tr[data-invoice]").first();
    await expect(row).toHaveAttribute("data-status", "draft");
    await expect(row).toContainText("13,125.00");
    await row.getByRole("button", { name: "Issue" }).click();
    await expect(page.locator("tr[data-invoice]").first()).toHaveAttribute("data-status", "issued");
  });

  test("the sales demonstration runs all six scenarios through the real engines", async ({ page }) => {
    await login(page, NADIA);
    await page.goto("/sales-demo");
    const setup = page.getByTestId("sales-demo-setup");
    if (await setup.isVisible()) {
      await setup.click();
      await page.waitForURL(/\/sales-demo$/);
    }
    await expect(page.getByText("Simulated environment: synthetic organization and data")).toBeVisible();
    const scenarios = page.getByTestId("sales-scenario");
    await expect(scenarios).toHaveCount(6);
    for (const key of ["finance", "healthcare", "it", "uncertainty", "autonomy", "reasoning"]) {
      const card = page.locator(`[data-scenario="${key}"]`);
      await card.getByTestId("run-scenario").click();
      await expect(card.getByTestId("sales-steps")).toBeVisible({ timeout: 60_000 });
      await expect(card.locator('[data-expected="no"]')).toHaveCount(0);
    }
  });
});
