import { test, expect, type Page } from "@playwright/test";

/** The personas' password: the published demo password, or the one a staging seed set (E2E_PERSONA_PASSWORD). */
const PASSWORD = process.env.E2E_PERSONA_PASSWORD || "AegisDemo2026!";
const NADIA = "nadia.haddad@meridian-demo.example";
const VIEWER = "sara.khalil@meridian-demo.example";

test.setTimeout(180_000);

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/(overview|no-organization|platform|mfa)/);
}

test.describe("control center", () => {
  test("every tile names its source and opens the page with the rows behind it", async ({ page }) => {
    await login(page, NADIA);
    await page.goto("/control-center");
    const tiles = page.getByTestId("cc-tile");
    await expect(tiles.first()).toBeVisible();
    expect(await tiles.count()).toBeGreaterThanOrEqual(10);
    for (const t of await tiles.all()) await expect(t).toContainText("Source:");
    await page.locator('[data-tile="security-events"] a').click();
    await page.waitForURL(/\/security/);
  });

  test("a viewer sees only the tiles their role can read", async ({ page }) => {
    await login(page, VIEWER);
    await page.goto("/control-center");
    await expect(page.getByTestId("cc-tile").first()).toBeVisible();
    await expect(page.locator('[data-tile="destinations"]')).toHaveCount(0);
  });

  test("system health reports each check with a status", async ({ page }) => {
    await login(page, NADIA);
    await page.goto("/org/health");
    const list = page.getByTestId("health-checks");
    for (const key of ["database", "worker", "jobs", "gateway"]) await expect(list.locator(`[data-check="${key}"]`)).toHaveAttribute("data-status", /^(ok|warning|failing|unknown)$/);
    await expect(list.locator('[data-check="database"]')).toHaveAttribute("data-status", "ok");
  });

  test("theme toggle switches between dark, light and system and survives a reload", async ({ page }) => {
    await login(page, NADIA);
    await page.goto("/control-center");
    const html = page.locator("html");
    await expect(html).toHaveAttribute("data-theme", "dark");
    const toggle = page.getByTestId("theme-toggle");
    await toggle.click();
    await expect(toggle).toHaveAttribute("data-theme-choice", "light");
    await expect(html).toHaveAttribute("data-theme", "light");
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe("rgb(245, 247, 251)");
    await page.reload();
    await expect(html).toHaveAttribute("data-theme", "light");
    await page.getByTestId("theme-toggle").click();
    await expect(page.getByTestId("theme-toggle")).toHaveAttribute("data-theme-choice", "system");
    await page.getByTestId("theme-toggle").click();
    await expect(page.getByTestId("theme-toggle")).toHaveAttribute("data-theme-choice", "dark");
    await expect(html).toHaveAttribute("data-theme", "dark");
  });

  test("keyboard shortcuts: ? lists them and g then c opens the control center", async ({ page }) => {
    await login(page, NADIA);
    await page.goto("/overview");
    await page.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => undefined);
    await page.keyboard.press("Shift+Slash");
    await expect(page.getByTestId("shortcut-list")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("shortcut-list")).toHaveCount(0);
    await page.keyboard.press("g");
    await page.keyboard.press("c");
    await page.waitForURL(/\/control-center/);
    await expect(page.getByTestId("cc-tile").first()).toBeVisible();
    await page.keyboard.press("g");
    await page.keyboard.press("g");
    await page.waitForURL(/\/gateway/);
  });
});
