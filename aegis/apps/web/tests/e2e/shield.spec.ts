import { test, expect, type Page } from "@playwright/test";

// The dev server compiles each route on first visit (10 to 30 s), so give every test room.
test.describe.configure({ timeout: 180_000 });
const SLOW = { timeout: 60_000 };

const PASSWORD = "AegisDemo2026!";
const ANALYST = "tariq.saleh@meridian-demo.example";
const VIEWER = "sara.khalil@meridian-demo.example";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/(overview|no-organization|platform|mfa)/);
}

/** Rows are server rendered before React hydrates, so a click can land before the handler exists. Click the first cell (never a link) and retry until the effect shows. */
async function clickRowUntilUrl(page: Page, row: ReturnType<Page["locator"]>, url: RegExp) {
  await expect(row).toBeVisible();
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await expect(async () => {
    await row.locator("td").first().click();
    await page.waitForURL(url, { timeout: 30_000 });
  }).toPass({ timeout: 150_000 });
}

async function pickSelect(page: Page, trigger: ReturnType<Page["locator"]>, optionText: string | RegExp) {
  await trigger.click();
  await page.getByRole("option", { name: optionText }).click();
}

test.describe("security analyst", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, ANALYST);
  });

  test("security events list renders and an open event can be triaged", async ({ page }) => {
    await page.goto("/security/events");
    await expect(page.getByRole("heading", { level: 1, name: "Security Events" })).toBeVisible();
    const rows = page.locator("tbody tr");
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeGreaterThanOrEqual(1);
    await expect(page.getByText("Last 24 hours")).toBeVisible();

    await page.goto("/security/events?status=open");
    const openRows = page.locator("tbody tr");
    await expect(openRows.first()).toBeVisible();
    await clickRowUntilUrl(page, openRows.first(), /\/security\/events\/[0-9a-f-]{36}/);
    await expect(page.getByText("Decision explanation")).toBeVisible();
    await page.getByRole("button", { name: "Triage", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Note").fill("E2E: reviewed, expected behaviour for the demo tenant");
    await dialog.getByRole("button", { name: "Mark triaged" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(/Triaged by Tariq Saleh/)).toBeVisible(SLOW);
  });

  test("data protection toggles a class action and the sample test masks a card number", async ({ page }) => {
    await page.goto("/security/data-protection");
    await expect(page.getByRole("heading", { level: 1, name: "Data Protection" })).toBeVisible();
    const cardAction = page.getByRole("combobox", { name: "Action for Payment card number" });
    await expect(cardAction).toContainText("Block");
    await pickSelect(page, cardAction, "Mask");
    await expect(page.getByText("Payment card number: action set to Mask")).toBeVisible(SLOW);
    await expect(cardAction).toContainText("Mask");

    await page.locator("#sample-text").fill("Refund card 4111 1111 1111 1111 for the customer.");
    await page.getByRole("button", { name: "Run inspector" }).click();
    const findings = page.locator("table", { has: page.getByText("Masked preview") });
    await expect(findings).toContainText("card_number");
    await expect(page.getByText("Rewritten and allowed")).toBeVisible();
    const rewritten = page.locator("pre").filter({ hasText: /1111/ }).first();
    await expect(rewritten).toBeVisible();
    const text = (await rewritten.textContent()) ?? "";
    expect(text).not.toContain("4111 1111 1111 1111");
    expect(text).toMatch(/\*{4}/);

    // Restore the demo default so later runs start from the same state.
    await pickSelect(page, cardAction, "Block");
    await expect(page.getByText("Payment card number: action set to Block")).toBeVisible(SLOW);
  });

  test("tool security evaluate reports a failed destination check for an external domain", async ({ page }) => {
    await page.goto("/security/tools");
    await expect(page.getByRole("heading", { level: 1, name: "Tool Security" })).toBeVisible();
    await expect(page.locator("tbody tr", { hasText: "export-customer-records" })).toBeVisible();
    await page.locator("#eval-agent").click();
    await page.getByPlaceholder("Search agents").fill("Marketing");
    await page.getByRole("option", { name: /Marketing Outreach Agent/ }).click();
    await pickSelect(page, page.locator("#eval-tool"), "export-customer-records");
    await page.locator("#eval-dest").fill("files.partner-upload.example");
    await page.locator("#eval-params").fill('{"segment": "vip", "destination": "https://files.partner-upload.example/inbox"}');
    await page.getByRole("button", { name: "Evaluate", exact: true }).click();
    const report = page.getByTestId("tool-security-report");
    await expect(report).toBeVisible(SLOW);
    await expect(report.locator('[data-check="Grant"]')).toHaveAttribute("data-mark", "pass");
    await expect(report.locator('[data-check="Destination check"]')).toHaveAttribute("data-mark", "fail");
    await expect(report.getByText("Would be denied")).toBeVisible();
    await expect(report.getByText(/mirrors the gateway/)).toBeVisible();
  });

  test("incident moves from open to investigating with a note", async ({ page }) => {
    await page.goto("/security/incidents?status=open");
    await expect(page.getByRole("heading", { level: 1, name: "Incident Center" })).toBeVisible();
    await expect(page.locator("table")).toBeVisible();
    const rows = page.locator('tbody tr[role="link"]');
    if ((await rows.count()) === 0) {
      await page.getByRole("button", { name: "New incident" }).click();
      const create = page.getByRole("dialog");
      await create.getByLabel("Title").fill(`E2E incident ${Date.now()}`);
      await create.getByRole("button", { name: "Open incident" }).click();
      await page.waitForURL(/\/security\/incidents\/[0-9a-f-]{36}/);
    } else {
      await clickRowUntilUrl(page, rows.first(), /\/security\/incidents\/[0-9a-f-]{36}/);
    }
    const header = page.locator("h1").locator("..").locator("..");
    await expect(header.getByText("Open", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "Investigate" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Note").fill("E2E: starting the investigation");
    await dialog.getByRole("button", { name: "Investigate" }).click();
    await expect(dialog).toBeHidden();
    await expect(header.getByText("Investigating", { exact: true }).first()).toBeVisible(SLOW);
    await expect(page.getByText("Moved to investigating").first()).toBeVisible();
    await expect(page.getByText("E2E: starting the investigation").first()).toBeVisible();
  });
});

test.describe("viewer", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, VIEWER);
  });

  test("triage is disabled with a permission tooltip", async ({ page }) => {
    await page.goto("/security/events");
    await clickRowUntilUrl(page, page.locator('tbody tr[role="link"]').first(), /\/security\/events\/[0-9a-f-]{36}/);
    const triage = page.getByRole("button", { name: "Triage", exact: true });
    await expect(triage).toBeDisabled();
    await expect(async () => {
      await page.mouse.move(0, 0);
      await triage.locator("..").hover();
      await expect(page.getByRole("tooltip").filter({ hasText: /Requires security:write|managed through their incident/ }).first()).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 20_000 });
    await page.goto("/security/data-protection");
    await expect(page.getByRole("combobox", { name: "Action for Payment card number" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Custom class" })).toBeDisabled();
  });
});
