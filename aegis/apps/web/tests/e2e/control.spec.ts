import { test, expect, type Page } from "@playwright/test";

const PASSWORD = "AegisDemo2026!";
const OWNER = "nadia.haddad@meridian-demo.example";
const APPROVER = "lina.mansour@meridian-demo.example";
const AUTHOR = "omar.farouk@meridian-demo.example";

test.setTimeout(180_000);

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/(overview|no-organization|platform|mfa)/);
}

async function openPolicy(page: Page, name: string) {
  await page.goto("/policies");
  const row = page.locator("tbody tr", { hasText: name }).first();
  await expect(row).toBeVisible();
  await row.click();
  await page.waitForURL(/\/policies\/[0-9a-f-]{36}/);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}

test.describe("control as owner", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, OWNER);
  });

  test("policies list shows 5 policies with active versions", async ({ page }) => {
    await page.goto("/policies");
    await expect(page.getByRole("heading", { level: 1, name: "Policies" })).toBeVisible();
    await expect(page.locator("tbody tr")).toHaveCount(5);
    await expect(page.locator("tbody tr", { hasText: "Customer refund authority" })).toContainText("v1");
    await expect(page.getByRole("button", { name: "New policy" })).toBeEnabled();
  });

  test("policy detail renders rules and the simulator returns approval required for AED 1,200", async ({ page }) => {
    await openPolicy(page, "Customer refund authority");
    const tabs = page.getByRole("tablist", { name: "Policy sections" });
    await expect(page.getByRole("tabpanel")).toContainText("supervisor-500-2500");
    await expect(page.getByRole("tabpanel")).toContainText("params.amount");
    await expect(page.getByRole("tabpanel").getByText("Require approval").first()).toBeVisible();
    await tabs.getByRole("tab", { name: /^Simulate/ }).click();
    const panel = page.getByRole("tabpanel");
    await expect(panel.locator("#sim-tool")).toHaveValue("issue-refund");
    await expect(panel.locator("#sim-params")).toContainText("1200");
    await panel.getByRole("button", { name: "Simulate" }).click();
    await expect(panel.getByText("Approval required").first()).toBeVisible();
    await expect(panel.getByText(/Deciding rule/)).toContainText("supervisor-500-2500");
    await expect(panel.getByRole("table", { name: "Evaluation trace" })).toContainText("between");
  });

  test("gateway list paginates and a row opens the decision trace", async ({ page }) => {
    await page.goto("/gateway");
    await expect(page.getByRole("heading", { level: 1, name: "Action Gateway" })).toBeVisible();
    await expect(page.locator("tbody tr")).toHaveCount(25);
    await expect(page.getByText(/1 to 25 of \d+/)).toBeVisible();
    await page.getByRole("button", { name: "Next page" }).click();
    await page.waitForURL(/page=2/);
    await expect(page.getByText(/26 to 50 of \d+/)).toBeVisible();
    await page.goto("/gateway?status=denied");
    const row = page.locator("tbody tr").first();
    await expect(row).toBeVisible();
    await row.click();
    await page.waitForURL(/\/gateway\/[0-9a-f-]{36}/);
    await expect(page.getByRole("heading", { level: 2, name: "Decision" })).toBeVisible();
    await expect(page.getByText("Denied").first()).toBeVisible();
    await expect(page.getByRole("table", { name: "Decision trace" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Evidence" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Pause gateway" })).toHaveCount(0);
  });

  test("emergency controls are enabled for the owner", async ({ page }) => {
    await page.goto("/gateway");
    await expect(page.getByRole("button", { name: "Pause gateway" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Suspend agent" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Revoke credential" })).toBeEnabled();
  });

  test("approvals pending shows the AED 250,000 transfer", async ({ page }) => {
    await page.goto("/approvals");
    await expect(page.getByRole("heading", { level: 1, name: "Human Approval Center" })).toBeVisible();
    if ((await page.getByText("AED 250,000.00").count()) === 0) {
      // The seeded approval expires four hours after seeding; recreate it through the real gateway.
      await page.goto("/gateway/demos");
      const banking = page.locator("section", { hasText: "Banking: transfer limits" }).first();
      await banking.getByRole("button", { name: "Run" }).click();
      await expect(banking.getByText("Waiting for a manager in the Approval Center")).toBeVisible({ timeout: 60_000 });
      await page.goto("/approvals");
    }
    await expect(page.getByText("AED 250,000.00").first()).toBeVisible();
    await expect(page.getByRole("tab", { name: /^Pending/ })).toHaveAttribute("data-state", "active");
  });

  test("integrations list links to a detail page with credentials and webhook setup", async ({ page }) => {
    await page.goto("/integrations");
    await expect(page.getByRole("button", { name: "New integration" })).toBeEnabled();
    await page.getByRole("link", { name: /Core Banking/ }).click();
    await page.waitForURL(/\/integrations\/[0-9a-f-]{36}/);
    await expect(page.getByRole("heading", { level: 2, name: "Credentials" })).toBeVisible();
    await expect(page.getByText("X-Aegis-Signature").first()).toBeVisible();
    await expect(page.getByText("Simulated system activity").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Disable integration" })).toBeEnabled();
  });

  test("alerts page acknowledges an open alert", async ({ page }) => {
    await page.goto("/alerts");
    await expect(page.getByRole("heading", { level: 1, name: "Alerts" })).toBeVisible();
    const row = page.locator("tbody tr").first();
    await expect(row).toContainText("Open");
    const title = (await row.locator("td").nth(2).textContent())?.trim() ?? "";
    await row.getByRole("button", { name: "Acknowledge" }).click();
    await expect(page.getByText("Alert acknowledged")).toBeVisible();
    await page.goto("/alerts?status=acknowledged");
    await expect(page.locator("tbody tr", { hasText: title.slice(0, 40) }).first()).toContainText("Acknowledged");
  });
});

test.describe("control as approver", () => {
  test("Lina approves the AED 250,000 transfer and sees the receipt, then the request is Executed", async ({ page }) => {
    await login(page, APPROVER);
    // A fresh pending transfer, created through the real gateway, so the test is repeatable.
    await page.goto("/gateway/demos");
    await expect(page.getByText("Leave approvals pending for the Approval Center")).toBeVisible();
    const banking = page.locator("section", { hasText: "Banking: transfer limits" }).first();
    await banking.getByRole("button", { name: "Run" }).click();
    await expect(banking.getByText("Waiting for a manager in the Approval Center")).toBeVisible({ timeout: 60_000 });
    const approvalLink = banking.getByRole("link", { name: "approval" }).first();
    await approvalLink.click();
    await page.waitForURL(/\/approvals\/[0-9a-f-]{36}/);
    await expect(page.getByText("AED 250,000.00").first()).toBeVisible();
    await expect(page.getByRole("radio", { name: "Approve" })).toBeEnabled();
    await page.getByRole("radio", { name: "Approve" }).click();
    await page.fill("#decision-comment", "Beneficiary and instruction verified with treasury (e2e)");
    await page.getByRole("button", { name: "Approve and execute" }).click();
    const reference = page.getByTestId("receipt-reference");
    await expect(reference).toBeVisible({ timeout: 30_000 });
    await expect(reference).toContainText(/^TRF-/);
    await page.getByRole("link", { name: "Open the action request" }).click();
    await page.waitForURL(/\/gateway\/[0-9a-f-]{36}/);
    await expect(page.locator("h1 ~ *").getByText("Executed").first().or(page.getByText("Executed").first())).toBeVisible();
    await expect(page.getByText(/reference/).first()).toBeVisible();
  });
});

test.describe("control as policy author", () => {
  test("Omar cannot activate his own new draft version (four-eyes)", async ({ page }) => {
    await login(page, AUTHOR);
    await openPolicy(page, "Read-only tool defaults");
    await page.getByRole("tablist", { name: "Policy sections" }).getByRole("tab", { name: /^Editor/ }).click();
    const textarea = page.locator("#policy-json");
    const doc = JSON.parse((await textarea.inputValue()) || "{}") as { rules: { description?: string }[] };
    doc.rules[0]!.description = `e2e revision ${Date.now()}`;
    await textarea.fill(JSON.stringify(doc, null, 2));
    await expect(page.getByText(/Valid policy document/)).toBeVisible();
    await page.getByRole("button", { name: "New version from this document" }).click();
    await page.fill("#nv-note", "e2e: four-eyes check");
    await page.getByRole("button", { name: "Create draft" }).click();
    await page.waitForURL(/v=[0-9a-f-]{36}/);
    await expect(page.getByText(/^v\d+: Draft$/)).toBeVisible();
    const activate = page.getByRole("button", { name: /^Activate v\d+/ });
    await expect(activate).toBeDisabled();
    await expect(async () => {
      await page.mouse.move(0, 0);
      await activate.locator("xpath=..").hover();
      await expect(page.getByRole("tooltip").filter({ hasText: "Four-eyes: the author cannot activate" }).first()).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 20_000 });
  });
});
