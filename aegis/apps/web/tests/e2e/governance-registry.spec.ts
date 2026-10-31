import { test, expect, type Page } from "@playwright/test";

/** The personas' password: the published demo password, or the one a staging seed set (E2E_PERSONA_PASSWORD). */
const PASSWORD = process.env.E2E_PERSONA_PASSWORD || "AegisDemo2026!";
const OMAR = "omar.farouk@meridian-demo.example";
const TARIQ = "tariq.saleh@meridian-demo.example";
const NADIA = "nadia.haddad@meridian-demo.example";
const HANA = "hana.youssef@meridian-demo.example";

test.setTimeout(180_000);

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/(overview|no-organization|platform|mfa)/);
}

test.describe("model and data governance", () => {
  test("the model registry shows every stage, and a governance manager approves the model an engineer sent for approval", async ({ page }) => {
    await login(page, OMAR);
    await page.goto("/governance/models");
    await expect(page.getByRole("heading", { level: 1, name: "Models" })).toBeVisible();
    for (const [key, stage] of [["claude-sonnet", "approved"], ["claude-haiku", "deprecated"], ["claude-sonnet-legacy", "retired"], ["gemini-pro", "proposed"]] as const) {
      await expect(page.locator(`[data-model="${key}"]`)).toContainText(stage);
    }
    await expect(page.locator('[data-model="claude-opus"]')).toContainText("review overdue");
    // Every live demo agent is linked; the archived legacy bot is out of scope.
    await expect(page.getByTestId("unlinked-agents")).toHaveCount(0);
    await page.locator('[data-model="gpt-5"]').getByRole("link").click();
    await page.waitForURL(/\/governance\/models\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId("model-evaluations")).toContainText("privacy");
    await page.fill("#ml-note", "Evaluations reviewed; approved for outreach drafts");
    await page.getByTestId("model-approve").click();
    await expect(page.getByTestId("model-history")).toContainText("evaluating to approved");
    await expect(page.getByTestId("model-lifecycle").getByRole("button", { name: "Deprecate" })).toBeVisible();
  });

  test("a failing evaluation blocks approval, with the reason on the button", async ({ page }) => {
    await login(page, OMAR);
    await page.goto("/governance/models");
    await page.locator('[data-model="gemini-pro"]').getByRole("link").click();
    await page.waitForURL(/\/governance\/models\/[0-9a-f-]{36}$/);
    await expect(page.getByText("Before approval: The latest bias evaluation failed.")).toBeVisible();
    await expect(page.getByTestId("model-request-approval")).toBeDisabled();
  });

  test("the data inventory flags gaps, and a deletion request needs a second person", async ({ page, browser }) => {
    await login(page, TARIQ);
    await page.goto("/governance/data");
    await expect(page.locator('[data-dataset="marketing-contacts"]')).toContainText("No retention period");
    await expect(page.locator('[data-dataset="customer-accounts"]')).toContainText("complete");
    await page.locator('[data-dataset="support-tickets"]').getByRole("link").click();
    await page.waitForURL(/\/governance\/data\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId("dataset-access")).toContainText("Support Refund Agent");
    const pending = page.getByTestId("deletion-requests").locator('[data-status="requested"]');
    await expect(pending).toContainText("subject ending 0917");
    await pending.getByRole("textbox").fill("Checked");
    await expect(pending.getByRole("button", { name: "Approve" })).toBeDisabled();

    const other = await browser.newPage();
    await login(other, NADIA);
    await other.goto(page.url());
    const theirs = other.getByTestId("deletion-requests").locator('[data-status="requested"]');
    await theirs.getByRole("textbox").fill("Identity confirmed");
    await theirs.getByRole("button", { name: "Approve" }).click();
    const approved = other.getByTestId("deletion-requests").locator('[data-status="approved"]');
    await approved.getByRole("textbox").fill("TICKETS-ERASE-7781");
    await approved.getByRole("button", { name: "Record completion" }).click();
    await expect(other.getByTestId("deletion-requests").locator('[data-status="completed"]').first()).toContainText("TICKETS-ERASE-7781");
    await other.close();
  });

  test("the regulatory register tracks impact and actions, and a new change can be recorded and assessed", async ({ page }) => {
    await login(page, HANA);
    await page.goto("/governance/regulatory");
    await expect(page.getByText("AEGIS does not monitor regulators")).toBeVisible();
    const rows = page.getByTestId("regulatory-row");
    await expect(rows.filter({ hasText: "EU AI Act" })).toContainText("implemented");
    await rows.filter({ hasText: "Supervisory guidance" }).getByRole("link").click();
    await page.waitForURL(/\/governance\/regulatory\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId("regulatory-tasks")).toContainText("fraud score above 0.4");
    await expect(page.getByRole("checkbox", { name: "Support Refund Agent" })).toBeChecked();

    await page.goto("/governance/regulatory");
    await page.getByTestId("regulatory-create-open").click();
    await page.fill("#r-title", "Revised outsourcing notification rule (e2e)");
    await page.fill("#r-source", "Illustrative regulator");
    await page.fill("#r-summary", "Notify the supervisor before moving personal data processing to a new provider.");
    await page.getByTestId("regulatory-create-submit").click();
    await page.waitForURL(/\/governance\/regulatory\/[0-9a-f-]{36}$/);
    await page.locator("#as-status").click();
    await page.getByRole("option", { name: "Not applicable" }).click();
    await page.fill("#as-note", "No provider change is planned this year");
    await page.getByTestId("assessment-save").click();
    await expect(page.getByText("not applicable").first()).toBeVisible();
  });
});
