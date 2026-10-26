// Admissions end to end: a family applies on a phone (English and Arabic), the admissions officer takes the
// application from new to enrolled, and the new family signs in to the parent portal with the invitation.
// Runs against the demo school (slug horizon), which shows the email code on screen. Creates its own family.
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

type Locale = "en" | "ar";
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const PDF = Buffer.from("%PDF-1.4\n1 0 obj <</Type /Catalog>> endobj\ntrailer <</Root 1 0 R>>\n%%EOF\n");
const PASSWORD = "Applicant2026!";
const run = Date.now().toString(36);
const letters = (s: string) => s.replace(/\d/g, (d) => "abcdefghij"[Number(d)]);

type Family = { locale: Locale; email: string; first: string; last: string; context: BrowserContext; page: Page; applicationId: string; errors: string[] };
const families: Partial<Record<Locale, Family>> = {};

async function phone(browser: Browser, locale: Locale) {
  const context = await browser.newContext({ baseURL: BASE, viewport: { width: 390, height: 844 }, userAgent: IPHONE_UA, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await context.addCookies([{ name: "NEXT_LOCALE", value: locale, url: BASE }]);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
  page.on("response", (r) => {
    if (r.status() >= 500) errors.push(`http ${r.status()} ${r.url()}`);
  });
  return { context, page, errors };
}

/** Optional screenshots for review: set ADM_SHOTS to a folder. */
async function shot(page: Page, name: string) {
  if (process.env.ADM_SHOTS) await page.screenshot({ path: `${process.env.ADM_SHOTS}/${name}.png`, fullPage: true });
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function staff(browser: Browser) {
  const context = await browser.newContext({ baseURL: BASE, viewport: { width: 1300, height: 900 } });
  await context.addCookies([{ name: "NEXT_LOCALE", value: "en", url: BASE }]);
  const page = await context.newPage();
  await page.goto("/demo");
  await page.locator("[data-testid=enter-admissions]").click();
  await page.waitForURL(/\/en\//, { timeout: 120_000 });
  return { context, page };
}

test.describe.serial("admissions", () => {
  for (const locale of ["en", "ar"] as Locale[]) {
    test(`a family applies on a phone (${locale})`, async ({ browser }) => {
      const { context, page, errors } = await phone(browser, locale);
      const fam: Family = { locale, email: `e2e.adm.${run}.${locale}@family.example`, first: locale === "en" ? "Maya" : "Salma", last: `Tester${letters(run)}`, context, page, applicationId: "", errors };
      families[locale] = fam;

      await page.goto(`/${locale}/apply/horizon`);
      await expect(page.locator("html")).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");
      await noSidewaysScroll(page);
      await shot(page, `family-${locale}-1-start`);
      await page.locator("[data-testid=acc-name]").fill(`Lina ${fam.last}`);
      await page.locator("[data-testid=acc-email]").fill(fam.email);
      await page.locator("[data-testid=acc-password]").fill(PASSWORD);
      await page.locator("[data-testid=account-submit]").click();
      // The demo school shows the code on screen (demo emails are not sent).
      const code = (await page.locator("[data-testid=demo-code]").textContent())?.trim() ?? "";
      expect(code).toMatch(/^\d{6}$/);
      await page.locator("[data-testid=code-input]").fill(code);
      await page.locator("[data-testid=verify-submit]").click();

      await expect(page.locator("[data-testid=start-application]")).toBeVisible();
      const yearName = (await page.locator("[data-testid=start-year] option:checked").textContent()) ?? "";
      const entry = Number(yearName.match(/\d{4}/)?.[0]);
      await page.locator("[data-testid=start-grade]").selectOption("-1");
      await page.locator("[data-testid=start-submit]").click();
      await page.waitForURL(new RegExp(`/${locale}/apply/horizon/[a-z0-9]+`));
      fam.applicationId = new URL(page.url()).pathname.split("/").pop()!;

      // 1. The child (KG1: four by 31 December of the year of entry).
      await expect(page.locator("[data-testid=wizard-student]")).toBeVisible();
      await page.locator("[data-testid=f-firstNameEn]").fill(fam.first);
      await page.locator("[data-testid=f-lastNameEn]").fill(fam.last);
      await page.locator("[data-testid=f-firstNameAr]").fill(locale === "en" ? "مايا" : "سلمى");
      await page.locator("[data-testid=f-dob]").fill(`${entry - 4}-05-10`);
      await page.locator("[data-testid=f-gender-F]").click();
      await page.locator("[data-testid=f-nationality]").selectOption("JO");
      await expect(page.locator("[data-testid=age-warning]")).toHaveCount(0);
      await noSidewaysScroll(page);
      await shot(page, `family-${locale}-2-child`);
      await page.locator("[data-testid=save-next]").click();

      // 2. Previous schooling: none yet.
      await expect(page.locator("[data-testid=wizard-schooling]")).toBeVisible();
      await page.locator("[data-testid=f-attended-false]").click();
      await page.locator("[data-testid=save-next]").click();

      // 3. Family: the parent applying is the first guardian (the portal invitation goes to this address).
      await expect(page.locator("[data-testid=wizard-family]")).toBeVisible();
      await page.locator("[data-testid=g0-relationship]").selectOption("MOTHER");
      await page.locator("[data-testid=g0-firstNameEn]").fill("Lina");
      await page.locator("[data-testid=g0-lastNameEn]").fill(fam.last);
      await page.locator("[data-testid=g0-email]").fill(fam.email);
      await page.locator("[data-testid=g0-phone]").fill("+971 50 555 0188");
      await noSidewaysScroll(page);
      await shot(page, `family-${locale}-3-family`);
      await page.locator("[data-testid=save-next]").click();

      // 4. Health and support.
      await expect(page.locator("[data-testid=wizard-health]")).toBeVisible();
      await page.locator("[data-testid=f-allergies]").fill("None known");
      await page.locator("[data-testid=save-next]").click();

      // 5. Documents: every required one, checked by content on the server.
      await expect(page.locator("[data-testid=wizard-documents]")).toBeVisible();
      for (const key of ["emirates_id", "passport", "residence_visa", "birth_certificate", "vaccination_record", "photo"]) {
        await page.locator(`[data-testid=file-${key}]`).setInputFiles({ name: `${key}.pdf`, mimeType: "application/pdf", buffer: PDF });
        await expect(page.locator(`[data-testid=doc-${key}]`)).toContainText(`${key}.pdf`);
      }
      await noSidewaysScroll(page);
      await page.mouse.move(1, 1);
      await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
      await shot(page, `family-${locale}-4-documents`);
      await page.locator("[data-testid=docs-continue]").click();

      // 6. Review and submit.
      await expect(page.locator("[data-testid=review]")).toBeVisible();
      await page.locator("[data-testid=consent]").click();
      await page.locator("[data-testid=submit-application]").click();
      await expect(page.locator("[data-testid=family-status]")).toBeVisible();
      await noSidewaysScroll(page);
      await shot(page, `family-${locale}-5-submitted`);
      expect(errors, errors.join("\n")).toEqual([]);
    });
  }

  test("the admissions officer takes the application to enrollment, and the family joins the portal", async ({ browser }) => {
    const fam = families.ar!;
    const { context, page } = await staff(browser);

    await page.goto(`/en/admissions/applications?q=${fam.last}`);
    await page.getByRole("link", { name: new RegExp(fam.first) }).first().click();
    await page.waitForURL(new RegExp(`/en/admissions/applications/${fam.applicationId}`));

    // Assessment, outcome and offer.
    await page.locator("[data-testid=btn-assessment]").click();
    // A random slot weeks ahead; if the officer is already booked then, try another.
    for (let attempt = 0; attempt < 6; attempt++) {
      const when = new Date(Date.now() + (20 + Math.floor(Math.random() * 60)) * 86_400_000).toISOString().slice(0, 10);
      await page.locator("[data-testid=assess-date]").fill(when);
      await page.locator("[data-testid=assess-time]").fill(`${String(8 + Math.floor(Math.random() * 6)).padStart(2, "0")}:${String(5 * Math.floor(Math.random() * 12)).padStart(2, "0")}`);
      await page.locator("[data-testid=assess-submit]").click();
      if (await page.locator("[data-testid=assessment-dialog]").waitFor({ state: "detached", timeout: 8_000 }).then(() => true, () => false)) break;
    }
    await expect(page.locator("[data-testid=assessment-dialog]")).toHaveCount(0);
    await page.locator("[data-testid=btn-outcome]").click();
    await page.locator("[data-testid=outcome-RECOMMENDED]").click();
    await page.locator("[data-testid=outcome-submit]").click();
    await expect(page.locator("[data-testid=outcome-dialog]")).toHaveCount(0);
    await page.locator("[data-testid=btn-offer]").click();
    await page.locator("[data-testid=offer-submit]").click();
    await expect(page.locator("[data-testid=offer-dialog]")).toHaveCount(0);

    // The family accepts on the phone and sees the offer letter and the seat booking amount.
    await fam.page.goto(`/ar/apply/horizon/${fam.applicationId}`);
    await expect(fam.page.locator("[data-testid=offer-card]")).toBeVisible();
    await expect(fam.page.locator("[data-testid=offer-letter]")).toBeVisible();
    await fam.page.locator("[data-testid=accept-offer]").click();
    await expect(fam.page.locator("[data-testid=seat-fee]")).toBeVisible();
    await noSidewaysScroll(fam.page);
    await shot(fam.page, "family-ar-6-offer-accepted");

    // Staff record the seat booking payment and enroll.
    await page.reload();
    await page.locator("[data-testid=btn-paid]").click();
    await page.locator("[data-testid=paid-ref]").fill(`RCPT-E2E-${run}`);
    await page.locator("[data-testid=paid-submit]").click();
    await expect(page.locator("[data-testid=paid-dialog]")).toHaveCount(0);
    await page.locator("[data-testid=btn-enroll]").click();
    await page.locator("[data-testid=enroll-submit]").click();
    await expect(page.locator("[data-testid=enroll-result]")).toBeVisible();
    const invite = await page.locator("[data-testid=invite-link]").first().getAttribute("href");
    expect(invite).toMatch(/^\/join\/[A-Za-z0-9_-]+$/);
    await shot(page, "staff-en-enrolled");
    await context.close();

    // The new family signs in with the account they applied with and sees their child.
    await fam.page.goto(invite!);
    await fam.page.locator("[data-testid=account-mode-signin]").click();
    await fam.page.locator("[data-testid=join-password]").fill(PASSWORD);
    await fam.page.locator("[data-testid=join-accept]").click();
    await fam.page.waitForURL(/\/ar\/home/, { timeout: 120_000 });
    await fam.page.goto("/ar/children");
    await expect(fam.page.getByText(/سلمى/).first()).toBeVisible();
    await noSidewaysScroll(fam.page);
    await shot(fam.page, "family-ar-7-portal-children");
    expect(fam.errors, fam.errors.join("\n")).toEqual([]);
  });

  test.afterAll(async () => {
    for (const f of Object.values(families)) await f?.context.close();
  });
});
