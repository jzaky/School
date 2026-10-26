// Full-size school checks, against a server whose database holds the synthetic school from scripts/seed-scale.ts
// (slug scale-test, 1,554 students). Skipped unless E2E_SCALE=1, because that school is never in the demo or in
// production. Run locally:
//   E2E_SCALE=1 E2E_BASE_URL=http://localhost:3149 npx playwright test tests/e2e/scale.spec.ts
// Checks, in English and Arabic on a 390px phone:
// - a parent with a KG1 child and a Grade 9 child sees "KG1" (never "-1" or "Grade -1") on home and the child page;
// - a parent whose child starts later sees the start date instead of an attendance figure;
// - an administrator sees the KG1 filter, KG1 on student cards and the profile, and the students list pages
//   through all 1,554 students with the real total.
import { expect, test, type Browser, type Page } from "@playwright/test";
import pg from "pg";
import { config as loadEnv } from "dotenv";
import { LOCALES, type Locale } from "./helpers";

loadEnv({ quiet: true });
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const PASSWORD = process.env.SCALE_PASSWORD ?? "ScaleTest2026!";
const ADMIN = process.env.SCALE_ADMIN_EMAIL ?? "admin@staff.scale.example";
const PARENT = "parent@parents.scale.example";
const SHOTS = process.env.SCALE_SHOTS ?? "test-results";

test.skip(process.env.E2E_SCALE !== "1", "needs the synthetic full-size school (scripts/seed-scale.ts) and E2E_SCALE=1");

type Kid = { id: string; gradeLevel: number; section: string | null; firstNameEn: string; firstNameAr: string };
let kids: Kid[] = [];
let starter: { email: string; firstNameEn: string } | null = null;
let activeTotal = 0;

test.beforeAll(async () => {
  const db = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await db.connect();
  try {
    const org = (await db.query(`SELECT id FROM "Organization" WHERE slug = 'scale-test'`)).rows[0];
    kids = (
      await db.query(
        `SELECT s.id, s."gradeLevel", s.section, s."firstNameEn", s."firstNameAr" FROM "Student" s
         JOIN "GuardianLink" l ON l."studentId" = s.id JOIN "Guardian" g ON g.id = l."guardianId"
         JOIN "Membership" m ON m.id = g."membershipId" JOIN "User" u ON u.id = m."userId"
         WHERE u.email = $1 ORDER BY s."gradeLevel"`,
        [PARENT],
      )
    ).rows;
    starter =
      (
        await db.query(
          `SELECT u.email, s."firstNameEn" FROM "Student" s
           JOIN "GuardianLink" l ON l."studentId" = s.id AND l."isPrimary" JOIN "Guardian" g ON g.id = l."guardianId"
           JOIN "Membership" m ON m.id = g."membershipId" JOIN "User" u ON u.id = m."userId"
           WHERE s."orgId" = $1 AND s."enrolledOn" > now() ORDER BY s."enrolledOn" LIMIT 1`,
          [org.id],
        )
      ).rows[0] ?? null;
    activeTotal = (await db.query(`SELECT count(*)::int AS n FROM "Student" WHERE "orgId" = $1 AND status = 'ACTIVE'`, [org.id])).rows[0].n;
  } finally {
    await db.end();
  }
});

async function phoneSignIn(browser: Browser, email: string, locale: Locale) {
  const context = await browser.newContext({ baseURL: BASE, viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await context.addCookies([{ name: "NEXT_LOCALE", value: locale, url: BASE }]);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror ${String(e).slice(0, 200)}`));
  page.on("response", (r) => r.status() >= 500 && errors.push(`http ${r.status()} ${r.url()}`));
  await page.goto("/login/scale-test");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(PASSWORD);
  await page.getByTestId("password-form").getByRole("button").click();
  await expect(page).toHaveURL(new RegExp(`/${locale}/home`), { timeout: 60_000 });
  await expect(page.locator("html")).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");
  return { context, page, errors };
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

const KG1_NAME: Record<Locale, string> = { en: "KG1", ar: "الروضة الأولى" };
const KG1_SHORT: Record<Locale, string> = { en: "KG1", ar: "روضة 1" };
// Both languages use Western digits by default ("1,554"); a school can switch Arabic to Arabic-Indic digits.
const fmt = (n: number) => n.toLocaleString("en-US");

for (const locale of LOCALES) {
  test(`parent sees KG1 and Grade 9 children correctly (${locale}, 390px)`, async ({ browser }) => {
    const kg1 = kids.find((k) => k.gradeLevel === -1)!;
    const older = kids.find((k) => k.gradeLevel === 9)!;
    expect(kg1, "the test parent has a KG1 child").toBeTruthy();
    const { context, page, errors } = await phoneSignIn(browser, PARENT, locale);
    const grades = page.getByTestId("child-grade");
    await expect(grades.first()).toBeVisible();
    const texts = await grades.allInnerTexts();
    expect(texts.some((x) => x.includes(KG1_NAME[locale]))).toBe(true);
    expect(texts.join(" ")).not.toMatch(/-1|Grade -|الصف -/);
    expect(texts.some((x) => x.includes(locale === "ar" ? `الصف 9${older.section ?? ""}` : `Grade 9${older.section ?? ""}`))).toBe(true);
    await noHorizontalScroll(page);
    await page.screenshot({ path: `${SHOTS}/scale-parent-home-${locale}-390.png` });

    await page.goto(`/${locale}/children/${kg1.id}`);
    await expect(page.getByTestId("child-grade")).toContainText(KG1_NAME[locale]);
    await expect(page.getByTestId("child-grade")).not.toContainText("-1");
    await expect(page.getByTestId("child-attendance-pct")).toBeVisible();
    await noHorizontalScroll(page);
    await page.screenshot({ path: `${SHOTS}/scale-parent-kg1-child-${locale}-390.png` });
    expect(errors).toEqual([]);
    await context.close();
  });

  test(`a child who starts later shows the start date, not 100% attendance (${locale}, 390px)`, async ({ browser }) => {
    test.skip(!starter, "no child with a future start date in this database");
    const { context, page, errors } = await phoneSignIn(browser, starter!.email, locale);
    if (locale === "en") await expect(page.getByTestId("child-name").filter({ hasText: starter!.firstNameEn }).first()).toBeVisible();
    await expect(page.getByTestId("child-starts").first()).toBeVisible();
    await expect(page.getByTestId("child-starts").first()).toContainText(locale === "ar" ? "يبدأ" : "Starts");
    await noHorizontalScroll(page);
    await page.screenshot({ path: `${SHOTS}/scale-parent-starter-${locale}-390.png` });
    expect(errors).toEqual([]);
    await context.close();
  });

  test(`administrator: paging through every student, KG1 filter and profile (${locale}, 390px)`, async ({ browser }) => {
    const { context, page, errors } = await phoneSignIn(browser, ADMIN, locale);
    // The list says the real total and pages through it.
    await page.goto(`/${locale}/students`);
    const summary = page.getByTestId("pager-summary").first();
    await expect(summary).toContainText(fmt(activeTotal));
    await expect(summary).toContainText(locale === "ar" ? "عرض 1 إلى 50" : "Showing 1 to 50");
    await expect(page.getByTestId("student-card")).toHaveCount(50);
    await noHorizontalScroll(page);
    await page.screenshot({ path: `${SHOTS}/scale-admin-students-${locale}-390.png` });
    await page.getByTestId("pager-next").first().click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page.getByTestId("pager-summary").first()).toContainText(locale === "ar" ? "عرض 51 إلى 100" : "Showing 51 to 100");
    // Last page: the remainder, and Next is disabled.
    const last = Math.ceil(activeTotal / 50);
    await page.goto(`/${locale}/students?page=${last}`);
    await expect(page.getByTestId("student-card")).toHaveCount(activeTotal - (last - 1) * 50);
    await expect(page.getByTestId("pager-next")).toHaveCount(0);

    // The KG1 chip filters to KG1 and the cards say KG1, not -1.
    await page.goto(`/${locale}/students`);
    await page.getByRole("button", { name: KG1_NAME[locale], exact: true }).first().click();
    await expect(page).toHaveURL(/grade=-1/);
    const cardGrades = await page.getByTestId("student-grade").allInnerTexts();
    expect(cardGrades.length).toBeGreaterThan(0);
    expect(cardGrades.every((g) => g.includes(KG1_SHORT[locale]))).toBe(true);
    await noHorizontalScroll(page);
    await page.screenshot({ path: `${SHOTS}/scale-admin-kg1-filter-${locale}-390.png` });

    const kg1 = kids.find((k) => k.gradeLevel === -1)!;
    await page.goto(`/${locale}/students/${kg1.id}`);
    await expect(page.getByTestId("student-grade")).toContainText(KG1_NAME[locale]);
    await expect(page.getByTestId("student-grade")).not.toContainText("-1");
    await noHorizontalScroll(page);
    await page.screenshot({ path: `${SHOTS}/scale-admin-kg1-profile-${locale}-390.png` });
    expect(errors).toEqual([]);
    await context.close();
  });
}
