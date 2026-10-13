import { test, expect, type Page } from "@playwright/test";

const PASSWORD = "AegisDemo2026!";
const OWNER = "nadia.haddad@meridian-demo.example";

test.setTimeout(180_000);

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/(overview|no-organization|platform|mfa)/);
}

test.describe("autonomy posture and boundary sentence", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, OWNER);
  });

  test("the agents list and the agent page show a posture derived from state, tools and policies", async ({ page }) => {
    await page.goto("/agents");
    await expect(page.getByRole("columnheader", { name: "Posture" })).toBeVisible();
    const row = page.locator("tbody tr", { hasText: "Customer Support Refund Agent" }).first();
    await expect(row.getByTestId("agent-posture")).toHaveAttribute("data-posture", "supervised");
    await expect(row.getByTestId("agent-posture")).toHaveText("Supervised");
    await row.click();
    await page.waitForURL(/\/agents\/[0-9a-f-]{36}/);
    const posture = page.getByTestId("agent-posture");
    await expect(posture).toHaveAttribute("data-posture", "supervised");
    await expect(posture).toContainText("Supervised");
    await expect(posture).toContainText(/Refunds below AED 500 run automatically/);
    await expect(posture).toContainText(/need/);
  });

  test("each approval says which boundary was close, in the policy's own units", async ({ page }) => {
    await page.goto("/approvals?status=all");
    let row = page.locator("[data-approval-row]", { hasText: "above the automatic limit of AED 500" }).first();
    if ((await row.count()) === 0) {
      await page.goto("/gateway/demos");
      const refunds = page.locator("section", { hasText: "Refunds: tiers, duplicates, expiry and tampering" }).first();
      await refunds.getByRole("button", { name: "Run" }).click();
      await expect(refunds.getByText("AED 1,450 refund needs a supervisor")).toBeVisible({ timeout: 60_000 });
      await page.goto("/approvals?status=all");
      row = page.locator("[data-approval-row]", { hasText: "above the automatic limit of AED 500" }).first();
    }
    await expect(row).toBeVisible();
    await expect(row).toContainText("Boundary");
    await row.getByTestId("approval-open").click();
    await page.waitForURL(/\/approvals\/[0-9a-f-]{36}/);
    const boundary = page.getByTestId("approval-boundary");
    await expect(boundary).toBeVisible();
    await expect(boundary).toContainText(/^Which boundary was close: AED [\d,]+ is AED [\d,]+ above the automatic limit of AED 500 and AED [\d,]+ below the ceiling of AED 2,500\.$/);

    // A policy without a guided template falls back to the deciding rule's matched comparison.
    await page.goto("/approvals?status=all");
    const transfer = page.locator("[data-approval-row]", { hasText: "AED 250,000.00" }).first();
    if ((await transfer.count()) > 0) {
      await expect(transfer).toContainText(/Matched because amount \(250,000\) is between 50,000 and 1,000,000/);
    }
  });
});
