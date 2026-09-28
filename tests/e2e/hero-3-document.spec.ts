import { expect, test } from "@playwright/test";
import { LOCALES, advanceToSubmit, expectNoErrors, go, idFromUrl, loginAs, toFirstStep } from "./helpers";

// Hero flow 3: a parent requests an enrollment letter, the registrar approves,
// a bilingual PDF is generated and the family is notified and can download it.
for (const locale of LOCALES) {
  test(`document request: enrollment letter (${locale})`, async ({ browser }) => {
    // Parent submits the request for Adam.
    const parent = await loginAs(browser, "parent", locale);
    const p = parent.page;
    await go(parent, "/services/document_request");
    const adam = p.locator("[data-testid=child-adam]");
    if (await adam.isVisible()) await adam.click();
    await expect(p.locator("[data-testid=child-adam]")).toHaveClass(/bg-brand/);
    await toFirstStep(p);
    await p.locator("[data-testid=opt-documentType-enrollment_letter]").click();
    await p.locator("[data-testid=opt-language-bilingual]").click();
    await p.locator("[data-testid=form-next]").click();
    await p.locator("[data-testid=select-purpose]").click();
    await p.locator("[data-testid=opt-purpose-visa]").click();
    await p.locator("#f-copies").fill("1");
    const neededBy = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);
    await p.locator("#f-neededBy").fill(neededBy);
    await p.locator("[data-testid=opt-deliveryMethod-collect]").click();
    await advanceToSubmit(p);
    await p.locator("[data-testid=form-submit]").click();
    await p.waitForURL(/\/requests\/[^/?]+\?submitted=1/);
    await expect(p.locator("[data-testid=submitted-banner]")).toBeVisible();
    const requestId = idFromUrl(p.url(), "requests");
    await expect(p.locator("[data-testid=request-title]")).toHaveAttribute("data-status", "PENDING_APPROVAL");

    // Registrar approves from the approvals inbox.
    const registrar = await loginAs(browser, "registrar", locale);
    const r = registrar.page;
    await go(registrar, "/approvals");
    const card = r.locator(`[data-testid=approval-card][data-request-id="${requestId}"]`);
    await expect(card).toBeVisible();
    await card.locator("[data-testid=approval-comment]").fill("Approved for visa renewal.");
    await card.locator("[data-testid=approve]").click();
    await expect(card).toHaveCount(0);
    expectNoErrors(registrar);

    // The request is completed with a generated PDF.
    await go(parent, `/requests/${requestId}`);
    await expect(p.locator("[data-testid=request-title]")).toHaveAttribute("data-status", "COMPLETED");
    const doc = p.locator("[data-testid=generated-document]").first();
    await expect(doc).toBeVisible();
    const href = await doc.locator("[data-testid=download-document]").getAttribute("href");
    expect(href).toMatch(/^\/api\/documents\/[^/]+\/download$/);
    const res = await parent.context.request.get(href!);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("application/pdf");
    const body = await res.body();
    expect(body.subarray(0, 5).toString()).toBe("%PDF-");
    expect(body.length).toBeGreaterThan(2000);

    // The requester is notified and the letter is in their documents.
    await go(parent, "/notifications");
    await expect(p.locator(`[data-testid=notification-row][data-href*="${requestId}"]`).first()).toBeVisible();
    const docId = href!.split("/")[3];
    await go(parent, "/documents");
    await expect(p.locator(`[data-testid=document-row]:has(a[href*="${docId}"])`)).toBeVisible();
    expectNoErrors(parent);

    await registrar.context.close();
    await parent.context.close();
  });
}
