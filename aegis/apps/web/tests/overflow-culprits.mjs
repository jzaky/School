// Lists elements extending past the viewport's right edge: node tests/overflow-culprits.mjs <email|-> <width> <path>...
import { chromium } from "@playwright/test";
const [email, widthStr, ...paths] = process.argv.slice(2);
const base = "http://localhost:3000";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(widthStr), height: 900 } });
if (email !== "-") {
  await page.goto(`${base}/login`); await page.fill("#email", email); await page.fill("#password", "AegisDemo2026!");
  await page.click("button[type=submit]"); await page.waitForURL(/\/(overview|getting-started)/);
}
for (const p of paths) {
  await page.goto(`${base}${p}`, { waitUntil: "networkidle", timeout: 120000 }).catch(() => undefined);
  await page.waitForTimeout(800);
  const out = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const res = [];
    const clipRight = (el) => {
      let right = el.getBoundingClientRect().right;
      let p = el.parentElement;
      while (p && p !== document.body) {
        const o = getComputedStyle(p);
        if (/(hidden|clip|auto|scroll)/.test(o.overflowX) || /(hidden|clip|auto|scroll)/.test(o.overflow)) right = Math.min(right, p.getBoundingClientRect().right);
        p = p.parentElement;
      }
      return right;
    };
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (clipRight(el) > vw + 2 && r.width > 0) {
        const cls = (el.getAttribute("class") ?? "").split(/\s+/).slice(0, 5).join(".");
        let d = 0, n = el; while (n.parentElement) { d++; n = n.parentElement; }
        res.push({ tag: el.tagName.toLowerCase() + (cls ? "." + cls : ""), right: Math.round(r.right), width: Math.round(r.width), depth: d, text: (el.textContent ?? "").trim().slice(0, 40) });
      }
    }
    res.sort((a, b) => a.depth - b.depth);
    return { vw, sw: document.documentElement.scrollWidth, items: res.slice(0, 10) };
  });
  console.log(`\n== ${p} @${widthStr}: scrollWidth ${out.sw} viewport ${out.vw}`);
  for (const i of out.items) console.log(`  d${i.depth} ${i.tag} right=${i.right} w=${i.width} "${i.text}"`);
}
await browser.close();
