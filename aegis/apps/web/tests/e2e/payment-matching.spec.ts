import { test, expect, type Page } from "@playwright/test";

const PASSWORD = "AegisDemo2026!";
const VIEWER = "sara.khalil@meridian-demo.example";

test.setTimeout(180_000);

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/(overview|no-organization|platform|mfa)/);
}

test("the Action Gateway shows payment matching: the paid invoice, open ones, and the tool it guards", async ({ page }) => {
  await login(page, VIEWER);
  await page.goto("/gateway");
  await expect(page.getByTestId("matching-tools")).toContainText("pay-supplier-invoice");
  await expect(page.getByTestId("payment-document").filter({ hasText: "INV-2026-0412" })).toContainText("Paid");
  await expect(page.getByTestId("payment-document").filter({ hasText: "INV-2026-0415" })).toContainText("Open");
  await page.goto("/gateway?tool=pay-supplier-invoice&status=denied");
  await expect(page.locator("tbody tr").filter({ hasText: "pay-supplier-invoice" })).toHaveCount(2);
});

test("the Action Gateway shows receipt validation: a matching receipt, an inflated one, a claim made twice and wrong VAT", async ({ page }) => {
  await login(page, VIEWER);
  await page.goto("/gateway");
  // A claim's explanation can name another claim, so match on the claim's own reference.
  const claim = (ref: string) => page.getByTestId("expense-claim").filter({ has: page.getByText(ref, { exact: true }) });
  await expect(claim("EXP-2026-1041")).toContainText("Matches the card");
  await expect(claim("EXP-2026-1042")).toContainText("Does not match");
  await expect(claim("EXP-2026-1043")).toContainText("Does not match");
  await expect(claim("EXP-2026-1044")).toContainText("Needs a person");
  await expect(page.getByTestId("claim-counts")).toContainText("Matches the card: 1");
});
