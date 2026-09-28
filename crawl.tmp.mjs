import { chromium } from "@playwright/test";
const base = process.env.BASE ?? "http://localhost:3000";
const [persona, locale = "en", ...paths] = process.argv.slice(2);
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
const p = await ctx.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(`pageerror ${String(e).slice(0, 200)}`));
p.on("console", (m) => m.type() === "error" && !m.text().includes("caret-color") && errors.push(`console ${m.text().slice(0, 6000)}`));
p.on("response", (r) => r.status() >= 400 && errors.push(`http ${r.status()} ${r.url()}`));
await p.goto(base + "/demo");
await p.click(`[data-testid=enter-${persona}]`);
await p.waitForURL(/\/(en|ar)\/home/, { timeout: 120000 });
for (const path of paths) {
  const url = path.startsWith("/") ? `${base}/${locale}${path}` : path;
  const res = await p.goto(url, { timeout: 120000 });
  await p.waitForLoadState("networkidle").catch(() => {});
  const title = (await p.locator("h1").first().textContent().catch(() => "")) ?? "";
  const name = `${persona}-${locale}${path.replace(/[/?=&]/g, "_")}`.slice(0, 120);
  await p.screenshot({ path: `/tmp/claude-0/shots/${name}.png` });
  console.log(res?.status(), path, "|", title.trim().slice(0, 60));
}
console.log("errors:", errors.length ? errors.join("\n") : "none");
await b.close();
