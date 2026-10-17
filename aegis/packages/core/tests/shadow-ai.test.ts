/**
 * Shadow AI discovery (docs/SHADOW_AI.md) with synthetic log exports in the formats the parsers read.
 * All identities are example.com or test addresses; nothing comes from a real tenant.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { disconnectAll, withTenant, type TenantDb } from "@aegis/db";
import { makeTestTenant, addUserWithRole, type TestTenant } from "./helpers.js";
import { addCustomShadowAiApp, importDiscoveryFile, listShadowAiApps, parseImport, reviewShadowAiApp, shadowAiCoverage, matchDomain, AI_APP_CATALOG } from "../src/secure/shadow-ai.js";

let t: TestTenant;
let ownerEmail = "";
const run = <T>(fn: (db: TenantDb) => Promise<T>) => withTenant(t.orgId, fn);
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

beforeAll(async () => {
  t = await makeTestTenant("shadow");
  ownerEmail = (await run((db) => db.membership.findFirstOrThrow({ where: { userId: t.ownerUserId }, select: { user: { select: { email: true } } } }))).user.email;
}, 60_000);
afterAll(async () => {
  await t.cleanup();
  await disconnectAll();
});

const entra = () =>
  JSON.stringify({
    value: [
      { createdDateTime: ago(30), userPrincipalName: ownerEmail, appDisplayName: "ChatGPT Enterprise", status: { errorCode: 0 }, deviceDetail: { deviceId: "dev-1" } },
      { createdDateTime: ago(40), userPrincipalName: "contractor@example.com", appDisplayName: "ChatGPT Enterprise", status: { errorCode: 0 } },
      { createdDateTime: ago(50), userPrincipalName: ownerEmail, appDisplayName: "Claude", status: { errorCode: 50126 } },
      { createdDateTime: ago(60), userPrincipalName: ownerEmail, appDisplayName: "Salesforce", status: { errorCode: 0 } },
      { userPrincipalName: "broken-record@example.com" },
    ],
  });

describe("parsing and matching", () => {
  it("reads Entra sign-ins, skips failed sign-ins, and counts records it cannot read", () => {
    const r = parseImport("entra_signin_json", entra());
    expect(r.observations.map((o) => o.appName)).toEqual(["ChatGPT Enterprise", "ChatGPT Enterprise", "Salesforce"]);
    expect(r.rejected).toBe(1);
  });
  it("matches subdomains of catalog hostnames and nothing else", () => {
    expect(matchDomain("cdn.claude.ai", AI_APP_CATALOG)).toBe("claude");
    expect(matchDomain("notclaude.ai", AI_APP_CATALOG)).toBeNull();
    expect(matchDomain("www.google.com", AI_APP_CATALOG)).toBeNull();
  });
  it("reads Okta SSO events and Zeek-style DNS lines", () => {
    const okta = JSON.stringify([{ published: ago(5), eventType: "user.authentication.sso", actor: { alternateId: "a@example.com" }, target: [{ type: "User" }, { type: "AppInstance", displayName: "Perplexity Enterprise" }], outcome: { result: "SUCCESS" } }]);
    expect(parseImport("okta_system_log_json", okta).observations[0]!.appName).toBe("Perplexity Enterprise");
    const dns = `{"ts": ${Date.now() / 1000}, "id.orig_h": "10.0.0.5", "query": "chat.deepseek.com"}\n# comment\n{"ts": "bad"}`;
    const d = parseImport("dns_jsonl", dns);
    expect(d.observations[0]).toMatchObject({ domain: "chat.deepseek.com", device: "10.0.0.5" });
    expect(d.rejected).toBe(1);
  });
});

describe("ingestion", () => {
  it("an identity-provider import stores confirmed sign-ins, links members and hashes everyone else", async () => {
    const r = await run((db) => importDiscoveryFile(db, t.ownerCtx, { format: "entra_signin_json", text: entra(), label: "Entra export" }));
    expect(r).toMatchObject({ matched: 2, accepted: 2, unmatched: 1, rejected: 1 });
    const signals = await run((db) => db.discoverySignal.findMany({ where: { importId: r.importId } }));
    expect(signals.every((s) => s.confidence === "confirmed" && s.appKey === "chatgpt")).toBe(true);
    expect(signals.filter((s) => s.userId === t.ownerUserId)).toHaveLength(1);
    const other = signals.find((s) => !s.userId)!;
    expect(other.identityHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(signals)).not.toContain("contractor@example.com");
    const imp = await run((db) => db.discoveryImport.findUniqueOrThrow({ where: { id: r.importId } }));
    expect(imp.unmatchedTop).toEqual([{ name: "Salesforce", count: 1 }]);
  });

  it("re-importing the same file adds nothing", async () => {
    const r = await run((db) => importDiscoveryFile(db, t.ownerCtx, { format: "entra_signin_json", text: entra() }));
    expect(r).toMatchObject({ matched: 2, accepted: 0, duplicates: 2 });
  });

  it("a DNS import keeps only AI lookups, labels them inferred, and never keeps other hostnames", async () => {
    const lines = [
      { ts: ago(20), client: "10.1.1.7", query: "chat.deepseek.com" },
      { ts: ago(21), client: "10.1.1.7", query: "www.bank-intranet.example" },
      { ts: ago(22), client: "10.1.1.8", query: "news.example.org" },
    ];
    const r = await run((db) => importDiscoveryFile(db, t.ownerCtx, { format: "dns_jsonl", text: lines.map((l) => JSON.stringify(l)).join("\n") }));
    expect(r).toMatchObject({ matched: 1, unmatched: 2 });
    const all = await run((db) => db.discoverySignal.findMany({ where: { importId: r.importId } }));
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ confidence: "inferred", sourceType: "network", appKey: "deepseek" });
    const imp = await run((db) => db.discoveryImport.findUniqueOrThrow({ where: { id: r.importId } }));
    expect(imp.unmatchedTop).toEqual([]);
    const everything = JSON.stringify(await run((db) => db.discoverySignal.findMany()));
    expect(everything).not.toContain("bank-intranet");
    expect(everything).not.toContain("news.example.org");
    expect(everything).not.toContain("10.1.1.7");
  });

  it("an endpoint import finds a local model runtime as observed", async () => {
    const r = await run((db) => importDiscoveryFile(db, t.ownerCtx, { format: "endpoint_jsonl", text: JSON.stringify({ ts: ago(15), hostname: "LAPTOP-042", process: "C:\\Program Files\\Ollama\\ollama.exe", user: ownerEmail }) }));
    expect(r.matched).toBe(1);
    const s = await run((db) => db.discoverySignal.findFirstOrThrow({ where: { importId: r.importId } }));
    expect(s).toMatchObject({ appKey: "ollama", confidence: "observed", process: "ollama.exe", userId: t.ownerUserId });
  });

  it("use of an app marked unapproved raises a security event that says how sure it is and that nothing was blocked", async () => {
    await run((db) => reviewShadowAiApp(db, t.ownerCtx, { key: "deepseek", status: "unapproved", note: "No data processing agreement" }));
    const r = await run((db) => importDiscoveryFile(db, t.ownerCtx, { format: "dns_jsonl", text: JSON.stringify({ ts: ago(3), client: "10.1.1.9", query: "api.deepseek.com" }) }));
    expect(r.unapprovedApps).toEqual(["deepseek"]);
    const ev = await run((db) => db.securityEvent.findFirstOrThrow({ where: { type: "shadow_ai.unapproved_use" }, orderBy: { createdAt: "desc" } }));
    expect(ev.title).toMatch(/^Possible use of unapproved AI app DeepSeek/);
    expect((ev.detail as { blocked: boolean; confidence: string }).blocked).toBe(false);
    expect((ev.detail as { confidence: string }).confidence).toBe("inferred");
  });

  it("a custom app is recognized once added", async () => {
    await run((db) => addCustomShadowAiApp(db, t.ownerCtx, { key: "internal-summarizer", name: "Internal summarizer", domains: ["summarize.tools.example"], processes: [] }));
    const r = await run((db) => importDiscoveryFile(db, t.ownerCtx, { format: "swg_jsonl", text: JSON.stringify({ ts: ago(2), url: "https://summarize.tools.example/api", user: ownerEmail }) }));
    expect(r.matched).toBe(1);
  });
});

describe("views", () => {
  it("each app shows its best confidence, sources, people and finding", async () => {
    const apps = await run((db) => listShadowAiApps(db, t.ownerCtx));
    const chatgpt = apps.find((a) => a.key === "chatgpt")!;
    expect(chatgpt).toMatchObject({ bestConfidence: "confirmed", people: 2, sources: ["entra"], finding: "review" });
    const deepseek = apps.find((a) => a.key === "deepseek")!;
    expect(deepseek).toMatchObject({ bestConfidence: "inferred", finding: "violation", status: "unapproved" });
    expect(apps[0]!.finding).toBe("violation");
    expect(apps.find((a) => a.key === "gemini")).toMatchObject({ signals: 0, finding: null, bestConfidence: null });
  });

  it("coverage lists what each source misses and never claims a share of AI use found", async () => {
    const c = await run((db) => shadowAiCoverage(db, t.ownerCtx));
    expect(c.typesConnected).toBe(3);
    expect(c.statement).toMatch(/Not covered: browser, inventory/);
    expect(c.statement).toMatch(/personal devices, personal accounts/);
    expect(c.people).toEqual({ seen: 1, total: 1 });
    expect(c.sources.find((s) => s.key === "dns")!.misses).toMatch(/anything typed/);
  });

  it("a viewer can read but cannot import or review", async () => {
    const viewer = await addUserWithRole(t, "viewer", "sv");
    await expect(run((db) => listShadowAiApps(db, viewer.ctx))).resolves.toBeInstanceOf(Array);
    await expect(run((db) => importDiscoveryFile(db, viewer.ctx, { format: "dns_jsonl", text: "" }))).rejects.toThrow(/security:write/);
    await expect(run((db) => reviewShadowAiApp(db, viewer.ctx, { key: "chatgpt", status: "approved" }))).rejects.toThrow(/security:write/);
  });
});
