import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";

const PASSWORD = "AegisDemo2026!";
const OWNER = "nadia.haddad@meridian-demo.example";
const VIEWER = "sara.khalil@meridian-demo.example";
const API = process.env.AEGIS_API_URL ?? "http://localhost:4000";

test.setTimeout(180_000);

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/(overview|no-organization|platform|mfa)/);
}

/** The seeded refund agent's own API key, written by the seed to the gitignored .demo-keys.json. */
function refundAgentKey(): string {
  const keys = JSON.parse(readFileSync(join(process.cwd(), "..", "..", ".demo-keys.json"), "utf8")) as { agents: Record<string, string> };
  return keys.agents["support-refund-agent"]!;
}

test.describe("uncertainty governance", () => {
  test("the uncertainty page shows decisions by level, calibration from labelled outcomes and tool requirements", async ({ page }) => {
    await login(page, OWNER);
    await page.goto("/uncertainty");
    await expect(page.getByRole("heading", { level: 1, name: "Uncertainty" })).toBeVisible();
    await expect(page.getByTestId("uncertainty-levels")).toBeVisible();
    const profile = page.locator('[data-profile="Customer Support Refund Agent"]');
    await expect(profile).toContainText(/Calibrated on \d+ outcomes/);
    await expect(profile).toContainText("Expected calibration error");
    await expect(page.getByTestId("uncertainty-tool-form")).toBeVisible();
    await page.getByLabel("Tool", { exact: true }).click();
    await page.getByRole("option", { name: /\(issue-refund\)/ }).click();
    await expect(page.locator("#unc-required")).toHaveValue("params.orderId");
    await expect(page.locator("#unc-conf")).toHaveValue("0.7");
  });

  test("evidence that contradicts a request sends it to a person, and a reviewer can record the outcome", async ({ page, request }) => {
    const res = await request.post(`${API}/v1/gateway/actions`, {
      headers: { authorization: `Bearer ${refundAgentKey()}` },
      data: { tool: "issue-refund", action: "execute", resource: "support-tickets", idempotencyKey: `e2e-unc-${randomUUID()}`, params: { orderId: "ORD-E2E-1", customerId: "CUST-1", amount: 240, currency: "AED", reason: "Damaged item" }, context: { confidence: 0.92, evidence: [{ field: "amount", value: 24, source: "orders-db", observedAt: new Date().toISOString() }] }, principal: { type: "customer", ref: "CUST-1" }, justification: "e2e" },
    });
    expect(res.status()).toBe(202);
    const body = (await res.json()) as { requestId: string; decision: string };
    expect(body.decision).toBe("require_approval");
    await login(page, OWNER);
    await page.goto(`/gateway/${body.requestId}`);
    const panel = page.getByTestId("uncertainty-panel");
    await expect(panel).toHaveAttribute("data-level", "high");
    await expect(panel).toContainText("Made the decision stricter");
    await expect(panel.locator('[data-indicator="contradiction:amount"]')).toHaveAttribute("data-basis", "measured");
    // The seeded refund agent has enough labelled outcomes, so its confidence is shown against observed accuracy.
    await expect(panel.locator('[data-indicator="confidence"]')).toHaveAttribute("data-basis", "calibrated");
    await expect(panel.locator('[data-indicator="confidence"]')).toContainText(/observed accuracy at that confidence is \d+% over \d+ labelled outcomes/);
    await panel.getByRole("button", { name: "Wrong action" }).click();
    await expect(panel).toContainText("Outcome recorded (reviewer): the wrong action.");
  });

  test("a viewer can see uncertainty but cannot label outcomes or change requirements", async ({ page }) => {
    await login(page, VIEWER);
    await page.goto("/uncertainty");
    await expect(page.getByRole("button", { name: "Save requirements" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Recompute now" })).toBeDisabled();
  });
});
