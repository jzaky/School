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

test.describe("replay calibration", () => {
  test("the active refund policy replays with no changes, and a stricter unsaved threshold shows which requests would change", async ({ page }) => {
    await login(page, OWNER);
    await page.goto("/policies");
    await page.locator("tbody tr", { hasText: "Customer refund authority" }).first().click();
    await page.waitForURL(/\/policies\/[0-9a-f-]{36}/);
    const tabs = page.getByRole("tablist", { name: "Policy sections" });

    // Replay tab: the active version against the last 30 days produces the recorded outcomes.
    await tabs.getByRole("tab", { name: "Replay" }).click();
    const replay = page.getByRole("tabpanel").getByTestId("policy-replay");
    await replay.getByTestId("replay-run").click();
    const outcomes = replay.getByRole("table", { name: "Outcomes before and after" });
    await expect(outcomes).toBeVisible({ timeout: 120_000 });
    await expect(replay.getByText("Requests replayed")).toBeVisible();
    await expect(replay.getByText("Outcomes that change")).toBeVisible();
    await expect(replay.getByText("Same decisions as recorded")).toBeVisible();
    await expect(replay.getByText("Nothing was recorded")).toBeVisible();

    // Thresholds tab: lowering the autonomous limit to AED 50 turns small refunds into approvals.
    await tabs.getByRole("tab", { name: "Thresholds" }).click();
    const panel = page.getByRole("tabpanel");
    await panel.locator("#th-auto").fill("50");
    const draftReplay = panel.getByTestId("policy-replay");
    await expect(draftReplay.getByText("Replays recent requests against the unsaved thresholds above")).toBeVisible();
    await draftReplay.getByTestId("replay-run").click();
    const changes = draftReplay.getByRole("table", { name: "Requests whose outcome changes" });
    await expect(changes).toBeVisible({ timeout: 120_000 });
    await expect(changes.locator("tbody tr").first()).toContainText("Approval required");
    await expect(changes.locator("tbody tr").first()).toContainText("refund-authority/approval-band");
  });
});
