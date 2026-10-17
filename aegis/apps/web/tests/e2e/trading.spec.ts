import { test, expect, type Page } from "@playwright/test";

const PASSWORD = "AegisDemo2026!";
const OWNER = "nadia.haddad@meridian-demo.example";

test.setTimeout(240_000);

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/(overview|no-organization|platform|mfa)/);
}

test.describe("AEGIS Trading", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, OWNER);
  });

  test("the seeded trading mandate opens on its guided tab and the trading agent is supervised", async ({ page }) => {
    await page.goto("/policies");
    await page.locator("tbody tr", { hasText: "Trading mandate (paper)" }).first().click();
    await page.waitForURL(/\/policies\/[0-9a-f-]{36}/);
    const tabs = page.getByRole("tablist", { name: "Policy sections" });
    await expect(tabs.getByRole("tab", { name: "Mandate" })).toHaveAttribute("data-state", "active");
    const panel = page.getByTestId("trading-mandate");
    await expect(panel.locator("#trm-instruments")).toHaveValue("SPY, QQQ, AAPL, MSFT, NVDA");
    await expect(panel.locator("#trm-auto")).toHaveValue("5000");
    await expect(panel.locator("#trm-ceiling")).toHaveValue("50000");
    await expect(panel.getByText("Orders below USD 5,000 run automatically.")).toBeVisible();
    const samples = panel.getByRole("table", { name: "Sample order outcomes" });
    await expect(samples).toBeVisible({ timeout: 60_000 });
    await expect(samples.locator("tr[data-sample=small]")).toContainText("Allowed");
    await expect(samples.locator("tr[data-sample=mid]")).toContainText("Approval required");
    await expect(samples.locator("tr[data-sample=large]")).toContainText("Denied");
    await expect(samples.locator("tr[data-sample=wrong_instrument]")).toContainText("Denied");
    await expect(samples.locator("tr[data-sample=daily_loss]")).toContainText("Denied");

    await page.goto("/agents");
    const row = page.locator("tbody tr", { hasText: "Portfolio Trading Agent" }).first();
    await expect(row.getByTestId("agent-posture")).toHaveAttribute("data-posture", "supervised");
  });

  test("a new trading mandate is created from the guided template with custom limits", async ({ page }) => {
    await page.goto("/policies");
    await page.getByRole("button", { name: "New policy" }).click();
    const dialog = page.getByRole("dialog", { name: "New policy" });
    const stamp = Date.now().toString(36).slice(-5);
    await dialog.locator("#policy-name").fill(`Options desk mandate ${stamp}`);
    await dialog.locator("#policy-template").click();
    await page.getByRole("option", { name: /Trading mandate \(guided\)/ }).click();
    await dialog.locator("#npt-instruments").fill("TSLA, AMZN");
    await dialog.locator("#npt-auto").fill("1000");
    await dialog.locator("#npt-ceiling").fill("20000");
    await dialog.locator("#npt-maxqty").fill("50");
    await expect(dialog.getByText("Only TSLA, AMZN may be traded; any other symbol is refused and recorded as a security event.")).toBeVisible();
    const samples = dialog.getByRole("table", { name: "Sample order outcomes" });
    await expect(samples).toBeVisible({ timeout: 60_000 });
    await expect(samples.locator("tr[data-sample=small]")).toContainText("Order of USD 500 runs automatically");
    await expect(samples.locator("tr[data-sample=oversize]")).toContainText("Order of 51 units is refused");
    await dialog.getByRole("button", { name: "Create draft" }).click();
    await page.waitForURL(/\/policies\/[0-9a-f-]{36}\?tab=thresholds/);
    await expect(page.getByTestId("trading-mandate")).toBeVisible();
    await expect(page.locator("#trm-instruments")).toHaveValue("TSLA, AMZN");
  });

  test("the trading demo runs through the gateway and the approval shows the notional boundary", async ({ page }) => {
    await page.goto("/gateway/demos");
    const card = page.locator("section", { hasText: "AEGIS Trading: a portfolio agent under a mandate" }).first();
    await card.getByRole("button", { name: "Run" }).click();
    await expect(card.getByText("USD 13,800 AAPL order needs an approver")).toBeVisible({ timeout: 90_000 });
    await expect(card.getByText("USD 72,000 NVDA order is refused")).toBeVisible();
    await expect(card.getByText("GME order is refused: not on the instrument list")).toBeVisible();
    await expect(card.getByText("Second order with the same reference is refused")).toBeVisible();
    await expect(card.getByText("Order after a USD 2,600 day loss is refused")).toBeVisible();
    await card.getByRole("link", { name: "approval" }).first().click();
    await page.waitForURL(/\/approvals\/[0-9a-f-]{36}/);
    await expect(page.getByTestId("approval-sentence")).toBeVisible();
    await expect(page.getByTestId("approval-boundary")).toContainText(/USD 13,800 is USD 8,800 above the automatic limit of USD 5,000 and USD 36,200 below the ceiling of USD 50,000\.|outside market hours/);
  });

  test("the Alpaca paper integration is listed as a sandbox that needs a paper key and refuses live keys", async ({ page }) => {
    await page.goto("/integrations");
    await expect(page.locator("tbody tr", { hasText: "Alpaca (paper trading)" })).toContainText("Sandbox");
    await page.getByRole("link", { name: /Alpaca \(paper trading\)/ }).click();
    await page.waitForURL(/\/integrations\/[0-9a-f-]{36}/);
    await expect(page.getByRole("heading", { level: 1, name: "Alpaca (paper trading)" })).toBeVisible();
    await expect(page.getByText("Not connected.")).toBeVisible();
    await expect(page.getByText(/Only paper keys are accepted/).first()).toBeVisible();
  });
});
