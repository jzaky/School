import { expect, test } from "@playwright/test";
import { LOCALES, advanceToSubmit, expectNoErrors, go, idFromUrl, loginAs, pickSlot, toFirstStep } from "./helpers";

const DANIEL = { en: "Daniel Carter", ar: "دانيال كارتر" };

// Hero flow 5: a parent picks a child, a teacher and a free slot, gets a confirmation,
// the meeting shows for the teacher and the .ics download works.
for (const locale of LOCALES) {
  test(`parent meeting with a teacher (${locale})`, async ({ browser }) => {
    const parent = await loginAs(browser, "parent", locale);
    const p = parent.page;
    await go(parent, "/services/parent_meeting");
    const adam = p.locator("[data-testid=child-adam]");
    await adam.click();
    await expect(adam).toHaveClass(/bg-brand/);

    // Pick Daniel Carter and a free slot.
    await p.locator("[data-testid^=host-]", { hasText: DANIEL[locale] }).click();
    const dayKey = await pickSlot(p);
    await p.locator("[data-testid=booking-continue]").click();

    // Meeting details.
    await toFirstStep(p);
    await p.locator("[data-testid=select-topic]").click();
    await p.locator("[data-testid=opt-topic-progress]").click();
    await p.locator("#f-details").fill(locale === "ar" ? "نود مناقشة تقدم آدم في الفيزياء." : "We would like to discuss Adam's progress in Physics.");
    await p.locator("[data-testid=opt-attendance-in_person]").click();
    await advanceToSubmit(p);
    await p.locator("[data-testid=form-submit]").click();
    await p.waitForURL(/\/requests\/[^/?]+\?submitted=1/);
    await expect(p.locator("[data-testid=submitted-banner]")).toBeVisible();
    const requestId = idFromUrl(p.url(), "requests");

    // Confirmation: the request links to the booked meeting.
    const meetingLink = p.locator("[data-testid=view-meeting]");
    await expect(meetingLink).toBeVisible();
    await meetingLink.click();
    await p.waitForURL(/\/meetings\/[^/?]+$/);
    const meetingId = idFromUrl(p.url(), "meetings");
    await expect(p.locator("[data-testid=meeting-title]")).toBeVisible();
    await expect(p.locator("main")).toContainText(DANIEL[locale]);

    // The .ics file downloads.
    const icsHref = await p.locator("[data-testid=download-ics]").getAttribute("href");
    const ics = await parent.context.request.get(icsHref!);
    expect(ics.status()).toBe(200);
    expect(ics.headers()["content-type"]).toContain("text/calendar");
    const icsText = await ics.text();
    expect(icsText).toContain("BEGIN:VCALENDAR");
    expect(icsText).toContain("BEGIN:VEVENT");
    expect(icsText).toContain(`DTSTART:${dayKey.replace(/-/g, "")}`);

    // It is in the parent's meetings list, and the request is complete.
    await go(parent, "/meetings");
    await expect(p.locator(`[data-testid=meeting-row][href$="/meetings/${meetingId}"]`)).toBeVisible();
    await go(parent, `/requests/${requestId}`);
    await expect(p.locator("[data-testid=request-title]")).toHaveAttribute("data-status", "COMPLETED");
    expectNoErrors(parent);

    // The teacher sees it in their meetings and calendar, and was notified.
    const teacher = await loginAs(browser, "teacher", locale);
    const t = teacher.page;
    await go(teacher, "/meetings");
    await expect(t.locator(`[data-testid=meeting-row][href$="/meetings/${meetingId}"]`)).toBeVisible();
    await go(teacher, `/calendar?view=day&d=${dayKey}`);
    await expect(t.locator(`[data-testid=cal-item][href$="/meetings/${meetingId}"]`)).toBeVisible();
    await go(teacher, "/notifications");
    await expect(t.locator(`[data-testid=notification-row][data-href*="${requestId}"], [data-testid=notification-row][data-href*="${meetingId}"]`).first()).toBeVisible();
    await go(teacher, `/meetings/${meetingId}`);
    await expect(t.locator("[data-testid=meeting-title]")).toBeVisible();
    expectNoErrors(teacher);

    await teacher.context.close();
    await parent.context.close();
  });
}
