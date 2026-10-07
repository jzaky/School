import { expect, test, type Browser } from "@playwright/test";
import { LOCALES, type Locale } from "./helpers";

// Shared CI machines have a small /dev/shm; without this flag Chromium tabs can crash under load.
test.use({ launchOptions: { args: ["--disable-dev-shm-usage"] } });

// School group: the group director persona compares the demo school with two small schools, creates an
// invite code and shares a letter template. Wellbeing and safeguarding never appear at group level.

async function enterGroup(browser: Browser, locale: Locale) {
  const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
  const context = await browser.newContext({ baseURL, viewport: { width: 1300, height: 900 } });
  await context.addCookies([{ name: "NEXT_LOCALE", value: locale, url: baseURL }]);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
  page.on("response", (r) => {
    if (r.status() >= 500) errors.push(`http ${r.status()} ${r.url()}`);
  });
  await page.goto("/demo");
  await page.locator("[data-testid=enter-group_admin]").click();
  await page.waitForURL(new RegExp(`/${locale}/group$`), { timeout: 120_000 });
  return { context, page, errors };
}

for (const locale of LOCALES) {
  test(`group dashboard (${locale})`, async ({ browser }) => {
    const { context, page, errors } = await enterGroup(browser, locale);
    await expect(page.locator("html")).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");
    await expect(page.getByTestId("group-name")).toHaveText(locale === "ar" ? "مجموعة هورايزن التعليمية" : "Horizon Education Group");
    await expect(page.getByTestId("group-privacy-note")).toBeVisible();
    await expect(page.getByTestId("group-school-table").locator("tbody tr")).toHaveCount(3);
    // The director works at Horizon only: one school opens, two are disabled with a reason.
    await expect(page.locator("[data-testid=group-school-table] [data-testid^=open-school-disabled-]")).toHaveCount(2);
    await expect(page.locator("[data-testid=group-school-table] [data-testid^=open-school-]:not([data-testid*=disabled])")).toHaveCount(1);
    const body = (await page.locator("main").innerText()).toLowerCase();
    for (const word of locale === "ar" ? ["بلاغ حماية", "متابعة جلسة الرفاه"] : ["safeguarding concern", "wellbeing check-in"]) expect(body).not.toContain(word);
    await page.screenshot({ path: `test-results/group-dashboard-${locale}.png`, fullPage: true });

    // Phone width: cards instead of the table, no sideways scroll.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(page.locator("[data-testid^=group-school-card-]")).toHaveCount(3);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `test-results/group-dashboard-${locale}-phone.png`, fullPage: true });
    expect(errors, errors.join("\n")).toEqual([]);
    await context.close();
  });
}

test("invite code, shared template and jumping into a school", async ({ browser }) => {
  const { context, page, errors } = await enterGroup(browser, "en");

  // Invite codes: create one (shown once), then revoke it.
  await page.getByTestId("group-nav-schools").click();
  await expect(page.getByTestId("group-member-schools").locator("li")).toHaveCount(3);
  await page.getByTestId("group-invite-create").click();
  const code = (await page.getByTestId("group-invite-code").innerText()).trim();
  expect(code).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
  await page.getByRole("button", { name: "Done" }).click();
  const revoke = page.locator("[data-testid^=group-invite-revoke-]").first();
  await revoke.click();
  await expect(page.getByText("Code revoked")).toBeVisible();
  await page.screenshot({ path: "test-results/group-schools-en.png", fullPage: true });

  // Share a letter template from Horizon to the two other schools, replacing their version.
  await page.getByTestId("group-nav-templates").click();
  await page.getByTestId("push-kind").click();
  await page.getByTestId("push-kind-letter").click();
  await page.getByTestId("push-item").click();
  await page.getByRole("option").first().click();
  await page.getByTestId("push-mode").click();
  await page.getByRole("option", { name: "Replace the school's letter" }).click();
  await page.getByTestId("push-submit").click();
  await page.getByTestId("push-confirm").click();
  await expect(page.getByTestId("push-results").locator("li")).toHaveCount(2);
  await expect(page.getByTestId("push-results")).toContainText("Replaced the school's version");
  await expect(page.getByTestId("push-history").locator("> li").first()).toContainText("Noura Al Suwaidi");
  await page.screenshot({ path: "test-results/group-templates-en.png", fullPage: true });

  // Jump into Horizon, where the director also has an account.
  await page.getByTestId("group-nav-dashboard").click();
  await page.locator("[data-testid=group-school-table] [data-testid^=open-school-]:not([data-testid*=disabled])").click();
  await page.waitForURL(/\/en\/home/, { timeout: 60_000 });
  await expect(page.locator("a[href='/en/group']").first()).toBeVisible();
  expect(errors, errors.join("\n")).toEqual([]);
  await context.close();
});

test("school admin sees the school's group under School setup (ar)", async ({ browser }) => {
  const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
  const context = await browser.newContext({ baseURL, viewport: { width: 1300, height: 900 } });
  await context.addCookies([{ name: "NEXT_LOCALE", value: "ar", url: baseURL }]);
  const page = await context.newPage();
  await page.goto("/demo");
  await page.locator("[data-testid=enter-admin]").click();
  await page.waitForURL(/\/ar\/home/, { timeout: 120_000 });
  await page.goto("/ar/admin/school");
  await expect(page.getByTestId("school-group-current")).toContainText("مجموعة هورايزن التعليمية");
  await context.close();
});
