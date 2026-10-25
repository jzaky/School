// Subject levels and course selection: Adam sees next year's options with AP badges, which of his
// target universities need each one and how many programmes it keeps open; the subject levels panel
// on his University planning page; Rania sees the same for Adam; Sarah (counselor) opens his choices
// read only and can try others; Mona (registrar) sees next year's AP offerings in the editor.
// Nothing is saved, so the demo school stays as it is. English, Arabic and phone width.
import { expect, test } from "@playwright/test";
import { expectNoErrors, go, LOCALES, loginAs } from "./helpers";

for (const locale of LOCALES) {
  test(`student chooses next year's courses with university impact (${locale})`, async ({ browser }) => {
    const s = await loginAs(browser, "student", locale);
    const { page } = s;
    await go(s, "/subjects");
    await expect(page.locator("[data-testid=year-tab-next]")).toBeVisible();
    await expect(page.locator("[data-testid=impact-intro]")).toBeVisible();
    const ap = page.locator("[data-testid=option-AP_PHYS_1]");
    await expect(ap.locator("[data-testid=ap-badge]")).toBeVisible();
    await expect(ap.locator("[data-testid=needed-for]")).toBeVisible();
    await expect(ap.locator("[data-testid=keeps-open]")).toBeVisible();
    await expect(page.locator("[data-testid=ap-compare]").first()).toBeVisible();
    await ap.click();
    await expect(ap).toHaveAttribute("aria-checked", "true");
    await expect(page.locator("[data-testid=impact-summary] svg").first()).toBeVisible();
    await page.screenshot({ path: `test-results/subject-levels-picker-${locale}.png`, fullPage: true });

    await go(s, "/career/pathways");
    await expect(page.locator("[data-testid=worldwide]")).toBeVisible();
    await expect(page.locator("[data-testid=subject-levels]")).toBeVisible();
    const maths = page.locator("[data-testid=levels-row][data-family=mathematics]");
    await expect(maths).toBeVisible();
    if (locale === "en") await expect(maths.locator("[data-testid=levels-headline]")).toContainText("AP Calculus BC");
    await expect(page.locator("[data-testid=level-chip][data-level=AP_REQUIRED]").first()).toBeVisible();
    await page.screenshot({ path: `test-results/subject-levels-hub-${locale}.png`, fullPage: true });
    expectNoErrors(s);
    await s.context.close();
  });

  test(`parent sees course impact and subject levels for Adam (${locale})`, async ({ browser }) => {
    const s = await loginAs(browser, "parent", locale);
    const { page } = s;
    await go(s, "/subjects");
    await expect(page.locator("[data-testid=impact-intro]")).toBeVisible();
    await expect(page.locator("[data-testid=option-AP_PHYS_1] [data-testid=needed-for]")).toBeVisible();
    await go(s, "/career/pathways");
    await expect(page.locator("[data-testid=subject-levels]")).toBeVisible();
    expectNoErrors(s);
    await s.context.close();
  });
}

test("counselor opens a student's choices read only and tries another option", async ({ browser }) => {
  const s = await loginAs(browser, "counselor", "en");
  const { page } = s;
  await go(s, "/career/pathways?q=Adam");
  await page.locator("[data-testid=pathway-student]", { hasText: "Adam Nasser" }).first().click();
  await expect(page.locator("[data-testid=subject-levels]")).toBeVisible();
  await page.locator("[data-testid=levels-choices]").click();
  await expect(page.locator("[data-testid=read-only-note]")).toBeVisible();
  await expect(page.locator("[data-testid=submit-registration]")).toHaveCount(0);
  const option = page.locator("[data-testid=option-PHYS]");
  await option.click();
  await expect(option).toHaveAttribute("aria-checked", "true");
  expectNoErrors(s);
  await s.context.close();
});

test("registrar sees next year's AP offerings and the AP switch in the editor", async ({ browser }) => {
  const s = await loginAs(browser, "registrar", "en");
  const { page } = s;
  await go(s, "/admin/registration?year=next&grade=12");
  await expect(page.locator("[data-testid=year-next]")).toBeVisible();
  const row = page.locator("[data-testid=offering-row]", { hasText: "AP Calculus BC" });
  await expect(row.locator("[data-testid=offering-ap-badge]")).toBeVisible();
  await row.locator("[data-testid=edit-offering]").click();
  await expect(page.getByRole("dialog").locator("[data-testid=offering-ap]")).toHaveAttribute("data-state", "checked");
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  expectNoErrors(s);
  await s.context.close();
});

test("course choices fit a phone screen", async ({ browser }) => {
  const s = await loginAs(browser, "student", "ar");
  await s.page.setViewportSize({ width: 390, height: 844 });
  await go(s, "/subjects");
  await expect(s.page.locator("[data-testid=option-AP_PHYS_1]")).toBeVisible();
  const overflow = await s.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await s.context.close();
});
