// Ad hoc full-page screenshots: node tests/shot.mjs <outdir> <email> <width> <path> [<path>...]
import { chromium } from "@playwright/test";
const [outdir, email, widthStr, ...paths] = process.argv.slice(2);
const base = "http://localhost:3000";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(widthStr), height: 900 } });
if (email !== "-") {
  await page.goto(`${base}/login`);
  await page.fill("#email", email);
  await page.fill("#password", "AegisDemo2026!");
  await page.click("button[type=submit]");
  await page.waitForURL(/\/(overview|getting-started)/);
}
for (const p of paths) {
  await page.goto(`${base}${p}`, { waitUntil: "networkidle", timeout: 120000 }).catch(() => undefined);
  await page.waitForTimeout(800);
  const name = `${p.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "home"}-${widthStr}.png`;
  await page.screenshot({ path: `${outdir}/${name}`, fullPage: true });
  console.log(name);
}
await browser.close();
