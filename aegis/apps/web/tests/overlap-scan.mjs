/**
 * Scans pages at several viewport widths for text that collides or overflows.
 * Reports: (a) pairs of text-bearing elements whose boxes intersect by more than 3px in both axes
 * and are not nested, (b) elements whose text overflows their own box without clipping,
 * (c) horizontal page overflow (document wider than the viewport).
 * Run against the dev server with the demo tenant seeded:
 *   node tests/overlap-scan.mjs            (Google Fonts blocked, local fallbacks)
 *   node tests/overlap-scan.mjs --fonts    (real web fonts; needs network)
 * Plain .mjs on purpose: esbuild's keepNames helper breaks functions passed to page.evaluate.
 */
import { chromium } from "@playwright/test";

const base = "http://localhost:3000";
const PASSWORD = "AegisDemo2026!";
const widths = [390, 768, 1024, 1280, 1440];
const marketing = ["/", "/site/products", "/site/tour", "/site/architecture", "/site/security", "/site/open-source", "/site/pricing", "/site/contact", "/site/demo", "/site/pilot", "/site/privacy", "/site/terms", "/login"];
const consolePages = ["/overview", "/getting-started", "/agents", "/approvals", "/activity", "/org/settings", "/policies", "/integrations", "/evidence", "/gateway", "/security/events", "/audit", "/monitoring"];

function scan(page) {
  return page.evaluate(() => {
    const out = [];
    const vw = document.documentElement.clientWidth;
    const sw = document.documentElement.scrollWidth;
    if (sw > vw + 1) out.push({ kind: "page-overflow", a: "document", detail: `scrollWidth ${sw} > viewport ${vw}` });
    const label = (el) => {
      const t = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 50);
      const id = el.id ? `#${el.id}` : "";
      const cls = (el.getAttribute("class") ?? "").split(/\s+/).slice(0, 3).join(".");
      return `${el.tagName.toLowerCase()}${id}${cls ? "." + cls : ""} "${t}"`;
    };
    const visible = (el) => {
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none" || cs.opacity === "0") return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const leaves = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let node = walker.nextNode();
    while (node) {
      const el = node;
      const inClosedDetails = el.closest("details:not([open])") && !el.closest("summary");
      if (!["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "PATH"].includes(el.tagName) && !inClosedDetails && visible(el)) {
        let hasText = false;
        for (const c of Array.from(el.childNodes)) if (c.nodeType === 3 && (c.textContent ?? "").trim()) hasText = true;
        if (hasText) leaves.push(el);
        if (hasText && el.scrollWidth > el.clientWidth + 2) {
          let clipped = false;
          let p = el;
          while (p && p !== document.body) {
            const o = getComputedStyle(p);
            if (/(hidden|clip|auto|scroll)/.test(o.overflowX) || /(hidden|clip|auto|scroll)/.test(o.overflow)) { clipped = true; break; }
            p = p.parentElement;
          }
          if (!clipped) out.push({ kind: "text-overflow", a: label(el), detail: `scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}` });
        }
      }
      node = walker.nextNode();
    }
    // Each element contributes its line boxes (an inline link that wraps onto two lines is two boxes, not one
    // union rectangle), clipped by scrolling ancestors: a table column hidden behind a horizontal scrollbar is
    // not visible and cannot collide with anything.
    const clipBox = (el, r) => {
      let box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      let p = el.parentElement;
      while (p && p !== document.body) {
        const o = getComputedStyle(p);
        if (/(hidden|clip|auto|scroll)/.test(o.overflowX) || /(hidden|clip|auto|scroll)/.test(o.overflow)) {
          const pr = p.getBoundingClientRect();
          box = { left: Math.max(box.left, pr.left), top: Math.max(box.top, pr.top), right: Math.min(box.right, pr.right), bottom: Math.min(box.bottom, pr.bottom) };
        }
        p = p.parentElement;
      }
      return box;
    };
    const items = leaves.map((el) => ({ el, boxes: Array.from(el.getClientRects()).map((r) => clipBox(el, r)).filter((b) => b.right - b.left > 1 && b.bottom - b.top > 1) })).filter((x) => x.boxes.length);
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const A = items[i], B = items[j];
        if (A.el.contains(B.el) || B.el.contains(A.el)) continue;
        const pa = getComputedStyle(A.el).position, pb = getComputedStyle(B.el).position;
        if (["fixed", "absolute"].includes(pa) || ["fixed", "absolute"].includes(pb)) continue;
        let best = null;
        for (const a of A.boxes) for (const b of B.boxes) {
          const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (ix > 3 && iy > 3 && (!best || ix * iy > best.ix * best.iy)) best = { ix, iy };
        }
        if (best) out.push({ kind: "overlap", a: label(A.el), b: label(B.el), detail: `${Math.round(best.ix)}x${Math.round(best.iy)}px` });
      }
    }
    return out;
  });
}

const useFonts = process.argv.includes("--fonts");
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
if (!useFonts) await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (r) => r.abort());

const results = {};
async function visit(path) {
  for (const w of widths) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded", timeout: 120_000 }).catch(() => undefined);
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
    await page.waitForTimeout(600);
    const hits = await scan(page);
    if (hits.length) results[`${path} @${w}`] = hits;
  }
}
async function login(email) {
  await ctx.clearCookies();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}/login`);
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/(overview|getting-started)/);
}

for (const p of marketing) await visit(p);

await login("nadia.haddad@meridian-demo.example");
for (const p of consolePages) await visit(p);
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(`${base}/policies`, { waitUntil: "networkidle" });
await page.locator("tbody tr", { hasText: "Customer refund authority" }).first().click();
await page.waitForURL(/\/policies\/[0-9a-f-]{36}/);
const policyPath = new URL(page.url()).pathname;
await visit(`${policyPath}?tab=thresholds`);
await visit(policyPath);
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(`${base}/gateway`, { waitUntil: "networkidle" });
await page.locator("tbody tr", { hasText: "issue-refund" }).first().click();
await page.waitForURL(/\/gateway\/[0-9a-f-]{36}/).catch(() => undefined);
if (/\/gateway\/[0-9a-f-]{36}/.test(page.url())) await visit(new URL(page.url()).pathname);

await login("lina.mansour@meridian-demo.example");
await page.goto(`${base}/approvals`, { waitUntil: "networkidle" });
const href = await page.locator("a[href^='/approvals/']").first().getAttribute("href").catch(() => null);
if (href) await visit(href);
await browser.close();

let total = 0;
for (const [k, hits] of Object.entries(results)) {
  console.log(`\n== ${k}`);
  for (const h of hits) { total++; console.log(`  [${h.kind}] ${h.a}${h.b ? "  <->  " + h.b : ""}  (${h.detail})`); }
}
console.log(`\n${total} findings across ${Object.keys(results).length} page/width combinations`);
