import { test, expect, type Page } from "@playwright/test";

const PASSWORD = "AegisDemo2026!";
const TARIQ = "tariq.saleh@meridian-demo.example";
const KARIM = "karim.nassar@meridian-demo.example";

test.setTimeout(180_000);

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/(overview|no-organization|platform|mfa)/);
}

test.describe("software security", () => {
  test("an approved tool with a new critical vulnerability is flagged for reassessment", async ({ page }) => {
    await login(page, TARIQ);
    await page.goto("/security/software");
    const row = page.getByTestId("software-list").locator("tr", { hasText: "chart-studio" });
    await expect(row).toContainText("Reassess");
    await expect(row).toContainText("Approved");
    await expect(row).toContainText("Quarantined");
  });

  test("dependency confusion is explained and a person other than the requester decides", async ({ page }) => {
    await login(page, KARIM);
    await page.goto("/security/software");
    await page.getByTestId("software-list").getByRole("link", { name: "mgb-ledger-client" }).click();
    await expect(page.getByTestId("software-assessment")).toHaveAttribute("data-recommended", "prohibited");
    await expect(page.getByTestId("software-findings")).toContainText("has an internal name but was resolved from registry.npmjs.org");
    await expect(page.getByTestId("software-decision").getByRole("button", { name: "Record decision" })).toBeDisabled();

    await page.context().clearCookies();
    await login(page, TARIQ);
    await page.goto("/security/software");
    await page.getByTestId("software-list").getByRole("link", { name: "mgb-ledger-client" }).click();
    await page.selectOption("#sw-decision", "prohibited");
    await page.fill("#sw-note", "Internal name resolved from the public registry");
    await page.getByTestId("software-decision").getByRole("button", { name: "Record decision" }).click();
    await expect(page.getByText("Last decided by a person")).toBeVisible();
    await page.goto("/security/software");
    await expect(page.getByTestId("software-list").locator("tr", { hasText: "mgb-ledger-client" }).locator("td").nth(1)).toContainText("Prohibited");
  });

  test("anyone can request software and it starts under review", async ({ page }) => {
    await login(page, KARIM);
    await page.goto("/security/software");
    await page.getByTestId("request-software").click();
    await page.fill("#sw-name", `e2e-tool-${Date.now().toString(36)}`);
    await page.fill("#sw-version", "1.0.0");
    await page.getByRole("button", { name: "Send request" }).click();
    await page.waitForURL(/\/security\/software\/[0-9a-f-]{36}/);
    await expect(page.getByTestId("software-assessment")).toHaveAttribute("data-recommended", "under_review");
    await expect(page.getByText("No SBOM or lockfile attached yet")).toBeVisible();
  });
});
