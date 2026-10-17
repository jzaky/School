import { test, expect, type Page } from "@playwright/test";

const PASSWORD = "AegisDemo2026!";
const OWNER = "nadia.haddad@meridian-demo.example";

test.setTimeout(180_000);

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/(overview|no-organization|platform|mfa)/);
}

test.describe("guided score-band policy", () => {
  test("Nadia creates a score-band policy from her model's score, sees every band dry-run, and the Score bands tab is pre-filled", async ({ page }) => {
    await login(page, OWNER);
    const stamp = Date.now();
    const name = `E2E fraud score ${stamp}`;
    const key = `e2e-fraud-score-${stamp}`;

    await page.goto("/policies");
    await page.getByRole("button", { name: "New policy" }).click();
    const dialog = page.getByRole("dialog", { name: "New policy" });
    await expect(dialog).toBeVisible();
    await dialog.locator("#policy-name").fill(name);
    await dialog.locator("#policy-key").fill(key);
    await dialog.locator("#policy-template").click();
    await page.getByRole("option", { name: /Score-band policy/ }).click();
    await expect(dialog.locator("#policy-template")).toContainText("Score-band policy");

    // The customer's score field and a percent scale with custom boundaries.
    await dialog.locator("#nps-attr").fill("fraudProbability");
    await dialog.locator("#nps-scale").click();
    await page.getByRole("option", { name: "0 to 100 (percent)" }).click();
    await dialog.locator("#nps-review").fill("30");
    await dialog.locator("#nps-hold").fill("60");
    await dialog.locator("#nps-block").fill("85");
    const explanation = dialog.getByRole("list", { name: "What this policy does" });
    await expect(explanation).toContainText("Scores below 30 run automatically.");
    await expect(explanation).toContainText("Scores from 30 to 60 need one approval from approver");
    await expect(explanation).toContainText("Scores from 60 to 85 are held");
    await expect(explanation).toContainText("Scores of 85 and above are refused");
    await expect(explanation).toContainText("A request without a score is refused.");

    // One dry run per band, each as intended.
    const samples = dialog.getByRole("table", { name: "Sample request outcomes" });
    await expect(samples.locator("tr[data-sample=clear]")).toContainText("Allowed", { timeout: 20_000 });
    await expect(samples.locator("tr[data-sample=review]")).toContainText("Approval required");
    await expect(samples.locator("tr[data-sample=hold]")).toContainText("Approval required");
    await expect(samples.locator("tr[data-sample=hold]")).toContainText("hold-band");
    await expect(samples.locator("tr[data-sample=block]")).toContainText("Denied");
    await expect(samples.locator("tr[data-sample=missing]")).toContainText("Denied");
    await expect(samples.locator("tr[data-sample=out_of_range]")).toContainText("Denied");
    await expect(samples.getByLabel("not as intended")).toHaveCount(0);

    // A boundary out of order blocks creation with an explanation, then is corrected.
    await dialog.locator("#nps-hold").fill("20");
    await expect(dialog.getByText("The hold boundary must be at least the review boundary")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Create draft" })).toBeDisabled();
    await dialog.locator("#nps-hold").fill("60");

    await dialog.getByRole("button", { name: "Create draft" }).click();
    await page.waitForURL(/\/policies\/[0-9a-f-]{36}\?tab=thresholds/);
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();

    // The guided tab is first and pre-filled with the custom values.
    const tabs = page.getByRole("tablist", { name: "Policy sections" });
    await expect(tabs.getByRole("tab").first()).toHaveText("Score bands");
    const panel = page.getByTestId("score-band-thresholds");
    await expect(panel.locator("#sbt-attr")).toHaveValue("fraudProbability");
    await expect(panel.locator("#sbt-review")).toHaveValue("30");
    await expect(panel.locator("#sbt-hold")).toHaveValue("60");
    await expect(panel.locator("#sbt-block")).toHaveValue("85");
    await expect(panel.getByText("as context.fraudProbability")).toBeVisible();
    // The generated JSON is ordinary policy JSON with six rules.
    await tabs.getByRole("tab", { name: "Rules" }).click();
    for (const id of ["score-missing", "score-out-of-range", "clear-band", "review-band", "hold-band", "block-band"]) {
      await expect(page.getByRole("tabpanel").getByText(id, { exact: true }).first()).toBeVisible();
    }
  });

  test("the seeded example policy opens on its Score bands tab", async ({ page }) => {
    await login(page, OWNER);
    await page.goto("/policies");
    await page.locator("tbody tr", { hasText: "Refund fraud score routing (example)" }).first().click();
    await page.waitForURL(/\/policies\/[0-9a-f-]{36}/);
    const tabs = page.getByRole("tablist", { name: "Policy sections" });
    await expect(tabs.getByRole("tab").first()).toHaveText("Score bands");
    await expect(page.getByTestId("score-band-thresholds").locator("#sbt-attr")).toHaveValue("fraudScore");
  });
});
