import { withTenant } from "@aegis/db";
import { importDiscoveryFile, reviewShadowAiApp } from "../secure/shadow-ai.js";
import type { SeededTenant } from "./demo-tenant.js";

/**
 * Shadow AI demo data. Synthetic log exports in the real formats go through the real parsers, so the
 * console shows exactly what an import of a customer's export would show. All people and addresses are
 * fictional; non-member identities use the demo domain and end up stored only as fingerprints.
 */
export async function seedDemoShadowAi(t: SeededTenant): Promise<{ imports: number; signals: number }> {
  const analyst = t.users.security_analyst!.ctx;
  const DAY = 86400_000;
  const at = (d: number, h = 10) => new Date(Date.now() - d * DAY + h * 3600_000).toISOString();
  const members = Object.values(t.users).map((u) => u.email);
  const contractors = ["contractor.one@meridian-demo.example", "contractor.two@meridian-demo.example", "intern.ops@meridian-demo.example"];

  return withTenant(t.orgId, async (db) => {
    await reviewShadowAiApp(db, analyst, { key: "chatgpt", status: "approved", note: "ChatGPT Enterprise workspace under the group agreement", controls: { sso: true, dpaSigned: true, dataRetentionAgreed: true, adminConsole: true } });
    await reviewShadowAiApp(db, analyst, { key: "github-copilot", status: "approved", note: "Copilot Business for the platform team", controls: { sso: true, dpaSigned: true, dataRetentionAgreed: true, adminConsole: true } });
    await reviewShadowAiApp(db, analyst, { key: "claude", status: "tolerated", note: "Pilot in the governance team while the contract is reviewed", controls: { sso: true } });
    await reviewShadowAiApp(db, analyst, { key: "deepseek", status: "unapproved", note: "No data processing agreement; data may be processed outside approved regions" });

    const entra: unknown[] = [];
    for (let d = 1; d <= 28; d++) {
      members.forEach((email, i) => {
        if ((d + i) % 3 === 0) entra.push({ createdDateTime: at(d, 8 + i), userPrincipalName: email, appDisplayName: "ChatGPT Enterprise", status: { errorCode: 0 }, deviceDetail: { deviceId: `mgb-laptop-${i}` } });
        if (i === 1 && d % 4 === 0) entra.push({ createdDateTime: at(d, 15), userPrincipalName: email, appDisplayName: "Claude for Work", status: { errorCode: 0 } });
        if (i === 5 && d % 2 === 0) entra.push({ createdDateTime: at(d, 9), userPrincipalName: email, appDisplayName: "GitHub Copilot", status: { errorCode: 0 } });
      });
      if (d % 5 === 0) entra.push({ createdDateTime: at(d, 11), userPrincipalName: contractors[d % 3], appDisplayName: "ChatGPT Enterprise", status: { errorCode: 0 } });
      if (d % 7 === 0) entra.push({ createdDateTime: at(d, 12), userPrincipalName: members[2], appDisplayName: "Workday", status: { errorCode: 0 } });
      if (d % 9 === 0) entra.push({ createdDateTime: at(d, 13), userPrincipalName: members[3], appDisplayName: "ChatGPT Enterprise", status: { errorCode: 50126 } });
    }
    const dns: string[] = [];
    for (let d = 1; d <= 21; d++) {
      if (d % 3 === 0) dns.push(JSON.stringify({ ts: at(d, 14), client: "10.20.4.17", query: "chat.deepseek.com" }));
      if (d % 6 === 0) dns.push(JSON.stringify({ ts: at(d, 16), client: "10.20.4.31", query: "www.perplexity.ai" }));
      dns.push(JSON.stringify({ ts: at(d, 9), client: "10.20.4.17", query: "portal.meridian-demo.example" }));
      if (d % 2 === 0) dns.push(JSON.stringify({ ts: at(d, 10), client: "10.20.5.2", query: "chatgpt.com" }));
    }
    const endpoint: string[] = [];
    for (let d = 2; d <= 20; d += 3) {
      endpoint.push(JSON.stringify({ ts: at(d, 17), hostname: "MGB-DEV-014", process: "/usr/local/bin/ollama", user: t.users.engineer!.email }));
      endpoint.push(JSON.stringify({ ts: at(d, 11), hostname: "MGB-DEV-022", process: "C:\\Users\\dev\\AppData\\Local\\Programs\\cursor\\Cursor.exe", user: "contractor.two@meridian-demo.example" }));
    }
    const results = [
      await importDiscoveryFile(db, analyst, { format: "entra_signin_json", text: JSON.stringify({ value: entra }), label: "Entra sign-ins, last 28 days" }),
      await importDiscoveryFile(db, analyst, { format: "dns_jsonl", text: dns.join("\n"), label: "Resolver logs, last 21 days" }),
      await importDiscoveryFile(db, analyst, { format: "endpoint_jsonl", text: endpoint.join("\n"), label: "EDR process events" }),
    ];
    return { imports: results.length, signals: results.reduce((n, r) => n + r.accepted, 0) };
  });
}
