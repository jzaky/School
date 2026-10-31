import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";

/** The personas' password: the published demo password, or the one a staging seed set (E2E_PERSONA_PASSWORD). */
const PASSWORD = process.env.E2E_PERSONA_PASSWORD || "AegisDemo2026!";
const OWNER = "nadia.haddad@meridian-demo.example";
const VIEWER = "sara.khalil@meridian-demo.example";
const PLATFORM_ADMIN = "admin@aegis.local";

/** The platform administrator has its own password (never the demo password), written by the seed to .demo-keys.json. */
function platformAdminPassword(): string {
  const keys = JSON.parse(readFileSync(join(process.cwd(), "..", "..", ".demo-keys.json"), "utf8")) as { platformAdmin?: { password?: string } };
  if (!keys.platformAdmin?.password) throw new Error("Run pnpm db:seed first: .demo-keys.json has no platform admin password");
  return keys.platformAdmin.password;
}

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", email === PLATFORM_ADMIN ? platformAdminPassword() : PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/(overview|no-organization|platform|mfa)/);
}

async function openAgent(page: Page, name: string) {
  await page.goto(`/agents?q=${encodeURIComponent(name)}`);
  const row = page.locator("tbody tr", { hasText: name }).first();
  await expect(row).toBeVisible();
  await row.click();
  await page.waitForURL(/\/agents\/[0-9a-f-]{36}/);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}

test.describe("owner", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, OWNER);
  });

  test("Overview leads with what needs attention, health, recent actions and next steps", async ({ page }) => {
    await page.goto("/overview");
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
    await expect(page.getByTestId("needs-attention")).toBeVisible();
    await expect(page.getByTestId("health")).toBeVisible();
    await expect(page.getByTestId("health")).toContainText("Active agents");
    await expect(page.getByTestId("health")).toContainText("Integrations");
    const recent = page.getByTestId("recent-actions");
    await expect(recent).toBeVisible();
    for (const group of ["Allowed and executed", "Approval", "Blocked", "Failed or unresolved"]) {
      await expect(recent.locator(`[data-outcome-group]`, { hasText: group }).first()).toBeVisible();
    }
    await expect(recent.locator("a[href^='/gateway/']").first()).toBeVisible();
    await expect(page.getByTestId("chain-indicator")).toContainText(/Evidence chain valid|Evidence chain broken at seq \d+/);
    await expect(page.getByText("Demo data").first()).toBeVisible();
    // The twelve-tile grid is gone.
    await expect(page.getByText("Actions evaluated", { exact: true })).toHaveCount(0);
  });

  test("sidebar shows five primary sections and a collapsed More area with the specialist groups", async ({ page }) => {
    await page.goto("/overview");
    const nav = page.getByRole("navigation", { name: "Main" });
    const primary = ["/overview", "/agents", "/approvals", "/activity", "/org/settings"];
    for (const href of primary) await expect(nav.locator(`[data-nav-item="${href}"]`)).toBeVisible();
    const hrefs = await nav.locator("[data-nav-item]").evaluateAll((els) => els.map((e) => e.getAttribute("data-nav-item")));
    const primaryOrder = hrefs.filter((h) => primary.includes(h ?? ""));
    expect(primaryOrder).toEqual(primary);
    // Collapsed by default: no specialist item is rendered until More is opened.
    await expect(nav.locator('[data-nav-item="/policies"]')).toHaveCount(0);
    const more = nav.locator("[data-nav-more]");
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await more.click();
    await expect(more).toHaveAttribute("aria-expanded", "true");
    for (const group of ["Control", "Assurance", "Security", "Audit", "Organization"]) {
      await expect(nav.getByText(group, { exact: true })).toBeVisible();
    }
    await expect(nav.getByText("Platform Admin")).toHaveCount(0);
    await expect(nav.locator('[data-nav-item="/policies"]')).toHaveAttribute("href", "/policies");
    // The preference persists across navigation.
    await page.goto("/agents");
    await expect(nav.locator("[data-nav-more]")).toHaveAttribute("aria-expanded", "true");
    await expect(nav.locator('[data-nav-item="/policies"]')).toBeVisible();
    await nav.locator("[data-nav-more]").click();
    await expect(nav.locator('[data-nav-item="/policies"]')).toHaveCount(0);
  });

  test("every navigation item is a working link or a disabled item with a tooltip", async ({ page }) => {
    await page.goto("/overview");
    const nav = page.getByRole("navigation", { name: "Main" });
    await nav.locator("[data-nav-more]").click();
    await expect(nav.locator('[data-nav-item="/agents"]')).toHaveAttribute("href", "/agents");
    const items = nav.locator("[data-nav-item]");
    const count = await items.count();
    expect(count).toBeGreaterThan(20);
    let disabledSeen = 0;
    for (let i = 0; i < count; i++) {
      const item = items.nth(i);
      const disabled = (await item.getAttribute("aria-disabled")) === "true";
      if (!disabled) {
        expect(await item.getAttribute("href")).toBe(await item.getAttribute("data-nav-item"));
        continue;
      }
      disabledSeen++;
      if (disabledSeen === 1) {
        await expect(async () => {
          await page.mouse.move(0, 0);
          await item.hover();
          await expect(page.getByRole("tooltip").first()).toBeVisible({ timeout: 2000 });
        }).toPass({ timeout: 20_000 });
      }
    }
    // Collapse More again so the stored preference does not leak into later tests.
    await nav.locator("[data-nav-more]").click();
  });

  test("agents list shows 9 agents and filters by status", async ({ page }) => {
    await page.goto("/agents");
    await expect(page.locator("tbody tr")).toHaveCount(9);
    await expect(page.getByText("1 to 9 of 9")).toBeVisible();
    await page.goto("/agents?status=suspended");
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await expect(page.locator("tbody tr").first()).toContainText("IT Helpdesk Agent");
    await expect(page.getByRole("combobox", { name: "Status" })).toContainText("Suspended");
  });

  test("agent detail renders every tab", async ({ page }) => {
    await openAgent(page, "Treasury Transfer Agent");
    const tabs = page.getByRole("tablist", { name: "Agent sections" });
    for (const t of ["Overview", "Tools", "Permissions", "Versions", "Policies", "Activity", "API keys", "Evidence"]) {
      await tabs.getByRole("tab", { name: new RegExp(`^${t}`) }).click();
      await expect(page.getByRole("tabpanel")).toBeVisible();
    }
    await tabs.getByRole("tab", { name: /^Tools/ }).click();
    await expect(page.getByRole("tabpanel")).toContainText("initiate-transfer");
    await tabs.getByRole("tab", { name: /^Policies/ }).click();
    await expect(page.getByRole("tabpanel")).toContainText("Policy management arrives in the Control release");
  });

  test("suspend an active agent with a reason, then resume it", async ({ page }) => {
    await openAgent(page, "Analytics Copilot");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Analytics Copilot");
    const header = page.locator("h1").locator("..").locator("..");
    await expect(header.getByText("Active", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "Suspend", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: /Suspend Analytics Copilot/ })).toBeVisible();
    await dialog.getByLabel(/Reason/).fill("E2E check: temporary suspension");
    await dialog.getByRole("button", { name: "Suspend", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
    await expect(header.getByText("Suspended", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "Resume", exact: true }).click();
    const resume = page.getByRole("dialog");
    await resume.getByLabel(/Reason/).fill("E2E check: resumed");
    await resume.getByRole("button", { name: "Resume", exact: true }).click();
    await expect(resume).toBeHidden();
    await expect(page.getByRole("button", { name: "Suspend", exact: true })).toBeVisible();
    await expect(header.getByText("Active", { exact: true }).first()).toBeVisible();
  });

  test("issue an API key and see it exactly once", async ({ page }) => {
    await openAgent(page, "Analytics Copilot");
    await page.getByRole("tab", { name: /^API keys/ }).click();
    await page.getByRole("button", { name: "Issue key" }).click();
    const dialog = page.getByRole("dialog");
    const keyName = `e2e key ${Date.now()}`;
    await dialog.getByLabel("Key name").fill(keyName);
    await dialog.getByRole("button", { name: "Issue key" }).click();
    await expect(dialog.getByRole("heading", { name: "Copy your new API key" })).toBeVisible();
    const code = dialog.locator("pre");
    await expect(code).toContainText(/^aegis_ak_[0-9a-f]{12}_[A-Za-z0-9_-]+$/);
    const full = (await code.textContent())!.trim();
    await dialog.getByRole("button", { name: "I have stored the key" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("tabpanel")).toContainText(keyName);
    await expect(page.getByRole("tabpanel")).not.toContainText(full);
    // Revoke it again so the demo tenant stays tidy.
    const row = page.locator("tbody tr", { hasText: keyName });
    await row.getByRole("button", { name: "Revoke" }).click();
    const revoke = page.getByRole("dialog");
    await revoke.getByLabel(/Reason/).fill("E2E cleanup");
    await revoke.getByRole("button", { name: "Revoke key" }).click();
    await expect(revoke).toBeHidden();
    await expect(row).toContainText("Revoked");
  });

  test("command palette opens with Ctrl+K and finds an agent", async ({ page }) => {
    await page.goto("/overview");
    await page.keyboard.press("Control+k");
    const palette = page.getByRole("dialog");
    await expect(palette.getByPlaceholder(/Search agents/)).toBeVisible();
    await palette.getByPlaceholder(/Search agents/).fill("treasury");
    await expect(palette.getByText("Treasury Transfer Agent")).toBeVisible();
    await palette.getByText("Treasury Transfer Agent").click();
    await page.waitForURL(/\/agents\/[0-9a-f-]{36}/);
  });
});

test.describe("viewer", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, VIEWER);
  });

  test("Register agent is disabled with a permission tooltip", async ({ page }) => {
    await page.goto("/agents");
    const button = page.getByRole("button", { name: "Register agent" });
    await expect(button).toBeDisabled();
    // Tooltips mount after hydration, so retry the hover until the tooltip appears.
    await expect(async () => {
      await page.mouse.move(0, 0);
      await button.locator("..").hover();
      await expect(page.getByRole("tooltip").filter({ hasText: "Requires agents:write" })).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 20_000 });
  });

  test("role creation is unavailable and org pages are gated", async ({ page }) => {
    await page.goto("/org/roles");
    // Viewer lacks users:read, so the page redirects to the forbidden explanation.
    await expect(page).toHaveURL(/\/forbidden\?need=users%3Aread/);
    await expect(page.getByText("users:read")).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Main" });
    await page.goto("/overview");
    await nav.locator("[data-nav-more]").click();
    const roles = nav.locator('[data-nav-item="/org/roles"]');
    await expect(roles).toHaveAttribute("aria-disabled", "true");
    await expect(async () => {
      await page.mouse.move(0, 0);
      await roles.hover();
      await expect(page.getByRole("tooltip").filter({ hasText: "Requires users:read" })).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 20_000 });
  });
});

test.describe("platform admin", () => {
  test("can open the tenants page without an organization", async ({ page }) => {
    await login(page, PLATFORM_ADMIN);
    await expect(page).toHaveURL(/\/no-organization/);
    await page.getByRole("link", { name: "Open platform admin" }).click();
    await expect(page).toHaveURL(/\/platform\/tenants/);
    await expect(page.getByRole("heading", { level: 1, name: "Tenants" })).toBeVisible();
    await expect(page.locator("tbody tr", { hasText: "Meridian Gulf Bank" })).toBeVisible();
    await page.goto("/platform/health");
    await expect(page.getByText("Reachable")).toBeVisible();
  });
});
