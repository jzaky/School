/**
 * Employee AI gateway with DLP (docs/AI_GATEWAY_DLP.md). Runs against a local fake OpenAI-compatible
 * provider that records every request it receives, so the tests prove what actually left AEGIS.
 * All data is synthetic: test card numbers, example.com addresses and made-up keys.
 */
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { disconnectAll, withTenant, type TenantDb } from "@aegis/db";
import { env } from "../src/env.js";
import { makeTestTenant, addUserWithRole, type TestTenant } from "./helpers.js";
import { activateVersion, assignPolicy, createPolicy, submitForReview } from "../src/policy/service.js";
import { setAiGatewayMode, aiGatewayStats, completeAiRequest, createAiProvider, decideAiRequest, inspectChatRequest, listAiGatewayEvents, prepareAiRequest, previewAiDecision, setAiProviderApproval, type AiPolicyInput } from "../src/secure/ai-gateway.js";
import { DEFAULT_DATA_CLASSES } from "../src/shield/data-classes.js";
import type { DataClassSpec } from "../src/shield/detectors.js";
import { parsePolicyDocument } from "../src/policy/schema.js";
import { runPolicyTests } from "../src/policy/evaluate.js";
import { POLICY_TEMPLATES } from "../../../apps/web/src/components/control/policy-templates.js";

let server: Server;
let base = "";
const received: { auth: string | undefined; body: Record<string, unknown> }[] = [];
let answer = "Here is a summary.";
let t: TestTenant;
const run = <T>(fn: (db: TenantDb) => Promise<T>) => withTenant(t.orgId, fn);

const CARD = "4111 1111 1111 1111";
const PROVIDER_KEY = "sk-test-fake-provider-key-000000";

beforeAll(async () => {
  env().AEGIS_ALLOW_PRIVATE_DESTINATIONS = true;
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      received.push({ auth: req.headers.authorization, body: JSON.parse(raw) as Record<string, unknown> });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "chatcmpl-test", object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: answer }, finish_reason: "stop" }] }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
  t = await makeTestTenant("aigw");
  await run((db) => createAiProvider(db, t.ownerCtx, { key: "fake-openai", name: "Fake provider", baseUrl: base, models: ["gpt-test"], apiKey: PROVIDER_KEY, declaredRegion: "Test only" }));
}, 60_000);

afterAll(async () => {
  env().AEGIS_ALLOW_PRIVATE_DESTINATIONS = false;
  await new Promise<void>((r) => server.close(() => r()));
  await t.cleanup();
  await disconnectAll();
});

const principal = () => ({ type: "user" as const, id: t.ownerUserId, apiKeyId: null });
async function send(body: unknown) {
  const prepared = await run((db) => prepareAiRequest(db, t.ownerCtx, principal(), body));
  return completeAiRequest(run, t.ownerCtx, prepared);
}
const chat = (content: string, model = "gpt-test") => ({ model, messages: [{ role: "user", content }] });

describe("inspection is local and pure", () => {
  const classes: DataClassSpec[] = DEFAULT_DATA_CLASSES.map((c) => ({ key: c.key, detector: c.detector, action: c.action, severity: c.severity }));
  it("finds classes in text parts and tool arguments, and counts parts it cannot inspect", () => {
    const insp = inspectChatRequest({ model: "m", messages: [{ role: "user", content: [{ type: "text", text: `card ${CARD}` }, { type: "image_url", image_url: { url: "x" } }] }, { role: "assistant", content: null, tool_calls: [{ id: "1", type: "function", function: { name: "f", arguments: '{"to":"amira@example.com"}' } }] }] }, classes);
    expect(insp.classes.map((c) => c.dataClass)).toEqual(["card_number", "email"]);
    expect(insp.uninspectableParts).toBe(1);
  });
  it("a policy restrict redacts, a deny blocks, an unapproved provider blocks, and approval outcomes block", () => {
    const input: AiPolicyInput = { action: { tool: "ai.chat", name: "chat.completions" }, principal: { type: "user", id: "u", claimedUser: null, role: "viewer", teams: [] }, provider: { key: "p", approved: true }, model: "m", data: { classes: [], blockClasses: [], maxSeverity: null, total: 0, uninspectableParts: 0 }, prompt: { chars: 10, messages: 1 } };
    const pol = (effect: string) => [{ policyKey: "k", policyVersionId: "v", policyVersion: 1, document: { version: 1, appliesTo: { tools: [], actions: [], environments: [] }, rules: [{ id: "r", effect, when: { always: true }, description: "", reason: `rule ${effect}`, riskIndicators: [] }], tests: [] } as never }];
    expect(decideAiRequest(input, []).decision).toBe("allow");
    expect(decideAiRequest(input, pol("allow")).decision).toBe("allow");
    expect(decideAiRequest(input, pol("restrict"))).toMatchObject({ decision: "redact", strictRedaction: true });
    expect(decideAiRequest(input, pol("deny")).decision).toBe("block");
    expect(decideAiRequest(input, pol("require_approval")).decision).toBe("block");
    expect(decideAiRequest({ ...input, provider: { key: "p", approved: false } }, []).decision).toBe("block");
    expect(decideAiRequest({ ...input, provider: { key: null, approved: false } }, []).decision).toBe("block");
    expect(decideAiRequest(input, pol("allow"), [{ policyKey: "k" }]).decision).toBe("block");
  });
});

describe("the Employee AI use template", () => {
  it("parses as a policy and passes its own test cases", () => {
    const tpl = POLICY_TEMPLATES.find((x) => x.id === "employee-ai-use")!;
    expect(tpl.category).toBe("ai_usage");
    const results = runPolicyTests(parsePolicyDocument(tpl.document));
    expect(results.length).toBe(3);
    expect(results.every((r) => r.passed)).toBe(true);
  });
});

describe("the gateway end to end", () => {
  it("a clean prompt is forwarded unchanged with the vaulted provider key, and the record holds no prompt text", async () => {
    const before = received.length;
    const out = await send(chat("Summarize the quarterly roadmap in three bullet points."));
    expect(out).toMatchObject({ status: 200, decision: "allow", forwarded: true });
    expect(received.length).toBe(before + 1);
    expect(received.at(-1)!.auth).toBe(`Bearer ${PROVIDER_KEY}`);
    expect((received.at(-1)!.body.messages as { content: string }[])[0]!.content).toBe("Summarize the quarterly roadmap in three bullet points.");
    const ev = await run((db) => db.aiGatewayEvent.findUniqueOrThrow({ where: { id: out.eventId } }));
    expect(ev).toMatchObject({ forwarded: true, status: "forwarded", upstreamStatus: 200, decision: "allow", basis: "data_classes_only" });
    expect(JSON.stringify(ev)).not.toContain("quarterly roadmap");
    expect(ev.promptHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("a prompt with a payment card never reaches the provider, and the block is recorded as not forwarded", async () => {
    const before = received.length;
    const out = await send(chat(`Please check why ${CARD} was declined.`));
    expect(out).toMatchObject({ status: 403, decision: "block", forwarded: false });
    expect(received.length).toBe(before);
    const ev = await run((db) => db.aiGatewayEvent.findUniqueOrThrow({ where: { id: out.eventId } }));
    expect(ev).toMatchObject({ forwarded: false, status: "not_forwarded", decision: "block" });
    expect(ev.promptClasses).toEqual([{ dataClass: "card_number", count: 1, action: "block", severity: "high" }]);
    expect(JSON.stringify(ev)).not.toContain("4111");
    const sec = await run((db) => db.securityEvent.findFirstOrThrow({ where: { type: "ai_gateway.sensitive_prompt_blocked" }, orderBy: { createdAt: "desc" } }));
    expect(sec.title).not.toContain("4111");
    expect((sec.detail as { forwarded: boolean }).forwarded).toBe(false);
  });

  it("an email address is masked before forwarding; the provider sees only the masked value", async () => {
    const out = await send(chat("Draft a reply to amira.saleh@example.com about the delay."));
    expect(out).toMatchObject({ status: 200, decision: "redact", forwarded: true });
    const sent = (received.at(-1)!.body.messages as { content: string }[])[0]!.content;
    expect(sent).not.toContain("amira.saleh@example.com");
    expect(sent).toMatch(/\*+/);
  });

  it("the person named by an application key is recorded but never sent to the provider", async () => {
    const prepared = await run((db) => prepareAiRequest(db, t.ownerCtx, { type: "integration", id: t.ownerUserId, apiKeyId: null }, { ...chat("Hello"), user: "employee-123" }));
    await completeAiRequest(run, t.ownerCtx, prepared);
    expect(prepared.event.claimedUser).toBe("employee-123");
    expect(received.at(-1)!.body.user).toBeUndefined();
  });

  it("images and streaming are refused rather than passed through uninspected", async () => {
    const before = received.length;
    const img = await send({ model: "gpt-test", messages: [{ role: "user", content: [{ type: "text", text: "what is this" }, { type: "image_url", image_url: { url: "https://example.com/a.png" } }] }] });
    expect(img.decision).toBe("block");
    await expect(run((db) => prepareAiRequest(db, t.ownerCtx, principal(), { ...chat("hi"), stream: true }))).rejects.toThrow(/Streaming/);
    expect(received.length).toBe(before);
  });

  it("a model no approved provider offers is blocked, and so is every model of a blocked provider", async () => {
    const before = received.length;
    expect((await send(chat("hello", "gpt-unapproved"))).decision).toBe("block");
    const p = await run((db) => db.integration.findFirstOrThrow({ where: { key: "fake-openai" } }));
    await run((db) => setAiProviderApproval(db, t.ownerCtx, p.id, false, "Contract review pending"));
    const out = await send(chat("hello"));
    expect(out.decision).toBe("block");
    expect(JSON.stringify(out.body)).toMatch(/blocked/);
    await run((db) => setAiProviderApproval(db, t.ownerCtx, p.id, true, "Contract signed"));
    expect(received.length).toBe(before);
  });

  it("a provider answer containing a secret is withheld from the employee", async () => {
    answer = "Use AKIAABCDEFGHIJKLMNOP to call the bucket.";
    try {
      const out = await send(chat("How do I list the bucket?"));
      expect(out.status).toBe(200);
      const content = (out.body as { choices: { message: { content: string } }[] }).choices[0]!.message.content;
      expect(content).toMatch(/AEGIS withheld this answer/);
      expect(content).not.toContain("AKIA");
      const ev = await run((db) => db.aiGatewayEvent.findUniqueOrThrow({ where: { id: out.eventId } }));
      expect(ev.responseWithheld).toBe(true);
    } finally {
      answer = "Here is a summary.";
    }
  });

  it("an AI usage policy evaluated by the same engine can require strict redaction for some models", async () => {
    const doc = { version: 1, appliesTo: { tools: ["ai.chat"], actions: [], environments: [] }, rules: [{ id: "allow-all", effect: "allow", when: { always: true }, reason: "Employees may use approved models" }, { id: "strict-for-test", effect: "restrict", when: { attr: "model", op: "eq", value: "gpt-test" }, reason: "Remove every detected value for this model" }] };
    const pol = await run((db) => createPolicy(db, t.ownerCtx, { key: "employee-ai-use", name: "Employee AI use", description: "", category: "ai_usage", document: doc, changeNote: "test" }));
    await run((db) => submitForReview(db, t.ownerCtx, pol.version.id));
    await run((db) => activateVersion(db, t.ownerCtx, pol.version.id, { fourEyes: false }));
    await run((db) => assignPolicy(db, t.ownerCtx, pol.policy.id, { targetType: "org", priority: 100 }));
    const out = await send(chat("Ping the server at 10.20.30.40 for me."));
    expect(out).toMatchObject({ decision: "redact", forwarded: true });
    const sent = (received.at(-1)!.body.messages as { content: string }[])[0]!.content;
    expect(sent).toContain("[REDACTED:ip_address]");
    const ev = await run((db) => db.aiGatewayEvent.findUniqueOrThrow({ where: { id: out.eventId } }));
    expect(ev.basis).toBe("policy");
    expect(ev.policyVersionIds).toEqual([pol.version.id]);
  });

  it("the dry run contacts nobody and records nothing; a viewer can read the log but cannot add a provider", async () => {
    const before = received.length;
    const count = await run((db) => db.aiGatewayEvent.count());
    const preview = await run((db) => previewAiDecision(db, t.ownerCtx, { model: "gpt-test", text: `card ${CARD}` }));
    expect(preview.decision).toBe("block");
    expect(received.length).toBe(before);
    expect(await run((db) => db.aiGatewayEvent.count())).toBe(count);
    const stats = await run((db) => aiGatewayStats(db, t.ownerCtx));
    expect(stats.blocked).toBeGreaterThan(0);
    expect(stats.forwarded + stats.notForwarded).toBe(stats.total);
    const viewer = await addUserWithRole(t, "viewer", "aiv");
    await expect(run((db) => listAiGatewayEvents(db, viewer.ctx))).resolves.toBeInstanceOf(Array);
    await expect(run((db) => createAiProvider(db, viewer.ctx, { key: "nope", name: "Nope", baseUrl: base, models: ["x"] }))).rejects.toThrow();
  });

  it("monitor mode sends a request the policy would block, and records it as a block decision that was not enforced", async () => {
    await run((db) => setAiGatewayMode(db, t.ownerCtx, "monitor", "First week of rollout"));
    try {
      const before = received.length;
      const out = await send(chat(`Card ${CARD} again`));
      expect(out).toMatchObject({ decision: "block", forwarded: true, blocked: false });
      expect(received.length).toBe(before + 1);
      const ev = await run((db) => db.aiGatewayEvent.findUniqueOrThrow({ where: { id: out.eventId } }));
      expect(ev).toMatchObject({ decision: "block", mode: "monitor", forwarded: true });
      const sec = await run((db) => db.securityEvent.findFirstOrThrow({ where: { type: "ai_gateway.sensitive_prompt_monitored" }, orderBy: { createdAt: "desc" } }));
      expect(sec.title).toMatch(/not blocked/);
      const stats = await run((db) => aiGatewayStats(db, t.ownerCtx));
      expect(stats.mode).toBe("monitor");
      expect(stats.monitored).toBeGreaterThan(0);
    } finally {
      await run((db) => setAiGatewayMode(db, t.ownerCtx, "enforce", "Rollout week over"));
    }
    const before = received.length;
    expect((await send(chat(`Card ${CARD} once more`))).blocked).toBe(true);
    expect(received.length).toBe(before);
  });

  it("a policy can treat roles differently: viewers may not use one model", async () => {
    const doc = { version: 1, appliesTo: { tools: ["ai.chat"], actions: [], environments: [] }, rules: [{ id: "allow-all", effect: "allow", when: { always: true }, reason: "ok" }, { id: "viewers-no-test-model", effect: "deny", when: { all: [{ attr: "principal.role", op: "eq", value: "viewer" }, { attr: "model", op: "eq", value: "gpt-test" }] }, reason: "Viewers use the smaller model" }] };
    const pol = await run((db) => createPolicy(db, t.ownerCtx, { key: "role-model-rule", name: "Role model rule", description: "", category: "ai_usage", document: doc, changeNote: "test" }));
    await run((db) => submitForReview(db, t.ownerCtx, pol.version.id));
    await run((db) => activateVersion(db, t.ownerCtx, pol.version.id, { fourEyes: false }));
    await run((db) => assignPolicy(db, t.ownerCtx, pol.policy.id, { targetType: "org", priority: 100 }));
    const viewer = await addUserWithRole(t, "viewer", "rolev");
    const prepared = await run((db) => prepareAiRequest(db, viewer.ctx, { type: "user", id: viewer.userId, apiKeyId: null }, chat("hello")));
    expect(prepared.decision.decision).toBe("block");
    expect(prepared.decision.reasons.join(" ")).toMatch(/Viewers use the smaller model/);
    const ownerReq = await run((db) => prepareAiRequest(db, t.ownerCtx, principal(), chat("hello")));
    expect(ownerReq.decision.decision).not.toBe("block");
    await completeAiRequest(run, t.ownerCtx, ownerReq);
  });

  it("a refused model names the approved alternatives", async () => {
    const out = await send(chat("hello", "gpt-unapproved"));
    expect(JSON.stringify(out.body)).toMatch(/Approved models you can use instead: gpt-test/);
  });

  it("an organization on the Core plan cannot use the AI gateway", async () => {
    const { ownerPrisma } = await import("@aegis/db");
    await ownerPrisma().organization.update({ where: { id: t.orgId }, data: { plan: "core" } });
    try {
      await expect(run((db) => prepareAiRequest(db, t.ownerCtx, principal(), chat("hello")))).rejects.toThrow(/not part of this organization's plan/);
    } finally {
      await ownerPrisma().organization.update({ where: { id: t.orgId }, data: { plan: "enterprise_trial" } });
    }
  });

  it("a person who left the organization cannot use their key", async () => {
    const leaver = await addUserWithRole(t, "viewer", "leaver");
    await run((db) => db.membership.updateMany({ where: { userId: leaver.userId }, data: { status: "suspended" } }));
    await expect(run((db) => prepareAiRequest(db, t.ownerCtx, { type: "user", id: leaver.userId, apiKeyId: null }, chat("hi")))).rejects.toThrow(/no longer an active member/);
  });
});
