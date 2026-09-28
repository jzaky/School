import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

export type Locale = "en" | "ar";
export type Persona =
  | "admin"
  | "principal"
  | "teacher"
  | "counselor"
  | "career_advisor"
  | "dsl"
  | "student"
  | "parent"
  | "registrar"
  | "hod_computing"
  | "deputy_dsl";

export const LOCALES: Locale[] = ["en", "ar"];

export type Session = { context: BrowserContext; page: Page; locale: Locale; errors: string[] };

/** A fresh browser context signed in as a demo persona, in the chosen locale. */
export async function loginAs(browser: Browser, persona: Persona, locale: Locale = "en"): Promise<Session> {
  const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
  const context = await browser.newContext({ baseURL, viewport: { width: 1300, height: 900 }, acceptDownloads: true });
  await context.addCookies([{ name: "NEXT_LOCALE", value: locale, url: baseURL }]);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${String(e).slice(0, 300)}`));
  page.on("response", (r) => {
    if (r.status() >= 500) errors.push(`http ${r.status()} ${r.url()}`);
  });
  await page.goto("/demo");
  await page.locator(`[data-testid=enter-${persona}]`).click();
  await page.waitForURL(new RegExp(`/${locale}/home`), { timeout: 120_000 });
  await expect(page.locator("html")).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");
  return { context, page, locale, errors };
}

/** Go to a product path in the session locale, for example go(s, "/approvals"). */
export async function go(s: Session, path: string) {
  await s.page.goto(`/${s.locale}${path}`);
}

/** Fail the test if the page threw or the server returned a 5xx. */
export function expectNoErrors(s: Session) {
  expect(s.errors, s.errors.join("\n")).toEqual([]);
}

/** Pick an option from a searchable picker (student, staff or subject). */
export async function pickOption(page: Page, testId: string, search: string) {
  await page.locator(`[data-testid=${testId}]`).click();
  const input = page.locator("[cmdk-input]").last();
  await input.fill(search);
  const item = page.locator("[cmdk-item]").first();
  await item.waitFor();
  await item.click();
  await expect(page.locator(`[data-testid=${testId}]`)).not.toContainText(/^$/);
}

/** Choose a free slot in the booking picker. Picks one of the next few days and a random time, to avoid collisions with other runs. Returns the day key (YYYY-MM-DD, Dubai). */
export async function pickSlot(page: Page): Promise<string> {
  const days = page.locator("[data-testid=day-strip] button");
  await days.first().waitFor({ timeout: 60_000 });
  const n = await days.count();
  const dayIdx = Math.floor(Math.random() * Math.min(n, 6));
  const day = days.nth(dayIdx);
  const dayKey = (await day.getAttribute("data-testid"))!.replace(/^day-/, "");
  await day.click();
  await expect(day).toHaveClass(/bg-brand/);
  const slots = page.locator("[data-testid=time-slot]");
  await slots.first().waitFor({ timeout: 60_000 });
  const m = await slots.count();
  await slots.nth(Math.floor(Math.random() * m)).click();
  return dayKey;
}

/** Click the form Next button until the submit button shows. */
export async function advanceToSubmit(page: Page, max = 6) {
  for (let i = 0; i < max; i++) {
    if (await page.locator("[data-testid=form-submit]").isVisible()) return;
    await page.locator("[data-testid=form-next]").click();
    await page.waitForTimeout(350);
  }
  await expect(page.locator("[data-testid=form-submit]")).toBeVisible();
}

/** Reopen the first form step, in case a saved draft put the form part way through. */
export async function toFirstStep(page: Page) {
  const back = page.locator("[data-testid=form-back]");
  for (let i = 0; i < 6 && (await back.isVisible()); i++) {
    await back.click();
    await page.waitForTimeout(250);
  }
}

/** Unique marker for text fields, so a test can find the record it created. */
export function marker(prefix: string) {
  return `${prefix} ${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
}

/** The id at the end of a /requests/<id> or /cases/<id> url. */
export function idFromUrl(url: string, segment: string) {
  const m = url.match(new RegExp(`/${segment}/([^/?#]+)`));
  if (!m) throw new Error(`no ${segment} id in ${url}`);
  return m[1];
}
