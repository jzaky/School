import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";

const PASSWORD = "AegisDemo2026!";
const OWNER = "nadia.haddad@meridian-demo.example";
const API = process.env.AEGIS_API_URL ?? "http://localhost:4000";

test.setTimeout(180_000);

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/(overview|no-organization|platform|mfa)/);
}

function refundAgentKey(): string {
  const keys = JSON.parse(readFileSync(join(process.cwd(), "..", "..", ".demo-keys.json"), "utf8")) as { agents: Record<string, string> };
  return keys.agents["support-refund-agent"]!;
}

test.describe("decision inspector and stated reasons", () => {
  test("a rationale that cites evidence it never supplied is held, and the inspector shows every stage", async ({ page, request }) => {
    const res = await request.post(`${API}/v1/gateway/actions`, {
      headers: { authorization: `Bearer ${refundAgentKey()}` },
      data: {
        tool: "issue-refund",
        action: "execute",
        resource: "support-tickets",
        idempotencyKey: `e2e-rsn-${randomUUID()}`,
        params: { orderId: `ORD-E2E-RSN-${randomUUID().slice(0, 8)}`, customerId: "CUST-2", amount: 180, currency: "AED", reason: "Late delivery" },
        context: { rationale: { summary: "Customer is a gold-tier member", action: { tool: "issue-refund", action: "execute" }, steps: [{ statement: "Loyalty status confirmed", cites: ["crm-gold-7"] }], policyBasis: ["refund-authority"] } },
        principal: { type: "customer", ref: "CUST-2" },
        justification: "e2e",
      },
    });
    const body = (await res.json()) as { requestId: string; decision: string };
    expect(body.decision).toBe("require_approval");
    await login(page, OWNER);
    await page.goto(`/gateway/${body.requestId}`);
    await page.getByRole("link", { name: "Open in Decision Inspector" }).click();
    await page.waitForURL(/\/inspect$/);
    await expect(page.getByRole("heading", { level: 1, name: "Decision Inspector" })).toBeVisible();
    await expect(page.getByText("AEGIS has no access to a model's internal reasoning")).toBeVisible();
    const stages = page.getByTestId("inspector-stages");
    for (const key of ["received", "baseline", "policy", "uncertainty", "reasoning", "autonomy", "outcome", "approval"]) await expect(stages.locator(`[data-stage="${key}"]`)).toBeVisible();
    await expect(stages.locator('[data-stage="reasoning"]')).toHaveAttribute("data-status", "changed");
    await expect(page.getByTestId("inspector-rationale")).toContainText("Customer is a gold-tier member");
    await expect(page.locator('[data-indicator="citations"]')).toContainText("crm-gold-7");
    await expect(page.getByTestId("inspector-counterfactuals")).toContainText("would");
    await page.getByTestId("inspector-recheck").click();
    await expect(page.getByTestId("inspector-recheck-result")).toContainText("Nothing was changed");
    await page.getByTestId("inspector-record").click();
    await expect(page.getByTestId("inspector-record-digest")).toContainText(/sha256 [0-9a-f]{64}/);
  });

  test("rationale requirements are configured per tool, off by default for the demo scenarios", async ({ page }) => {
    await login(page, OWNER);
    await page.goto("/uncertainty");
    const form = page.getByTestId("reasoning-tool-form");
    await expect(form).toBeVisible();
    await page.locator("#rsn-tool").click();
    await page.getByRole("option", { name: /\(issue-refund\)/ }).click();
    await expect(page.locator("#rsn-enabled")).toHaveAttribute("aria-checked", "false");
    await expect(page.locator("#rsn-required")).toHaveAttribute("aria-checked", "true");
    await expect(page.locator("#rsn-cites")).toHaveAttribute("aria-checked", "true");
  });
});
