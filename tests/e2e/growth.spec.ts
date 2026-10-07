import { expect, test, type Page } from "@playwright/test";
import { go, loginAs, LOCALES, expectNoErrors } from "./helpers";

// Public growth pages: career taster, pricing and ROI estimator, status, referral links, platform admin.
// Platform admin checks need the admin persona's email in PLATFORM_ADMIN_EMAILS (local and staging only).

const base = process.env.E2E_BASE_URL ?? "http://localhost:3000";

async function publicPage(page: Page, locale: "en" | "ar", path: string) {
  await page.context().addCookies([{ name: "NEXT_LOCALE", value: locale, url: base }]);
  await page.goto(path);
  await expect(page.locator("html")).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

for (const locale of LOCALES) {
  test(`landing links and career taster to full result (${locale})`, async ({ page }) => {
    await publicPage(page, locale, "/");
    await expect(page.locator("[data-testid=cta-try]")).toBeVisible();
    await expect(page.locator("[data-testid=nav-pricing]")).toBeVisible();
    await expect(page.locator("[data-testid=footer-status]")).toBeVisible();

    await page.locator("[data-testid=cta-try]").click();
    await page.waitForURL(/\/try$/);
    await page.locator("[data-testid=taster-start]").click();
    for (let i = 0; i < 12; i++) {
      await expect(page.locator("[data-testid=taster-progress]")).toContainText(String(i + 1));
      await page.locator(`[data-testid=taster-answer-${(i % 5) + 1}]`).click();
    }
    await expect(page.locator("[data-testid=taster-area]")).toHaveCount(3);
    if (locale === "ar") await expect(page.locator("[data-testid=taster-area]").first()).toContainText(/[؀-ۿ]/);

    await page.locator("[data-testid=lead-name]").fill(locale === "ar" ? "ليلى حداد" : "Lina Haddad");
    await page.locator("[data-testid=lead-email]").fill(`taster-${locale}-${Date.now()}@example.com`);
    await page.locator("[data-testid=lead-role-PARENT]").check();
    await page.locator("[data-testid=lead-consent]").check();
    await page.locator("[data-testid=taster-submit]").click();
    await page.waitForURL(/\/try\/result\//);
    await expect(page.locator("[data-testid=result-area]")).toHaveCount(3);

    const pdf = await page.request.get(await page.locator("[data-testid=result-pdf]").getAttribute("href").then((h) => h!));
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toContain("application/pdf");

    const missing = await page.request.get("/try/result/notatoken");
    expect(missing.status()).toBe(200);
    await page.goto("/try/result/notatoken");
    await expect(page.locator("[data-testid=result-missing]")).toBeVisible();
  });

  test(`pricing estimator and offer request (${locale})`, async ({ page }) => {
    await publicPage(page, locale, "/pricing");
    const hours = page.locator("[data-testid=roi-hours]");
    const before = await hours.textContent();
    await page.locator("[data-testid=pricing-students]").fill("1200");
    await expect(hours).not.toHaveText(before ?? "");
    await page.locator("[data-testid=assumption-minutesPerLetter]").fill("30");
    await expect(page.locator("[data-testid=pricing-assumptions]")).toBeVisible();
    await expect(page.locator("[data-testid=pricing-no-price]")).toBeVisible();
    await page.locator("[data-testid=pricing-module-career]").check();
    await page.locator("[data-testid=lead-name]").fill("Omar Saleh");
    await page.locator("[data-testid=lead-email]").fill(`offer-${locale}-${Date.now()}@example.com`);
    await page.locator("[data-testid=lead-school]").fill("Al Noor Private School");
    await page.locator("[data-testid=lead-consent]").check();
    await page.locator("[data-testid=offer-submit]").click();
    await expect(page.locator("[data-testid=offer-sent]")).toBeVisible();
  });

  test(`status page (${locale})`, async ({ page }) => {
    await publicPage(page, locale, "/status");
    for (const c of ["web", "database", "redis", "worker"]) await expect(page.locator(`[data-testid=status-${c}]`)).toBeVisible();
    await expect(page.locator("[data-testid=status-web]")).toHaveAttribute("data-state", "up");
    await expect(page.locator("[data-testid=status-history] > span")).toHaveCount(90);
    const html = await page.content();
    expect(html).not.toMatch(/localhost|127\.0\.0\.1|postgres|redis:\/\//i);
  });

  test(`public pages fit a phone (${locale})`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addCookies([{ name: "NEXT_LOCALE", value: locale, url: base }]);
    const page = await context.newPage();
    for (const path of ["/", "/try", "/pricing", "/status"]) {
      await page.goto(`${base}${path}`);
      await page.waitForLoadState("networkidle");
      await noSidewaysScroll(page);
    }
    await context.close();
  });
}

test("referral link, platform leads, referrals and pricing settings", async ({ browser }) => {
  test.setTimeout(600_000);
  const s = await loginAs(browser, "admin", "en");
  await go(s, "/admin/referral");
  const code = (await s.page.locator("[data-testid=referral-code]").textContent())!.trim();
  expect(code).toMatch(/^[A-Z2-9]{8}$/);
  await expect(s.page.locator("[data-testid=referral-link]")).toHaveValue(new RegExp(`/signup\\?ref=${code}$`));

  const visitor = await browser.newPage();
  await visitor.goto(`${base}/signup?ref=${code}`);
  await expect(visitor.locator("[data-testid=signup-referred]")).toContainText("Horizon");
  await visitor.close();

  await go(s, "/platform/leads");
  await expect(s.page.locator("[data-testid=leads-table]")).toBeVisible();
  const csv = await s.page.request.get("/api/platform/leads/export");
  expect(csv.status()).toBe(200);
  expect(await csv.text()).toContain("marketing_lead");

  await go(s, "/platform/referrals");
  await expect(s.page.locator("[data-testid=referrals-terms]")).toBeVisible();

  // Publish a core price, see it on /pricing, then clear it again.
  await go(s, "/platform/settings");
  await s.page.locator("[data-testid=setting-price_core]").fill("150");
  const published = s.page.locator("[data-testid=setting-published]");
  if ((await published.getAttribute("aria-checked")) !== "true") await published.click();
  await expect(published).toHaveAttribute("aria-checked", "true");
  await s.page.locator("[data-testid=pricing-settings-save]").click();
  await expect(s.page.getByText(/Pricing saved/)).toBeVisible();
  const pub = await s.context.newPage();
  await pub.goto(`${base}/pricing`);
  // Safeguarding is selected by default and has no price, so the page asks for an offer until it is unticked.
  await expect(pub.locator("[data-testid=pricing-no-price]")).toBeVisible();
  await pub.locator("[data-testid=pricing-module-safeguarding]").uncheck();
  await expect(pub.locator("[data-testid=pricing-total]")).toBeVisible();
  await pub.close();
  await go(s, "/platform/settings");
  await s.page.locator("[data-testid=setting-price_core]").fill("");
  await s.page.locator("[data-testid=pricing-settings-save]").click();
  await expect(s.page.getByText(/Pricing saved/)).toBeVisible();
  expectNoErrors(s);
  await s.context.close();
});
