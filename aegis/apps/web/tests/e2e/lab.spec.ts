import { test, expect, type Page } from "@playwright/test";

const PASSWORD = "AegisDemo2026!";
const ANALYST = "tariq.saleh@meridian-demo.example";

test.setTimeout(180_000);

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/(overview|no-organization|platform|mfa)/);
}

test.describe("attack simulation lab", () => {
  test("the seeded runs show the injection setting closing two gaps, with remedies for the rest", async ({ page }) => {
    await login(page, ANALYST);
    await page.goto("/security/lab");
    await expect(page.getByRole("heading", { level: 1, name: "Attack Simulation Lab" })).toBeVisible();
    await expect(page.getByText("It is not a penetration test")).toBeVisible();
    await expect(page.getByTestId("lab-scenarios")).toContainText("OWASP LLM01:2025");
    const rows = page.getByTestId("lab-run-row");
    expect(await rows.count()).toBeGreaterThanOrEqual(2);
    // Most recent first: the run after the organization started holding injection signals for review.
    await rows.first().getByRole("link").click();
    await page.waitForURL(/\/security\/lab\/[0-9a-f-]{36}$/);
    const results = page.getByTestId("lab-results");
    await expect(results.locator('[data-scenario="control"]')).toHaveAttribute("data-outcome", "control");
    await expect(results.locator('[data-scenario="prompt_injection"]')).toHaveAttribute("data-outcome", "defended");
    await expect(results.locator('[data-scenario="grant_replay"]')).toHaveAttribute("data-outcome", "defended");
    await expect(results.locator('[data-scenario="split_amounts"]')).toHaveAttribute("data-outcome", "gap");
    await expect(results.locator('[data-scenario="split_amounts"]').getByTestId("lab-remedy")).toContainText("daily total or velocity");
  });

  test("a security analyst runs the lab from the console and the clone never appears among the agents", async ({ page }) => {
    await login(page, ANALYST);
    await page.goto("/security/lab");
    await page.locator("#lab-agent").click();
    await page.getByRole("option", { name: "Support Refund Agent" }).click();
    await page.getByTestId("lab-run-start").click();
    await page.waitForURL(/\/security\/lab\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    const results = page.getByTestId("lab-results");
    await expect(results.locator('[data-scenario="suspended_agent"]')).toHaveAttribute("data-outcome", "defended");
    await expect(results.locator('[data-scenario="self_escalation"]')).toHaveAttribute("data-outcome", "defended");
    await page.goto("/agents");
    await expect(page.getByText("Lab clone of")).toHaveCount(0);
    await page.goto("/security/data-protection");
    await expect(page.getByTestId("injection-response-form")).toContainText("Hold for security review");
  });
  test("a security analyst turns scheduled runs on for one agent and off again; a viewer cannot change them", async ({ page, browser }) => {
    await login(page, ANALYST);
    await page.goto("/security/lab");
    const schedule = page.getByTestId("lab-schedule");
    await expect(page.getByTestId("lab-schedule-state")).toContainText("Off.");
    await expect(page.getByTestId("lab-schedule-save")).toBeDisabled();
    await schedule.getByRole("checkbox").first().check();
    await page.getByTestId("lab-schedule-save").click();
    await expect(page.getByTestId("lab-schedule-state")).toContainText("On: every week for 1 agent.");
    await page.getByTestId("lab-schedule-off").click();
    await expect(page.getByTestId("lab-schedule-state")).toContainText("Off.");

    const viewer = await browser.newPage();
    await login(viewer, "sara.khalil@meridian-demo.example");
    await viewer.goto("/security/lab");
    await expect(viewer.getByTestId("lab-schedule").getByRole("checkbox").first()).toBeDisabled();
    await expect(viewer.getByTestId("lab-schedule-save")).toBeDisabled();
    await viewer.close();
  });
});
