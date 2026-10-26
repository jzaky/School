// Limited admin access: the administrator tries to give herself safeguarding access and is stopped, gives a
// teacher time-limited Deputy DSL cover, opens "Who can see what" and exports it; then the DSL sees the alert.
// English and Arabic, desktop and phone. Runs against the shared demo school and cleans up after itself.
import { expect, test, type Browser, type Page } from "@playwright/test";
import { expectNoErrors, pickOption, type Locale } from "./helpers";

const SHOTS = process.env.E2E_SHOTS ?? "test-results/limited-admin";
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.jpg`, type: "jpeg", quality: 60, fullPage: true });
const dubaiDay = (plusDays: number) => new Date(Date.now() + 4 * 3_600_000 + plusDays * 86_400_000).toISOString().slice(0, 10);

type Device = "desktop" | "phone";

async function session(browser: Browser, persona: string, locale: Locale, device: Device) {
  const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
  const phone = device === "phone";
  const context = await browser.newContext({ baseURL, viewport: phone ? { width: 390, height: 844 } : { width: 1300, height: 900 }, isMobile: phone, hasTouch: phone, acceptDownloads: true });
  await context.addCookies([{ name: "NEXT_LOCALE", value: locale, url: baseURL }]);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${String(e).slice(0, 300)}`));
  page.on("response", (r) => r.status() >= 500 && errors.push(`http ${r.status()} ${r.url()}`));
  await page.goto("/demo");
  await page.locator(`[data-testid=enter-${persona}]`).click();
  await page.waitForURL(new RegExp(`/${locale}/home`), { timeout: 120_000 });
  return { context, page, errors, locale };
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

const TEXT = {
  en: { selfNote: "You hold this role", notListed: "You are not in this list", until: "until", report: "Who can see what", endNow: "End now" },
  ar: { selfNote: "أنت تحمل هذا الدور", notListed: "لست ضمن هذه القائمة", until: "حتى", report: "من يطّلع على ماذا", endNow: "إنهاء الآن" },
};

for (const locale of ["en", "ar"] as Locale[]) {
  for (const device of ["desktop", "phone"] as Device[]) {
    test(`admin cannot self-grant, gives time-limited cover and opens the access report (${locale}, ${device})`, async ({ browser }) => {
      const s = await session(browser, "admin", locale, device);
      const p = s.page;
      const tx = TEXT[locale];

      // 1. Her own role: safeguarding switches are locked and the page says why.
      await p.goto(`/${locale}/admin/roles/school_admin`);
      await expect(p.getByTestId("self-role-note")).toContainText(tx.selfNote);
      const sw = p.getByTestId("perm-safeguarding.view");
      await expect(sw).toBeDisabled();
      await expect(sw).toHaveAttribute("data-self-blocked", "yes");
      await expect(p.getByTestId("perm-calendar.manage")).toBeEnabled();
      if (device === "desktop") {
        await p.getByTestId("locked-control").filter({ has: sw }).hover();
        await expect(p.getByRole("tooltip")).toContainText(locale === "en" ? "Another person who manages roles has to do it" : "شخص آخر ممن يديرون الأدوار");
      }
      await shot(p, `self-grant-${locale}-${device}`);
      await noHorizontalScroll(p);

      // 2. The DSL role does not offer her as a member.
      await p.goto(`/${locale}/admin/roles/dsl`);
      await expect(p.getByTestId("self-note")).toContainText(tx.notListed);
      await p.getByTestId("add-member-picker").click();
      await p.locator("[cmdk-input]").last().fill("Aisha");
      await expect(p.locator("[cmdk-item]")).toHaveCount(0);
      await p.keyboard.press("Escape");

      // 3. Time-limited cover: Daniel Carter becomes Deputy DSL for a week, then it is extended and ended early.
      await p.goto(`/${locale}/admin/roles/deputy_dsl`);
      const row = p.getByTestId("role-member").filter({ hasText: "daniel.carter" });
      if ((await row.count()) > 0) await row.getByTestId("remove-member").click();
      await expect(row).toHaveCount(0);
      await pickOption(p, "add-member-picker", "Daniel Carter");
      await p.getByTestId("add-member-until").fill(dubaiDay(7));
      await p.getByTestId("add-member-ack").click();
      await p.getByTestId("add-member").click();
      await expect(row).toHaveAttribute("data-until", dubaiDay(7));
      await expect(row).toContainText(tx.until);
      await row.getByTestId("assignment-end").click();
      await p.getByTestId("assignment-end-date").fill(dubaiDay(14));
      await p.getByTestId("assignment-end-save").click();
      await expect(row).toHaveAttribute("data-until", dubaiDay(14));
      await shot(p, `time-limited-${locale}-${device}`);
      await noHorizontalScroll(p);

      // 4. Who can see what: Daniel's cover appears with its end date; export is recorded.
      await p.goto(`/${locale}/admin/roles/report`);
      await expect(p.locator("h1")).toHaveText(tx.report);
      const sg = p.getByTestId("access-report-row").filter({ hasText: "daniel.carter" });
      await expect(sg.first()).toContainText(tx.until);
      await expect(p.getByTestId("access-report-row").filter({ hasText: "hannah.morrison" }).first()).toBeVisible();
      await noHorizontalScroll(p);
      await shot(p, `report-${locale}-${device}`);
      if (device === "desktop") {
        const [download] = await Promise.all([p.waitForEvent("download"), p.getByTestId("access-report-export").click()]);
        const path = await download.path();
        const csv = path ? (await import("node:fs")).readFileSync(path, "utf8") : "";
        expect(csv).toContain("granted_by_role");
        expect(csv).toContain("daniel.carter");
        await p.goto(`/${locale}/admin/audit?preset=access&days=7`);
        await expect(p.getByTestId("audit-row").first()).toBeVisible();
        await expect(p.getByTestId("audit-detail").first()).toBeVisible();
        await shot(p, `audit-access-${locale}-${device}`);
      }

      // 5. End the cover early so the next run starts clean.
      await p.goto(`/${locale}/admin/roles/deputy_dsl`);
      await row.getByTestId("remove-member").click();
      await expect(row).toHaveCount(0);
      expect(s.errors, s.errors.join("\n")).toEqual([]);
      await s.context.close();
    });
  }
}

test("the safeguarding lead sees the access alert and the report (en and ar)", async ({ browser }) => {
  for (const locale of ["en", "ar"] as Locale[]) {
    const s = await session(browser, "dsl", locale, locale === "en" ? "desktop" : "phone");
    await s.page.goto(`/${locale}/notifications`);
    const alert = s.page.getByTestId("notification-row").filter({ hasText: locale === "en" ? "Safeguarding access changed by" : "تغيير في صلاحيات الحماية" });
    await expect(alert.first()).toBeVisible();
    await expect(alert.first()).toHaveAttribute("data-href", "/admin/roles/report");
    await shot(s.page, `dsl-alert-${locale}`);
    await alert.first().click();
    await s.page.waitForURL(/\/admin\/roles\/report/);
    await expect(s.page.getByTestId("area-safeguarding")).toBeVisible();
    // The DSL reviews access but does not manage roles: no tabs to the roles screens.
    await expect(s.page.getByTestId("tab-roles")).toHaveCount(0);
    await noHorizontalScroll(s.page);
    await shot(s.page, `dsl-report-${locale}`);
    expectNoErrors({ ...s, locale });
    await s.context.close();
  }
});
