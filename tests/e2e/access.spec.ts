// Access management flows: a principal edits and assigns a role, an admin invites a teacher who joins,
// and parents join with the school code on a phone (English and Arabic).
// Runs against the shared demo school; every person it creates has a unique e2e email.
import { expect, test, type Browser, type Page } from "@playwright/test";
import { expectNoErrors, go, loginAs, pickOption, type Locale } from "./helpers";

const SHOTS = process.env.E2E_SHOTS ?? "test-results/access";
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
const rand = () => Math.random().toString(36).slice(2, 8);
const PASSWORD = "Welcome-2026";

async function phone(browser: Browser, locale: Locale) {
  const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await context.addCookies([{ name: "NEXT_LOCALE", value: locale, url: baseURL }]);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${String(e).slice(0, 300)}`));
  page.on("response", (r) => r.status() >= 500 && errors.push(`http ${r.status()} ${r.url()}`));
  return { context, page, errors };
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function setParentApproval(browser: Browser, on: boolean) {
  const s = await loginAs(browser, "admin", "en");
  await go(s, "/admin/invitations?tab=signin");
  const sw = s.page.getByTestId("setting-parent-approval");
  if ((await sw.getAttribute("data-state")) !== (on ? "checked" : "unchecked")) {
    await sw.click();
    await s.page.getByTestId("settings-save").click();
    await expect(s.page.getByText("Sign-in settings saved")).toBeVisible();
  }
  await s.context.close();
}

test("principal creates a role, grants access with confirmation, assigns it and checks access", async ({ browser }) => {
  const s = await loginAs(browser, "principal", "en");
  const name = `Exams Officer ${rand()}`;
  await go(s, "/admin/roles");
  await expect(s.page.getByTestId("role-card-teacher")).toBeVisible();
  await shot(s.page, "roles-en");
  await s.page.getByTestId("create-role").click();
  await s.page.getByTestId("role-name-en").fill(name);
  await s.page.getByTestId("role-name-ar").fill("مسؤول الاختبارات");
  await s.page.getByTestId("role-copy-from").click();
  await s.page.getByRole("option", { name: "Teacher" }).click();
  await s.page.getByTestId("create-role-save").click();
  await expect(s.page.getByTestId("role-title")).toHaveText(name);

  // Plain toggle, then a sensitive one that needs the role name typed.
  await s.page.getByTestId("perm-calendar.manage").click();
  await expect(s.page.getByTestId("perm-calendar.manage")).toHaveAttribute("data-state", "checked");
  await s.page.getByTestId("perm-people.medical").click();
  await expect(s.page.getByTestId("sensitive-confirm")).toBeDisabled();
  await s.page.getByTestId("sensitive-confirm-input").fill("wrong");
  await s.page.getByTestId("sensitive-confirm").click();
  await expect(s.page.getByText("Type the role name exactly to confirm.")).toBeVisible();
  await s.page.getByTestId("sensitive-confirm-input").fill(name);
  await s.page.getByTestId("sensitive-confirm").click();
  await expect(s.page.getByTestId("perm-people.medical")).toHaveAttribute("data-state", "checked");

  // Assign it to Daniel Carter.
  await pickOption(s.page, "add-member-picker", "Daniel Carter");
  await s.page.getByTestId("add-member-ack").click();
  await s.page.getByTestId("add-member").click();
  await expect(s.page.getByTestId("role-member").filter({ hasText: "Daniel Carter" })).toBeVisible();
  await shot(s.page, "role-edit-en");

  // Access check shows where each permission comes from.
  await go(s, "/admin/roles?tab=check");
  await pickOption(s.page, "access-check-picker", "Daniel Carter");
  await expect(s.page.getByTestId("check-person")).toHaveText("Daniel Carter");
  await expect(s.page.getByTestId("check-calendar.manage")).toHaveAttribute("data-granted", "yes");
  await expect(s.page.getByTestId("check-calendar.manage")).toContainText(name);
  await shot(s.page, "access-check-en");

  // Clean up: delete the role, moving its members to Teacher (Daniel already has it).
  await go(s, "/admin/roles");
  await s.page.getByText(name).click();
  await s.page.getByTestId("delete-role").click();
  await s.page.getByTestId("delete-move-to").click();
  await s.page.getByRole("option", { name: "Teacher", exact: true }).click();
  await s.page.getByTestId("delete-role-confirm").click();
  await expect(s.page).toHaveURL(/\/admin\/roles$/);
  await expect(s.page.getByText(name)).toHaveCount(0);
  expectNoErrors(s);
  await s.context.close();
});

test("admin invites a teacher, who joins from the link and lands on their home", async ({ browser }) => {
  const s = await loginAs(browser, "admin", "en");
  const email = `e2e.teacher.${rand()}@horizon.example`;
  await go(s, "/admin/invitations");
  await s.page.getByTestId("invite-person").click();
  await s.page.getByTestId("invite-name").fill("Salma Idris");
  await s.page.getByTestId("invite-email").fill(email);
  await s.page.getByTestId("invite-send").click();
  const link = await s.page.getByTestId("invite-link").inputValue();
  expect(link).toMatch(/\/en\/join\/[A-Za-z0-9_-]{40,}$/);
  await shot(s.page, "invite-sent-en");
  await s.page.getByTestId("invite-done").click();
  await expect(s.page.getByTestId("invite-row").filter({ hasText: email })).toContainText("Pending");
  expectNoErrors(s);

  const t = await phone(browser, "en");
  await t.page.goto(link.replace(/^https?:\/\/[^/]+/, ""));
  await expect(t.page.getByTestId("join-headline")).toContainText("Horizon");
  await expect(t.page.getByTestId("join-email")).toHaveValue(email);
  await t.page.getByTestId("join-name").fill("Salma Idris");
  await t.page.getByTestId("join-password").fill(PASSWORD);
  await shot(t.page, "teacher-join-en-390");
  await noHorizontalScroll(t.page);
  await t.page.getByTestId("join-accept").click();
  await t.page.waitForURL(/\/en\/home/);
  await expect(t.page.getByTestId("first-run")).toBeVisible();
  await shot(t.page, "teacher-home-en-390");
  expect(t.errors).toEqual([]);
  await t.context.close();

  await s.page.reload();
  await expect(s.page.getByTestId("invite-row").filter({ hasText: email })).toContainText("Accepted");
  await s.context.close();
});

test("parents join with the school code on a phone and link their child (English and Arabic)", async ({ browser }) => {
  await setParentApproval(browser, false);
  try {
    for (const locale of ["en", "ar"] as Locale[]) {
      const p = await phone(browser, locale);
      await p.page.goto("/join?code=hrz-2026");
      await p.page.waitForURL(new RegExp(`/${locale}/join`));
      await expect(p.page.locator("html")).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");
      await expect(p.page.getByTestId("join-code-input")).toHaveValue("HRZ-2026");
      await shot(p.page, `code-${locale}-390`);
      await p.page.getByTestId("join-code-next").click();
      await expect(p.page.getByTestId("child-form")).toBeVisible();
      if (locale === "en") {
        await p.page.getByTestId("child-number").fill("HIS-24013");
        await p.page.getByTestId("child-dob").fill("2015-01-25");
      } else {
        await p.page.getByTestId("child-method-name").click();
        await p.page.getByTestId("child-grade").click();
        await p.page.getByRole("option", { name: "الصف 6" }).click();
        await p.page.getByTestId("child-fullname").fill("Humaid Al Rumaithi");
      }
      await shot(p.page, `children-${locale}-390`);
      await noHorizontalScroll(p.page);
      await p.page.getByTestId("details-next").click();
      await p.page.getByTestId("join-name").fill(locale === "en" ? "Maryam Qasim" : "مريم قاسم");
      await p.page.getByTestId("join-email").fill(`e2e.parent.${locale}.${rand()}@family.horizon.example`);
      await p.page.getByTestId("join-password").fill(PASSWORD);
      await shot(p.page, `account-${locale}-390`);
      await p.page.getByTestId("join-submit").click();
      await p.page.waitForURL(new RegExp(`/${locale}/home`));
      await expect(p.page.getByTestId("first-run")).toBeVisible();
      await expect(p.page.getByTestId("first-run-child")).toHaveCount(1);
      await noHorizontalScroll(p.page);
      await shot(p.page, `parent-home-${locale}-390`);
      expect(p.errors).toEqual([]);
      await p.context.close();
    }
  } finally {
    await setParentApproval(browser, true);
  }

  // With approval on, wrong details wait for the school and show nothing about any child.
  const w = await phone(browser, "ar");
  await w.page.goto("/ar/join?code=HRZ-2026");
  await w.page.getByTestId("join-code-next").click();
  await w.page.getByTestId("child-number").fill("HIS-24013");
  await w.page.getByTestId("child-dob").fill("2015-01-26");
  await w.page.getByTestId("details-next").click();
  await w.page.getByTestId("join-name").fill("زائر تجريبي");
  await w.page.getByTestId("join-email").fill(`e2e.waiting.${rand()}@family.horizon.example`);
  await w.page.getByTestId("join-password").fill(PASSWORD);
  await w.page.getByTestId("join-submit").click();
  await w.page.waitForURL(/\/ar\/join\/waiting/);
  await expect(w.page.getByTestId("waiting-screen")).toBeVisible();
  await expect(w.page.getByTestId("waiting-screen")).not.toContainText("Humaid");
  await noHorizontalScroll(w.page);
  await shot(w.page, "waiting-ar-390");
  // Going to the app while pending always lands back on the waiting screen.
  await w.page.goto("/ar/students");
  await w.page.waitForURL(/\/ar\/join\/waiting/);
  expect(w.errors).toEqual([]);
  await w.context.close();
});
