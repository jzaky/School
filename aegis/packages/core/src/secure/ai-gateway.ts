import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { AiGatewayEvent, Integration, Prisma, TenantDb } from "@aegis/db";
import { z } from "zod";
import { env } from "../env.js";
import { appendEvidence } from "../evidence/ledger.js";
import { assertSafeDestinationUrl, pinnedLookup } from "../integrations/destinations.js";
import { readCredentialForExecution, storeCredential } from "../integrations/service.js";
import type { OrgContext } from "../lib/context.js";
import { encryptSecret, hmacHex, randomToken, sha256Hex, canonicalJson } from "../lib/crypto.js";
import { forbidden, notFound, validation } from "../lib/errors.js";
import { orgSettings } from "../lib/tx-cache.js";
import { normalizePlan, planIncludes } from "../commercial/plans.js";
import { assertPermission, slugSchema } from "../orgs/orgs.js";
import { evaluatePolicies, type EvaluationResult, type PolicyToEvaluate } from "../policy/evaluate.js";
import type { PolicyDocument } from "../policy/schema.js";
import { policyIntegrityFailures } from "../policy/service.js";
import { loadEnabledDataClasses } from "../shield/data-classes.js";
import { classifyText, maxSeverity, redactValue, rewriteText, type DataClassSpec, type TaggedSpan } from "../shield/detectors.js";
import { createSecurityEvent } from "../shield/security-events.js";

/**
 * Employee AI gateway with data loss prevention (docs/AI_GATEWAY_DLP.md).
 *
 * People and internal applications send OpenAI-style chat requests to AEGIS instead of to the provider.
 * AEGIS finds sensitive data with its own local detectors (never an external model), evaluates the
 * organization's AI usage policies with the same policy engine that governs agents, and then does one
 * of three things:
 *
 * - allow: forwards the request unchanged (values whose data class says mask or redact are still rewritten)
 * - redact: forwards a rewritten request with every detected sensitive value replaced
 * - block: refuses; nothing is sent to the provider
 *
 * Every request is recorded in ai_gateway_events without the prompt or the answer: a keyed hash, sizes,
 * the data classes found and counted, the decision, and whether the provider was actually contacted.
 * A block is only recorded as blocked because the request was not forwarded; `forwarded` is set true
 * only after the provider answered.
 *
 * What this is not: it does not see AI use that does not go through it (browser chat sites, personal
 * accounts). That is Shadow AI discovery (secure/shadow-ai.ts), which reports observations, not blocks.
 */

export const AI_PROVIDER_TYPE = "ai_provider";
export const AI_USAGE_CATEGORY = "ai_usage";
export const AI_CHAT_TOOL = "ai.chat";
const CREDENTIAL_NAME = "api_key";
const MAX_MESSAGES = 200;
const MAX_PROMPT_CHARS = 400_000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 60_000;

export type AiDecision = "allow" | "redact" | "block";

// ---------- providers ----------

export interface AiProviderSettings {
  kind: "openai_compatible";
  models: string[];
  /** What the administrator says about where the provider processes data. Recorded as a statement, not verified. */
  declaredRegion: string;
  /** Free text the administrator records about the provider's retention terms. */
  retentionNote: string;
}

export const aiProviderInputSchema = z
  .object({
    key: slugSchema,
    name: z.string().trim().min(2).max(120),
    baseUrl: z.string().trim().min(8).max(300),
    models: z.array(z.string().trim().min(1).max(120)).min(1).max(50),
    apiKey: z.string().trim().min(8).max(500).optional(),
    declaredRegion: z.string().trim().max(80).default(""),
    retentionNote: z.string().trim().max(500).default(""),
  })
  .strict();

export function providerSettings(i: Pick<Integration, "settings">): AiProviderSettings {
  const s = (i.settings ?? {}) as Partial<AiProviderSettings>;
  return { kind: "openai_compatible", models: Array.isArray(s.models) ? s.models.filter((x): x is string => typeof x === "string") : [], declaredRegion: typeof s.declaredRegion === "string" ? s.declaredRegion : "", retentionNote: typeof s.retentionNote === "string" ? s.retentionNote : "" };
}

/** Approved model providers are integrations of type ai_provider; their API keys live in the credential vault. */
export async function createAiProvider(db: TenantDb, ctx: OrgContext, raw: z.input<typeof aiProviderInputSchema>) {
  assertPermission(ctx, "integrations:write");
  const input = aiProviderInputSchema.parse(raw);
  const url = await assertSafeDestinationUrl(input.baseUrl);
  const exists = await db.integration.findUnique({ where: { orgId_key: { orgId: ctx.orgId, key: input.key } } });
  if (exists) throw validation(`An integration with the key ${input.key} already exists`);
  const settings: AiProviderSettings = { kind: "openai_compatible", models: [...new Set(input.models)], declaredRegion: input.declaredRegion, retentionNote: input.retentionNote };
  const row = await db.integration.create({
    data: { orgId: ctx.orgId, key: input.key, name: input.name, type: AI_PROVIDER_TYPE, description: "Model provider reached through the AEGIS AI gateway", baseUrl: url.toString().replace(/\/$/, ""), webhookSecretEnc: encryptSecret(randomToken(24), `integration:${input.key}`), settings: settings as unknown as Prisma.InputJsonValue },
  });
  await appendEvidence(db, ctx, { type: "ai_provider.created", subjectType: "integration", subjectId: row.id, payload: { key: row.key, models: settings.models, declaredRegion: settings.declaredRegion || null } });
  if (input.apiKey) await storeCredential(db, ctx, row.id, CREDENTIAL_NAME, input.apiKey);
  return row;
}

/** Approve or block a provider. A blocked provider refuses every request at the gateway. */
export async function setAiProviderApproval(db: TenantDb, ctx: OrgContext, id: string, approved: boolean, reason: string) {
  assertPermission(ctx, approved ? "integrations:write" : "agents:control");
  if (reason.trim().length < 3) throw validation("A reason is required");
  const p = await db.integration.findUnique({ where: { id } });
  if (!p || p.type !== AI_PROVIDER_TYPE) throw notFound("AI provider");
  const row = await db.integration.update({ where: { id }, data: { status: approved ? "active" : "disabled", statusReason: approved ? null : reason.trim() } });
  await appendEvidence(db, ctx, { type: approved ? "ai_provider.approved" : "ai_provider.blocked", subjectType: "integration", subjectId: id, payload: { key: row.key, reason: reason.trim() } });
  return row;
}

export async function listAiProviders(db: TenantDb, ctx: OrgContext) {
  assertPermission(ctx, "integrations:read");
  const rows = await db.integration.findMany({ where: { orgId: ctx.orgId, type: AI_PROVIDER_TYPE }, include: { credentials: { select: { name: true, revokedAt: true, rotationDueAt: true } } }, orderBy: { name: "asc" } });
  return rows.map((r) => {
    const cred = r.credentials.find((c) => c.name === CREDENTIAL_NAME);
    return { id: r.id, key: r.key, name: r.name, baseUrl: r.baseUrl, approved: r.status === "active", statusReason: r.statusReason, settings: providerSettings(r), credential: cred ? (cred.revokedAt ? "revoked" : "stored") : "missing", createdAt: r.createdAt };
  });
}

// ---------- request parsing and inspection ----------

const contentPart = z.object({ type: z.string().max(40) }).passthrough();
const messageSchema = z
  .object({
    role: z.enum(["system", "developer", "user", "assistant", "tool"]),
    content: z.union([z.string(), z.array(contentPart).max(100), z.null()]).optional(),
    name: z.string().max(120).optional(),
    tool_call_id: z.string().max(200).optional(),
    tool_calls: z.array(z.object({ id: z.string().max(200).optional(), type: z.string().max(40).optional(), function: z.object({ name: z.string().max(200), arguments: z.string() }).passthrough() }).passthrough()).max(50).optional(),
  })
  .passthrough();

export const chatRequestSchema = z
  .object({
    model: z.string().trim().min(1).max(120),
    messages: z.array(messageSchema).min(1).max(MAX_MESSAGES),
    stream: z.boolean().optional(),
    /** Application keys may say which person the request is for. AEGIS records it as a claim. */
    user: z.string().trim().max(200).optional(),
  })
  .passthrough();
export type ChatRequest = z.infer<typeof chatRequestSchema>;

/** One piece of text AEGIS can inspect, with where it came from so a rewrite can be put back. */
interface TextSlot {
  message: number;
  /** "content", "part:<n>" or "tool:<n>" */
  where: string;
  text: string;
}

export interface ClassCount {
  dataClass: string;
  count: number;
  action: string;
  severity: string;
}

export interface Inspection {
  slots: (TextSlot & { spans: TaggedSpan[] })[];
  classes: ClassCount[];
  /** Images, audio, files: AEGIS cannot inspect them, so they are not forwarded. */
  uninspectableParts: number;
  promptChars: number;
  maxSeverity: string | null;
}

function slotsOf(req: ChatRequest): { slots: TextSlot[]; uninspectable: number } {
  const slots: TextSlot[] = [];
  let uninspectable = 0;
  req.messages.forEach((m, i) => {
    if (typeof m.content === "string") slots.push({ message: i, where: "content", text: m.content });
    else if (Array.isArray(m.content)) {
      m.content.forEach((p, n) => {
        const text = (p as { text?: unknown }).text;
        if (p.type === "text" && typeof text === "string") slots.push({ message: i, where: `part:${n}`, text });
        else uninspectable += 1;
      });
    }
    m.tool_calls?.forEach((t, n) => slots.push({ message: i, where: `tool:${n}`, text: t.function.arguments }));
  });
  return { slots, uninspectable };
}

export function countClasses(spans: TaggedSpan[]): ClassCount[] {
  const by = new Map<string, ClassCount>();
  for (const s of spans) {
    const c = by.get(s.dataClass) ?? { dataClass: s.dataClass, count: 0, action: s.action, severity: s.severity };
    c.count += 1;
    by.set(s.dataClass, c);
  }
  return [...by.values()].sort((a, b) => a.dataClass.localeCompare(b.dataClass));
}

/** Pure: finds sensitive data in every inspectable piece of the request. Runs entirely in this process. */
export function inspectChatRequest(req: ChatRequest, classes: DataClassSpec[]): Inspection {
  const { slots, uninspectable } = slotsOf(req);
  const promptChars = slots.reduce((n, s) => n + s.text.length, 0);
  const withSpans = slots.map((s) => ({ ...s, spans: classifyText(s.text, classes) }));
  const all = withSpans.flatMap((s) => s.spans);
  return { slots: withSpans, classes: countClasses(all), uninspectableParts: uninspectable, promptChars, maxSeverity: maxSeverity(all.map((s) => s.severity)) };
}

/** Rewrites the request. With `strict`, every detected value is replaced, whatever its class action. */
export function rewriteChatRequest(req: ChatRequest, insp: Inspection, strict: boolean): ChatRequest {
  const messages = req.messages.map((m) => ({ ...m, content: Array.isArray(m.content) ? m.content.map((p) => ({ ...p })) : m.content, tool_calls: m.tool_calls?.map((t) => ({ ...t, function: { ...t.function } })) }));
  for (const s of insp.slots) {
    if (!s.spans.length) continue;
    const spans = strict ? s.spans.map((sp) => (sp.action === "mask" ? sp : { ...sp, action: "redact" as const })) : s.spans;
    const text = rewriteText(s.text, spans);
    const m = messages[s.message]!;
    if (s.where === "content") m.content = text;
    else if (s.where.startsWith("part:")) (m.content as { text?: string }[])[Number(s.where.slice(5))]!.text = text;
    else m.tool_calls![Number(s.where.slice(5))]!.function.arguments = text;
  }
  return { ...req, messages };
}

// ---------- policy ----------

/** Policies with category ai_usage assigned to the organization. Same documents and engine as agent policies. */
export async function resolveAiUsagePolicies(db: TenantDb, orgId: string): Promise<PolicyToEvaluate[]> {
  const assignments = await db.policyAssignment.findMany({ where: { orgId, targetType: "org", policy: { category: AI_USAGE_CATEGORY, archived: false } }, include: { policy: true } });
  const versionIds = [...new Set(assignments.map((a) => a.policy.currentVersionId).filter((v): v is string => !!v))];
  if (!versionIds.length) return [];
  const versions = await db.policyVersion.findMany({ where: { id: { in: versionIds }, state: "active" } });
  const byId = new Map(versions.map((v) => [v.id, v]));
  const out: PolicyToEvaluate[] = [];
  const seen = new Set<string>();
  for (const a of assignments) {
    const v = a.policy.currentVersionId ? byId.get(a.policy.currentVersionId) : undefined;
    if (!v || seen.has(a.policyId)) continue;
    seen.add(a.policyId);
    out.push({ policyKey: a.policy.key, policyVersionId: v.id, policyVersion: v.version, document: v.document as unknown as PolicyDocument, contentHash: v.contentHash });
  }
  return out.sort((x, y) => x.policyKey.localeCompare(y.policyKey));
}

export interface AiPolicyInput {
  action: { tool: string; name: string };
  /** role and teams are the person's own for a personal key; empty for an application key. */
  principal: { type: string; id: string; claimedUser: string | null; role: string | null; teams: string[] };
  provider: { key: string | null; approved: boolean };
  model: string;
  data: { classes: string[]; blockClasses: string[]; maxSeverity: string | null; total: number; uninspectableParts: number };
  prompt: { chars: number; messages: number };
}

export interface AiDecisionResult {
  decision: AiDecision;
  basis: "policy" | "data_classes_only";
  reasons: string[];
  /** Rewrite every detected value (policy restrict) rather than only mask and redact classes. */
  strictRedaction: boolean;
  policyVersionIds: string[];
  evaluation: EvaluationResult | null;
}

/**
 * Pure decision. Order of checks, each one final:
 * provider not approved, content AEGIS cannot inspect, a data class whose action is block or
 * require_approval, a tampered policy, then the AI usage policy (deny, quarantine and approval
 * outcomes block; restrict redacts). With no AI usage policy active, the data classes decide alone.
 */
export function decideAiRequest(input: AiPolicyInput, policies: PolicyToEvaluate[], integrityFailures: { policyKey: string }[] = []): AiDecisionResult {
  const ids = policies.map((p) => p.policyVersionId);
  const block = (reasons: string[], evaluation: EvaluationResult | null = null, basis: AiDecisionResult["basis"] = policies.length ? "policy" : "data_classes_only"): AiDecisionResult => ({ decision: "block", basis, reasons, strictRedaction: false, policyVersionIds: ids, evaluation });
  if (!input.provider.key) return block([`The model ${input.model} is not offered by any approved provider`]);
  if (!input.provider.approved) return block([`The provider ${input.provider.key} is blocked`]);
  if (input.data.uninspectableParts > 0) return block([`${input.data.uninspectableParts} attachment(s) AEGIS cannot inspect (images, audio or files); send text only`]);
  if (input.data.blockClasses.length) return block([`The prompt contains data that must not leave the organization: ${input.data.blockClasses.join(", ")}`]);
  if (integrityFailures.length) return block([`AI usage policy ${integrityFailures.map((f) => f.policyKey).join(", ")} failed its integrity check, so AEGIS refused rather than evaluate it`]);
  const needsRewrite = input.data.total > 0;
  if (!policies.length) return { decision: needsRewrite ? "redact" : "allow", basis: "data_classes_only", reasons: needsRewrite ? ["Values whose data class says mask or redact were rewritten"] : ["No sensitive data found; no AI usage policy is active"], strictRedaction: false, policyVersionIds: [], evaluation: null };
  const evaluation = evaluatePolicies(policies, input);
  if (evaluation.result === "allow") return { decision: needsRewrite ? "redact" : "allow", basis: "policy", reasons: evaluation.reasons.length ? evaluation.reasons : ["Allowed by AI usage policy"], strictRedaction: false, policyVersionIds: ids, evaluation };
  if (evaluation.result === "restrict") return { decision: "redact", basis: "policy", reasons: evaluation.reasons.length ? evaluation.reasons : ["The AI usage policy requires every detected value to be removed"], strictRedaction: true, policyVersionIds: ids, evaluation };
  const why = evaluation.result === "require_approval" ? "The AI usage policy requires approval, which the AI gateway does not hold requests for, so it refused" : null;
  return block([...(why ? [why] : []), ...evaluation.reasons], evaluation, "policy");
}

// ---------- upstream ----------

export interface UpstreamRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}
export type AiUpstreamSender = (req: UpstreamRequest) => Promise<{ status: number; body: string }>;

/** POST with the same DNS pinning as event destinations; redirects are not followed. */
export const defaultAiSender: AiUpstreamSender = (req) =>
  new Promise((resolve, reject) => {
    const url = new URL(req.url);
    const client = url.protocol === "https:" ? httpsRequest : httpRequest;
    const r = client(url, { method: "POST", headers: req.headers, lookup: pinnedLookup(env().AEGIS_ALLOW_PRIVATE_DESTINATIONS), timeout: UPSTREAM_TIMEOUT_MS }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (c: Buffer) => {
        size += c.length;
        if (size > MAX_RESPONSE_BYTES) r.destroy(new Error("The provider's answer was larger than AEGIS accepts"));
        else chunks.push(c);
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    r.on("timeout", () => r.destroy(new Error("The provider did not answer in time")));
    r.on("error", reject);
    r.end(req.body);
  });

let sender: AiUpstreamSender = defaultAiSender;
/** Tests point the gateway at a local fake provider. */
export function setAiUpstreamSender(s: AiUpstreamSender | null) {
  sender = s ?? defaultAiSender;
}

/** Inspects the provider's answer: mask and redact classes are rewritten; a block class withholds that answer. */
export function inspectChatResponse(body: unknown, classes: DataClassSpec[]): { body: unknown; classes: ClassCount[]; withheld: boolean } {
  const b = body as { choices?: { message?: { content?: unknown } }[] };
  if (!b || !Array.isArray(b.choices)) return { body, classes: [], withheld: false };
  const spans: TaggedSpan[] = [];
  let withheld = false;
  const choices = b.choices.map((c) => {
    const content = c?.message?.content;
    if (typeof content !== "string") return c;
    const found = classifyText(content, classes);
    spans.push(...found);
    const blockers = found.filter((s) => s.action === "block" || s.action === "require_approval");
    if (blockers.length) {
      withheld = true;
      const names = [...new Set(blockers.map((s) => s.dataClass))];
      return { ...c, message: { ...c.message, content: `AEGIS withheld this answer because it contained ${names.map(redactValue).join(", ")}.` } };
    }
    return { ...c, message: { ...c.message, content: rewriteText(content, found) } };
  });
  return { body: { ...b, choices }, classes: countClasses(spans), withheld };
}

// ---------- mode ----------

/**
 * enforce: blocks are not sent. monitor: every decision is recorded, but a request that would be blocked is
 * still sent unchanged, and the record says it was not blocked. Monitor mode is for a first week of rollout.
 */
export type AiGatewayMode = "enforce" | "monitor";

export function readAiGatewayMode(settings: unknown): AiGatewayMode {
  const s = (settings ?? {}) as { aiGateway?: { mode?: unknown } };
  return s.aiGateway?.mode === "monitor" ? "monitor" : "enforce";
}

export async function setAiGatewayMode(db: TenantDb, ctx: OrgContext, mode: AiGatewayMode, reason: string) {
  assertPermission(ctx, "security:write");
  if (mode !== "enforce" && mode !== "monitor") throw validation("Mode must be enforce or monitor");
  if (reason.trim().length < 3) throw validation("A reason is required");
  const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { settings: true } });
  const settings = (org.settings ?? {}) as Record<string, unknown>;
  const aiGateway = { ...((settings.aiGateway ?? {}) as Record<string, unknown>), mode };
  await db.organization.update({ where: { id: ctx.orgId }, data: { settings: { ...settings, aiGateway } as Prisma.InputJsonValue } });
  await appendEvidence(db, ctx, { type: "ai_gateway.mode_changed", subjectType: "organization", subjectId: ctx.orgId, payload: { mode, reason: reason.trim() } });
  return mode;
}

async function principalAttributes(db: TenantDb, orgId: string, principal: { type: string; id: string }): Promise<{ role: string | null; teams: string[]; active: boolean }> {
  if (principal.type !== "user") return { role: null, teams: [], active: true };
  const m = await db.membership.findFirst({ where: { orgId, userId: principal.id }, select: { id: true, status: true, role: { select: { key: true } } } });
  if (!m) return { role: null, teams: [], active: false };
  const teams = await db.teamMember.findMany({ where: { membershipId: m.id }, select: { team: { select: { key: true } } } });
  return { role: m.role.key, teams: teams.map((t) => t.team.key).sort(), active: m.status === "active" };
}

// ---------- the request flow ----------

export interface AiPrincipal {
  type: "user" | "integration";
  id: string;
  apiKeyId: string | null;
}

/** Keyed so a short prompt cannot be found by hashing guesses without the deployment's master key. */
export function promptHash(orgId: string, req: ChatRequest): string {
  return hmacHex(sha256Hex(`aegis-ai-prompt:${orgId}:${env().AEGIS_MASTER_KEY}`), canonicalJson(req.messages));
}

export interface PreparedAiRequest {
  event: AiGatewayEvent;
  decision: AiDecisionResult;
  forward: { url: string; apiKey: string | null; body: ChatRequest } | null;
  classes: DataClassSpec[];
}

/** Step 1, inside a tenant transaction: decide and record. Nothing has been sent anywhere yet. */
export async function prepareAiRequest(db: TenantDb, ctx: OrgContext, principal: AiPrincipal, raw: unknown): Promise<PreparedAiRequest> {
  const parsed = chatRequestSchema.safeParse(raw);
  if (!parsed.success) throw validation("Not a chat completion request", parsed.error.flatten());
  const req = parsed.data;
  if (req.stream) throw validation("Streaming is not supported by the AEGIS AI gateway yet; send stream: false");
  // Entitlement: the AI gateway is part of the Secure and Enterprise plans (and trials).
  const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { plan: true } });
  if (!planIncludes(normalizePlan(org.plan), "ai_gateway_dlp")) throw forbidden("The AI gateway is not part of this organization's plan");
  const who = await principalAttributes(db, ctx.orgId, principal);
  if (!who.active) throw forbidden("This key belongs to a person who is no longer an active member");
  const mode = readAiGatewayMode(await orgSettings(db, ctx.orgId));
  const classes = await loadEnabledDataClasses(db, ctx.orgId);
  const insp = inspectChatRequest(req, classes);
  if (insp.promptChars > MAX_PROMPT_CHARS) throw validation(`The prompt is longer than ${MAX_PROMPT_CHARS} characters`);

  const providers = await db.integration.findMany({ where: { orgId: ctx.orgId, type: AI_PROVIDER_TYPE }, orderBy: [{ status: "asc" }, { name: "asc" }] });
  const provider = providers.find((p) => p.status === "active" && providerSettings(p).models.includes(req.model)) ?? providers.find((p) => providerSettings(p).models.includes(req.model)) ?? null;
  const policies = await resolveAiUsagePolicies(db, ctx.orgId);
  const claimedUser = principal.type === "integration" && req.user ? req.user : null;
  const input: AiPolicyInput = {
    action: { tool: AI_CHAT_TOOL, name: "chat.completions" },
    principal: { type: principal.type, id: principal.id, claimedUser, role: who.role, teams: who.teams },
    provider: { key: provider?.key ?? null, approved: provider?.status === "active" },
    model: req.model,
    data: { classes: insp.classes.map((c) => c.dataClass), blockClasses: insp.classes.filter((c) => c.action === "block" || c.action === "require_approval").map((c) => c.dataClass), maxSeverity: insp.maxSeverity, total: insp.classes.reduce((n, c) => n + c.count, 0), uninspectableParts: insp.uninspectableParts },
    prompt: { chars: insp.promptChars, messages: req.messages.length },
  };
  const decision = decideAiRequest(input, policies, policyIntegrityFailures(policies));
  if (decision.decision === "block" && !provider) {
    const approvedModels = providers.filter((p) => p.status === "active").flatMap((p) => providerSettings(p).models);
    if (approvedModels.length) decision.reasons.push(`Approved models you can use instead: ${approvedModels.slice(0, 8).join(", ")}`);
  }
  let apiKey: string | null = null;
  if (decision.decision !== "block" && provider) {
    apiKey = await readCredentialForExecution(db, provider.id, CREDENTIAL_NAME);
    if (!apiKey && !env().AEGIS_ALLOW_PRIVATE_DESTINATIONS) {
      decision.decision = "block";
      decision.reasons = [`The provider ${provider.key} has no usable API key in the vault`];
    }
  }
  // Monitor mode sends a request the policy would block, unchanged, as long as there is a provider to send it to.
  const monitorPass = mode === "monitor" && decision.decision === "block" && !!provider && provider.status === "active";
  if (monitorPass && !apiKey) apiKey = await readCredentialForExecution(db, provider.id, CREDENTIAL_NAME);
  const forwarding = decision.decision !== "block" || monitorPass;
  const event = await db.aiGatewayEvent.create({
    data: {
      orgId: ctx.orgId,
      principalType: principal.type,
      principalId: principal.id,
      apiKeyId: principal.apiKeyId,
      claimedUser,
      providerId: provider?.id ?? null,
      providerKey: provider?.key ?? null,
      model: req.model,
      decision: decision.decision,
      mode,
      basis: decision.basis,
      reasons: decision.reasons as Prisma.InputJsonValue,
      policyVersionIds: decision.policyVersionIds,
      promptClasses: insp.classes as unknown as Prisma.InputJsonValue,
      promptHash: promptHash(ctx.orgId, req),
      promptChars: insp.promptChars,
      messageCount: req.messages.length,
      forwarded: false,
      status: forwarding ? "pending" : "not_forwarded",
      createdAt: ctx.now ?? new Date(),
      completedAt: forwarding ? null : ctx.now ?? new Date(),
    },
  });
  await appendEvidence(db, ctx, { type: `ai_gateway.${decision.decision}`, subjectType: "ai_gateway_event", subjectId: event.id, payload: { principalType: principal.type, providerKey: event.providerKey, model: event.model, mode, blocked: decision.decision === "block" && !monitorPass, basis: decision.basis, classes: insp.classes.map((c) => `${c.dataClass}x${c.count}`), forwarded: false, policyVersionIds: decision.policyVersionIds } });
  if (decision.decision === "block" && input.data.blockClasses.length) {
    const sev = input.data.blockClasses.some((k) => insp.classes.find((c) => c.dataClass === k)?.severity === "critical") ? "high" : "medium";
    const title = monitorPass ? `AI prompt with ${input.data.blockClasses.join(", ")} sent to ${event.providerKey} (monitor mode, not blocked)` : `AI prompt blocked before reaching ${event.providerKey ?? "a provider"}: ${input.data.blockClasses.join(", ")}`;
    await createSecurityEvent(db, ctx, { type: monitorPass ? "ai_gateway.sensitive_prompt_monitored" : "ai_gateway.sensitive_prompt_blocked", severity: sev, title, detail: { aiGatewayEventId: event.id, classes: input.data.blockClasses, principalType: principal.type, mode, blocked: !monitorPass, forwarded: monitorPass } });
  }
  const body = monitorPass ? stripAegisFields(req) : rewriteChatRequest(stripAegisFields(req), insp, decision.strictRedaction);
  const forward = forwarding && provider ? { url: `${provider.baseUrl ?? ""}/chat/completions`, apiKey, body } : null;
  return { event, decision, forward, classes };
}

function stripAegisFields(req: ChatRequest): ChatRequest {
  // The claimed user stays with AEGIS; providers get no personal identifier from it.
  const { user: _user, ...rest } = req;
  return rest as ChatRequest;
}

export interface AiGatewayOutcome {
  status: number;
  body: unknown;
  eventId: string;
  decision: AiDecision;
  forwarded: boolean;
  /** True only when the request was refused and nothing was sent. */
  blocked: boolean;
}

/** Step 2, outside any transaction: contact the provider. Step 3 records what happened. */
export async function completeAiRequest(run: <T>(fn: (db: TenantDb) => Promise<T>) => Promise<T>, ctx: OrgContext, prepared: PreparedAiRequest): Promise<AiGatewayOutcome> {
  const { event, decision } = prepared;
  if (!prepared.forward) {
    return { status: 403, eventId: event.id, decision: "block", forwarded: false, blocked: true, body: { error: { type: "aegis_policy_block", code: "blocked", message: decision.reasons.join(". "), aegis_event_id: event.id } } };
  }
  const started = Date.now();
  let upstream: { status: number; body: string } | null = null;
  let failure: string | null = null;
  try {
    upstream = await sender({ url: prepared.forward.url, headers: { "content-type": "application/json", "user-agent": "AEGIS-AI-Gateway/1", ...(prepared.forward.apiKey ? { authorization: `Bearer ${prepared.forward.apiKey}` } : {}) }, body: JSON.stringify(prepared.forward.body) });
  } catch (e) {
    failure = e instanceof Error ? e.message : "The provider could not be reached";
  }
  const latencyMs = Date.now() - started;
  let parsed: unknown = null;
  if (upstream) {
    try {
      parsed = JSON.parse(upstream.body);
    } catch {
      parsed = null;
    }
  }
  const ok = !!upstream && upstream.status >= 200 && upstream.status < 300 && parsed !== null;
  const inspected = ok ? inspectChatResponse(parsed, prepared.classes) : { body: null, classes: [] as ClassCount[], withheld: false };
  // The request reached the provider whenever it answered at all, even with an error status.
  const reached = !!upstream;
  await run(async (db) => {
    await db.aiGatewayEvent.update({ where: { id: event.id }, data: { forwarded: reached, status: ok ? "forwarded" : "upstream_error", upstreamStatus: upstream?.status ?? null, responseClasses: inspected.classes as unknown as Prisma.InputJsonValue, responseWithheld: inspected.withheld, latencyMs, completedAt: ctx.now ?? new Date() } });
    await appendEvidence(db, ctx, { type: "ai_gateway.completed", subjectType: "ai_gateway_event", subjectId: event.id, payload: { forwarded: reached, upstreamStatus: upstream?.status ?? null, responseClasses: inspected.classes.map((c) => `${c.dataClass}x${c.count}`), responseWithheld: inspected.withheld } });
  });
  if (!ok) return { status: 502, eventId: event.id, decision: decision.decision, forwarded: reached, blocked: false, body: { error: { type: "aegis_upstream_error", code: "upstream_error", message: failure ?? `The provider answered with status ${upstream?.status ?? 0}`, aegis_event_id: event.id } } };
  return { status: 200, eventId: event.id, decision: decision.decision, forwarded: true, blocked: false, body: inspected.body };
}

// ---------- console ----------

export const aiEventFilter = z.object({ decision: z.enum(["allow", "redact", "block"]).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) });

export async function listAiGatewayEvents(db: TenantDb, ctx: OrgContext, f: z.input<typeof aiEventFilter> = {}) {
  assertPermission(ctx, "security:read");
  const q = aiEventFilter.parse(f);
  return db.aiGatewayEvent.findMany({ where: { orgId: ctx.orgId, ...(q.decision ? { decision: q.decision } : {}) }, orderBy: { createdAt: "desc" }, take: q.limit });
}

export async function aiGatewayStats(db: TenantDb, ctx: OrgContext, days = 30) {
  assertPermission(ctx, "security:read");
  const since = new Date((ctx.now ?? new Date()).getTime() - days * 86400_000);
  const rows = await db.aiGatewayEvent.groupBy({ by: ["decision", "forwarded"], where: { orgId: ctx.orgId, createdAt: { gte: since } }, _count: { _all: true } });
  // blocked counts only requests that were refused and not sent; monitored counts block decisions sent anyway (monitor mode).
  const out = { allow: 0, redact: 0, blocked: 0, monitored: 0, forwarded: 0, notForwarded: 0, total: 0 };
  for (const r of rows) {
    const n = r._count._all;
    out.total += n;
    if (r.decision === "allow") out.allow += n;
    else if (r.decision === "redact") out.redact += n;
    else if (r.decision === "block") {
      if (r.forwarded) out.monitored += n;
      else out.blocked += n;
    }
    if (r.forwarded) out.forwarded += n;
    else out.notForwarded += n;
  }
  return { days, mode: readAiGatewayMode(await orgSettings(db, ctx.orgId)), ...out };
}

/** Dry run for the console: what the gateway would decide for this text. Records nothing and contacts nobody. */
export async function previewAiDecision(db: TenantDb, ctx: OrgContext, input: { model: string; text: string }) {
  assertPermission(ctx, "security:read");
  const req = chatRequestSchema.parse({ model: input.model, messages: [{ role: "user", content: input.text.slice(0, 20_000) }] });
  const classes = await loadEnabledDataClasses(db, ctx.orgId);
  const insp = inspectChatRequest(req, classes);
  const providers = await db.integration.findMany({ where: { orgId: ctx.orgId, type: AI_PROVIDER_TYPE } });
  const provider = providers.find((p) => p.status === "active" && providerSettings(p).models.includes(req.model)) ?? providers.find((p) => providerSettings(p).models.includes(req.model)) ?? null;
  const policies = await resolveAiUsagePolicies(db, ctx.orgId);
  const decision = decideAiRequest(
    {
      action: { tool: AI_CHAT_TOOL, name: "chat.completions" },
      principal: { type: "user", id: ctx.actor.id ?? "", claimedUser: null, ...(await principalAttributes(db, ctx.orgId, { type: "user", id: ctx.actor.id ?? "" })) },
      provider: { key: provider?.key ?? null, approved: provider?.status === "active" },
      model: req.model,
      data: { classes: insp.classes.map((c) => c.dataClass), blockClasses: insp.classes.filter((c) => c.action === "block" || c.action === "require_approval").map((c) => c.dataClass), maxSeverity: insp.maxSeverity, total: insp.classes.reduce((n, c) => n + c.count, 0), uninspectableParts: 0 },
      prompt: { chars: insp.promptChars, messages: 1 },
    },
    policies,
    policyIntegrityFailures(policies),
  );
  const rewritten = decision.decision === "block" ? null : (rewriteChatRequest(req, insp, decision.strictRedaction).messages[0]!.content as string);
  return { decision: decision.decision, basis: decision.basis, reasons: decision.reasons, classes: insp.classes, rewritten, provider: provider ? { key: provider.key, approved: provider.status === "active" } : null };
}

// ---------- personal keys ----------

const PERSONAL_KEY_DAYS = 90;

/** A person issues a key for their own use with the AI gateway. It acts as them and expires in 90 days. */
export async function issuePersonalAiKey(db: TenantDb, ctx: OrgContext, name: string) {
  if (ctx.actor.type !== "user" || !ctx.actor.id) throw forbidden("Only a signed-in person can issue a personal AI gateway key");
  assertPermission(ctx, "org:read");
  const label = name.trim().slice(0, 80) || "AI gateway";
  const { issueApiKey } = await import("../identity/api-keys.js");
  return issueApiKey(db, ctx, { name: label, subjectType: "user", subjectId: ctx.actor.id, scopes: ["ai:chat"], expiresAt: new Date((ctx.now ?? new Date()).getTime() + PERSONAL_KEY_DAYS * 86400_000) });
}

export async function listPersonalAiKeys(db: TenantDb, ctx: OrgContext) {
  if (ctx.actor.type !== "user" || !ctx.actor.id) return [];
  return db.apiKey.findMany({ where: { orgId: ctx.orgId, subjectType: "user", subjectId: ctx.actor.id, scopes: { has: "ai:chat" } }, select: { id: true, name: true, prefix: true, expiresAt: true, revokedAt: true, lastUsedAt: true, createdAt: true }, orderBy: { createdAt: "desc" } });
}

export async function revokePersonalAiKey(db: TenantDb, ctx: OrgContext, id: string) {
  const k = await db.apiKey.findUnique({ where: { id } });
  if (!k || k.subjectType !== "user" || !k.scopes.includes("ai:chat")) throw notFound("Key");
  if (k.subjectId !== ctx.actor.id) assertPermission(ctx, "agents:control");
  const { revokeApiKey } = await import("../identity/api-keys.js");
  return revokeApiKey(db, ctx, id, k.subjectId === ctx.actor.id ? "Revoked by its owner" : "Revoked by an administrator");
}
