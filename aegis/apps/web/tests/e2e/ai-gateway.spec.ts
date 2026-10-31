import { test, expect, type Page } from "@playwright/test";

/** The personas' password: the published demo password, or the one a staging seed set (E2E_PERSONA_PASSWORD). */
const PASSWORD = process.env.E2E_PERSONA_PASSWORD || "AegisDemo2026!";
const TARIQ = "tariq.saleh@meridian-demo.example";
const SARA = "sara.khalil@meridian-demo.example";

test.setTimeout(180_000);

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/(overview|no-organization|platform|mfa)/);
}

test.describe("AI gateway", () => {
  test("the log shows blocked requests as not sent, and the dry run blocks a card number without recording it", async ({ page }) => {
    await login(page, TARIQ);
    await page.goto("/security/ai-gateway");
    await expect(page.getByRole("heading", { name: "AI Gateway" })).toBeVisible();
    const rows = page.getByTestId("ai-gateway-events").locator("tr");
    await expect(rows.first()).toBeVisible();
    const blocked = rows.filter({ hasText: "Blocked" }).first();
    await expect(blocked).toContainText("Not sent");
    await expect(page.getByText("Azure OpenAI (demo, simulated)")).toBeVisible();
    await expect(page.getByText(/UAE North/)).toBeVisible();
    const before = await rows.count();
    await page.fill("#pv-model", "gpt-4o-mini");
    await page.getByTestId("ai-preview-run").click();
    await expect(page.getByTestId("ai-preview-result")).toHaveAttribute("data-decision", "block");
    await expect(page.getByTestId("ai-preview-result")).toContainText("Nothing would be sent to the provider");
    await page.reload();
    await expect(page.getByTestId("ai-gateway-events").locator("tr")).toHaveCount(before);
  });

  test("a person issues a personal key that is shown once", async ({ page }) => {
    await login(page, SARA);
    await page.goto("/security/ai-gateway");
    await page.getByTestId("issue-ai-key").click();
    await expect(page.getByTestId("issued-ai-key")).toContainText("aegis_ak_");
    await expect(page.getByTestId("ai-key-list")).toContainText("My laptop");
    // A viewer cannot add or block providers.
    await expect(page.getByRole("button", { name: "Add provider" })).toBeDisabled();
  });
});
