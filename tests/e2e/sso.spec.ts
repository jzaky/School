// Sign-in and rostering end to end:
// - the school sign-in page shows only configured options, with brand buttons, in English and Arabic at 390px;
// - ClassLink single sign-on through the local mock provider signs a teacher in, and another tenant is refused
//   (needs E2E_MOCK_IDP, for example http://127.0.0.1:3145, and the app started with the mock settings from
//   scripts/mock-idp.ts);
// - the administrator's sign-in settings save and change the sign-in page;
// - the roster preview of the demo ClassLink feed shows its changes and problems;
// - forgotten password in English and Arabic at 390px (the reset link is planted in the database, so this part
//   runs locally with MIGRATION_DATABASE_URL).
import { createHash, randomBytes } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
import pg from "pg";
import { config as loadEnv } from "dotenv";
import { expectNoErrors, go, LOCALES, loginAs, type Locale } from "./helpers";

loadEnv({ quiet: true });
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const MOCK = process.env.E2E_MOCK_IDP ?? "";
const local = /localhost|127\.0\.0\.1/.test(BASE);

async function phone(browser: Browser, locale: Locale) {
  const context = await browser.newContext({ baseURL: BASE, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await context.addCookies([{ name: "NEXT_LOCALE", value: locale, url: BASE }]);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror ${String(e).slice(0, 200)}`));
  page.on("response", (r) => r.status() >= 500 && errors.push(`http ${r.status()} ${r.url()}`));
  return { context, page, errors };
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function setMockUser(prefix: string, claims: Record<string, unknown>) {
  const res = await fetch(`${MOCK}/_mock/users/${prefix}`, { method: "POST", body: JSON.stringify(claims) });
  expect(res.ok).toBe(true);
}

for (const locale of LOCALES) {
  test(`school sign-in page shows only its configured options (${locale}, 390px)`, async ({ browser }) => {
    const { context, page, errors } = await phone(browser, locale);
    await page.goto("/login/horizon");
    await expect(page.getByTestId("school-name")).toBeVisible();
    await expect(page.getByTestId("sign-in-panel")).toBeVisible();
    // Clever has no district id and the school identity provider has no address yet: neither may show.
    await expect(page.getByTestId("sso-clever")).toHaveCount(0);
    await expect(page.getByTestId("sso-oidc")).toHaveCount(0);
    if (MOCK) {
      await expect(page.getByTestId("sso-classlink")).toBeVisible();
      await expect(page.getByTestId("sso-uaepass")).toBeVisible();
    }
    await expect(page.getByTestId("password-form")).toBeVisible();
    await expect(page.getByTestId("forgot-password")).toBeVisible();
    await noHorizontalScroll(page);
    await page.screenshot({ path: `test-results/sso-school-login-${locale}-390.png`, fullPage: true });
    await page.goto("/login/horizon?error=WRONG_TENANT");
    await expect(page.getByTestId("sign-in-error")).toBeVisible();
    await page.goto("/login/no-such-school-anywhere");
    expect((await page.request.get("/login/no-such-school-anywhere")).status()).toBe(404);
    expect(errors).toEqual([]);
    await context.close();
  });
}

test("ClassLink single sign-on signs a teacher in; another account or tenant is refused", async ({ browser }) => {
  test.skip(!MOCK, "needs the local mock identity provider (E2E_MOCK_IDP)");
  // Daniel Carter's ClassLink account is linked in the demo seed (subject cl-daniel-carter).
  await setMockUser("classlink", { sub: "cl-daniel-carter", email: "daniel.carter@horizon.example", given_name: "Daniel", family_name: "Carter", classLink_tenant_id: "1907", classLink_role: "teacher" });
  const context = await browser.newContext({ baseURL: BASE });
  await context.addCookies([{ name: "NEXT_LOCALE", value: "en", url: BASE }]);
  const page = await context.newPage();
  await page.goto("/login/horizon");
  await page.getByTestId("sso-classlink").click();
  await expect(page).toHaveURL(/\/en\/home/, { timeout: 60_000 });
  await expect(page.locator("body")).toContainText("Daniel");
  await context.close();

  // A different ClassLink account with Daniel's address cannot take over his link.
  await setMockUser("classlink", { sub: `cl-${randomBytes(4).toString("hex")}`, email: "daniel.carter@horizon.example", classLink_tenant_id: "1907" });
  const taken = await browser.newContext({ baseURL: BASE });
  const pt = await taken.newPage();
  await pt.goto("/login/horizon");
  await pt.getByTestId("sso-classlink").click();
  await expect(pt).toHaveURL(/error=IDENTITY_TAKEN/, { timeout: 60_000 });
  await taken.close();

  // A ClassLink account from another district's tenant cannot come in, whatever its email says.
  await setMockUser("classlink", { sub: `cl-${randomBytes(4).toString("hex")}`, email: "daniel.carter@horizon.example", classLink_tenant_id: "9999" });
  const other = await browser.newContext({ baseURL: BASE });
  const p2 = await other.newPage();
  await p2.goto("/login/horizon");
  await p2.getByTestId("sso-classlink").click();
  await expect(p2).toHaveURL(/\/login\/horizon\?error=WRONG_TENANT/, { timeout: 60_000 });
  await expect(p2.getByTestId("sign-in-error")).toBeVisible();
  await other.close();
});

test("UAE PASS refuses an unverified (SOP1) account", async ({ browser }) => {
  test.skip(!MOCK, "needs the local mock identity provider (E2E_MOCK_IDP)");
  await setMockUser("uaepass", { sub: "UAEPASS/e2e", uuid: `e2e-${randomBytes(4).toString("hex")}`, userType: "SOP1", email: "rania.nasser@family.horizon.example", firstnameEN: "Rania" });
  const context = await browser.newContext({ baseURL: BASE });
  const page = await context.newPage();
  await page.goto("/login/horizon");
  await page.getByTestId("sso-uaepass").click();
  await expect(page).toHaveURL(/error=LOW_ASSURANCE/, { timeout: 60_000 });
  await expect(page.getByTestId("sign-in-error")).toBeVisible();
  await context.close();
});

for (const locale of LOCALES) {
  test(`administrator sign-in settings and roster preview (${locale})`, async ({ browser }) => {
    const s = await loginAs(browser, "admin", locale);
    const { page } = s;
    await go(s, "/admin/sign-in");
    await expect(page.getByTestId("method-classlink")).toBeVisible();
    await expect(page.getByTestId("school-login-url")).toHaveValue(/\/login\/horizon$/);
    // Turn email links off and on again: the school's sign-in page follows.
    const magic = page.getByTestId("method-magic_link");
    if ((await magic.getAttribute("data-state")) === "checked" && !(await magic.isDisabled())) {
      await magic.click();
      await page.getByTestId("signin-save").click();
      await expect(page.getByText(locale === "ar" ? "تم حفظ إعدادات تسجيل الدخول" : "Sign-in settings saved")).toBeVisible();
      const check = await s.context.newPage();
      await check.goto("/login/horizon");
      await expect(check.getByTestId("mode-link")).toHaveCount(0);
      await check.close();
      await page.reload();
      await page.getByTestId("method-magic_link").click();
      await page.getByTestId("signin-save").click();
      await expect(page.getByText(locale === "ar" ? "تم حفظ إعدادات تسجيل الدخول" : "Sign-in settings saved").first()).toBeVisible();
    }
    await go(s, "/admin/sign-in?tab=providers");
    await expect(page.getByTestId("classlink-tenant")).toHaveValue("1907");
    await expect(page.getByTestId("redirect-google")).toHaveValue(/\/api\/auth\/callback\/google$/);
    await go(s, "/admin/sign-in?tab=activity");
    await expect(page.getByTestId("signin-activity")).toBeVisible();
    await page.screenshot({ path: `test-results/sso-admin-activity-${locale}.png`, fullPage: true });

    await go(s, "/admin/rostering");
    await expect(page.getByTestId("connection-row")).toBeVisible();
    await page.getByTestId("preview-connection").click();
    await page.waitForURL(/\/admin\/rostering\/runs\//);
    await expect(page.getByTestId("run-counts")).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId("run-issues")).toContainText("TK");
    await page.screenshot({ path: `test-results/sso-roster-preview-${locale}.png`, fullPage: true });
    await go(s, "/admin/rostering?tab=log");
    await expect(page.getByTestId("log-row").first()).toBeVisible();
    expectNoErrors(s);
    await s.context.close();
  });
}

for (const locale of LOCALES) {
  test(`forgotten password: request, weak password refused, new password works (${locale}, 390px)`, async ({ browser }) => {
    const { context, page, errors } = await phone(browser, locale);
    await page.goto("/login");
    await page.getByTestId("forgot-password").click();
    await page.waitForURL(/\/forgot-password/);
    await noHorizontalScroll(page);
    const email = `e2e-reset-${randomBytes(4).toString("hex")}@family.horizon.example`;
    await page.locator("#fp-email").fill(email);
    await page.getByRole("button", { name: locale === "ar" ? "إرسال رابط إعادة التعيين" : "Send reset link" }).click();
    // The same answer whether or not the address has an account.
    await expect(page.getByTestId("forgot-sent")).toBeVisible();
    await page.screenshot({ path: `test-results/sso-forgot-${locale}-390.png`, fullPage: true });

    test.skip(!local || !process.env.MIGRATION_DATABASE_URL, "the reset link is planted in the local database");
    const db = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL!.replace(/[?&]connection_limit=\d+/, "") });
    await db.connect();
    try {
      const org = (await db.query(`SELECT id FROM "Organization" WHERE slug = 'horizon'`)).rows[0];
      const userId = `e2e${randomBytes(8).toString("hex")}`;
      await db.query(`INSERT INTO "User" (id, email, "nameEn", "passwordHash", "createdAt", "updatedAt") VALUES ($1, $2, 'Reset Test', NULL, now(), now())`, [userId, email]);
      await db.query(`INSERT INTO "Membership" (id, "orgId", "userId", status, "createdAt") VALUES ($1, $2, $3, 'ACTIVE', now())`, [`m${userId}`, org.id, userId]);
      await db.query(`INSERT INTO "MembershipRole" (id, "orgId", "membershipId", "roleId") SELECT $1, $2, $3, id FROM "Role" WHERE "orgId" = $2 AND key = 'parent'`, [`r${userId}`, org.id, `m${userId}`]);
      const raw = randomBytes(32).toString("base64url");
      await db.query(`INSERT INTO "VerificationToken" (identifier, token, expires) VALUES ($1, $2, now() + interval '45 minutes')`, [`pwreset:${userId}`, createHash("sha256").update(raw).digest("hex")]);

      await page.goto(`/${locale}/reset-password?token=${raw}`);
      await expect(page.getByTestId("reset-form")).toBeVisible();
      await noHorizontalScroll(page);
      await page.locator("#new-password").fill("short");
      await page.locator("#confirm-password").fill("short");
      await page.getByRole("button", { name: locale === "ar" ? "حفظ كلمة المرور الجديدة" : "Save new password" }).click();
      await expect(page.getByTestId("reset-error")).toBeVisible();
      await page.screenshot({ path: `test-results/sso-reset-weak-${locale}-390.png`, fullPage: true });
      const strong = `Garden-${randomBytes(3).toString("hex")}-2026`;
      await page.locator("#new-password").fill(strong);
      await page.locator("#confirm-password").fill(strong);
      await page.getByRole("button", { name: locale === "ar" ? "حفظ كلمة المرور الجديدة" : "Save new password" }).click();
      await expect(page.getByTestId("reset-done")).toBeVisible();
      await page.screenshot({ path: `test-results/sso-reset-done-${locale}-390.png`, fullPage: true });

      // The link works once.
      await page.goto(`/${locale}/reset-password?token=${raw}`);
      await expect(page.getByTestId("reset-invalid")).toBeVisible();
      // The new password signs in.
      await page.goto("/login");
      await page.locator("#email").fill(email);
      await page.locator("#password").fill(strong);
      await page.getByTestId("password-form").getByRole("button").click();
      await expect(page).toHaveURL(/\/(en|ar)\/(home|join\/waiting)/, { timeout: 60_000 });
      const audit = await db.query(`SELECT count(*)::int AS n FROM "AuditEvent" WHERE action = 'auth.password_reset' AND "actorUserId" = $1`, [userId]);
      expect(audit.rows[0].n).toBe(1);
      await db.query(`DELETE FROM "User" WHERE id = $1`, [userId]);
    } finally {
      await db.end();
    }
    expect(errors).toEqual([]);
    await context.close();
  });
}
