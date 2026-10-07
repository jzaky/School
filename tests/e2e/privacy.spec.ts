import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { go, loginAs, LOCALES, expectNoErrors } from "./helpers";

// Privacy tools: purposes editor, one-person export and erasure, school export, pilot measures.
// Erasure changes demo data, so it picks a student with an open deletion request (reset restores it).
const shots = process.env.E2E_SHOTS_DIR;

for (const locale of LOCALES) {
  test(`compliance: purposes, person export and erasure (${locale})`, async ({ browser }) => {
    const s = await loginAs(browser, "admin", locale);
    const { page } = s;
    await go(s, "/admin/compliance");
    // Add a processing purpose.
    await page.getByTestId("purpose-add").click();
    const name = `E2E purpose ${locale} ${Date.now()}`;
    await page.getByTestId("purpose-name-en").fill(name);
    await page.getByTestId("purpose-name-ar").fill("غرض اختبار");
    await page.getByTestId("purpose-cat-contact").click();
    await page.getByTestId("purpose-save").click();
    await expect(page.getByText(locale === "en" ? name : "غرض اختبار").first()).toBeVisible();
    if (shots) await page.screenshot({ path: `${shots}/compliance-${locale}.png`, fullPage: true });

    // Open the person behind the first request and export their data.
    await page.getByTestId("dsr-row").first().getByRole("link").click();
    await expect(page.getByTestId("person-name")).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-for-dsr").first().click()]);
    const file = await download.path();
    const bytes = readFileSync(file!);
    expect(bytes.subarray(0, 2).toString()).toBe("PK");
    expect(bytes.includes(Buffer.from("summary.pdf"))).toBe(true);
    if (shots) await page.screenshot({ path: `${shots}/person-${locale}.png`, fullPage: true });

    // Erase a student who asked for deletion.
    await go(s, "/admin/compliance");
    const deletionRow = page.getByTestId("dsr-row").filter({ has: page.getByRole("link") }).nth(locale === "en" ? 0 : 2);
    await deletionRow.getByRole("link").click();
    await expect(page.getByTestId("person-name")).toBeVisible();
    const preview = page.getByTestId("erasure-preview");
    if (await preview.count()) {
      await preview.click();
      await expect(page.getByTestId("erasure-plan")).toBeVisible();
      if (shots) await page.screenshot({ path: `${shots}/erasure-plan-${locale}.png` });
      await page.getByTestId("erasure-continue").click();
      const reference = (await page.locator("label[for=erase-confirm]").innerText()).split(/\s+/).pop()!;
      await page.getByTestId("erasure-confirm-input").fill(reference);
      await page.getByTestId("erasure-understood").click();
      await page.getByTestId("erasure-confirm").click();
      await expect(page.getByTestId("erasure-done")).toBeVisible();
    }
    expectNoErrors(s);
    await s.context.close();
  });
}

test("school export: typed confirmation, background job, expiring download", async ({ browser }) => {
  const s = await loginAs(browser, "admin", "en");
  const { page } = s;
  await go(s, "/admin/compliance/exit");
  const request = page.getByTestId("exit-request");
  if (await request.isEnabled()) {
    await request.click();
    await expect(page.getByTestId("exit-confirm")).toBeDisabled();
    await page.getByTestId("exit-confirm-input").fill("horizon");
    await page.getByTestId("exit-confirm").click();
  }
  await expect(page.getByTestId("exit-download").first()).toBeVisible({ timeout: 180_000 });
  const href = await page.getByTestId("exit-download").first().getAttribute("href");
  const res = await page.request.get(href!);
  expect(res.status()).toBe(200);
  expect((await res.body()).subarray(0, 2).toString()).toBe("PK");
  if (shots) await page.screenshot({ path: `${shots}/exit-en.png`, fullPage: true });
  expectNoErrors(s);
  await s.context.close();
});

for (const locale of LOCALES) {
  test(`pilot measures for the principal (${locale})`, async ({ browser }) => {
    const s = await loginAs(browser, "principal", locale);
    const { page } = s;
    await go(s, "/analytics");
    await expect(page.getByTestId("pilot-staff")).toBeVisible();
    await expect(page.getByTestId("pilot-adoption")).toContainText("%");
    const href = await page.getByTestId("pilot-csv").getAttribute("href");
    const res = await page.request.get(href!);
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain("parent_adoption_pct");
    if (shots) await page.screenshot({ path: `${shots}/pilot-${locale}.png` });
    // Phone width: no sideways scroll.
    await page.setViewportSize({ width: 390, height: 844 });
    await go(s, "/analytics");
    await expect(page.getByTestId("pilot-staff")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    expectNoErrors(s);
    await s.context.close();
  });
}

test("mobile: person data and exit pages fit a phone in Arabic", async ({ browser }) => {
  const s = await loginAs(browser, "admin", "ar");
  const { page } = s;
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/admin/compliance", "/admin/compliance/person", "/admin/compliance/exit"]) {
    await go(s, path);
    await page.waitForLoadState("networkidle");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), path).toBe(true);
  }
  await go(s, "/admin/compliance/person");
  await page.getByTestId("subject-search").fill("Nas");
  await expect(page.getByTestId("subject-hit").first()).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/person-search-ar-mobile.png`, fullPage: true });
  expectNoErrors(s);
  await s.context.close();
});

test("platform schools: only platform admins, demo school protected", async ({ browser }) => {
  const s = await loginAs(browser, "principal", "en");
  const res = await s.page.goto("/en/platform/schools");
  expect(res?.status()).toBe(404);
  await s.context.close();
  if (!process.env.E2E_PLATFORM_ADMIN) return;
  const a = await loginAs(browser, "admin", "en");
  await go(a, "/platform/schools");
  const demo = a.page.locator("[data-testid=platform-school][data-slug=horizon]");
  await expect(demo.getByRole("button")).toBeDisabled();
  // Delete a throwaway school: dry run, typed slug, gone.
  if (process.env.MIGRATION_DATABASE_URL) {
    const { PrismaClient } = await import("@prisma/client");
    const owner = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DATABASE_URL });
    const slug = `e2e-leaving-${Date.now()}`;
    await owner.organization.create({ data: { slug, nameEn: "E2E Leaving School", nameAr: "مدرسة مغادرة" } });
    await a.page.reload();
    const row = a.page.locator(`[data-testid=platform-school][data-slug=${slug}]`);
    await row.getByTestId("school-dry-run").click();
    await expect(a.page.getByTestId("school-report")).toBeVisible();
    if (shots) await a.page.screenshot({ path: `${shots}/platform-dry-run-en.png` });
    await a.page.getByTestId("school-delete-continue").click();
    await expect(a.page.getByTestId("school-delete-confirm")).toBeDisabled();
    await a.page.getByTestId("school-delete-input").fill(slug);
    await a.page.getByTestId("school-delete-confirm").click();
    await expect(row).toHaveCount(0);
    expect(await owner.organization.count({ where: { slug } })).toBe(0);
    expect(await owner.platformAuditEvent.count({ where: { action: "school.delete", createdAt: { gte: new Date(Date.now() - 600_000) } } })).toBeGreaterThan(0);
    await owner.$disconnect();
  }
  if (shots) await a.page.screenshot({ path: `${shots}/platform-en.png`, fullPage: true });
  expectNoErrors(a);
  await a.context.close();
});
