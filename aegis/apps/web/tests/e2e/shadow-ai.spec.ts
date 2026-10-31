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

test.describe("Shadow AI discovery", () => {
  test("an unapproved app seen only in DNS is a violation labelled inferred, and coverage names what is not visible", async ({ page }) => {
    await login(page, TARIQ);
    await page.goto("/security/shadow-ai");
    const deepseek = page.getByTestId("shadow-apps").locator("tr", { hasText: "DeepSeek" });
    await expect(deepseek).toContainText("Policy violation");
    await expect(deepseek).toContainText("Inferred");
    await expect(deepseek).toContainText("Unapproved");
    const chatgpt = page.getByTestId("shadow-apps").locator("tr", { hasText: "ChatGPT" }).first();
    await expect(chatgpt).toContainText("Confirmed");
    await expect(page.getByText(/personal devices, personal accounts/)).toBeVisible();
    await expect(page.getByTestId("coverage-sources").locator("tr", { hasText: "DNS logs" })).not.toContainText("not connected");
  });

  test("a security analyst imports a DNS export and only the AI lookup is kept", async ({ page }) => {
    await login(page, TARIQ);
    await page.goto("/security/shadow-ai");
    await page.selectOption("#si-format", "dns_jsonl");
    const lines = [JSON.stringify({ ts: new Date().toISOString(), client: "10.99.0.1", query: "claude.ai" }), JSON.stringify({ ts: new Date().toISOString(), client: "10.99.0.1", query: "weather.example" })].join("\n");
    await page.setInputFiles("#si-file", { name: "dns.jsonl", mimeType: "application/json", buffer: Buffer.from(lines) });
    await page.getByTestId("shadow-import-form").getByRole("button", { name: "Import" }).click();
    await expect(page.getByTestId("shadow-import-result")).toContainText("1 matched an AI app");
    await expect(page.getByTestId("shadow-import-result")).toContainText("1 were not AI and were discarded");
  });

  test("a viewer can see discovery but cannot import or review", async ({ page }) => {
    await login(page, SARA);
    await page.goto("/security/shadow-ai");
    await expect(page.getByTestId("shadow-import-form").getByRole("button", { name: "Import" })).toBeDisabled();
    await expect(page.getByTestId("review-deepseek")).toBeDisabled();
    // The live Entra connector panel is there, but a viewer cannot connect it.
    await expect(page.getByTestId("entra-panel")).toHaveAttribute("data-connected", "no");
    await expect(page.getByTestId("entra-panel").getByRole("button", { name: "Connect", exact: true })).toBeDisabled();
  });
});
