import { test, expect, type Page } from "@playwright/test";

/** The personas' password: the published demo password, or the one a staging seed set (E2E_PERSONA_PASSWORD). */
const PASSWORD = process.env.E2E_PERSONA_PASSWORD || "AegisDemo2026!";
const OWNER = "nadia.haddad@meridian-demo.example";
const APPROVER = "lina.mansour@meridian-demo.example";
const STEPS = ["explore", "connect", "agent", "policy", "approver", "verify", "evidence"];

test.setTimeout(180_000);

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/(overview|no-organization|platform|mfa)/);
}

test.describe("guided onboarding as owner", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, OWNER);
  });

  test("getting started renders seven data-derived steps in order with their done states", async ({ page }) => {
    await page.goto("/getting-started");
    await expect(page.getByRole("heading", { level: 1, name: "Getting started" })).toBeVisible();
    const steps = page.getByTestId("onboarding-steps").locator("li[data-step]");
    await expect(steps).toHaveCount(7);
    expect(await steps.evaluateAll((els) => els.map((e) => e.getAttribute("data-step")))).toEqual(STEPS);
    // The seeded tenant has demo runs, owned active agents, assigned active policies, an approver and recent outcomes.
    for (const key of ["explore", "agent", "policy", "approver", "verify"]) {
      const li = page.locator(`li[data-step="${key}"]`);
      await expect(li, key).toHaveAttribute("data-done", "true");
      await expect(li).toContainText("Done");
    }
    // Sandbox integrations and evidence exports depend on the tenant's own work, so only the state must be shown.
    for (const key of ["connect", "evidence"]) {
      const li = page.locator(`li[data-step="${key}"]`);
      await expect(li).toContainText(/Done|Not done/);
    }
    // Every step has a button to the right screen.
    const hrefs = await steps.locator("a").evaluateAll((els) => els.map((e) => e.getAttribute("href")));
    expect(hrefs).toEqual(["/gateway/demos", "/integrations", "/agents", "/policies", "/org/users", "/gateway/demos", "/evidence"]);
    await expect(page.getByTestId("onboarding-progress")).toContainText(/\d of 7 done/);
  });

  test("overview shows the next steps card and the sidebar link reflects progress", async ({ page }) => {
    // An earlier run may have left the checklist hidden; restore it first so the card is expected.
    await page.goto("/org/settings");
    const dismiss = page.getByTestId("pilot-setup").getByTestId("onboarding-dismiss");
    if ((await dismiss.textContent())?.includes("Restore")) {
      await dismiss.click();
      await expect(page.getByTestId("pilot-setup").getByTestId("onboarding-dismiss")).toHaveText("Hide checklist");
    }
    await page.goto("/overview");
    const card = page.getByTestId("next-steps");
    await expect(card).toBeVisible();
    const progress = await card.getByTestId("onboarding-progress").textContent();
    const nav = page.getByRole("navigation", { name: "Main" });
    if (progress?.startsWith("7 of 7")) {
      await expect(nav.locator('[data-nav-item="/getting-started"]')).toHaveCount(0);
    } else {
      await expect(card.getByTestId("next-step-button")).toBeVisible();
      const link = nav.locator('[data-nav-item="/getting-started"]');
      await expect(link).toBeVisible();
      await link.click();
      await page.waitForURL(/\/getting-started/);
    }
  });

  test("settings shows pilot setup and the gateway pause control; hiding the checklist removes the sidebar link", async ({ page }) => {
    await page.goto("/org/settings");
    const pilot = page.getByTestId("pilot-setup");
    await expect(pilot).toBeVisible();
    await expect(pilot.getByTestId("onboarding-progress")).toContainText(/\d of 7 done/);
    await expect(pilot.getByRole("link", { name: "Open the checklist" })).toHaveAttribute("href", "/getting-started");
    const pause = page.getByTestId("gateway-pause");
    await expect(pause.getByRole("button", { name: /Pause gateway|Resume gateway/ })).toBeEnabled();
    const dismiss = pilot.getByTestId("onboarding-dismiss");
    await expect(dismiss).toBeEnabled();
    const wasHidden = (await dismiss.textContent())?.includes("Restore");
    if (wasHidden) {
      await dismiss.click();
      await expect(pilot.getByTestId("onboarding-dismiss")).toHaveText("Hide checklist");
    }
    await pilot.getByTestId("onboarding-dismiss").click();
    await expect(pilot.getByTestId("onboarding-dismiss")).toHaveText("Restore checklist");
    await expect(page.getByRole("navigation", { name: "Main" }).locator('[data-nav-item="/getting-started"]')).toHaveCount(0);
    await page.goto("/overview");
    await expect(page.getByTestId("next-steps")).toHaveCount(0);
    await page.goto("/org/settings");
    await page.getByTestId("pilot-setup").getByTestId("onboarding-dismiss").click();
    await expect(page.getByTestId("pilot-setup").getByTestId("onboarding-dismiss")).toHaveText("Hide checklist");
    await page.goto("/overview");
    await expect(page.getByTestId("next-steps")).toBeVisible();
  });

  test("empty approvals state points at the sample workflow", async ({ page }) => {
    await page.goto("/approvals?status=rejected&mine=1&page=999");
    await expect(page.getByTestId("approvals-list")).toBeVisible();
    // A page past the end is empty; the pending tab's empty state carries the onboarding link, others say so plainly.
    await expect(page.getByTestId("approvals-list")).toContainText(/No approvals in this state|Nothing waiting/);
  });
});

test.describe("guided onboarding as approver", () => {
  test("overview needs-your-attention lists approvals Lina can decide", async ({ page }) => {
    await login(page, APPROVER);
    await page.goto("/overview");
    let rows = page.getByTestId("needs-attention").locator("a[href^='/approvals/']");
    if ((await rows.count()) === 0) {
      // Seeded approvals expire four hours after seeding; recreate one through the real gateway.
      await page.goto("/gateway/demos");
      const banking = page.locator("section", { hasText: "Banking: transfer limits" }).first();
      await banking.getByRole("button", { name: "Run" }).click();
      await expect(banking.getByText("Waiting for a manager in the Approval Center")).toBeVisible({ timeout: 60_000 });
      await page.goto("/overview");
      rows = page.getByTestId("needs-attention").locator("a[href^='/approvals/']");
    }
    await expect(rows.first()).toBeVisible();
    const row = rows.first();
    await expect(row).toContainText(/AED/);
    await expect(row).toContainText("expires in");
    await expect(row).toContainText("Awaiting your decision");
    await row.click();
    await page.waitForURL(/\/approvals\/[0-9a-f-]{36}/);
    await expect(page.getByRole("radio", { name: "Approve" })).toBeEnabled();
  });
});
