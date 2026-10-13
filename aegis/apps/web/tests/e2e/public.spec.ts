import { test, expect } from "@playwright/test";

test.setTimeout(180_000);

test.describe("public checker and proof pages", () => {
  test("the free checker scores answers in the browser and lists framework coverage", async ({ page }) => {
    await page.goto("/site/checker");
    await expect(page.getByRole("heading", { level: 1, name: "How well governed are your AI agents?" })).toBeVisible();
    const checker = page.getByTestId("governance-checker");
    await expect(checker.getByRole("radiogroup")).toHaveCount(14);
    await expect(page.getByTestId("checker-results")).toContainText("Nothing you enter leaves your browser");
    await checker.getByRole("radiogroup", { name: "Answer to question 1", exact: true }).getByRole("radio", { name: "Yes", exact: true }).click();
    await checker.getByRole("radiogroup", { name: "Answer to question 2", exact: true }).getByRole("radio", { name: "No", exact: true }).click();
    await expect(page.getByTestId("checker-score")).toHaveText("7");
    await expect(page.getByTestId("checker-level")).toHaveText("Starting");
    await expect(checker.getByText("What AEGIS does here:")).toBeVisible();
    const eu = page.getByTestId("checker-results").locator("tr[data-framework=eu-ai-act]");
    await expect(eu).toContainText("EU AI Act");
    await expect(eu).toContainText("Art. 14");
    for (let i = 1; i <= 14; i++) await checker.getByRole("radiogroup", { name: `Answer to question ${i}`, exact: true }).getByRole("radio", { name: "Yes", exact: true }).click();
    await expect(page.getByTestId("checker-score")).toHaveText("100");
    await expect(page.getByTestId("checker-level")).toHaveText("Established");
    await expect(page.getByTestId("checker-results")).toContainText("Your self-check");
    await page.getByRole("button", { name: "Start over" }).click();
    await expect(page.getByTestId("checker-results")).toContainText("Nothing you enter leaves your browser");
  });

  test("the Proof page states what is verified and what is not claimed, and is reachable from the header", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("navigation", { name: "Primary" }).first().getByRole("link", { name: "Proof", exact: true }).click();
    await page.waitForURL(/\/site\/proof/);
    await expect(page.getByRole("heading", { level: 1, name: "What has been verified, and what has not" })).toBeVisible();
    await expect(page.getByRole("table", { name: "Verified test suites and runs" })).toContainText("Alpaca paper connector");
    await expect(page.getByText("No customers, paying or otherwise.")).toBeVisible();
    await expect(page.getByRole("table", { name: "Checks not yet made" })).toContainText("Alpaca paper-account run");
  });
});
