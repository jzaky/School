import { expect, test } from "@playwright/test";
import { LOCALES, advanceToSubmit, expectNoErrors, go, idFromUrl, loginAs, marker, pickOption, pickSlot, toFirstStep } from "./helpers";

const SARAH = { en: "Sarah Ahmed", ar: "سارة أحمد" };
const BOOK_TASK = { en: "Book a meeting with the family", ar: "حجز اجتماع مع الأسرة" };

// Hero flow 2: a teacher refers a student with an academic concern. The counselor picks up the case,
// books a meeting with the parent invited, agrees an action plan and sets a follow-up.
// The parent sees the meeting in her meetings and calendar.
for (const locale of LOCALES) {
  test(`teacher referral to the counselor (${locale})`, async ({ browser }) => {
    const note = marker("Grades dropped in the last two Physics tests");

    // Daniel refers Adam.
    const teacher = await loginAs(browser, "teacher", locale);
    const t = teacher.page;
    await go(teacher, "/services/academic_concern");
    await toFirstStep(t);
    await pickOption(t, "picker-student", "Adam Nasser");
    await pickOption(t, "picker-subject", "Physics");
    await t.locator("[data-testid=opt-concernAreas-grades_declining]").click();
    await t.locator("[data-testid=opt-concernAreas-missing_homework]").click();
    await t.locator("#f-observations").fill(note);
    await t.locator("[data-testid=form-next]").click();
    await t.locator("[data-testid=opt-urgency-medium]").click();
    await t.locator("[data-testid=opt-parentContacted-no]").click();
    await advanceToSubmit(t);
    await t.locator("[data-testid=form-submit]").click();
    await t.waitForURL(/\/requests\/[^/?]+\?submitted=1/);
    const requestId = idFromUrl(t.url(), "requests");
    expectNoErrors(teacher);
    await teacher.context.close();

    // Sarah is notified and opens the case.
    const counselor = await loginAs(browser, "counselor", locale);
    const c = counselor.page;
    await go(counselor, `/requests/${requestId}`);
    await c.locator("[data-testid=linked-case]").click();
    await c.waitForURL(/\/cases\/[^/?]+/);
    const caseId = idFromUrl(c.url(), "cases");
    await expect(c.locator("[data-testid=case-title]")).toBeVisible();
    await expect(c.locator("main")).toContainText(SARAH[locale]);
    await go(counselor, "/notifications");
    await expect(c.locator(`[data-testid=notification-row][data-href*="${caseId}"]`).first()).toBeVisible();
    await go(counselor, `/cases/${caseId}`);

    // Accept: move the case to In progress.
    await c.locator("[data-testid=case-status]").click();
    await c.locator("[data-testid=case-status-IN_PROGRESS]").click();
    await expect(c.locator("[data-testid=case-status]")).toHaveAttribute("data-value", "IN_PROGRESS");
    await c.reload();
    await expect(c.locator("[data-testid=case-status]")).toHaveAttribute("data-value", "IN_PROGRESS");

    // Book a parent meeting from the case, with Rania invited.
    await c.locator("[data-testid=case-book-meeting]").click();
    await c.waitForURL(/\/book\?/);
    const sarahHost = c.locator("[data-testid^=host-]", { hasText: SARAH[locale] });
    if (await sarahHost.count()) await sarahHost.click();
    const dayKey = await pickSlot(c);
    await expect(c.locator("[data-testid=invite-guardian]").first()).toBeChecked();
    await c.locator("[data-testid=confirm-booking]").click();
    await c.waitForURL(/\/meetings\/[^/?]+$/);
    const meetingId = idFromUrl(c.url(), "meetings");
    await expect(c.locator("main")).toContainText(locale === "ar" ? "رانيا" : "Rania");
    await go(counselor, `/cases/${caseId}?tab=appointments`);
    await expect(c.locator(`a[href$="/meetings/${meetingId}"]`)).toBeVisible();
    // Booking the meeting closes the workflow's "book a meeting" task.
    await go(counselor, `/cases/${caseId}?tab=tasks`);
    await expect(c.getByRole("checkbox", { name: BOOK_TASK[locale] })).toHaveAttribute("aria-checked", "true");
    await go(counselor, `/cases/${caseId}`);

    // Draft the action plan with AI, review it and approve it.
    await c.locator("[data-testid=draft-plan]").click();
    await expect(c.locator("[data-testid=plan-draft]")).toBeVisible({ timeout: 90_000 });
    await c.locator("[data-testid=approve-plan]").click();
    await expect(c.locator("[data-testid=plan-accepted]").first()).toBeVisible();

    // Set a follow-up date two weeks out.
    const follow = new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10);
    const fu = c.locator("[data-testid=case-followup]");
    await fu.fill(follow);
    await fu.blur();
    await expect(c.locator("[data-testid=case-followup-date]")).toBeVisible();

    expectNoErrors(counselor);
    await counselor.context.close();

    // Rania sees the meeting in her meetings and calendar.
    const parent = await loginAs(browser, "parent", locale);
    const p = parent.page;
    await go(parent, "/meetings");
    await expect(p.locator(`[data-testid=meeting-row][href$="/meetings/${meetingId}"]`)).toBeVisible();
    await go(parent, `/calendar?view=day&d=${dayKey}`);
    await expect(p.locator(`[data-testid=cal-item][href$="/meetings/${meetingId}"]`)).toBeVisible();
    await go(parent, `/meetings/${meetingId}`);
    await expect(p.locator("[data-testid=meeting-title]")).toBeVisible();
    expectNoErrors(parent);
    await parent.context.close();
  });
}
