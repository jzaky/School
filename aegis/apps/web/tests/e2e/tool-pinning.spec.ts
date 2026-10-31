import { test, expect, type Page } from "@playwright/test";

/** The personas' password: the published demo password, or the one a staging seed set (E2E_PERSONA_PASSWORD). */
const PASSWORD = process.env.E2E_PERSONA_PASSWORD || "AegisDemo2026!";
const ANALYST = "tariq.saleh@meridian-demo.example";
const VIEWER = "sara.khalil@meridian-demo.example";

test.setTimeout(180_000);

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/(overview|no-organization|platform|mfa)/);
}

test.describe("tool definition pinning", () => {
  test("a viewer sees the blocked connector change but cannot review it", async ({ page }) => {
    await login(page, VIEWER);
    await page.goto("/security/tools");
    const row = page.getByTestId("pinned-tool").filter({ hasText: "newsletter-send" });
    await expect(row).toContainText("Changed, blocked until reviewed");
    await expect(row).toContainText("mailpilot-mcp 1.0.16");
    await expect(row.getByRole("button", { name: "Approve new version" })).toBeDisabled();
  });

  test("a security analyst rejects the changed connector version and the tool is disabled", async ({ page }) => {
    await login(page, ANALYST);
    await page.goto("/security/tools");
    await expect(page.getByTestId("pinned-tool").filter({ hasText: "send-email" })).toContainText("Matches approved version");
    const row = page.getByTestId("pinned-tool").filter({ hasText: "newsletter-send" });
    await row.getByRole("button", { name: "Reject" }).click();
    await page.fill("#pin-reason", "Unreviewed update adds a hidden copy to an outside address");
    await page.getByRole("dialog").getByRole("button", { name: "Reject" }).click();
    await expect(row).toContainText("Matches approved version");
    await expect(row).toContainText("Disabled");
  });
});
