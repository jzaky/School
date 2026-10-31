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

test.describe("assurance as owner", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, OWNER);
  });

  test("evidence ledger verifies the chain and exports JSON Lines", async ({ page }) => {
    await page.goto("/evidence");
    await expect(page.getByRole("heading", { level: 1, name: "Evidence Ledger" })).toBeVisible();
    await expect(page.locator("tbody tr")).toHaveCount(25);
    await page.getByRole("button", { name: "Verify chain now" }).click();
    await expect(page.getByText(/Chain valid: \d+ events recomputed/)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("chain-status")).toContainText("Chain valid");
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export JSON Lines" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/aegis-evidence-.*\.jsonl$/);
    const path = await download.path();
    const fs = await import("node:fs");
    const firstLine = fs.readFileSync(path!, "utf8").split("\n")[0] ?? "";
    expect(firstLine).toContain("aegisEvidenceExport");
    await expect(page.getByText(/SHA-256/)).toBeVisible();
    // Row click opens the detail sheet with the payload and a verification result.
    await page.locator("tbody tr").first().click();
    await expect(page.getByRole("dialog")).toContainText("Payload");
    await expect(page.getByRole("dialog").getByText(/Hash recomputed and verified/)).toBeVisible();
  });

  test("monitoring page shows 12 built-in rules and alert stats", async ({ page }) => {
    await page.goto("/monitoring");
    await expect(page.getByRole("heading", { level: 1, name: "Risk Monitoring" })).toBeVisible();
    await expect(page.locator("tbody tr[data-rule-key^='RM-']")).toHaveCount(12);
    await expect(page.locator("tbody tr").filter({ hasText: "built-in" })).toHaveCount(12);
    await expect(page.getByText("RM-010")).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Alert status" })).toBeVisible();
    await expect(page.getByRole("button", { name: "New custom rule" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Delete" }).first()).toBeDisabled();
  });

  test("reports page renders 30-day metrics and compliance evidence", async ({ page }) => {
    await page.goto("/reports");
    await expect(page.getByRole("heading", { level: 1, name: "Governance Reports" })).toBeVisible();
    await expect(page.getByText(/period 30 days/)).toBeVisible();
    for (const label of ["Actions evaluated", "Allowed", "Denied", "Approval required", "Executed", "Active policies", "Evidence events"]) {
      const panel = page.locator("div", { has: page.getByText(label, { exact: true }) }).filter({ hasText: /\d/ }).first();
      await expect(panel, label).toBeVisible();
    }
    await expect(page.getByText("Automatically observed").first()).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Observed technical controls" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Download JSON" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Print / Save as PDF" })).toBeEnabled();
    // The period links are soft navigations on a heavy page; a click that lands during a prefetch can be dropped, so retry.
    await expect(async () => {
      await page.getByRole("link", { name: "7 days" }).click();
      await page.waitForURL(/days=7/, { timeout: 10_000 });
    }).toPass({ timeout: 60_000 });
    await expect(page.getByText(/period 7 days/)).toBeVisible();
    await page.locator("section", { hasText: "Framework mapping" }).first().getByRole("link").first().click();
    await page.waitForURL(/\/reports\/frameworks\/[0-9a-f-]{36}/);
    await expect(page.locator("tbody tr").first()).toBeVisible();
  });

  test("policy history lists org-wide events with links", async ({ page }) => {
    await page.goto("/policy-history");
    await expect(page.getByRole("heading", { level: 1, name: "Policy History" })).toBeVisible();
    await expect(page.getByText("Historical versions are never overwritten")).toBeVisible();
    expect(await page.locator("tbody tr").count()).toBeGreaterThanOrEqual(10);
    await expect(page.locator("tbody tr").first().getByRole("link")).toHaveAttribute("href", /\/policies\/[0-9a-f-]{36}/);
  });

  test("live activity shows new rows after running the refund demo", async ({ page, context }) => {
    await page.goto("/activity");
    await expect(page.getByRole("heading", { level: 1, name: "Activity" })).toBeVisible();
    // The live ledger feed sits behind a collapsed details block on the redesigned Activity page.
    await page.getByTestId("ledger-feed").locator("summary").click();
    await expect(page.getByText(/Live, every 5 seconds/)).toBeVisible();
    const first = page.locator("li[data-seq]").first();
    await expect(first).toBeVisible();
    const before = Number(await first.getAttribute("data-seq"));
    const runner = await context.newPage();
    await runner.goto("/gateway/demos");
    const refunds = runner.locator("section", { hasText: "Refunds: tiers, duplicates" }).first();
    await refunds.getByRole("button", { name: "Run" }).click();
    await expect(refunds.getByText("Modified parameters after approval")).toBeVisible({ timeout: 90_000 });
    await runner.close();
    await expect(async () => {
      const seq = Number(await page.locator("li[data-seq]").first().getAttribute("data-seq"));
      expect(seq).toBeGreaterThan(before);
    }).toPass({ timeout: 20_000 });
    await expect(page.locator("li[data-seq]").filter({ hasText: "issue-refund" }).first()).toBeVisible();
  });
});
