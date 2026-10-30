import { test, expect, type Page } from "@playwright/test";

const PASSWORD = "AegisDemo2026!";
const OWNER = "nadia.haddad@meridian-demo.example";
const VIEWER = "sara.khalil@meridian-demo.example";

test.setTimeout(180_000);

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/(overview|no-organization|platform|mfa)/);
}

const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

test.describe("change freezes", () => {
  test("an owner schedules a freeze, sees it listed, and ends it early with a reason", async ({ page }) => {
    await login(page, OWNER);
    await page.goto("/gateway");
    // Scheduled in the future so other browser tests running against the demo data are not frozen.
    const title = `Release freeze ${Date.now().toString(36)}`;
    await page.getByRole("button", { name: "Schedule freeze" }).click();
    await page.fill("#fz-title", title);
    await page.fill("#fz-start", local(new Date(Date.now() + 2 * 86_400_000)));
    await page.fill("#fz-end", local(new Date(Date.now() + 3 * 86_400_000)));
    await page.fill("#fz-reason", "Core banking upgrade weekend");
    await page.locator("#freeze-form").evaluate((f: HTMLFormElement) => f.requestSubmit());
    const row = page.getByTestId("freeze-row").filter({ hasText: title });
    await expect(row).toContainText("Scheduled");
    await expect(row).toContainText("Refuse changes");
    await row.getByRole("button", { name: "End early" }).click();
    await page.fill("#fz-reason", "Upgrade moved to next quarter");
    await page.getByRole("button", { name: "End freeze" }).click();
    await expect(row).toContainText("Ended early");
    await expect(row).toContainText("Upgrade moved to next quarter");
  });

  test("a viewer sees freezes but cannot schedule one", async ({ page }) => {
    await login(page, VIEWER);
    await page.goto("/gateway");
    await expect(page.getByRole("button", { name: "Schedule freeze" })).toBeDisabled();
  });
});
