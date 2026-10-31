import { test, expect, type Page } from "@playwright/test";

/** The personas' password: the published demo password, or the one a staging seed set (E2E_PERSONA_PASSWORD). */
const PASSWORD = process.env.E2E_PERSONA_PASSWORD || "AegisDemo2026!";
const OWNER = "nadia.haddad@meridian-demo.example";

test.setTimeout(180_000);

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/(overview|no-organization|platform|mfa)/);
}

/** Runs the plain-language tester inside a panel and returns the result box. */
async function tryRefund(panel: ReturnType<Page["getByTestId"]>, prefix: string, amount: string) {
  await panel.locator(`#${prefix}-amount`).fill(amount);
  await panel.getByRole("button", { name: "Check this refund" }).click();
  const result = panel.getByTestId(`${prefix}-result`);
  await expect(result).toContainText(amount.replace(/\B(?=(\d{3})+(?!\d))/g, ","), { timeout: 20_000 });
  return result;
}

test.describe("guided refund policy", () => {
  test("Nadia creates a guided refund policy, tests three amounts, and the Thresholds tab is pre-filled", async ({ page }) => {
    await login(page, OWNER);
    const stamp = Date.now();
    const name = `E2E guided refund ${stamp}`;
    const key = `e2e-guided-refund-${stamp}`;

    await page.goto("/policies");
    await page.getByRole("button", { name: "New policy" }).click();
    const dialog = page.getByRole("dialog", { name: "New policy" });
    await expect(dialog).toBeVisible();
    await dialog.locator("#policy-name").fill(name);
    await dialog.locator("#policy-key").fill(key);
    // Guided refund is the default starting document.
    await expect(dialog.locator("#policy-template")).toContainText("Refund policy (guided)");

    // Custom thresholds: automatic below 400, approval up to 3,000.
    await dialog.locator("#np-auto").fill("400");
    await dialog.locator("#np-upto").fill("3000");
    const explanation = dialog.getByRole("list", { name: "What this policy does" });
    await expect(explanation).toContainText("Refunds below AED 400 run automatically.");
    await expect(explanation).toContainText("Refunds from AED 400 to AED 3,000 need one Approver within 4 hours.");
    await expect(explanation).toContainText("Refunds above AED 3,000 are refused.");
    await expect(explanation).toContainText("A second refund for the same order or payment is refused.");
    // The approver roles come from the organization's roles that hold approvals:decide.
    await expect(dialog.locator("#np-role-approver")).toBeChecked();
    await expect(dialog.locator("#np-role-governance_manager")).toBeVisible();

    // Live sample outcomes reflect the new thresholds.
    const samples = dialog.getByRole("table", { name: "Sample request outcomes" });
    await expect(samples.locator("tr[data-sample=small]")).toContainText("AED 200", { timeout: 20_000 });
    await expect(samples.locator("tr[data-sample=small]")).toContainText("Allowed");
    await expect(samples.locator("tr[data-sample=mid]")).toContainText("Approval required");
    await expect(samples.locator("tr[data-sample=large]")).toContainText("AED 6,000");
    await expect(samples.locator("tr[data-sample=large]")).toContainText("Denied");
    await expect(samples.locator("tr[data-sample=duplicate]")).toContainText("Denied");

    // An invalid ceiling blocks creation with an explanation, then is corrected.
    await dialog.locator("#np-upto").fill("100");
    await expect(dialog.getByText("The approval ceiling must be at least the autonomous limit")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Create draft" })).toBeDisabled();
    await dialog.locator("#np-upto").fill("3000");

    await dialog.getByRole("button", { name: "Create draft" }).click();
    await page.waitForURL(/\/policies\/[0-9a-f-]{36}\?tab=thresholds/);
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(page.getByText(/^v1: Draft$/)).toBeVisible();

    // Thresholds tab is first and pre-filled with the custom values.
    const tabs = page.getByRole("tablist", { name: "Policy sections" });
    await expect(tabs.getByRole("tab").first()).toHaveText("Thresholds");
    await expect(tabs.getByRole("tab", { name: "Thresholds" })).toHaveAttribute("data-state", "active");
    const panel = page.getByRole("tabpanel");
    await expect(panel.locator("#th-auto")).toHaveValue("400");
    await expect(panel.locator("#th-upto")).toHaveValue("3000");
    await expect(panel.locator("#th-role-approver")).toBeChecked();
    await expect(panel.getByRole("list", { name: "What this policy does" })).toContainText("Refunds from AED 400 to AED 3,000");
    await expect(panel.getByRole("button", { name: "Save draft" })).toBeDisabled();

    // Try a request: small, mid and large amounts give the three outcomes with the matched rule.
    const tester = panel.getByTestId("th-try-panel");
    const small = await tryRefund(tester, "th-try", "150");
    await expect(small).toContainText("Allowed");
    await expect(small).toContainText("autonomous-band");
    const mid = await tryRefund(tester, "th-try", "1200");
    await expect(mid).toContainText("Approval required");
    await expect(mid).toContainText("approval-band");
    await expect(mid).toContainText("need approval");
    const large = await tryRefund(tester, "th-try", "9000");
    await expect(large).toContainText("Denied");
    await expect(large).toContainText("above-limit");
    await expect(large).toContainText("Refunds above AED 3,000 are refused");
    // Duplicate detection through the toggle.
    await tester.locator("#th-try-dup").click();
    const dup = await tryRefund(tester, "th-try", "150");
    await expect(dup).toContainText("Denied");
    await expect(dup).toContainText("duplicate-refund");
    await tester.locator("#th-try-dup").click();

    // Editing a threshold enables Save draft; saving keeps the review flow (still a draft).
    await panel.locator("#th-auto").fill("450");
    await expect(panel.getByRole("list", { name: "What this policy does" })).toContainText("Refunds below AED 450 run automatically.");
    await panel.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("Draft v1 saved")).toBeVisible();
    // Reload to prove the draft persisted (and to avoid racing the client refresh).
    await page.reload();
    await expect(page.getByText(/^v1: Draft$/)).toBeVisible();
    await expect(page.getByRole("tabpanel").locator("#th-auto")).toHaveValue("450");
    await expect(page.getByRole("tabpanel").getByRole("list", { name: "What this policy does" })).toContainText("Refunds below AED 450 run automatically.");

    // The Rules tab shows the generated rules and the Editor tab still shows the JSON.
    await tabs.getByRole("tab", { name: /^Rules/ }).click();
    await expect(page.getByRole("tabpanel")).toContainText("above-limit");
    await expect(page.getByRole("tabpanel")).toContainText("context.priorRequestsSameReference");
    await tabs.getByRole("tab", { name: /^Editor/ }).click();
    const json = page.locator("#policy-json");
    await expect(json).toBeVisible();
    const doc = JSON.parse(await json.inputValue()) as { version: number; rules: { id: string }[]; meta?: { template?: { id: string; settings?: { autoApproveBelow?: number } } } };
    expect(doc.version).toBe(1);
    expect(doc.rules.map((r) => r.id)).toContain("approval-band");
    expect(doc.meta?.template?.id).toBe("refund-v1");
    expect(doc.meta?.template?.settings?.autoApproveBelow).toBe(450);
    await expect(page.getByText(/Valid policy document/)).toBeVisible();

    // The Simulate tab carries the same plain-language tester for the stored version.
    await tabs.getByRole("tab", { name: /^Simulate/ }).click();
    const simTester = page.getByRole("tabpanel").getByTestId("sim-try-panel");
    const simMid = await tryRefund(simTester, "sim-try", "2000");
    await expect(simMid).toContainText("Approval required");
    await expect(page.getByRole("tabpanel").locator("#sim-tool")).toHaveValue("issue-refund");
  });

  test("the classic templates remain available and the JSON editor opens for them", async ({ page }) => {
    await login(page, OWNER);
    await page.goto("/policies");
    await page.getByRole("button", { name: "New policy" }).click();
    const dialog = page.getByRole("dialog", { name: "New policy" });
    await dialog.locator("#policy-template").click();
    await page.getByRole("option", { name: "Refund tiers" }).click();
    await expect(dialog.getByText("Three amount bands: autonomous, approval, denied.")).toBeVisible();
    await expect(dialog.locator("#np-auto")).toHaveCount(0);
  });
});
