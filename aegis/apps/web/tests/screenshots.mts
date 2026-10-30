/**
 * Captures console and website screenshots for documentation.
 *   npx tsx tests/screenshots.mts   (dev server on :3000, demo tenant seeded)
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const out = new URL("../../../docs/screens/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const base = "http://localhost:3000";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const shot = async (name: string, path: string, settle = 1500) => {
  await page.goto(`${base}${path}`, { waitUntil: "networkidle" }).catch(() => undefined);
  await page.waitForTimeout(settle);
  await page.screenshot({ path: `${out}${name}.png`, fullPage: false });
  console.log("captured", name, page.url());
};
const firstRow = async (listPath: string, name: string) => {
  await page.goto(`${base}${listPath}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const row = page.locator('tbody tr[role="link"], tbody tr a[href]').first();
  const href = await row.getAttribute("href").catch(() => null);
  if (href) await page.goto(`${base}${href}`, { waitUntil: "networkidle" });
  else {
    await row.locator("td").first().click();
    await page.waitForTimeout(2500);
  }
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}${name}.png` });
  console.log("captured", name, page.url());
};

// Public site
await shot("00-site-home", "/site", 2500);
await shot("01-site-tour", "/site/tour");
await shot("02-site-architecture", "/site/architecture");

// Sign in as the owner
await page.goto(`${base}/login`);
await page.fill("#email", "nadia.haddad@meridian-demo.example");
await page.fill("#password", "AegisDemo2026!");
await page.click("button[type=submit]");
await page.waitForURL(/overview/);
await shot("10-command-center", "/overview", 3000);
await shot("11-agents", "/agents");
await firstRow("/agents", "12-agent-detail");
await shot("13-policies", "/policies");
await firstRow("/policies", "14-policy-detail");
await shot("15-gateway", "/gateway");
await firstRow("/gateway", "16-request-detail");
await shot("17-approvals", "/approvals");
await shot("18-live-activity", "/activity", 4000);
await shot("19-alerts", "/alerts");
await shot("20-evidence-ledger", "/evidence");
await shot("21-monitoring", "/monitoring");
await shot("22-governance-report", "/reports", 3000);
await shot("23-security-events", "/security/events");
await shot("24-data-protection", "/security/data-protection");
await shot("25-tool-security", "/security/tools");
await shot("26-incidents", "/security/incidents");
await shot("27-assessments", "/audit/assessments");
await firstRow("/audit/assessments", "28-assessment-detail");
await shot("29-documents", "/audit/documents");
await shot("30-remediation", "/audit/remediation");
await shot("31-users", "/org/users");
await shot("32-roles", "/org/roles");
await shot("33-demos", "/gateway/demos");
await browser.close();
