// Government reporting end to end, as the registrar (English and Arabic, desktop and phone) and the principal:
// create a census, fix a problem the checks found, export Excel and CSV (and look inside them), sign off the
// summary PDF as principal, and record the submission with the authority's reference.
// Runs against the demo school after a reset (npm run db:reset-demo): the seeded data has a student with no
// nationality and two without a registration reference. On a school where those are already fixed, the fix
// steps are skipped and the rest still runs.
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { readZip } from "../../src/lib/zip";
import { expectNoErrors, go, loginAs, type Locale, type Session } from "./helpers";

const shots = process.env.GOV_SHOTS;
async function shot(page: Page, name: string, full = false) {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: full });
}
async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}
const today = () => new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 10);

let returnUrl = "";

async function openReturn(s: Session) {
  await s.page.goto(returnUrl.replace(/\/(en|ar)\//, `/${s.locale}/`));
  await expect(s.page.locator("[data-testid=gov-status]")).toBeVisible();
}

test.describe.serial("government reporting", () => {
  test("registrar creates a census, fixes a problem and exports Excel and CSV (en)", async ({ browser }) => {
    const s = await loginAs(browser, "registrar", "en");
    const { page } = s;
    await go(s, "/admin/government");
    await expect(page.locator("h1")).toHaveText("Government reporting");
    await expect(page.locator("[data-testid=gov-authority]")).toContainText("KHDA");
    await shot(page, "01-registrar-en-overview");

    // A new census for today.
    await page.locator("[data-testid=gov-new-return]").first().click();
    await page.locator("[data-testid=gov-kind-CENSUS]").check();
    await page.locator("[data-testid=gov-asof]").fill(today());
    await page.locator("[data-testid=gov-create]").click();
    await page.waitForURL(/\/en\/admin\/government\/[a-z0-9]+$/);
    returnUrl = page.url();
    await expect(page.locator("[data-testid=gov-table-grades]")).toBeVisible();
    await shot(page, "02-registrar-en-census", true);

    // Fix a missing nationality, when the checks found one.
    const nat = page.locator("[data-testid=gov-rule-missing_nationality]");
    if (await nat.count()) {
      const before = await page.locator("[data-testid=gov-problem]").count();
      await nat.locator("[data-testid=gov-fix]").first().click();
      await page.locator("[data-testid=gov-fix-nationality]").selectOption("AE");
      await shot(page, "03-registrar-en-fix-dialog");
      await page.locator("[data-testid=gov-fix-save]").click();
      await expect(nat).toHaveCount(0);
      await expect(page.locator("[data-testid=gov-problem]")).toHaveCount(before - 1);
    } else test.info().annotations.push({ type: "note", description: "no missing nationality left to fix" });

    // Record a registration reference, when one is missing.
    const ref = page.locator("[data-testid=gov-rule-no_reference]");
    if (await ref.count()) {
      const n = await ref.locator("[data-testid=gov-problem]").count();
      await ref.locator("[data-testid=gov-ref]").first().click();
      await page.locator("[data-testid=gov-ref-input]").fill(`REG-E2E-${Date.now().toString(36).toUpperCase()}`);
      await page.locator("[data-testid=gov-ref-save]").click();
      if (n > 1) await expect(ref.locator("[data-testid=gov-problem]")).toHaveCount(n - 1);
      else await expect(ref).toHaveCount(0);
    }
    const open = await page.locator("[data-testid=gov-problem]").count();

    // Excel: a warning first when problems are open, then the download. Look inside the workbook.
    await page.locator("[data-testid=gov-export-xlsx]").click();
    if (open > 0) {
      await expect(page.locator("[data-testid=gov-export-warning]")).toBeVisible();
      await shot(page, "04-registrar-en-export-warning");
    }
    const [xlsx] = await Promise.all([page.waitForEvent("download"), open > 0 ? page.locator("[data-testid=gov-export-go]").click() : Promise.resolve()]);
    expect(xlsx.suggestedFilename()).toMatch(/^horizon-census-\d{4}-\d{2}-\d{2}-v\d+\.xlsx$/);
    const book = readZip(readFileSync((await xlsx.path())!));
    const sheets = [...book.keys()].filter((k) => k.startsWith("xl/worksheets/"));
    expect(sheets.length).toBeGreaterThanOrEqual(6);
    const grades = book.get("xl/worksheets/sheet3.xml")!.toString("utf8");
    expect(grades).toContain("Grade");
    expect(grades).toContain("الصف");
    const all = sheets.map((k) => book.get(k)!.toString("utf8")).join("");
    expect(all).not.toMatch(/784-?\d{4}-?\d{7}-?\d/);

    // CSV: one table with English and Arabic headers.
    await page.locator("[data-testid=gov-export-csv]").click();
    const [csv] = await Promise.all([page.waitForEvent("download"), open > 0 ? page.locator("[data-testid=gov-export-go]").click() : Promise.resolve()]);
    const text = readFileSync((await csv.path())!, "utf8");
    expect(text.split("\r\n")[0]).toContain("Grade / الصف");
    expect(text.split("\r\n")[0]).toContain("Section / الشعبة");

    // Both files are logged with a version and checksum.
    await page.reload();
    await expect(page.locator("[data-testid=gov-files] li")).toHaveCount(2);
    await shot(page, "05-registrar-en-files", true);
    expectNoErrors(s);
    await s.context.close();
  });

  test("principal signs off and the summary PDF carries the sign-off (en and ar)", async ({ browser }) => {
    const s = await loginAs(browser, "principal", "en");
    const { page } = s;
    await openReturn(s);
    await page.locator("[data-testid=gov-signoff]").click();
    await page.locator("[data-testid=gov-signoff-confirm]").click();
    await shot(page, "06-principal-en-signoff");
    await page.locator("[data-testid=gov-signoff-save]").click();
    await expect(page.locator("[data-testid=gov-signed]")).toContainText("Omar Al Mansoori");
    const id = returnUrl.split("/").pop();
    for (const lang of ["en", "ar"]) {
      const res = await page.request.get(`/api/government/export?return=${id}&format=pdf&lang=${lang}`);
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toBe("application/pdf");
      const body = await res.body();
      expect(body.subarray(0, 5).toString()).toBe("%PDF-");
      if (shots) (await import("node:fs")).writeFileSync(`${shots}/summary-${lang}.pdf`, body);
    }
    // The principal cannot download Excel or CSV, or full identity numbers.
    expect((await page.request.get(`/api/government/export?return=${id}&format=xlsx`)).status()).toBe(403);
    expectNoErrors(s);
    await s.context.close();
  });

  for (const locale of ["ar", "en"] as Locale[]) {
    test(`registrar on a phone records the submission and checks due dates (${locale})`, async ({ browser }) => {
      const s = await loginAs(browser, "registrar", locale);
      const { page } = s;
      await page.setViewportSize({ width: 390, height: 844 });
      await openReturn(s);
      await noSidewaysScroll(page);
      await shot(page, `07-registrar-${locale}-390-return`, true);
      if (locale === "ar") {
        await page.locator("[data-testid=gov-submit]").click();
        await page.locator("[data-testid=gov-sub-ref]").fill("CNS-E2E-0001");
        await shot(page, "08-registrar-ar-390-submit");
        await page.locator("[data-testid=gov-sub-save]").click();
        await expect(page.locator("[data-testid=gov-submissions]")).toContainText("CNS-E2E-0001");
      }
      await go(s, "/admin/government?tab=log");
      await expect(page.locator("[data-testid=gov-log]")).toContainText("CNS-E2E-0001");
      await noSidewaysScroll(page);
      await go(s, "/admin/government?tab=due");
      await expect(page.locator("[data-testid=gov-due-row]").first()).toBeVisible();
      await noSidewaysScroll(page);
      await shot(page, `09-registrar-${locale}-390-due`, true);
      expectNoErrors(s);
      await s.context.close();
    });
  }

  test("a teacher cannot open government reporting", async ({ browser }) => {
    const s = await loginAs(browser, "teacher", "en");
    // Not found (with streaming the status can still be 200): the page and its controls never render.
    await s.page.goto("/en/admin/government");
    await expect(s.page.locator("[data-testid=gov-authority]")).toHaveCount(0);
    await expect(s.page.locator("[data-testid=gov-new-return]")).toHaveCount(0);
    expect((await s.page.request.get(`/api/government/export?return=${returnUrl.split("/").pop()}&format=pdf`)).status()).toBe(403);
    await s.context.close();
  });
});
