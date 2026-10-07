// Inspection evidence pack, university fairs and visits, and partner resources, in English and Arabic.
import { expect, test } from "@playwright/test";
import { expectNoErrors, go, LOCALES, loginAs } from "./helpers";

const SHOTS = process.env.E2E_SHOTS_DIR;
const shot = async (page: import("@playwright/test").Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
};

for (const locale of LOCALES) {
  test(`principal builds and downloads the inspection evidence pack (${locale})`, async ({ browser }) => {
    const s = await loginAs(browser, "principal", locale);
    await go(s, "/admin/inspection?preset=last90");
    for (const key of ["safeguarding", "wellbeing", "parents", "careers", "attendance", "compliance"]) await expect(s.page.getByTestId(`section-${key}`)).toBeVisible();
    await expect(s.page.getByTestId("inspection-disclaimer")).toBeVisible();
    await expect(s.page.getByTestId("mapping-safeguarding").locator("li")).toHaveCount(4);
    await shot(s.page, `inspection-${locale}`);

    const csv = await s.page.request.get(await s.page.getByTestId("inspection-csv").getAttribute("href") as string);
    expect(csv.status()).toBe(200);
    const text = await csv.text();
    expect(text).toContain("Safeguarding");
    expect(text).toContain("حماية الطفل");
    const pdf = await s.page.request.get(await s.page.getByTestId("inspection-pdf").getAttribute("href") as string);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toContain("application/pdf");

    // Case references: wellbeing yes (role), safeguarding no.
    await go(s, `/admin/inspection${new URL((await s.page.getByTestId("toggle-refs-wellbeing").getAttribute("href")) as string, "http://x").search}`);
    await expect(s.page.getByTestId("refs-wellbeing").getByTestId("case-ref").first()).toBeVisible();
    await expect(s.page.getByTestId("toggle-refs-safeguarding")).toHaveCount(0);
    expectNoErrors(s);
    await s.context.close();
  });

  test(`parent registers a child for a university session and cancels (${locale})`, async ({ browser }) => {
    const s = await loginAs(browser, "parent", locale);
    await go(s, "/career/events");
    await expect(s.page.getByTestId("child-events").first()).toBeVisible();
    await shot(s.page, `events-parent-${locale}`);
    const card = s.page.getByTestId("child-events").first();
    // Adam is registered for the Grade 9 session by the seed: cancel then register again.
    const unregister = card.getByTestId("event-unregister").first();
    await expect(unregister).toBeVisible();
    await unregister.click();
    await expect(card.getByTestId("event-register").first()).toBeVisible();
    await card.getByTestId("event-register").first().click();
    await expect(card.getByTestId("event-unregister").first()).toBeVisible();
    expectNoErrors(s);
    await s.context.close();
  });

  test(`student sees partner resources (${locale})`, async ({ browser }) => {
    const s = await loginAs(browser, "student", locale);
    await go(s, "/career");
    await expect(s.page.getByTestId("career-partners")).toBeVisible();
    await go(s, "/career/resources");
    await expect(s.page.getByTestId("partner-card").first()).toBeVisible();
    await shot(s.page, `partners-student-${locale}`);
    expectNoErrors(s);
    await s.context.close();
  });
}

test("career advisor creates a university visit and sees attendees", async ({ browser }) => {
  const s = await loginAs(browser, "career_advisor", "en");
  await go(s, "/career/events");
  await expect(s.page.getByTestId("event-card").first()).toBeVisible();
  await shot(s.page, "events-advisor-en");
  await s.page.getByTestId("new-event").click();
  await s.page.getByTestId("event-title-en").fill(`E2E visit ${Date.now()}`);
  await s.page.getByTestId("event-location").fill("Library");
  await s.page.getByTestId("event-capacity").fill("25");
  await s.page.getByTestId("event-grades").getByTestId("grade-11").click();
  await s.page.getByTestId("event-uni-search").fill("Khalifa");
  await s.page.getByRole("checkbox").first().click();
  await s.page.getByTestId("event-save").click();
  await s.page.waitForURL(/\/career\/events\/[a-z0-9]+$/);
  await expect(s.page.getByTestId("event-universities")).toBeVisible();
  await expect(s.page.getByText("0 of 25")).toBeVisible();
  await shot(s.page, "event-detail-en");
  expectNoErrors(s);
  await s.context.close();
});

test("phone width: new pages do not scroll sideways (ar)", async ({ browser }) => {
  for (const [persona, path] of [
    ["principal", "/admin/inspection"],
    ["parent", "/career/events"],
    ["career_advisor", "/career/resources"],
  ] as const) {
    const s = await loginAs(browser, persona, "ar");
    await s.page.setViewportSize({ width: 390, height: 844 });
    await go(s, path);
    await s.page.waitForLoadState("networkidle");
    const overflow = await s.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, path).toBeLessThanOrEqual(1);
    await shot(s.page, `phone-${persona}-ar`);
    await s.context.close();
  }
});
