import { test, expect, type Page } from "@playwright/test";

// The dev server compiles each route on first visit (10 to 30 s), so give every test room.
test.describe.configure({ timeout: 180_000 });
const SLOW = { timeout: 60_000 };

const PASSWORD = "AegisDemo2026!";
const AUDITOR = "hana.youssef@meridian-demo.example";
const VIEWER = "sara.khalil@meridian-demo.example";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/(overview|no-organization|platform|mfa)/);
}

/** Rows are server rendered before React hydrates, so a click can land before the handler exists. Retry until the effect shows. */
async function clickRowUntilUrl(page: Page, row: ReturnType<Page["locator"]>, url: RegExp) {
  await expect(async () => {
    await row.click();
    await page.waitForURL(url, { timeout: 5_000 });
  }).toPass({ timeout: 90_000 });
}

async function clickRowUntilVisible(row: ReturnType<Page["locator"]>, target: ReturnType<Page["locator"]>) {
  await expect(async () => {
    await row.click();
    await expect(target).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 90_000 });
}

async function pickSelect(page: Page, trigger: ReturnType<Page["locator"]>, optionText: string | RegExp) {
  await trigger.click();
  await page.getByRole("option", { name: optionText }).click();
}

const MARKDOWN = `# E2E Access Control Procedure

## Purpose
This procedure defines how access to AI systems shall be requested, approved and reviewed.

## Requirements
Access requests must be approved by the system owner before provisioning. Privileged access shall be reviewed quarterly by the security team and the results recorded. Accounts that are no longer required must be removed within five working days.

## Monitoring
Access events are logged to the evidence ledger and reviewed monthly. Deviations are raised as incidents and tracked to closure.
`;

test.describe("auditor", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, AUDITOR);
  });

  test("documents page lists the parsed demo documents", async ({ page }) => {
    await page.goto("/audit/documents");
    await expect(page.getByRole("heading", { level: 1, name: "Documents" })).toBeVisible();
    await expect(page.getByText("Documents never leave this deployment.")).toBeVisible();
    const parsedRows = page.locator("tbody tr", { hasText: "Parsed" });
    await expect(parsedRows.first()).toBeVisible();
    expect(await parsedRows.count()).toBeGreaterThanOrEqual(3);
    for (const title of ["AI Governance Policy", "Information Security Policy", "Incident Response Procedure"]) {
      await expect(page.locator("tbody tr", { hasText: title })).toBeVisible();
    }
  });

  test("upload a markdown document, see it parsed with chunks, then delete it", async ({ page }) => {
    await page.goto("/audit/documents");
    await page.getByRole("button", { name: "Upload document" }).click();
    const dialog = page.getByRole("dialog");
    const title = `E2E Access Control Procedure ${Date.now()}`;
    await dialog.locator("#doc-file").setInputFiles({ name: "e2e-access-control.md", mimeType: "text/markdown", buffer: Buffer.from(MARKDOWN, "utf8") });
    await dialog.locator("#doc-title").fill(title);
    await dialog.getByRole("button", { name: "Upload and parse" }).click();
    const result = dialog.getByTestId("upload-result");
    await expect(result).toBeVisible({ timeout: 60_000 });
    const text = (await result.textContent()) ?? "";
    const m = text.match(/parsed: (\d+) chunks/);
    expect(m, text).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThan(0);
    await dialog.getByRole("button", { name: "Done" }).click();
    const row = page.locator("tbody tr", { hasText: title });
    await expect(row).toBeVisible();
    await expect(row).toContainText("Parsed", SLOW);

    // Tidy up: open the sheet, confirm the chunk preview, delete the document.
    const sheet = page.getByRole("dialog");
    await clickRowUntilVisible(row, sheet.getByText(/First chunks/));
    await expect(sheet.locator("pre").first()).toContainText("Access Control Procedure");
    await sheet.getByRole("button", { name: "Delete document" }).click();
    const confirm = page.getByRole("dialog").filter({ hasText: `Delete ${title}` });
    await confirm.getByRole("button", { name: "Delete document" }).click();
    await expect(confirm).toBeHidden();
    await expect(page.locator("tbody tr", { hasText: title })).toHaveCount(0, SLOW);
  });

  test("assessments list shows two completed assessments", async ({ page }) => {
    await page.goto("/audit/assessments");
    await expect(page.getByRole("heading", { level: 1, name: "Assessments" })).toBeVisible();
    const completed = page.locator("tbody tr", { hasText: "Completed" });
    await expect(completed.first()).toBeVisible();
    expect(await completed.count()).toBeGreaterThanOrEqual(2);
    await expect(page.locator("tbody tr", { hasText: "ISO/IEC 42001" })).toBeVisible();
    await expect(page.locator("tbody tr", { hasText: "NIST AI RMF" })).toBeVisible();
  });

  test("assessment detail shows the disclaimer, a cited excerpt, and a finding can be validated", async ({ page }) => {
    await page.goto("/audit/assessments");
    await clickRowUntilUrl(page, page.locator("tbody tr", { hasText: "ISO/IEC 42001" }).first(), /\/audit\/assessments\/[0-9a-f-]{36}/);
    await expect(page.getByTestId("assessment-disclaimer")).toContainText("Similarity is not proof of compliance");
    await page.getByRole("button", { name: "Expand all" }).click();
    const artifact = page.locator('[data-artifact="document"]').first();
    await expect(artifact).toBeVisible();
    await expect(artifact).toContainText("lexical similarity");
    await expect(artifact.locator("blockquote")).not.toBeEmpty();

    // Validate the finding that owns that artifact.
    const finding = artifact.locator("xpath=ancestor::li[@data-finding]");
    const code = await finding.getAttribute("data-finding");
    await pickSelect(page, finding.locator('[id^="hv-status-"]'), "Partial");
    await finding.locator('[id^="hv-note-"]').fill("E2E: confirmed against the cited passage");
    await finding.getByRole("button", { name: "Validate" }).click();
    await expect(page.getByText(`${code} validated as partial`)).toBeVisible(SLOW);
    const refreshed = page.locator(`li[data-finding="${code}"]`);
    await expect(refreshed.getByText("Human validated").first()).toBeVisible(SLOW);
    await expect(refreshed.getByText(/Validated by Hana Youssef/)).toBeVisible();
  });

  test("generate a JSON report and download it", async ({ page }) => {
    await page.goto("/audit/assessments");
    await clickRowUntilUrl(page, page.locator("tbody tr", { hasText: "NIST AI RMF" }).first(), /\/audit\/assessments\/[0-9a-f-]{36}/);
    const form = page.getByTestId("generate-report-form");
    await pickSelect(page, form.locator("#rep-kind"), "Gap report");
    await pickSelect(page, form.locator("#rep-format"), "JSON");
    await form.getByRole("button", { name: "Generate report" }).click();
    await expect(page.getByText(/Gap report generated/)).toBeVisible(SLOW);
    const row = page.locator("tr[data-export]", { hasText: "Gap report" }).filter({ hasText: "JSON" }).first();
    await expect(row).toBeVisible(SLOW);
    const href = await row.getByRole("link", { name: "Download" }).getAttribute("href");
    expect(href).toMatch(/\/audit\/reports\/download\/[0-9a-f-]{36}/);
    const res = await page.request.get(href!);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("application/json");
    const body = await res.json();
    expect(body.kind).toBe("gap_report");
    expect(body.disclaimer).toContain("Similarity is not proof of compliance");
    expect(Array.isArray(body.findings)).toBe(true);
    for (const f of body.findings) expect(["Automated", "Human validated"]).toContain(f.conclusionLabel);
    await page.goto("/audit/reports");
    await expect(page.locator("tr[data-export]").first()).toBeVisible();
  });

  test("remediation task moves from open to in progress", async ({ page }) => {
    await page.goto("/audit/remediation?status=open");
    await expect(page.getByRole("heading", { level: 1, name: "Remediation" })).toBeVisible();
    await expect(page.locator("table")).toBeVisible();
    const rows = page.locator("tbody tr");
    if ((await rows.count()) === 0) {
      await page.getByRole("button", { name: "New task" }).click();
      const create = page.getByRole("dialog");
      await create.locator("#task-title").fill(`E2E remediation task ${Date.now()}`);
      await create.getByRole("button", { name: "Create task" }).click();
      await expect(create).toBeHidden();
      await expect(page.locator("tbody tr").first()).toBeVisible();
    }
    const sheet = page.getByTestId("task-sheet");
    await clickRowUntilVisible(page.locator("tbody tr").first(), sheet);
    await sheet.getByRole("button", { name: "Start work" }).click();
    await sheet.locator("#task-transition-note").fill("E2E: work started");
    await sheet.getByRole("button", { name: /Confirm: Start work/ }).click();
    await expect(page.getByText("Task moved to in progress")).toBeVisible(SLOW);
    await expect(sheet.getByText("In progress").first()).toBeVisible();
    await expect(sheet.getByText("Open to In progress")).toBeVisible(SLOW);
  });
});

test.describe("viewer", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, VIEWER);
  });

  test("upload is disabled with a permission tooltip", async ({ page }) => {
    await page.goto("/audit/documents");
    const upload = page.getByRole("button", { name: "Upload document" });
    await expect(upload).toBeDisabled();
    await expect(async () => {
      await page.mouse.move(0, 0);
      await upload.locator("..").hover();
      await expect(page.getByRole("tooltip").filter({ hasText: "Requires audit:write" }).first()).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 20_000 });
    await page.goto("/audit/assessments");
    await expect(page.getByRole("button", { name: "New assessment" })).toBeDisabled();
  });
});
