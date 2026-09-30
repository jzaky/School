import { expect, test, type Page } from "@playwright/test";
import { expectNoErrors, go, loginAs, marker } from "./helpers";

// Hero flow: University planning. Adam (Grade 9, American track) sets his goal, sees matches, opens a
// programme's line-by-line requirements, tries a what-if, searches and compares programmes, generates his
// Grade 9 to 12 plan and submits it. Sarah (counselor) approves with a note, Rania (parent, in Arabic)
// sees the approved plan, and Layla (career advisor) shows the catalog change monitor and the application board.

const COUNTRIES = ["United Kingdom", "United States", "Canada", "United Arab Emirates"];

async function chooseOption(page: Page, trigger: string, name: RegExp | string) {
  await page.locator(`[data-testid=${trigger}]`).click();
  const option = page.getByRole("option", { name });
  await option.first().click();
}

async function optionExists(page: Page, trigger: string, name: RegExp) {
  await page.locator(`[data-testid=${trigger}]`).click();
  const found = (await page.getByRole("option", { name }).count()) > 0;
  await page.keyboard.press("Escape");
  return found;
}

test("university planning: goal, matches, what-if, search, compare, plan approval (en, plus ar for the parent)", async ({ browser }) => {
  const note = marker("Approved, keep AP Physics in Grade 11");

  // --- Adam: goal and plan ---------------------------------------------------------------
  const adam = await loginAs(browser, "student", "en");
  const a = adam.page;
  await go(adam, "/career/pathways");
  await chooseOption(a, "goal-career", "AI Engineer");
  const countries = a.locator("[data-testid=goal-countries] button");
  for (let i = 0; i < (await countries.count()); i++) {
    const b = countries.nth(i);
    const want = COUNTRIES.includes(((await b.textContent()) ?? "").trim());
    if ((await b.getAttribute("aria-pressed")) !== String(want)) await b.click();
    await expect(b).toHaveAttribute("aria-pressed", String(want));
  }
  await a.locator("[data-testid=generate-plan]").click();
  await a.waitForURL(/\/en\/career\/pathways\/plan/);
  await expect(a.locator("[data-testid=plan-status]")).toHaveText("Draft");
  await expect(a.locator("[data-testid=plan-item]").first()).toBeVisible();

  // Matches on the hub, grouped by status, and a programme with line-by-line requirements.
  await go(adam, "/career/pathways");
  await expect(a.locator("[data-testid=goal-summary]")).toContainText("AI Engineer");
  await expect(a.locator("[data-testid=status-counts]")).toBeVisible();
  const top = a.locator("[data-testid=top-programs] a");
  await expect(top.first()).toBeVisible();
  await top.first().click();
  await a.waitForURL(/\/career\/pathways\/programs\//);
  await expect(a.locator("[data-testid=req-line]").first()).toBeVisible();
  await expect(a.locator("[data-testid=example-label]")).toBeVisible();
  await expect(a.locator("[data-testid=source-link]")).toBeVisible();

  // What-if: AP Calculus BC with a predicted 5 (added, or its grade set when the plan already has it).
  await go(adam, "/career/pathways/what-if");
  await expect(a.locator("[data-testid=whatif-row]").first()).toBeVisible({ timeout: 60_000 });
  await a.locator("[data-testid=whatif-mode-add_course]").click();
  if (await optionExists(a, "whatif-course", /Calculus BC/)) {
    await chooseOption(a, "whatif-course", /Calculus BC/);
    await chooseOption(a, "whatif-predicted", "5");
  } else {
    await a.locator("[data-testid=whatif-mode-set_grade]").click();
    await chooseOption(a, "whatif-course", /Calculus BC/);
    await chooseOption(a, "whatif-grade", "5");
  }
  await a.locator("[data-testid=whatif-add]").click();
  await expect(a.locator("[data-testid=whatif-changes] li")).toHaveCount(1);
  await expect(a.locator("[data-testid=whatif-changes]")).toContainText("Calculus BC");
  await expect(a.locator("[data-testid=whatif-row]").first()).toBeVisible();

  // Programme search with match chips, then compare two programmes side by side.
  await go(adam, "/career/pathways/search?country=GB,US&field=computer_science");
  const results = a.locator("[data-testid=search-result]");
  await expect(results.first()).toBeVisible();
  await expect(results.first().locator("[data-testid=match-chip]")).toBeVisible();
  await a.waitForLoadState("networkidle");
  const box = a.locator("[data-testid=program-search]");
  await expect(async () => {
    await box.fill("imperial");
    await expect(a).toHaveURL(/q=imperial/, { timeout: 4000 });
  }).toPass({ timeout: 30_000 });
  await expect(results.first()).toContainText("Imperial");
  await a.waitForLoadState("networkidle");
  await expect(async () => {
    await box.fill("");
    await expect(a).not.toHaveURL(/q=imperial/, { timeout: 4000 });
  }).toPass({ timeout: 30_000 });
  await results.nth(0).locator("[data-testid=compare-toggle] button").click();
  await results.nth(1).locator("[data-testid=compare-toggle] button").click();
  await expect(a.locator("[data-testid=compare-tray]")).toBeVisible();
  await a.locator("a[data-testid=open-compare]").click();
  await a.waitForURL(/\/career\/pathways\/compare\?ids=/);
  await expect(a.locator("[data-testid=compare-column]")).toHaveCount(2);
  await expect(a.locator("[data-testid=compare-row]").first()).toBeVisible();
  await expect(a.locator("[data-testid=fact-deadlines]")).toBeVisible();
  await expect(a.locator("[data-testid=compare-cell][data-status]").first()).toBeVisible();

  // Global search (Ctrl K) finds universities and programmes.
  await go(adam, "/career/pathways");
  await a.locator("body").press("Control+k");
  await a.locator("[data-testid=palette-input]").fill("Imperial");
  await expect(a.locator("[data-testid=palette-university]").first()).toBeVisible();
  await expect(a.locator("[data-testid=palette-program]").first()).toBeVisible();
  await a.keyboard.press("Escape");

  // Submit the plan for approval.
  await go(adam, "/career/pathways/plan");
  await a.locator("[data-testid=submit-plan]").click();
  await expect(a.locator("[data-testid=plan-status]")).toHaveText("Waiting for approval");
  expectNoErrors(adam);
  await adam.context.close();

  // --- Sarah: approve with a note -----------------------------------------------------------
  const sarah = await loginAs(browser, "counselor", "en");
  const s = sarah.page;
  await go(sarah, "/career/pathways?tab=awaiting");
  await s.locator("[data-testid=pathway-student]", { hasText: "Adam Nasser" }).first().click();
  await s.waitForURL(/\/career\/pathways\/[^/?]+$/);
  await s.locator("[data-testid=tab-plan]").click();
  await s.waitForURL(/\/plan$/);
  await expect(s.locator("[data-testid=plan-status]")).toHaveText("Waiting for approval");
  await s.locator("[data-testid=plan-note]").fill(note);
  await s.locator("[data-testid=approve-plan]").click();
  await expect(s.locator("[data-testid=plan-status]")).toHaveText("Approved");
  expectNoErrors(sarah);
  await sarah.context.close();

  // --- Rania, in Arabic: sees the approved plan and the note ---------------------------------
  const rania = await loginAs(browser, "parent", "ar");
  await go(rania, "/career/pathways/plan");
  await expect(rania.page.locator("[data-testid=plan-status]")).toHaveText("معتمدة");
  await expect(rania.page.locator("[data-testid=counselor-note]")).toContainText(note);
  await expect(rania.page.locator("[data-testid=submit-plan]")).toHaveCount(0);
  expectNoErrors(rania);
  await rania.context.close();

  // --- Layla: catalog change monitor and application board -----------------------------------
  const layla = await loginAs(browser, "career_advisor", "en");
  await go(layla, "/career/catalog/changes");
  await expect(layla.page.locator("[data-testid=change-item]", { hasText: /IB points|Grade profile/ }).first()).toBeVisible();
  await go(layla, "/career/applications/manage");
  await expect(layla.page.locator("[data-testid=application-board]")).toBeVisible();
  await expect(layla.page.locator("[data-testid=board-card]").first()).toBeVisible();
  expectNoErrors(layla);
  await layla.context.close();
});
