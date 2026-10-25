import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { LOCALES, advanceToSubmit, expectNoErrors, go, idFromUrl, loginAs, marker, toFirstStep } from "./helpers";

// Request conversations and private absences:
// 1. A parent reports a sick day with a doctor's note; the attendance office approves; the homeroom teacher's
//    register shows "Excused absence, reported by parent" and nothing more; the request and the note stay closed to him.
// 2. Staff-only and private notes on a family request never reach the family; the family's reply reaches staff.
// 3. A substitute's cover notice carries the cover notes, never the private reason.

/** The next school day (Monday to Friday) at least `min` days ahead, as YYYY-MM-DD in Dubai. */
function schoolDayAhead(min: number) {
  const d = new Date(Date.now() + 4 * 3600_000 + min * 86400_000);
  while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

for (const locale of LOCALES) {
  test(`sick day stays private from the class teacher (${locale})`, async ({ browser }) => {
    const note = path.join(tmpdir(), `medical-note-${Date.now()}.pdf`);
    writeFileSync(note, "%PDF-1.4\n% fictional demo medical note\n%%EOF\n");
    const reason = marker("Fever and cough");
    const day = schoolDayAhead(locale === "en" ? 3 : 4);

    const parent = await loginAs(browser, "parent", locale);
    const p = parent.page;
    await go(parent, "/services/absence_request");
    const adam = p.locator("[data-testid=child-adam]");
    if (await adam.isVisible()) await adam.click();
    await toFirstStep(p);
    await p.locator("[data-testid=opt-absenceType-illness]").click();
    await p.locator("#f-startDate").fill(day);
    await p.locator("#f-endDate").fill(day);
    await p.locator("#f-details").fill(reason);
    await p.locator("#f-medicalNote").setInputFiles(note);
    await expect(p.getByText(path.basename(note))).toBeVisible();
    await p.locator("[data-testid=consent-declaration]").click();
    await advanceToSubmit(p);
    await p.locator("[data-testid=form-submit]").click();
    await p.waitForURL(/\/requests\/[^/?]+\?submitted=1/);
    const requestId = idFromUrl(p.url(), "requests");
    // The family sees its own full request, with the note.
    await expect(p.getByText(reason)).toBeVisible();
    await expect(p.locator("[data-testid=request-file]")).toBeVisible();

    // The attendance office (registrar) sees the reason and approves.
    const registrar = await loginAs(browser, "registrar", locale);
    const r = registrar.page;
    await go(registrar, `/requests/${requestId}`);
    await expect(r.getByText(reason)).toBeVisible();
    const file = await registrar.context.request.get(`/api/requests/${requestId}/file?field=medicalNote`);
    expect(file.status()).toBe(200);
    await go(registrar, "/approvals");
    const card = r.locator(`[data-testid=approval-card][data-request-id="${requestId}"]`);
    await card.locator("[data-testid=approve]").click();
    await expect(card).toHaveCount(0);
    expectNoErrors(registrar);

    // The homeroom teacher: excused on the register, no reason, no request, no file.
    const teacher = await loginAs(browser, "teacher", locale);
    const tp = teacher.page;
    await go(teacher, "/home");
    await tp.locator("[data-testid=open-register]").click();
    await tp.waitForURL(/\/classes\//);
    const classUrl = new URL(tp.url());
    await tp.goto(`${classUrl.pathname}?date=${day}#register`);
    const cell = tp.locator(`[data-testid=register-cell][data-status=EXCUSED][data-source=PARENT]`).first();
    await expect(cell).toBeVisible();
    const awayRow = tp.locator("[data-testid=away-row]").filter({ hasText: locale === "en" ? "Adam Nasser" : "آدم ناصر" }).last();
    await expect(awayRow.locator("[data-testid=away-label]")).toHaveText(locale === "en" ? "Excused absence, reported by parent" : "غياب بعذر، أبلغ عنه ولي الأمر");
    await expect(tp.locator("body")).not.toContainText(reason);
    const page404 = await tp.goto(`/${locale}/requests/${requestId}`);
    expect(page404?.status()).toBe(404);
    const denied = await teacher.context.request.get(`/api/requests/${requestId}/file?field=medicalNote`);
    expect([403, 404]).toContain(denied.status());

    // The principal sees the request but not the reason or the conversation.
    const principal = await loginAs(browser, "principal", locale);
    await go(principal, `/requests/${requestId}`);
    await expect(principal.page.locator("[data-testid=reason-private]")).toBeVisible();
    await expect(principal.page.locator("body")).not.toContainText(reason);
    await expect(principal.page.locator("[data-testid=composer]")).toHaveCount(0);
    expectNoErrors(principal);

    for (const s of [parent, teacher, principal, registrar]) await s.context.close();
  });

  test(`staff notes never reach the family (${locale})`, async ({ browser }) => {
    const admin = await loginAs(browser, "admin", locale);
    const a = admin.page;
    await go(admin, "/requests?tab=all&q=School%20bus%20request%20for%20Yara");
    await a.locator("[data-testid=request-row]").first().click();
    await a.waitForURL(/\/requests\/[^/?]+/);
    const requestId = idFromUrl(a.url(), "requests");
    const staffNote = marker("Staff only note");
    const privateNote = marker("Private note");
    const shared = marker("Shared update");

    await a.locator("[data-testid=vis-STAFF]").click();
    await expect(a.locator("[data-testid=who-can-see]")).toBeVisible();
    await a.locator("[data-testid=message-body]").fill(staffNote);
    await a.locator("[data-testid=send-message]").click();
    await expect(a.locator("[data-testid=message]").filter({ hasText: staffNote })).toHaveAttribute("data-visibility", "STAFF");

    await a.locator("[data-testid=vis-PRIVATE]").click();
    await a.locator("[data-testid=recipient]").filter({ hasText: locale === "en" ? "Omar" : "عمر" }).click();
    await a.locator("[data-testid=message-body]").fill(privateNote);
    await a.locator("[data-testid=send-message]").click();
    await expect(a.locator("[data-testid=message]").filter({ hasText: privateNote })).toHaveAttribute("data-visibility", "PRIVATE");

    await a.locator("[data-testid=vis-SHARED]").click();
    await a.locator("[data-testid=message-body]").fill(shared);
    await a.locator("[data-testid=send-message]").click();
    await expect(a.locator("[data-testid=message]").filter({ hasText: shared })).toBeVisible();
    expectNoErrors(admin);

    // The family sees the shared update only, and can reply.
    const parent = await loginAs(browser, "parent", locale);
    const p = parent.page;
    await go(parent, `/requests/${requestId}`);
    await expect(p.locator("[data-testid=message]").filter({ hasText: shared })).toBeVisible();
    await expect(p.locator("body")).not.toContainText(staffNote);
    await expect(p.locator("body")).not.toContainText(privateNote);
    await expect(p.locator("[data-testid=visibility-switch]")).toHaveCount(0);
    const reply = marker("Thanks");
    await p.locator("[data-testid=message-body]").fill(reply);
    await p.locator("[data-testid=send-message]").click();
    await expect(p.locator("[data-testid=message]").filter({ hasText: reply })).toBeVisible();
    expectNoErrors(parent);

    // The principal reads the private note; the registrar does not.
    const principal = await loginAs(browser, "principal", locale);
    await go(principal, `/requests/${requestId}`);
    await expect(principal.page.locator("[data-testid=message]").filter({ hasText: privateNote })).toBeVisible();
    const registrar = await loginAs(browser, "registrar", locale);
    await go(registrar, `/requests/${requestId}`);
    await expect(registrar.page.locator("[data-testid=message]").filter({ hasText: staffNote })).toBeVisible();
    await expect(registrar.page.locator("body")).not.toContainText(privateNote);

    for (const s of [admin, parent, principal, registrar]) await s.context.close();
  });
}

test("a substitute's cover notice shows cover notes, never the private reason", async ({ browser }) => {
  const teacher = await loginAs(browser, "teacher", "en");
  await go(teacher, "/timetable");
  const notices = teacher.page.locator("[data-testid=cover-notice]");
  if ((await notices.count()) > 0) {
    await expect(notices.first().locator("[data-testid=cover-notes]")).toBeVisible();
    await expect(notices.first()).not.toContainText("High temperature");
    await expect(notices.first()).toContainText("Absent, cover arranged");
  }
  expectNoErrors(teacher);
  await teacher.context.close();
});
