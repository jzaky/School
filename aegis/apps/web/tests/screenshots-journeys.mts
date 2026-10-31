/**
 * Captures the customer-journey screenshots used by docs/screens and the public site
 * (apps/web/public/assets/screens). Run against the dev server with the demo tenant seeded and the
 * API on :4000:  npx tsx tests/screenshots-journeys.mts
 *
 * The run first drives the refund workflow over the API so the screens show live state: an executed
 * refund with a receipt and a pending approval for the approver.
 */
import { chromium, type Page } from "@playwright/test";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";

const docs = new URL("../../../docs/screens/", import.meta.url).pathname;
const site = new URL("../public/assets/screens/", import.meta.url).pathname;
mkdirSync(docs, { recursive: true });
mkdirSync(site, { recursive: true });
const base = "http://localhost:3000";
const api = "http://localhost:4000";
const PASSWORD = "AegisDemo2026!";

const keys = JSON.parse(readFileSync(new URL("../../../.demo-keys.json", import.meta.url), "utf8")) as { agents: Record<string, string> };
const agentKey = keys.agents["support-refund-agent"]!;
const run = Date.now().toString(36);
async function refund(params: Record<string, unknown>, idempotencyKey: string) {
  // codeql[js/file-access-to-http] Developer screenshot script: sends the local demo agent key to the local API it was issued by.
  const res = await fetch(`${api}/v1/gateway/actions`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${agentKey}` }, body: JSON.stringify({ tool: "issue-refund", action: "execute", resource: "support-tickets", params, idempotencyKey, justification: "Customer sent photos of the damaged item; replacement declined", principal: { type: "customer", ref: "CUST-88213" }, context: { channel: "chat" } }) });
  return (await res.json()) as { requestId: string; status: string; approval?: { approvalRequestId: string } };
}
const executed = await refund({ orderId: `ORD-${run}-A`, customerId: "CUST-88213", amount: 180, currency: "AED", reason: "Damaged packaging" }, `shots-${run}-a`);
const pending = await refund({ orderId: `ORD-${run}-B`, customerId: "CUST-88213", amount: 1450, currency: "AED", reason: "Late delivery compensation" }, `shots-${run}-b`);
console.log("seeded live state", executed.status, pending.status);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
// External font hosts are unreachable from the build container and keep "waiting for fonts" open; local fallbacks render.
await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (r) => r.abort());

async function login(p: Page, email: string) {
  await p.goto(`${base}/login`);
  await p.fill("#email", email);
  await p.fill("#password", PASSWORD);
  await p.click("button[type=submit]");
  await p.waitForURL(/\/(overview|getting-started)/);
}
async function logout(p: Page) {
  await p.context().clearCookies();
}
const shot = async (name: string, path: string, settle = 2000) => {
  await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded", timeout: 120_000 }).catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
  await page.waitForTimeout(settle);
  await page.screenshot({ path: `${docs}${name}.png`, fullPage: false, timeout: 90_000 });
  copyFileSync(`${docs}${name}.png`, `${site}${name}.png`);
  console.log("captured", name, page.url());
};

// Owner journeys
await login(page, "nadia.haddad@meridian-demo.example");
await shot("overview", "/overview", 3500);
await shot("getting-started", "/getting-started");
await shot("request-detail", `/gateway/${executed.requestId}`);
await page.goto(`${base}/policies`, { waitUntil: "networkidle" });
const refundPolicy = page.locator("tbody tr", { hasText: "Customer refund authority" }).first();
await refundPolicy.click();
await page.waitForURL(/\/policies\/[0-9a-f-]{36}/);
const policyUrl = new URL(page.url());
await shot("policy-thresholds", `${policyUrl.pathname}?tab=thresholds`, 3000);
await shot("integrations", "/integrations");
await shot("evidence", "/evidence", 3000);
await shot("activity", "/activity", 3000);
await shot("settings", "/org/settings");
await logout(page);

// Approver journey
await login(page, "lina.mansour@meridian-demo.example");
await shot("approvals", "/approvals", 3000);
if (pending.approval) await shot("approval-detail", `/approvals/${pending.approval.approvalRequestId}`, 3000);
await logout(page);

// Public site
await shot("site-home", "/", 3000);
await shot("site-demo", "/site/demo", 3000);
await browser.close();
