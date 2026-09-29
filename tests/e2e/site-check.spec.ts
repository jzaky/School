import { expect, test } from "@playwright/test";
import { LOCALES, loginAs, type Persona } from "./helpers";

// Every sidebar link for every demo persona, in English and Arabic, on desktop and phone width.
// Fails on any page that errors, any 4xx/5xx page load, or horizontal scrolling on a phone.
// Run against production with: E2E_BASE_URL=https://<your domain> npx playwright test site-check
const PERSONAS: Persona[] = ["admin", "principal", "teacher", "counselor", "career_advisor", "dsl", "student", "parent", "registrar", "hod_computing", "deputy_dsl"];

for (const persona of PERSONAS) {
  for (const locale of LOCALES) {
    test(`site check: ${persona} (${locale})`, async ({ browser }) => {
      test.setTimeout(600_000);
      const s = await loginAs(browser, persona, locale);
      const { page } = s;
      const links = await page.$$eval("aside a[href], nav a[href]", (as) =>
        [...new Set(as.map((a) => a.getAttribute("href")))].filter((h): h is string => !!h && h.startsWith("/")),
      );
      expect(links.length).toBeGreaterThan(3);
      const problems: string[] = [];
      for (const href of links) {
        const res = await page.goto(href);
        if (!res || res.status() >= 400) problems.push(`${res?.status()} ${href}`);
        const notFound = await page.locator("text=/Page not found|الصفحة غير موجودة/").count();
        if (notFound) problems.push(`not found ${href}`);
      }
      // Phone width: no sideways scrolling on each page.
      await page.setViewportSize({ width: 390, height: 844 });
      for (const href of links) {
        await page.goto(href);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (overflow > 2) problems.push(`scrolls sideways by ${overflow}px on phone: ${href}`);
      }
      problems.push(...s.errors);
      await s.context.close();
      expect(problems, problems.join("\n")).toEqual([]);
    });
  }
}
