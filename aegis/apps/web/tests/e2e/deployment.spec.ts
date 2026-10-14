import { test, expect, type Page } from "@playwright/test";

const PASSWORD = "AegisDemo2026!";
const NADIA = "nadia.haddad@meridian-demo.example";
const AUDITOR = "hana.youssef@meridian-demo.example";

test.setTimeout(180_000);

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/(overview|no-organization|platform|mfa)/);
}

test.describe("deployment and regional settings", () => {
  test("without an attested manifest the page makes no residency claim and shows live isolation checks", async ({ page }) => {
    await login(page, AUDITOR);
    await page.goto("/org/deployment");
    const residency = page.getByTestId("residency");
    await expect(residency).toHaveAttribute("data-claim", "none");
    await expect(page.getByTestId("residency-statement")).toContainText("AEGIS makes no AE data residency claim");
    const checks = page.getByTestId("readiness");
    await expect(checks.locator('[data-key="app_role"]')).toHaveAttribute("data-status", "ok");
    await expect(checks.locator('[data-key="app_role"]')).toHaveAttribute("data-basis", "live");
    await expect(checks.locator('[data-key="rls"]')).toHaveAttribute("data-status", "ok");
    await expect(checks.locator('[data-key="append_only"]')).toHaveAttribute("data-status", "ok");
    await expect(checks.locator('[data-key="storage_encryption"]')).toHaveAttribute("data-status", "unknown");
    await expect(page.getByTestId("deployment-options").locator("[data-option]")).toHaveCount(4);
    await expect(page.getByTestId("regional-settings")).toContainText("Asia/Dubai");
  });

  test("the console switches to Arabic, right to left, and back", async ({ page }) => {
    await login(page, NADIA);
    await page.goto("/control-center");
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByTestId("language-switch").click();
    await expect(page.locator("[data-locale]").first()).toHaveAttribute("data-locale", "ar");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("مركز التحكم");
    await expect(page.locator('[data-nav-item="/overview"]').first()).toContainText("نظرة عامة");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await page.goto("/org/deployment");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("النشر");
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByTestId("language-switch").click();
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Deployment");
  });
});
