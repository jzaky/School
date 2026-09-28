import { expect, test } from "@playwright/test";
import { LOCALES, advanceToSubmit, expectNoErrors, go, idFromUrl, loginAs, pickSlot, toFirstStep } from "./helpers";

const STRONG = ["analytical", "investigative", "technical"];

// Hero flow 1: Adam takes the aptitude assessment, chooses AI Engineer, books Layla and submits the intake.
// Layla opens the case, prepares the AI brief, drafts and approves a plan. Adam gets tasks,
// the request completes and Rania is told about the plan.
for (const locale of LOCALES) {
  test(`career guidance (${locale})`, async ({ browser }) => {
    const student = await loginAs(browser, "student", locale);
    const s = student.page;

    // Aptitude assessment, answered with a strong technical profile.
    await go(student, "/career/assessment");
    await s.locator("[data-testid=question]").first().waitFor();
    for (let guard = 0; guard < 20; guard++) {
      if (/\/career\?done=1/.test(s.url())) break;
      const qs = s.locator("[data-testid=question]");
      const first = await qs.first().getAttribute("data-index");
      const n = await qs.count();
      for (let i = 0; i < n; i++) {
        const dim = (await qs.nth(i).getAttribute("data-dimension")) ?? "";
        const v = STRONG.includes(dim) ? 5 : dim === "organized" || dim === "creative" ? 4 : 2;
        await qs.nth(i).locator(`[data-testid=answer-${v}]`).click();
      }
      await s.locator("[data-testid=assessment-next]").click();
      await expect
        .poll(async () => /\/career\?done=1/.test(s.url()) || (await qs.first().getAttribute("data-index").catch(() => first)) !== first, { timeout: 60_000 })
        .toBe(true);
    }
    await s.waitForURL(/\/career\?done=1/);

    // AI Engineer is one of the matches. Choose it.
    const match = s.locator("[data-testid=match-ai_engineer]");
    await expect(match).toBeVisible();
    const choose = match.locator("[data-testid=choose-career]");
    if (await choose.isVisible()) await choose.click();
    await expect(s.locator("[data-testid=chosen-banner]")).toBeVisible();

    // Book Layla and submit the intake form.
    await s.locator("[data-testid=book-advisor]").click();
    await s.waitForURL(/\/services\/career_guidance/);
    await pickSlot(s);
    await s.locator("[data-testid=booking-continue]").click();
    await toFirstStep(s);
    const eng = s.locator("[data-testid=opt-interests-engineering_tech]");
    if ((await eng.getAttribute("aria-pressed")) !== "true") await eng.click();
    await advanceToSubmit(s);
    await s.locator("[data-testid=form-submit]").click();
    await s.waitForURL(/\/requests\/[^/?]+\?submitted=1/);
    const requestId = idFromUrl(s.url(), "requests");
    await expect(s.locator("[data-testid=view-meeting]")).toBeVisible();
    expectNoErrors(student);

    // Layla opens the case, prepares the brief, drafts and approves the plan.
    const advisor = await loginAs(browser, "career_advisor", locale);
    const l = advisor.page;
    await go(advisor, `/requests/${requestId}`);
    await l.locator("[data-testid=linked-case]").click();
    await l.waitForURL(/\/cases\/[^/?]+/);
    await l.locator("[data-testid=ai-brief]").click();
    await expect(l.locator("[data-testid=ai-brief-result]")).toBeVisible({ timeout: 90_000 });
    await l.locator("[data-testid=draft-plan]").click();
    await expect(l.locator("[data-testid=plan-draft]")).toBeVisible({ timeout: 90_000 });
    await l.locator("[data-testid=approve-plan]").click();
    const accepted = l.locator("[data-testid=plan-accepted]").first();
    await expect(accepted).toBeVisible();
    const planTitle = (await accepted.locator("[data-testid=plan-title]").innerText()).trim();
    const studentTask = (await accepted.locator("[data-testid=plan-item][data-owner=student] [data-testid=plan-item-text]").first().innerText()).trim();
    expectNoErrors(advisor);
    await advisor.context.close();

    // Adam has the plan's tasks and the request is complete.
    await go(student, "/tasks");
    await expect(s.locator("[data-testid=task-row]", { hasText: studentTask }).first()).toBeVisible();
    await go(student, `/requests/${requestId}`);
    await expect(s.locator("[data-testid=request-title]")).toHaveAttribute("data-status", "COMPLETED");
    expectNoErrors(student);
    await student.context.close();

    // Rania is told about the plan.
    const parent = await loginAs(browser, "parent", locale);
    await go(parent, "/notifications");
    await expect(parent.page.locator("[data-testid=notification-row]", { hasText: planTitle }).first()).toBeVisible();
    expectNoErrors(parent);
    await parent.context.close();
  });
}
