// Finds the deepest element whose hiding removes the horizontal page overflow. node tests/overflow-bisect.mjs <email|-> <width> <path>
import { chromium } from "@playwright/test";
const [email, widthStr, path] = process.argv.slice(2);
const base = "http://localhost:3000";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(widthStr), height: 900 } });
if (email !== "-") { await page.goto(`${base}/login`); await page.fill("#email", email); await page.fill("#password", "AegisDemo2026!"); await page.click("button[type=submit]"); await page.waitForURL(/\/(overview|getting-started)/); }
await page.goto(`${base}${path}`, { waitUntil: "networkidle", timeout: 120000 });
console.log(await page.evaluate(() => {
  const d = document.documentElement; const vw = d.clientWidth;
  const fixes = (el) => { const prev = el.style.display; el.style.display = "none"; const ok = d.scrollWidth <= vw + 1; el.style.display = prev; return ok; };
  let cur = document.body; const chain = [];
  for (let depth = 0; depth < 40; depth++) {
    const kids = Array.from(cur.children).filter((k) => fixes(k));
    if (!kids.length) break;
    cur = kids[0];
    chain.push(`${cur.tagName.toLowerCase()} [${(cur.getAttribute("class") ?? "").slice(0, 80)}] ox=${getComputedStyle(cur).overflowX} pos=${getComputedStyle(cur).position} w=${Math.round(cur.getBoundingClientRect().width)} right=${Math.round(cur.getBoundingClientRect().right)}`);
  }
  return `scrollWidth ${d.scrollWidth} viewport ${vw}\n` + chain.join("\n");
}));
await browser.close();
