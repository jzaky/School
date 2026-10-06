// Parents on a phone: install prompt, fees card, WhatsApp opt-in, push panel, career report and the offline page.
// Needs a server with WEB_PUSH_* and WHATSAPP_PROVIDER set to show the device options (see docs/deploy.md).
import { expect, test, type Browser, type Page } from "@playwright/test";
import { loginAs, type Locale } from "./helpers";

// Lets context.route() see the service worker's own requests (used by the offline check).
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = "1";

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const FEE_URL = "https://pay.horizon-school.example/fees";

async function phoneSession(browser: Browser, locale: Locale, persona = "parent") {
  const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, userAgent: IPHONE_UA, isMobile: true, hasTouch: true, deviceScaleFactor: 2, acceptDownloads: true });
  await context.addCookies([{ name: "NEXT_LOCALE", value: locale, url: baseURL }]);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
  page.on("response", (r) => {
    if (r.status() >= 500) errors.push(`http ${r.status()} ${r.url()}`);
  });
  await page.goto("/demo");
  await page.locator(`[data-testid=enter-${persona}]`).click();
  await page.waitForURL(new RegExp(`/${locale}/home`), { timeout: 120_000 });
  return { context, page, errors };
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function setFees(browser: Browser, url: string) {
  const admin = await loginAs(browser, "admin", "en");
  await admin.page.goto("/en/admin/school");
  await admin.page.locator("#fee-url").fill(url);
  await admin.page.locator("#fee-contact").fill(url ? "accounts@horizon.example" : "");
  await admin.page.locator("[data-testid=fee-save]").click();
  await expect(admin.page.getByText(/Saved/).first()).toBeVisible();
  if (url && (await admin.page.locator("[data-testid=whatsapp-kinds]").count())) {
    const sw = admin.page.locator("[data-testid=wa-kind-request_completed]");
    if ((await sw.getAttribute("data-state")) !== "checked") await sw.click();
    await admin.page.locator("[data-testid=whatsapp-kinds-save]").click();
  }
  await admin.context.close();
}

test.describe("parents on a phone", () => {
  test.beforeAll(async ({ browser }) => {
    await setFees(browser, FEE_URL);
  });
  test.afterAll(async ({ browser }) => {
    await setFees(browser, "");
  });

  for (const locale of ["en", "ar"] as Locale[]) {
    test(`home, fees, install prompt and settings (${locale})`, async ({ browser }) => {
      const s = await phoneSession(browser, locale);
      const { page } = s;
      await expect(page.locator("html")).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");

      // Install prompt with the iOS steps, dismissed and remembered on this device.
      await expect(page.locator("[data-testid=install-prompt]")).toBeVisible();
      await expect(page.locator("[data-testid=install-ios-steps]")).toBeVisible();
      await page.screenshot({ path: `test-results/parents-home-${locale}.png`, fullPage: false });
      await page.locator("[data-testid=install-dismiss]").click();
      await expect(page.locator("[data-testid=install-prompt]")).toHaveCount(0);
      await page.reload();
      await expect(page.locator("[data-testid=fees-card]")).toBeVisible();
      await expect(page.locator("[data-testid=install-prompt]")).toHaveCount(0);

      // Pay fees links out to the school's own portal.
      await expect(page.locator("[data-testid=pay-fees]")).toHaveAttribute("href", FEE_URL);
      await expect(page.locator("[data-testid=pay-fees]")).toHaveAttribute("target", "_blank");
      await noSidewaysScroll(page);
      await page.goto(`/${locale}/fees`);
      await expect(page.locator("[data-testid=fees-card]")).toBeVisible();
      await noSidewaysScroll(page);

      // Settings: the device panel (push) and WhatsApp opt-in with consent.
      await page.goto(`/${locale}/settings`);
      await expect(page.locator("[data-testid=push-device]")).toBeVisible();
      const optIn = page.locator("[data-testid=whatsapp-optin]");
      if (await optIn.count()) {
        if (await page.locator("[data-testid=whatsapp-off]").count()) await page.locator("[data-testid=whatsapp-off]").click();
        await expect(page.locator("[data-testid=whatsapp-on]")).toBeDisabled();
        await page.locator("#wa-phone").fill("050 123 4567");
        await page.locator("[data-testid=whatsapp-consent]").click();
        await page.locator("[data-testid=whatsapp-on]").click();
        await expect(page.locator("[data-testid=whatsapp-off]")).toBeVisible();
        await expect(optIn).toContainText("4567");
        await expect(page.locator("[data-testid=pref-request_completed-whatsapp]")).toBeVisible();
      }
      await page.screenshot({ path: `test-results/parents-settings-${locale}.png`, fullPage: true });
      await noSidewaysScroll(page);
      expect(s.errors, s.errors.join("\n")).toEqual([]);
      await s.context.close();
    });
  }

  test("career report: download on a phone, and parents only for their own children", async ({ browser }) => {
    // The demo parent's children have not taken the assessment yet, so the career advisor downloads a report.
    const advisor = await phoneSession(browser, "ar", "career_advisor");
    await advisor.page.goto("/ar/career");
    const href = await advisor.page.locator("a[href*='/career/students/']").first().getAttribute("href");
    expect(href).toBeTruthy();
    const otherStudentId = href!.split("/career/students/")[1].split(/[?#]/)[0];
    await advisor.page.goto(href!);
    const [download] = await Promise.all([advisor.page.waitForEvent("download"), advisor.page.locator("[data-testid=career-report-download]").click()]);
    const fs = await import("node:fs");
    expect(fs.readFileSync((await download.path())!).subarray(0, 5).toString()).toBe("%PDF-");
    await noSidewaysScroll(advisor.page);
    await advisor.context.close();

    // A parent gets the same 404 for another family's child as for an id that does not exist.
    const parent = await phoneSession(browser, "ar");
    expect((await parent.page.request.get(`/api/career/report?student=${otherStudentId}`)).status()).toBe(404);
    expect((await parent.page.request.get("/api/career/report?student=does-not-exist")).status()).toBe(404);
    await parent.context.close();
  });

  test("offline fallback page", async ({ browser }) => {
    const s = await phoneSession(browser, "en");
    const { page, context } = s;
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    // Playwright's offline switch does not reach service worker fetches, so the page request is failed instead.
    await context.route("**/en/settings", (r) => r.abort("internetdisconnected"));
    await page.goto("/en/settings");
    await expect(page.getByText("You are offline")).toBeVisible();
    await expect(page.getByText("أنت غير متصل بالإنترنت")).toBeVisible();
    await noSidewaysScroll(page);
    await context.close();
  });
});
