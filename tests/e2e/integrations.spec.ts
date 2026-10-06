// Integrations: the school administrator creates an API key (shown once), uses it against REST API v1,
// revokes it; adds a sync source with a column mapping read from the sample export and runs it; sees the
// API guide and the sign-in readiness panel. In English and Arabic, and at phone width.
import { expect, test } from "@playwright/test";
import { expectNoErrors, go, LOCALES, loginAs } from "./helpers";

for (const locale of LOCALES) {
  test(`integrations: API key lifecycle and API guide (${locale})`, async ({ browser }) => {
    const s = await loginAs(browser, "admin", locale);
    const { page } = s;
    await go(s, "/admin/integrations");
    await expect(page.locator("[data-testid=api-key-row]").first()).toBeVisible();
    await page.locator("[data-testid=create-api-key]").click();
    const label = `E2E key ${Date.now()}`;
    await page.locator("[data-testid=api-key-label]").fill(label);
    await page.locator("[data-testid=api-key-save]").click();
    const keyInput = page.locator("[data-testid=new-api-key]");
    await expect(keyInput).toHaveValue(/^hzk_/);
    const key = await keyInput.inputValue();
    await page.screenshot({ path: `test-results/integrations-key-${locale}.png` });
    await page.locator("[data-testid=api-key-done]").click();
    const row = page.locator("[data-testid=api-key-row]", { hasText: label });
    await expect(row).toBeVisible();

    const auth = { Authorization: `Bearer ${key}` };
    const list = await page.request.get("/api/v1/students?limit=2", { headers: auth });
    expect(list.status()).toBe(200);
    const body = await list.json();
    expect(body.data).toHaveLength(2);
    expect(body.next_cursor).toBeTruthy();
    const bad = await page.request.post("/api/v1/staff", { headers: auth, data: { staff: [{ name_en: "X", email: "not-an-email", roles: "teacher" }] } });
    expect(bad.status()).toBe(200);
    const badBody = await bad.json();
    expect(badBody.failed).toBe(1);
    expect(badBody.errors).toEqual(expect.arrayContaining([expect.objectContaining({ index: 0, field: "email" })]));
    expect(await bad.text()).not.toContain("not-an-email");

    await row.locator("[data-testid=revoke-api-key]").click();
    await page.locator("[data-testid=revoke-api-key-confirm]").click();
    await expect(row.locator("[data-testid=revoke-api-key]")).toHaveCount(0);
    expect((await page.request.get("/api/v1/students", { headers: auth })).status()).toBe(401);

    await go(s, "/admin/integrations?tab=docs");
    await expect(page.locator("[data-testid=api-base-url]")).toHaveValue(/\/api\/v1$/);
    await expect(page.locator("[data-testid=example-post]")).toContainText("Authorization: Bearer");
    const doc = await page.request.get("/api/v1/openapi.json");
    expect((await doc.json()).openapi).toBe("3.0.3");
    await page.screenshot({ path: `test-results/integrations-docs-${locale}.png`, fullPage: true });

    await go(s, "/admin/invitations?tab=signin");
    await expect(page.locator("[data-testid=signin-readiness]")).toBeVisible();
    await expect(page.locator("[data-testid=redirect-google]")).toHaveValue(/\/api\/auth\/callback\/google$/);
    await page.screenshot({ path: `test-results/integrations-signin-${locale}.png`, fullPage: true });
    expectNoErrors(s);
    await s.context.close();
  });
}

test("integrations: sync source with mapping and run now (local only)", async ({ browser }) => {
  test.skip(!/localhost|127\.0\.0\.1/.test(process.env.E2E_BASE_URL ?? "http://localhost:3000"), "the sample export is fetched from the same server, which is a private address locally");
  const s = await loginAs(browser, "admin", "ar");
  const { page } = s;
  await go(s, "/admin/integrations?tab=sync");
  await expect(page.locator("[data-testid=run-row]").first()).toBeVisible();
  const sampleUrl = await page.locator("[data-testid=sample-url]").inputValue();
  await page.locator("[data-testid=add-source]").click();
  const name = `E2E students ${Date.now()}`;
  await page.locator("[data-testid=source-name]").fill(name);
  await page.locator("[data-testid=source-url]").fill(sampleUrl);
  await page.locator("[data-testid=read-headers]").click();
  await expect(page.locator("[data-testid=mapping-missing]")).toBeVisible();
  // Map the required columns the automatic header resolution cannot guess.
  const rows = page.locator("[data-testid=mapping-rows] > div");
  for (const [header, option] of [["Pupil ID", "رقم الطالب"], ["Legal Forename", "الاسم الأول بالإنجليزية"], ["Legal Surname", "اسم العائلة بالإنجليزية"], ["NC Year", "الصف *"]] as const) {
    await rows.filter({ hasText: header }).locator("button").click();
    await page.getByRole("option", { name: option, exact: false }).first().click();
  }
  await expect(page.locator("[data-testid=mapping-ok]")).toBeVisible();
  await page.screenshot({ path: "test-results/integrations-mapping-ar.png" });
  await page.locator("[data-testid=source-save]").click();
  const card = page.locator("[data-testid=source-row]", { hasText: name });
  await expect(card).toBeVisible();
  await card.locator("[data-testid=run-now]").click();
  await expect(async () => {
    await page.reload();
    await expect(page.locator("[data-testid=run-row]", { hasText: name }).first()).toContainText(/3/);
  }).toPass({ timeout: 60_000 });
  await page.screenshot({ path: "test-results/integrations-sync-ar.png", fullPage: true });
  await card.locator("[data-testid=delete-source]").click();
  await page.locator("[data-testid=delete-source-confirm]").click();
  await expect(card).toHaveCount(0);
  expectNoErrors(s);
  await s.context.close();
});

test("integrations: phone width has no sideways scroll", async ({ browser }) => {
  const s = await loginAs(browser, "admin", "ar");
  await s.page.setViewportSize({ width: 390, height: 844 });
  for (const tab of ["", "?tab=sync", "?tab=docs"]) {
    await go(s, `/admin/integrations${tab}`);
    await s.page.waitForLoadState("networkidle");
    const overflow = await s.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `sideways scroll on ${tab || "keys"}`).toBeLessThanOrEqual(1);
  }
  await s.page.screenshot({ path: "test-results/integrations-phone-ar.png", fullPage: true });
  expectNoErrors(s);
  await s.context.close();
});
