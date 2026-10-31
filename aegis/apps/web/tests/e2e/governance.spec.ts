import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", process.env.E2E_PERSONA_PASSWORD || "AegisDemo2026!");
  await page.click("button[type=submit]");
  await page.waitForURL(/\/(overview|getting-started)/);
}

test.describe("continuous governance", () => {
  test("owner turns continuous mode on with the shipped responses, it persists, and can be turned off", async ({ page }) => {
    await login(page, "nadia.haddad@meridian-demo.example");
    await page.goto("/org/settings");
    const panel = page.getByTestId("continuous-governance");
    await expect(panel.getByTestId("cg-mode-badge")).toHaveText("Assisted");
    await panel.locator("#cg-mode").click();
    await expect(panel.getByTestId("cg-mode-badge")).toHaveText("Continuous");
    // The starting point sets a real response for RM-001 and leaves RM-003 at notify only.
    await expect(panel.getByRole("combobox", { name: "Response for RM-001" })).toContainText("Suspend the agent");
    await expect(panel.getByRole("combobox", { name: "Response for RM-003" })).toContainText("Notify people only");
    await panel.getByTestId("cg-save").click();
    await expect(page.getByText("Continuous governance is on")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("continuous-governance").getByTestId("cg-mode-badge")).toHaveText("Continuous");
    // Recorded in evidence.
    await page.goto("/evidence?type=governance.mode_changed");
    await expect(page.getByText("governance.mode_changed").first()).toBeVisible();
    // Back to assisted so the demo tenant keeps its default behaviour.
    await page.goto("/org/settings");
    await page.getByTestId("continuous-governance").locator("#cg-mode").click();
    await page.getByTestId("continuous-governance").getByTestId("cg-save").click();
    await expect(page.getByText("Continuous governance is off")).toBeVisible();
  });

  test("a viewer sees the mode but cannot change it", async ({ page }) => {
    await login(page, "sara.khalil@meridian-demo.example");
    await page.goto("/org/settings");
    const panel = page.getByTestId("continuous-governance");
    await expect(panel.getByTestId("cg-mode-badge")).toBeVisible();
    await expect(panel.locator("#cg-mode")).toBeDisabled();
    await expect(panel.getByTestId("cg-save")).toBeDisabled();
  });
});
