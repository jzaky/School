import { withTenant, type TenantDb } from "@aegis/db";
import { encryptSecret, randomToken } from "../lib/crypto.js";
import { storeCredential } from "../integrations/service.js";
import { activateVersion, assignPolicy, createPolicy, submitForReview } from "../policy/service.js";
import { AI_PROVIDER_TYPE, completeAiRequest, prepareAiRequest, setAiUpstreamSender, type AiPrincipal } from "../secure/ai-gateway.js";
import type { SeededTenant } from "./demo-tenant.js";

/**
 * AI gateway history for the demo. Every request goes through the real gateway code (detection, policy,
 * recording); only the provider is simulated, in this process, so nothing leaves the machine. The
 * provider is named as simulated in the console. All prompts are synthetic.
 */
const PROMPTS: { who: string; text: string; model?: string }[] = [
  { who: "governance_manager", text: "Summarize the main obligations in the EU AI Act for a credit scoring model, in five bullet points." },
  { who: "engineer", text: "Explain the difference between optimistic and pessimistic locking in PostgreSQL." },
  { who: "approver", text: "Draft a polite reply to a customer whose refund is delayed by two working days." },
  { who: "approver", text: "Rewrite this note for the customer at layla.demo@example.com: your refund was approved today." },
  { who: "security_analyst", text: "What are common indicators of a prompt injection in a customer support transcript?" },
  { who: "engineer", text: "Why does this fail? export AWS_ACCESS_KEY_ID=AKIADEMOEXAMPLE00001 then aws s3 ls" },
  { who: "approver", text: "Customer says card 4111 1111 1111 1111 was charged twice, draft an apology." },
  { who: "governance_manager", text: "Create an agenda for a 30 minute AI risk committee meeting." },
  { who: "engineer", text: "Write a SQL query that counts refunds per day for the last 30 days." },
  { who: "auditor", text: "List evidence an auditor would expect for human oversight of an AI system." },
  { who: "approver", text: "Call the customer back on +971 50 123 4567 and summarise the dispute for the file." },
  { who: "engineer", text: "Compare these two models for summarisation quality.", model: "claude-unapproved" },
  { who: "security_analyst", text: "Translate this phishing awareness tip into Arabic: never share your one-time password." },
  { who: "engineer", text: "Explain what an IBAN checksum is, using AE070331234567890123456 as the example." },
  { who: "governance_manager", text: "Write a one paragraph summary of our acceptable use rules for generative AI." },
  { who: "owner", text: "What should a CISO report to the board about AI usage each quarter?" },
];

export async function seedDemoAiGateway(t: SeededTenant): Promise<{ requests: number }> {
  const owner = t.users.owner!.ctx;
  await withTenant(t.orgId, async (db) => {
    const row = await db.integration.create({
      data: {
        orgId: t.orgId,
        key: "azure-openai-demo",
        name: "Azure OpenAI (demo, simulated)",
        type: AI_PROVIDER_TYPE,
        description: "Simulated provider for the demo; no request leaves AEGIS",
        baseUrl: "https://ai-provider.meridian-demo.example/v1",
        webhookSecretEnc: encryptSecret(randomToken(24), "integration:azure-openai-demo"),
        settings: { kind: "openai_compatible", models: ["gpt-4o-mini", "gpt-4.1"], declaredRegion: "UAE North (stated, not verified)", retentionNote: "Zero data retention under the enterprise agreement (stated)" },
      },
    });
    await storeCredential(db, owner, row.id, "api_key", "demo-placeholder-provider-key-not-real");
    await db.integration.create({
      data: { orgId: t.orgId, key: "public-chat-demo", name: "Public chatbot (demo, blocked)", type: AI_PROVIDER_TYPE, description: "Blocked pending a contract review", baseUrl: "https://chat.public-ai-demo.example/v1", status: "disabled", statusReason: "No data processing agreement", webhookSecretEnc: encryptSecret(randomToken(24), "integration:public-chat-demo"), settings: { kind: "openai_compatible", models: ["public-chat-1"], declaredRegion: "", retentionNote: "Unknown" } },
    });
  });

  // The organization's AI usage policy, the same template the console offers.
  await withTenant(t.orgId, async (db: TenantDb) => {
    const gm = t.users.governance_manager!.ctx;
    const doc = {
      version: 1,
      appliesTo: { tools: ["ai.chat"], actions: [], environments: [] },
      rules: [
        { id: "allow-approved", description: "Approved providers and models", effect: "allow", when: { attr: "provider.approved", op: "eq", value: true }, reason: "Approved model" },
        { id: "strip-sensitive", description: "Remove every detected value", effect: "restrict", when: { attr: "data.total", op: "gt", value: 0 }, reason: "Personal or confidential data is removed before the prompt leaves the bank" },
        { id: "no-bulk-paste", description: "Refuse very long prompts", effect: "deny", when: { attr: "prompt.chars", op: "gt", value: 100000 }, reason: "Prompts over 100,000 characters look like a bulk export; ask for an exception" },
      ],
      tests: [],
    };
    const p = await createPolicy(db, gm, { key: "employee-ai-use", name: "Employee AI use", description: "How staff may use generative AI through the AEGIS AI gateway", category: "ai_usage", document: doc, changeNote: "First version agreed by the AI risk committee" });
    await submitForReview(db, gm, p.version.id);
    await activateVersion(db, owner, p.version.id, { fourEyes: false });
    await assignPolicy(db, gm, p.policy.id, { targetType: "org", priority: 100 });
  });

  setAiUpstreamSender(async (req) => {
    const body = JSON.parse(req.body) as { model: string };
    return { status: 200, body: JSON.stringify({ id: `chatcmpl-demo-${randomToken(6)}`, object: "chat.completion", model: body.model, choices: [{ index: 0, message: { role: "assistant", content: "Here is a draft you can adapt." }, finish_reason: "stop" }] }) };
  });
  let n = 0;
  try {
    const DAY = 86400_000;
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < PROMPTS.length; i++) {
        const p = PROMPTS[i]!;
        const u = t.users[p.who] ?? t.users.owner!;
        const at = new Date(Date.now() - (28 - round * 9 - (i % 9)) * DAY - (i % 7) * 3600_000);
        const ctx = { ...u.ctx, now: at };
        const principal: AiPrincipal = { type: "user", id: u.id, apiKeyId: null };
        const run = <T>(fn: (db: TenantDb) => Promise<T>) => withTenant(t.orgId, fn);
        const prepared = await run((db) => prepareAiRequest(db, ctx, principal, { model: p.model ?? (i % 3 === 0 ? "gpt-4.1" : "gpt-4o-mini"), messages: [{ role: "user", content: p.text }] }));
        await completeAiRequest(run, ctx, prepared);
        n++;
      }
    }
  } finally {
    setAiUpstreamSender(null);
  }
  return { requests: n };
}
