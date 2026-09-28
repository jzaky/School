import { chromium } from "@playwright/test";
const base = "http://localhost:3000";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1300, height: 900 } });
const errors = [];
p.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
p.on("response", (r) => r.status() >= 500 && errors.push(`http ${r.status()} ${r.url()}`));
await p.goto(base + "/demo");
await p.click("[data-testid=enter-student]");
await p.waitForURL(/home/, { timeout: 120000 });
await p.click("[data-testid=start-assessment]");
await p.waitForURL(/assessment/, { timeout: 120000 });
// Answer: strongly agree on analytical/investigative/technical items is hard to know from text; answer by position pattern.
for (let page = 0; page < 9; page++) {
  const qs = p.locator("[data-testid=question]");
  await p.waitForFunction((n) => { const q = document.querySelectorAll("[data-testid=question]"); return q.length && q[0].textContent.trim().startsWith(n + "."); }, page * 5 + 1, { timeout: 60000 });
  await p.waitForTimeout(250);
  const n = await qs.count();
  for (let i = 0; i < n; i++) {
    const dim = await qs.nth(i).getAttribute("data-dimension");
    const v = ["analytical", "investigative", "technical"].includes(dim) ? 5 : dim === "organized" || dim === "creative" ? 4 : 2;
    await qs.nth(i).locator(`[data-testid=answer-${v}]`).click();
  }
  await p.click("[data-testid=assessment-next]");
  await p.waitForTimeout(600);
}
await p.waitForURL(/career\?done=1/, { timeout: 120000 });
await p.screenshot({ path: "/tmp/claude-0/shots/hero1-results.png", fullPage: false });
const hasAi = await p.locator("[data-testid=match-ai_engineer]").count();
console.log("ai_engineer in top matches:", hasAi);
await p.locator("[data-testid=match-ai_engineer] [data-testid=choose-career]").click();
await p.locator("[data-testid=chosen-banner]").waitFor({ timeout: 60000 });
await p.click("[data-testid=book-advisor]");
await p.waitForURL(/services\/career_guidance/, { timeout: 120000 });
await p.locator("[data-testid=time-slot]").first().waitFor({ timeout: 60000 });
await p.locator("[data-testid=time-slot]").first().click();
await p.click("[data-testid=booking-continue]");
await p.screenshot({ path: "/tmp/claude-0/shots/hero1-form.png" });
await p.getByRole("button", { name: /Engineering and technology/ }).click();
// Fill required fields: click through steps
for (let i = 0; i < 4; i++) {
  if (await p.locator("[data-testid=form-submit]").count()) break;
  await p.click("[data-testid=form-next]");
  await p.waitForTimeout(400);
}
await p.screenshot({ path: "/tmp/claude-0/shots/hero1-form2.png" });
await p.click("[data-testid=form-submit]");
await p.waitForURL(/requests\/.+submitted=1/, { timeout: 120000 }).catch(() => {});
console.log("url", p.url());
await p.screenshot({ path: "/tmp/claude-0/shots/hero1-request.png", fullPage: true });
console.log("errors", errors);
import("node:fs").then((fs) => fs.writeFileSync("/tmp/claude-0/hero1-url.txt", p.url()));
await b.close();
