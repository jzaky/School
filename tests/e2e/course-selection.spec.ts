// Course selection windows, assisted choosing, class sessions, exceptions and sign-off, in English and
// Arabic. Students, teachers and parents on a 390px phone; the admin on a desktop. The tests change the
// demo school (Adam's next year choices, a class session, a window and an exception) in ways a demo reset
// restores; each run works from whatever the previous run left.
import { expect, test, type Browser, type Page } from "@playwright/test";
import { LOCALES, loginAs, type Locale, type Persona } from "./helpers";

const SHOTS = process.env.E2E_SHOTS_DIR ?? "test-results";
const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";

async function phone(browser: Browser, persona: Persona, locale: Locale) {
  const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, userAgent: ANDROID_UA, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await context.addCookies([{ name: "NEXT_LOCALE", value: locale, url: baseURL }]);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror ${String(e).slice(0, 300)}`));
  page.on("response", (r) => {
    if (r.status() >= 500) errors.push(`http ${r.status()} ${r.url()}`);
  });
  await page.goto("/demo");
  await page.locator(`[data-testid=enter-${persona}]`).click();
  await page.waitForURL(new RegExp(`/${locale}/home`), { timeout: 120_000 });
  return { context, page, errors, locale };
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

/** Pick one option in each block (by subject code), then submit. */
async function chooseAndSubmit(page: Page, codes: string[]) {
  for (const code of codes) {
    const option = page.locator(`[data-testid=option-${code}]`);
    await option.scrollIntoViewIfNeeded();
    await option.click();
    await expect(option).toHaveAttribute("aria-checked", "true");
  }
  const submit = page.locator("[data-testid=submit-registration]");
  await submit.scrollIntoViewIfNeeded();
  await submit.click();
  await expect(page.locator("[data-testid=registered-state]")).toBeVisible({ timeout: 30_000 });
}

const ADAM = { en: "Adam", ar: "آدم" };
const DANIEL = { en: "Daniel Carter", ar: "دانيال كارتر" };
const RANIA = { en: "Rania Nasser", ar: "رانيا ناصر" };
// Two sets of next year's American Grade 10 courses without prerequisites, so each run changes something.
const PICKS = { en: ["PHYS", "US_INTRO_CS", "US_WORLD_HIST", "US_ART"], ar: ["US_CHEM_H", "US_INTRO_CS", "US_BUSINESS", "US_ROBOTICS"] };

let sessionCode = "";

for (const locale of LOCALES) {
  test.describe(`course selection (${locale})`, () => {
    test.describe.configure({ mode: "serial" });

    test("student on a phone: closed this year, open next year with a countdown, and lets a teacher help", async ({ browser }) => {
      const s = await phone(browser, "student", locale);
      const { page } = s;
      // This year's choices are locked, with who to ask.
      await page.goto(`/${locale}/subjects?year=current`);
      const banner = page.locator("[data-testid=window-banner]");
      await expect(banner).toHaveAttribute("data-state", "closed");
      await expect(page.locator("[data-testid=read-only-note]")).toBeVisible();
      await expect(page.locator("[data-testid=submit-registration]")).toHaveCount(0);
      await expect(banner).toContainText(DANIEL[locale]);
      await noSidewaysScroll(page);
      await page.screenshot({ path: `${SHOTS}/cs-student-closed-${locale}.png` });
      // Next year: open, with a live countdown.
      await page.goto(`/${locale}/subjects`);
      await expect(banner).toHaveAttribute("data-state", "open");
      await expect(banner).toContainText(/\d/);
      await noSidewaysScroll(page);
      await page.screenshot({ path: `${SHOTS}/cs-student-open-${locale}.png` });
      // Let my homeroom teacher help (the first person offered), until the window closes.
      await page.locator("[data-testid=let-someone-help]").click();
      const dialog = page.locator("[data-slot=dialog-content]");
      await expect(dialog).toBeVisible();
      await dialog.locator("[data-testid^=helper-option-]").first().click();
      await page.screenshot({ path: `${SHOTS}/cs-student-grant-${locale}.png` });
      await dialog.locator("[data-testid=helper-save]").click();
      await expect(dialog).toBeHidden();
      await expect(page.locator("[data-testid=helper-row]", { hasText: DANIEL[locale] })).toBeVisible();
      await noSidewaysScroll(page);
      expect(s.errors, s.errors.join("\n")).toEqual([]);
      await s.context.close();
    });

    test("teacher on a phone: starts a class session and helps Adam choose", async ({ browser }) => {
      const s = await phone(browser, "teacher", locale);
      const { page } = s;
      await page.goto(`/${locale}/subjects/session`);
      const card = page.locator("[data-testid=session-class]").first();
      await expect(card).toBeVisible();
      // A session may already be running (the demo has one): end it, then start a 30 minute one.
      if (await card.locator("[data-testid=session-open-live]").count()) {
        await card.locator("[data-testid=session-open-live]").click();
        await page.locator("[data-testid=session-end]").click();
        await page.locator("[data-testid=session-end-confirm]").click();
        await expect(page.locator("[data-testid=session-state]")).toHaveAttribute("data-active", "false");
        await page.goto(`/${locale}/subjects/session`);
      }
      await page.locator("[data-testid=session-class]").first().locator("[data-testid=session-minutes-30]").click();
      await page.locator("[data-testid=session-class]").first().locator("[data-testid=session-start]").click();
      await page.waitForURL(/\/subjects\/session\/[^/]+$/);
      await expect(page.locator("[data-testid=session-state]")).toHaveAttribute("data-active", "true");
      await expect(page.locator("[data-testid=session-qr]")).toBeVisible();
      await expect(page.locator("[data-testid=session-link]")).toContainText("/choose/");
      sessionCode = ((await page.locator("[data-testid=session-link]").textContent()) ?? "").split("/choose/")[1]?.trim() ?? "";
      await expect(page.locator("[data-testid=session-student]").first()).toBeVisible();
      await noSidewaysScroll(page);
      await page.screenshot({ path: `${SHOTS}/cs-teacher-session-${locale}.png`, fullPage: true });

      // Help a student choose: Adam asked for help.
      await page.goto(`/${locale}/subjects/help`);
      const asked = page.locator("[data-testid=asked-row]", { hasText: ADAM[locale] });
      await expect(asked).toBeVisible();
      await noSidewaysScroll(page);
      await page.screenshot({ path: `${SHOTS}/cs-teacher-help-${locale}.png` });
      await asked.locator("[data-testid=help-open]").click();
      await expect(page.locator("[data-testid=behalf-banner]")).toBeVisible();
      await expect(page.locator("[data-testid=impact-intro]")).toBeVisible();
      await chooseAndSubmit(page, PICKS[locale]);
      await expect(page.locator("[data-testid=chosen-by]", { hasText: DANIEL[locale] }).first()).toBeVisible();
      await expect(page.locator("[data-testid=last-by]")).toContainText(DANIEL[locale]);
      await noSidewaysScroll(page);
      await page.screenshot({ path: `${SHOTS}/cs-teacher-chose-${locale}.png` });
      expect(s.errors, s.errors.join("\n")).toEqual([]);
      await s.context.close();
    });

    test("student scans the class session link", async ({ browser }) => {
      expect(sessionCode).toMatch(/^[A-Z0-9]{6}$/);
      const s = await phone(browser, "student", locale);
      const { page } = s;
      await page.goto(`/choose/${sessionCode}`);
      await page.waitForURL(new RegExp(`/${locale}/subjects\\?year=next`));
      await expect(page.locator("[data-testid=window-banner]")).toBeVisible();
      expect(s.errors, s.errors.join("\n")).toEqual([]);
      await s.context.close();
    });

    test("parent on a phone: sees who chose, confirms, then helps Adam choose", async ({ browser }) => {
      const s = await phone(browser, "parent", locale);
      const { page } = s;
      await page.goto(`/${locale}/subjects`);
      await expect(page.locator("[data-testid=behalf-banner]")).toBeVisible();
      await expect(page.locator("[data-testid=chosen-by]", { hasText: DANIEL[locale] }).first()).toBeVisible();
      await expect(page.locator("[data-testid=status-pill]")).toHaveAttribute("data-status", "submitted");
      await page.screenshot({ path: `${SHOTS}/cs-parent-sees-${locale}.png` });
      await page.locator("[data-testid=sign-off]").click();
      await expect(page.locator("[data-testid=status-pill]")).toHaveAttribute("data-status", "signed_off");
      // Rania was allowed to help: she changes one course on Adam's behalf; her own choice counts as sign-off.
      const other = locale === "en" ? "US_CHEM_H" : "PHYS";
      await page.locator(`[data-testid=option-${other}]`).click();
      await page.locator("[data-testid=submit-registration]").click();
      await expect(page.locator("[data-testid=registered-state]")).toBeVisible({ timeout: 30_000 });
      await expect(page.locator("[data-testid=status-pill]")).toHaveAttribute("data-status", "signed_off");
      await expect(page.locator(`[data-testid=option-${other}] [data-testid=chosen-by]`)).toContainText(RANIA[locale]);
      await noSidewaysScroll(page);
      await page.screenshot({ path: `${SHOTS}/cs-parent-helped-${locale}.png`, fullPage: true });
      expect(s.errors, s.errors.join("\n")).toEqual([]);
      await s.context.close();
    });

    test("student sees who chose for them", async ({ browser }) => {
      const s = await phone(browser, "student", locale);
      const { page } = s;
      await page.goto(`/${locale}/subjects`);
      await expect(page.locator("[data-testid=chosen-by]", { hasText: RANIA[locale] }).first()).toBeVisible();
      await expect(page.locator("[data-testid=chosen-by]", { hasText: DANIEL[locale] }).first()).toBeVisible();
      expect(s.errors, s.errors.join("\n")).toEqual([]);
      await s.context.close();
    });

    test("admin sets a window and allows a late change", async ({ browser }) => {
      const s = await loginAs(browser, "admin", locale);
      const { page } = s;
      await page.goto(`/${locale}/admin/registration/windows`);
      await expect(page.locator("[data-testid=window-card]").first()).toBeVisible();
      await expect(page.locator("[data-testid=selection-settings]")).toBeVisible();
      // A short Grade 12 window later this year (a random day, so runs do not overlap).
      const day = new Date(Date.now() + (40 + Math.floor(Math.random() * 120)) * 86_400_000 + 4 * 3_600_000).toISOString().slice(0, 10);
      const hour = String(8 + Math.floor(Math.random() * 6)).padStart(2, "0");
      await page.locator("[data-testid=window-new]").click();
      const dialog = page.locator("[data-slot=dialog-content]");
      await dialog.locator("[data-testid=window-year-current]").click();
      await dialog.locator("[data-testid=window-grade-12]").click();
      await dialog.locator("[data-testid=window-opens-date]").fill(day);
      await dialog.locator("[data-testid=window-opens-time]").fill(`${hour}:00`);
      await dialog.locator("[data-testid=window-closes-date]").fill(day);
      await dialog.locator("[data-testid=window-closes-time]").fill(`${hour}:30`);
      await page.screenshot({ path: `${SHOTS}/cs-admin-window-${locale}.png` });
      await dialog.locator("[data-testid=window-save]").click();
      await expect(dialog).toBeHidden();
      await expect(page.locator("[data-testid=window-card][data-state=upcoming]").first()).toBeVisible();

      // Grade 12 add and drop has closed: open its progress, a student, and allow a late change.
      const closed = page.locator("[data-testid=window-card][data-state=closed]").first();
      await closed.locator("[data-testid=window-open-overview]").click();
      await expect(page.locator("[data-testid=student-row]").first()).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/cs-admin-overview-${locale}.png` });
      await page.locator("[data-testid=student-row]").last().getByRole("link").click();
      await page.waitForURL(/\/subjects\?student=/);
      await page.locator("[data-testid=allow-changes]").click();
      const ex = page.locator("[data-slot=dialog-content]");
      await ex.locator("[data-testid=exception-reason]").fill(locale === "en" ? "Late change after a timetable clash" : "تغيير متأخر بسبب تعارض في الجدول");
      await ex.locator("[data-testid=exception-save]").click();
      await expect(ex).toBeHidden();
      await expect(page.locator("[data-testid=exception-row]").first()).toBeVisible();
      await expect(page.locator("[data-testid=window-banner]")).toHaveAttribute("data-state", "exception");
      await page.screenshot({ path: `${SHOTS}/cs-admin-exception-${locale}.png` });
      expect(s.errors, s.errors.join("\n")).toEqual([]);
      await s.context.close();
    });
  });
}
