// Attendance and grade publishing, end to end against a running server (E2E_BASE_URL):
// a teacher takes a register on a 390px phone (with a dropped connection), the attendance office follows up,
// a parent reads their child's attendance, the principal exports reports and a certificate, and the Head of IT
// releases grades and report cards. English and Arabic. The specs change the demo data, which resets nightly.
import { expect, test, type Browser, type Page } from "@playwright/test";
import { expectNoErrors, go, loginAs, type Locale } from "./helpers";

const SHOTS = process.env.E2E_SHOTS ?? "";
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
};

async function phone(browser: Browser, persona: "teacher" | "parent" | "registrar", locale: Locale) {
  const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await context.addCookies([{ name: "NEXT_LOCALE", value: locale, url: baseURL }]);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
  page.on("response", (r) => r.status() >= 500 && errors.push(`http ${r.status()} ${r.url()}`));
  await page.goto("/demo");
  await page.locator(`[data-testid=enter-${persona}]`).click();
  await page.waitForURL(new RegExp(`/${locale}/home`), { timeout: 120_000 });
  return { context, page, errors };
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

for (const locale of ["en", "ar"] as const) {
  test(`teacher takes the 9A register on a phone (${locale})`, async ({ browser }) => {
    const { context, page, errors } = await phone(browser, "teacher", locale);
    await page.goto(`/${locale}/attendance`);
    await expect(page.locator("[data-testid=register-card]").first()).toBeVisible();
    await noSidewaysScroll(page);
    await shot(page, `teacher-${locale}-today`);
    await page.locator("[data-testid=register-card][data-kind=DAILY]").first().click();
    await page.waitForURL(/\/attendance\/take/);
    await expect(page.locator("html")).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");
    const closed = await page.locator("[data-testid=banner-closed]").count();
    if (closed) {
      // After the school's close time the teacher can only look; the office changes marks.
      await expect(page.locator("[data-testid=mark-present]").first()).toBeDisabled();
      await shot(page, `teacher-${locale}-closed`);
      await context.close();
      return;
    }
    await expect(page.locator("[data-testid=taker-row]").first()).toBeVisible();
    await noSidewaysScroll(page);
    const allPresent = page.locator("[data-testid=all-present]");
    if (await allPresent.isEnabled()) {
      await allPresent.click();
      await expect(page.locator("[data-testid=count-unmarked]")).toContainText("0");
    }
    // Adjust: mark the second student absent, then back to present.
    const row = page.locator("[data-testid=taker-row]").nth(1);
    await row.locator("[data-testid=mark-absent]").click();
    await expect(row).toHaveAttribute("data-code", "A");
    await expect(page.locator("[data-testid=save-state]")).toHaveAttribute("data-state", "saved", { timeout: 30_000 });
    await shot(page, `teacher-${locale}-taken`);

    // The connection drops: the change waits on the device and goes out when it is back.
    await context.setOffline(true);
    await row.locator("[data-testid=mark-present]").click();
    await expect(page.locator("[data-testid=save-state]")).toHaveAttribute("data-state", "offline", { timeout: 20_000 });
    await shot(page, `teacher-${locale}-offline`);
    await context.setOffline(false);
    await expect(page.locator("[data-testid=save-state]")).toHaveAttribute("data-state", "saved", { timeout: 60_000 });

    // The marks are on the server.
    await page.reload();
    await expect(page.locator("[data-testid=taker-row]").nth(1)).toHaveAttribute("data-code", "P");
    await expect(page.locator("[data-testid=count-unmarked]")).toContainText("0");
    expect(errors).toEqual([]);
    await context.close();
  });
}

test("attendance office follows up unexplained absences", async ({ browser }) => {
  const s = await loginAs(browser, "registrar", "en");
  await go(s, "/attendance/office");
  await expect(s.page.locator("[data-testid=followup-row]").first()).toBeVisible();
  await s.page.locator("[data-testid=run-followup]").click();
  await expect(s.page.getByText(/No new messages|messaged/).first()).toBeVisible({ timeout: 30_000 });
  // A family held for staff contact is never messaged automatically (the row stays marked held once explained too).
  const heldText = "No automatic message: contact the family yourself";
  await go(s, "/attendance/office?status=ALL");
  await expect(s.page.getByText(heldText).first()).toBeVisible();
  await go(s, "/attendance/office");
  await expect(s.page.locator("[data-testid=stat-open]")).toBeVisible();
  await shot(s.page, "office-en");
  const notHeld = s.page.locator("[data-testid=followup-row]").filter({ hasNotText: heldText });
  const row = notHeld.and(s.page.locator("[data-status=OPEN]")).first();
  if (await row.count()) {
    await row.locator("[data-testid=log-call]").click();
    await s.page.locator("[data-testid=office-confirm]").click();
    await expect(s.page.getByText("Call logged")).toBeVisible();
  }
  const open = notHeld.first();
  await open.locator("[data-testid=mark-explained]").click();
  await s.page.locator("[data-testid=explain-code]").click();
  await s.page.getByRole("option").filter({ hasText: "Unauthorised absence" }).click();
  await s.page.locator("[data-testid=office-confirm]").click();
  await expect(s.page.getByText("Absence explained")).toBeVisible();
  await expect(s.page.locator("[data-testid=limit-list]")).toBeVisible();
  await go(s, "/attendance/office");
  expectNoErrors(s);
  await s.context.close();
});

test("attendance office in Arabic on a phone", async ({ browser }) => {
  const { context, page, errors } = await phone(browser, "registrar", "ar");
  await page.goto("/ar/attendance/office");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("[data-testid=stat-open]")).toBeVisible();
  await noSidewaysScroll(page);
  await shot(page, "office-ar-phone");
  expect(errors).toEqual([]);
  await context.close();
});

for (const locale of ["en", "ar"] as const) {
  test(`parent sees their child's attendance (${locale})`, async ({ browser }) => {
    const { context, page, errors } = await phone(browser, "parent", locale);
    await page.goto(`/${locale}/children`);
    await expect(page.locator("[data-testid=child-attendance]")).toBeVisible();
    await expect(page.locator("[data-testid=child-attendance-pct]")).toContainText("%");
    await noSidewaysScroll(page);
    await shot(page, `parent-${locale}-child`);
    expect(errors).toEqual([]);
    await context.close();
  });
}

test("principal reads reports, exports them and opens a certificate", async ({ browser }) => {
  const s = await loginAs(browser, "principal", "en");
  await go(s, "/attendance/reports");
  await expect(s.page.locator("[data-testid=stat-attendance]")).toContainText("%");
  await expect(s.page.locator("[data-testid=rollup]")).toBeVisible();
  const csv = await s.page.request.get(await s.page.locator("[data-testid=export-csv]").getAttribute("href") ?? "");
  expect(csv.status()).toBe(200);
  expect(await csv.text()).toContain("attendance_percent");
  const xlsx = await s.page.request.get(await s.page.locator("[data-testid=export-xlsx]").getAttribute("href") ?? "");
  expect(xlsx.headers()["content-type"]).toContain("spreadsheetml");
  await s.page.locator("[data-testid=tab-students]").click();
  await s.page.waitForURL(/view=students/);
  await expect(s.page.locator("[data-testid=student-table]")).toBeVisible();
  await s.page.locator("[data-testid=student-row] a").first().click();
  await s.page.waitForURL(/student=/);
  await expect(s.page.locator("[data-testid=report-student]")).toBeVisible();
  for (const lang of ["en", "ar"]) {
    const href = await s.page.locator(`[data-testid=certificate-${lang}]`).getAttribute("href");
    const pdf = await s.page.request.get(href ?? "");
    expect(pdf.headers()["content-type"]).toBe("application/pdf");
  }
  await shot(s.page, "principal-student-report");
  expectNoErrors(s);
  await s.context.close();
});

for (const locale of ["en", "ar"] as const) {
  test(`Head of IT releases grades and report cards (${locale})`, async ({ browser }) => {
    const s = await loginAs(browser, "head_of_it", locale);
    await go(s, "/grades/publish");
    await expect(s.page.locator("[data-testid=stat-ready]")).toBeVisible();
    await shot(s.page, `it-${locale}-queue`);
    if (locale === "en") {
      const rows = s.page.locator("[data-testid=queue-ready] [data-testid=queue-row]");
      const before = await rows.count();
      if (before > 0) {
        await rows.first().locator("[data-testid=publish-one]").click();
        await s.page.locator("[data-testid=confirm-publish-queue]").click();
        await expect(s.page.getByText(/1 assessment published/)).toBeVisible();
        await expect(rows).toHaveCount(before - 1);
      }
      await go(s, "/grades/publish?tab=cards");
      if (await s.page.locator("[data-testid=release-all]").count()) {
        await s.page.locator("[data-testid=release-all]").click();
        await expect(s.page.getByText(/report cards? released/)).toBeVisible();
        await expect(s.page.locator("[data-testid=queue-cards]")).toHaveCount(0);
      }
    }
    // No case or safeguarding access.
    const cases = await s.page.goto(`/${locale}/cases`);
    expect(cases?.status()).toBe(404);
    await s.context.close();
  });
}
