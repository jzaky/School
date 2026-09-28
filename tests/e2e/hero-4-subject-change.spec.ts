import { expect, test, type Page } from "@playwright/test";
import { LOCALES, advanceToSubmit, expectNoErrors, go, idFromUrl, loginAs, pickOption, toFirstStep, type Locale, type Persona } from "./helpers";

const SUBJECT = {
  physics: { en: "Physics", ar: "الفيزياء" },
  cs: { en: "Computer Science", ar: "علوم الحاسوب" },
};

async function approveFromInbox(page: Page, requestId: string) {
  const card = page.locator(`[data-testid=approval-card][data-request-id="${requestId}"]`);
  await expect(card).toBeVisible();
  await card.locator("[data-testid=approve]").click();
  await expect(card).toHaveCount(0);
}

// Hero flow 4: a parent asks to swap Physics for Computer Science. Submitting counts as the parent's consent,
// then the Physics teacher, the Head of Computing and the Registrar approve in turn and the family is notified.
for (const locale of LOCALES) {
  test(`subject change: Physics to Computer Science (${locale})`, async ({ browser }) => {
    const parent = await loginAs(browser, "parent", locale);
    const p = parent.page;
    await go(parent, "/services/subject_change");
    await p.locator("[data-testid=child-adam]").click();
    await expect(p.locator("[data-testid=child-adam]")).toHaveClass(/bg-brand/);
    await toFirstStep(p);
    await pickOption(p, "picker-fromSubject", SUBJECT.physics[locale]);
    await pickOption(p, "picker-toSubject", SUBJECT.cs[locale]);
    await p.locator("[data-testid=form-next]").click();
    await p.locator("[data-testid=select-reason]").click();
    await p.locator("[data-testid=opt-reason-career]").click();
    await p.locator("#f-careerLink").fill(locale === "ar" ? "مهندس ذكاء اصطناعي" : "AI Engineer");
    await p.locator("[data-testid=opt-parentAware-yes]").click();
    await advanceToSubmit(p);
    await p.locator("[data-testid=form-submit]").click();
    await p.waitForURL(/\/requests\/[^/?]+\?submitted=1/);
    const requestId = idFromUrl(p.url(), "requests");
    await expect(p.locator("[data-testid=request-title]")).toHaveAttribute("data-status", "PENDING_APPROVAL");
    // The parent is not asked to approve her own request.
    await expect(p.locator("[data-testid=approval-panel]")).toHaveCount(0);

    // Teacher, then Head of Computing, then Registrar. One after the other.
    const order: Persona[] = ["teacher", "hod_computing", "registrar"];
    for (const [i, persona] of order.entries()) {
      const s = await loginAs(browser, persona, locale as Locale);
      await go(s, "/approvals");
      await approveFromInbox(s.page, requestId);
      expectNoErrors(s);
      await s.context.close();
      if (i < order.length - 1) {
        // The next approver has not been skipped: the request is still waiting.
        await go(parent, `/requests/${requestId}`);
        await expect(p.locator("[data-testid=request-title]")).toHaveAttribute("data-status", "PENDING_APPROVAL");
      }
    }

    // Completed, and the family is notified.
    await go(parent, `/requests/${requestId}`);
    await expect(p.locator("[data-testid=request-title]")).toHaveAttribute("data-status", "COMPLETED");
    await go(parent, "/notifications");
    await expect(p.locator(`[data-testid=notification-row][data-href*="${requestId}"]`).first()).toBeVisible();
    expectNoErrors(parent);
    await parent.context.close();

    const student = await loginAs(browser, "student", locale);
    await go(student, "/notifications");
    await expect(student.page.locator(`[data-testid=notification-row][data-href*="${requestId}"]`).first()).toBeVisible();
    expectNoErrors(student);
    await student.context.close();
  });
}
