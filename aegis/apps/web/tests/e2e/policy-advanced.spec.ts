import { test, expect, type Page } from "@playwright/test";

const PASSWORD = "AegisDemo2026!";
const OMAR = "omar.farouk@meridian-demo.example";
const NADIA = "nadia.haddad@meridian-demo.example";

test.setTimeout(180_000);

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/(overview|no-organization|platform|mfa)/);
}

test.describe("advanced policy management", () => {
  test("every policy shows whether it is actually enforced, and the conflicts tab explains its coverage", async ({ page }) => {
    await login(page, OMAR);
    await page.goto("/policies");
    await expect(page.locator('[data-enforcement="enforced"]').first()).toBeVisible();
    await page.getByRole("tab", { name: /Conflicts/ }).click();
    await expect(page.getByTestId("policy-conflicts")).toContainText("Each conflict below was confirmed by building an example request");
    await page.goto("/policies");
    await page.locator("tbody tr", { hasText: "Customer refund authority" }).first().click();
    await page.waitForURL(/\/policies\/[0-9a-f-]{36}/);
    await expect(page.getByTestId("policy-enforcement")).toHaveAttribute("data-state", "enforced");
  });

  test("an exception needs a second person: the requester cannot approve, another governance user can", async ({ page, browser }) => {
    await login(page, OMAR);
    await page.goto("/policies?tab=exceptions");
    const pending = page.getByTestId("policy-exceptions").locator('[data-state="requested"]').first();
    await expect(pending).toContainText("Quarter-end supplier settlements");
    await pending.getByRole("textbox").fill("Checked");
    await expect(pending.getByRole("button", { name: "Approve" })).toBeDisabled();
    await expect(page.getByTestId("policy-exceptions").locator('[data-state="expired"]').first()).toBeVisible();

    const other = await browser.newPage();
    await login(other, NADIA);
    await other.goto("/policies?tab=exceptions");
    const theirs = other.getByTestId("policy-exceptions").locator('[data-state="requested"]').first();
    await theirs.getByRole("textbox").fill("Approved for quarter end");
    await theirs.getByRole("button", { name: "Approve" }).click();
    await expect(other.getByTestId("policy-exceptions").locator('[data-state="active"]').first()).toContainText("Quarter-end");
    // Leave the demo as it was: revoke the exception again.
    const active = other.getByTestId("policy-exceptions").locator('[data-state="active"]').first();
    await active.getByRole("textbox").fill("Demo reset");
    await active.getByRole("button", { name: "Revoke now" }).click();
    await expect(other.getByTestId("policy-exceptions").locator('[data-state="revoked"]').first()).toBeVisible();
    await other.close();
  });

  test("a sector template previews its rules, passes its own tests and becomes a draft policy", async ({ page }) => {
    await login(page, OMAR);
    await page.goto("/policies?tab=templates");
    await page.getByTestId("sector-preview").click();
    await expect(page.getByTestId("sector-preview-tests")).toContainText("pass");
    await expect(page.getByTestId("sector-preview-tests")).not.toContainText("fail");
    const key = `secrets-guard-${Math.random().toString(36).replace(/[^a-z]/g, "").slice(0, 6)}`;
    await page.fill("#st-key", key);
    await page.fill("#st-name", "Secrets publishing guard (e2e)");
    await page.getByTestId("sector-create").click();
    await page.waitForURL(/\/policies\/[0-9a-f-]{36}/);
    await expect(page.getByTestId("policy-enforcement")).toHaveAttribute("data-state", "no_active_version");
  });
});
