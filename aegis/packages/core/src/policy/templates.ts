import { z } from "zod";
import type { Effect } from "./evaluate.js";
import { parsePolicyDocument, type Condition, type PolicyDocument, type Rule } from "./schema.js";

/**
 * Guided refund policy template.
 *
 * A small, typed set of business settings (thresholds, currency, approvers, duplicate handling)
 * that compiles to an ordinary version 1 policy document. The generated document is plain JSON:
 * it validates against the normal schema, evaluates with the normal evaluator and stays editable
 * in the JSON editor. The settings are recorded under `meta.template` so the console can reopen
 * the guided form for a document it generated.
 */

export const REFUND_TEMPLATE_ID = "refund-v1";

export const DEFAULT_REFUND_TOOLS = ["issue-refund", "refund-payment"];

const hourSchema = z.coerce.number().int().min(0).max(23);
const currencyCode = z
  .string()
  .trim()
  .min(3)
  .max(3)
  .transform((s) => s.toUpperCase());

export const refundTemplateSchema = z
  .object({
    /** Tool keys the policy applies to. */
    tools: z.array(z.string().trim().min(1).max(80)).min(1).max(20).default(DEFAULT_REFUND_TOOLS),
    /** Currency the thresholds are expressed in. Always accepted. */
    currency: currencyCode.default("AED"),
    /** Further currencies accepted at the same numeric thresholds. The threshold currency is always included. */
    allowedCurrencies: z.array(currencyCode).max(20).default([]),
    /** Refunds strictly below this amount run autonomously. 0 means nothing runs without a human. */
    autoApproveBelow: z.coerce.number().min(0).max(1_000_000_000).default(500),
    /** Refunds from autoApproveBelow up to and including this amount need approval. Above is refused. */
    approvalUpTo: z.coerce.number().min(0).max(1_000_000_000).default(2500),
    /** Role keys allowed to decide. Empty means anyone holding approvals:decide. */
    approverRoles: z.array(z.string().trim().min(1).max(64)).max(10).default(["approver"]),
    minApprovers: z.coerce.number().int().min(1).max(3).default(1),
    approvalExpiresMinutes: z.coerce.number().int().min(5).max(7 * 24 * 60).default(240),
    separationOfDuties: z.boolean().default(true),
    /** Refuse (or escalate) when the same order or payment was already refunded or is awaiting a decision. */
    blockDuplicates: z.boolean().default(true),
    duplicateHandling: z.enum(["deny", "require_approval"]).default("deny"),
    /** Refuse refunds whose params.reason is missing or blank. */
    requireReason: z.boolean().default(true),
    businessHoursOnly: z
      .object({
        enabled: z.boolean().default(false),
        startHourUtc: hourSchema.default(4),
        endHourUtc: hourSchema.default(14),
      })
      .default({ enabled: false, startHourUtc: 4, endHourUtc: 14 }),
    /** Refuse once the agent has collected this many denials in 24 hours. 0 disables the check. */
    maxDailyDeniedAttempts: z.coerce.number().int().min(0).max(10_000).default(0),
  })
  .superRefine((s, ctx) => {
    if (s.approvalUpTo < s.autoApproveBelow) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["approvalUpTo"], message: "The approval ceiling must be at least the autonomous limit" });
    }
    if (s.businessHoursOnly.enabled && s.businessHoursOnly.startHourUtc === s.businessHoursOnly.endHourUtc) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["businessHoursOnly", "endHourUtc"], message: "Business hours must cover at least one hour" });
    }
  });

export type RefundTemplateSettings = z.infer<typeof refundTemplateSchema>;
export type RefundTemplateInput = z.input<typeof refundTemplateSchema>;

export function defaultRefundSettings(): RefundTemplateSettings {
  return refundTemplateSchema.parse({});
}

/** Currencies the generated policy accepts: the threshold currency first, then the extras, without repeats. */
export function refundCurrencies(settings: RefundTemplateSettings): string[] {
  return [...new Set([settings.currency, ...settings.allowedCurrencies])];
}

const BUSINESS_HOUR_SAMPLE_OFFSET = 1;

/** An hour inside the configured business hours (or 10:00 UTC when the check is disabled). */
export function businessHourSample(settings: RefundTemplateSettings): number {
  if (!settings.businessHoursOnly.enabled) return 10;
  return settings.businessHoursOnly.startHourUtc;
}

/** An hour outside the configured business hours. */
export function afterHoursSample(settings: RefundTemplateSettings): number {
  if (!settings.businessHoursOnly.enabled) return 22;
  // The hour just before opening is always closed, whether or not the window wraps midnight.
  return (settings.businessHoursOnly.startHourUtc - BUSINESS_HOUR_SAMPLE_OFFSET + 24) % 24;
}

function withinBusinessHours(start: number, end: number): Condition {
  // Hours are [start, end): start <= hour < end. A window that wraps midnight is the union of two ranges.
  if (start < end) return { all: [{ attr: "context.hour", op: "gte", value: start }, { attr: "context.hour", op: "lt", value: end }] };
  return { any: [{ attr: "context.hour", op: "gte", value: start }, { attr: "context.hour", op: "lt", value: end }] };
}

export function formatRefundAmount(amount: number, currency: string): string {
  const n = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(amount);
  return `${currency} ${n}`;
}

function pad(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

function describeWindow(settings: RefundTemplateSettings): string {
  return `${pad(settings.businessHoursOnly.startHourUtc)} to ${pad(settings.businessHoursOnly.endHourUtc)} UTC`;
}

function describeApprovers(settings: RefundTemplateSettings): string {
  const who = settings.approverRoles.length ? settings.approverRoles.map(roleLabel).join(" or ") : "anyone who can decide approvals";
  const count = settings.minApprovers === 1 ? `one ${who}` : `${settings.minApprovers} approvers (${who})`;
  return count;
}

function roleLabel(key: string): string {
  return key
    .split(/[_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function describeDuration(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? "" : "s"}`;
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? "" : "s"}`;
  return `${minutes} minutes`;
}

/** Plain-language bullet points for the generated policy. Mirrors the rules exactly. */
export function explainRefundPolicy(input: RefundTemplateInput | RefundTemplateSettings): string[] {
  const s = refundTemplateSchema.parse(input);
  const cur = s.currency;
  const fmt = (n: number) => formatRefundAmount(n, cur);
  const out: string[] = [];
  const currencies = refundCurrencies(s);
  out.push(`Applies to the tool${s.tools.length === 1 ? "" : "s"} ${s.tools.join(", ")}.`);
  if (s.autoApproveBelow > 0) out.push(`Refunds below ${fmt(s.autoApproveBelow)} run automatically.`);
  else out.push("No refund runs automatically: every refund needs a human decision or is refused.");
  if (s.approvalUpTo > s.autoApproveBelow) out.push(`Refunds from ${fmt(s.autoApproveBelow)} to ${fmt(s.approvalUpTo)} need ${describeApprovers(s)} within ${describeDuration(s.approvalExpiresMinutes)}.`);
  else if (s.approvalUpTo > 0) out.push(`Refunds of exactly ${fmt(s.approvalUpTo)} need ${describeApprovers(s)} within ${describeDuration(s.approvalExpiresMinutes)}.`);
  out.push(`Refunds above ${fmt(s.approvalUpTo)} are refused.`);
  out.push(currencies.length === 1 ? `Only ${cur} refunds are accepted; any other currency is refused.` : `Refunds are accepted in ${currencies.join(", ")}; any other currency is refused.`);
  if (s.blockDuplicates) out.push(s.duplicateHandling === "deny" ? "A second refund for the same order or payment is refused." : "A second refund for the same order or payment needs approval, whatever the amount.");
  if (s.requireReason) out.push("A refund without a stated reason is refused.");
  if (s.businessHoursOnly.enabled) out.push(`Outside business hours (${describeWindow(s)}) every refund needs approval.`);
  if (s.maxDailyDeniedAttempts > 0) out.push(`After ${s.maxDailyDeniedAttempts} refused attempt${s.maxDailyDeniedAttempts === 1 ? "" : "s"} in 24 hours the agent is refused further refunds.`);
  if (s.separationOfDuties) out.push("Owners of the requesting agent cannot approve their own agent's refunds.");
  out.push("Anything else, such as a missing or non-positive amount, is refused by default.");
  return out;
}

const INSTRUCTIONS_MAX = 500;

/** Compiles the settings into a version 1 policy document. Throws on invalid settings. */
export function buildRefundPolicyDocument(input: RefundTemplateInput | RefundTemplateSettings): PolicyDocument {
  const s = refundTemplateSchema.parse(input);
  const cur = s.currency;
  const fmt = (n: number) => formatRefundAmount(n, cur);
  const currencies = refundCurrencies(s);
  const approvers = s.approverRoles.length ? s.approverRoles.map(roleLabel).join(" or ") : "anyone with approvals:decide";
  const approval = (instructions: string): NonNullable<Rule["approval"]> => ({
    roles: s.approverRoles,
    minApprovers: s.minApprovers,
    expiresInMinutes: s.approvalExpiresMinutes,
    separationOfDuties: s.separationOfDuties,
    escalateToRoles: [],
    instructions: instructions.slice(0, INSTRUCTIONS_MAX),
  });

  const rules: Rule[] = [];

  rules.push({
    id: "invalid-amount",
    description: "The refund amount must be a positive number",
    effect: "deny",
    when: { any: [{ attr: "params.amount", op: "missing" }, { attr: "params.amount", op: "lte", value: 0 }] },
    reason: "Refund amount is missing or not positive",
    riskIndicators: ["invalid_request"],
  });

  rules.push({
    id: "wrong-currency",
    description: currencies.length === 1 ? `Only ${cur} refunds are accepted` : `Only ${currencies.join(", ")} refunds are accepted`,
    effect: "deny",
    when: { attr: "params.currency", op: "not_in", value: currencies },
    reason: currencies.length === 1 ? `Refunds are only permitted in ${cur}` : `Refunds are only permitted in ${currencies.join(", ")}`,
    riskIndicators: ["currency_not_permitted"],
  });

  if (s.requireReason) {
    rules.push({
      id: "missing-reason",
      description: "Every refund must state a reason",
      effect: "deny",
      when: { any: [{ attr: "params.reason", op: "missing" }, { attr: "params.reason", op: "matches", value: "^\\s*$" }] },
      reason: "A refund reason is required",
      riskIndicators: ["missing_reason"],
    });
  }

  if (s.blockDuplicates) {
    const deny = s.duplicateHandling === "deny";
    rules.push({
      id: "duplicate-refund",
      description: deny ? "A refund for the same order or payment was already processed or is awaiting a decision" : "A second refund for the same order or payment needs a human decision",
      effect: deny ? "deny" : "require_approval",
      when: { attr: "context.priorRequestsSameReference", op: "gt", value: 0 },
      ...(deny ? {} : { approval: approval("This order or payment already has an earlier refund request in the last 30 days. Confirm with the customer record that a second refund is really owed before approving.") }),
      reason: deny ? "A refund for this order or payment already exists" : "A second refund for the same order or payment needs approval",
      riskIndicators: ["duplicate_refund"],
      ...(deny ? { securityEventSeverity: "low" as const } : {}),
    });
  }

  if (s.maxDailyDeniedAttempts > 0) {
    rules.push({
      id: "too-many-denials",
      description: `Stop after ${s.maxDailyDeniedAttempts} refused attempt${s.maxDailyDeniedAttempts === 1 ? "" : "s"} in 24 hours`,
      effect: "deny",
      when: { attr: "context.deniedCount24h", op: "gte", value: s.maxDailyDeniedAttempts },
      reason: `The agent has had ${s.maxDailyDeniedAttempts} or more refund requests refused in the last 24 hours`,
      riskIndicators: ["repeated_denials"],
      securityEventSeverity: "high",
    });
  }

  rules.push({
    id: "autonomous-band",
    description: s.autoApproveBelow > 0 ? `Refunds below ${fmt(s.autoApproveBelow)} run without a human` : "No autonomous band: the limit is set to zero",
    effect: "allow",
    when: { all: [{ attr: "params.amount", op: "gt", value: 0 }, { attr: "params.amount", op: "lt", value: s.autoApproveBelow }] },
    reason: `Within the autonomous refund limit of ${fmt(s.autoApproveBelow)}`,
    riskIndicators: [],
  });

  rules.push({
    id: "approval-band",
    description: `Refunds from ${fmt(s.autoApproveBelow)} to ${fmt(s.approvalUpTo)} need ${approvers}`,
    effect: "require_approval",
    when: { attr: "params.amount", op: "between", value: [s.autoApproveBelow, s.approvalUpTo] },
    approval: approval(`Refund between ${fmt(s.autoApproveBelow)} and ${fmt(s.approvalUpTo)}. Check that the order exists, that the amount does not exceed what was paid, and that the stated reason matches the customer conversation before approving.`),
    reason: `Refunds from ${fmt(s.autoApproveBelow)} to ${fmt(s.approvalUpTo)} need approval`,
    riskIndicators: ["elevated_amount"],
  });

  if (s.businessHoursOnly.enabled) {
    rules.push({
      id: "after-hours",
      description: `Outside ${describeWindow(s)} every refund needs a human decision`,
      effect: "require_approval",
      when: { not: withinBusinessHours(s.businessHoursOnly.startHourUtc, s.businessHoursOnly.endHourUtc) },
      approval: approval(`This refund was requested outside business hours (${describeWindow(s)}). Confirm the request is genuine before approving.`),
      reason: `Refunds outside business hours (${describeWindow(s)}) need approval`,
      riskIndicators: ["after_hours"],
    });
  }

  rules.push({
    id: "above-limit",
    description: `Refunds above ${fmt(s.approvalUpTo)} are outside the agent's authority`,
    effect: "deny",
    when: { attr: "params.amount", op: "gt", value: s.approvalUpTo },
    reason: `Refunds above ${fmt(s.approvalUpTo)} are refused`,
    riskIndicators: ["authority_exceeded"],
    securityEventSeverity: "medium",
  });

  const tests = refundSampleRequests(s).map((sample) => ({ name: sample.name, input: refundSampleToEvaluationInput(sample), expect: sample.expected }));

  return parsePolicyDocument({
    version: 1,
    appliesTo: { tools: s.tools, actions: [], environments: [] },
    rules,
    tests,
    meta: { template: { id: REFUND_TEMPLATE_ID, settings: s } },
  });
}

/**
 * Recognises a document generated by this template and returns its settings, or null for any
 * other document. The settings are re-validated, so a hand-edited meta block that no longer
 * parses is treated as not recognised.
 */
export function extractRefundSettings(document: unknown): RefundTemplateSettings | null {
  if (!document || typeof document !== "object") return null;
  const meta = (document as { meta?: unknown }).meta;
  if (!meta || typeof meta !== "object") return null;
  const template = (meta as { template?: unknown }).template;
  if (!template || typeof template !== "object") return null;
  const { id, settings } = template as { id?: unknown; settings?: unknown };
  if (id !== REFUND_TEMPLATE_ID) return null;
  const parsed = refundTemplateSchema.safeParse(settings);
  return parsed.success ? parsed.data : null;
}

/** True when the document's rules still match what the recorded settings would generate. */
export function refundDocumentMatchesSettings(document: unknown): boolean {
  const settings = extractRefundSettings(document);
  if (!settings) return false;
  const generated = buildRefundPolicyDocument(settings);
  const parsed = parsePolicyDocument(document);
  return JSON.stringify(parsed.rules) === JSON.stringify(generated.rules) && JSON.stringify(parsed.appliesTo) === JSON.stringify(generated.appliesTo);
}

export type RefundSampleId = "small" | "mid" | "large" | "wrong_currency" | "duplicate" | "missing_reason" | "after_hours" | "too_many_denials" | "second_tool";

export interface RefundSampleRequest {
  id: RefundSampleId;
  name: string;
  description: string;
  /** Simulator fields: the tool and parameters the agent would send. */
  tool: string;
  params: Record<string, unknown>;
  /** Simulator context overrides. */
  hour: number;
  priorRequestsSameReference: number;
  deniedCount24h: number;
  /** What the generated policy must decide. */
  expected: Effect;
}

const SAMPLE_ORDER = "ORD-24117";
const SAMPLE_CUSTOMER = "CUST-88213";
const SAMPLE_REASON = "Customer returned the item";
const FOREIGN_CANDIDATES = ["USD", "EUR", "GBP", "SAR", "XXX"];

/** Picks a currency the settings do not accept, for the wrong-currency sample. */
export function foreignCurrencyFor(settings: RefundTemplateSettings): string {
  const accepted = new Set(refundCurrencies(settings));
  return FOREIGN_CANDIDATES.find((c) => !accepted.has(c)) ?? "XXX";
}

function roundAmount(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Representative amounts for each band, derived from the thresholds. */
export function refundSampleAmounts(settings: RefundTemplateSettings): { small: number; mid: number; large: number } {
  const lo = settings.autoApproveBelow;
  const hi = settings.approvalUpTo;
  const small = lo > 0 ? roundAmount(Math.max(0.01, lo / 2)) : 0;
  const mid = hi > lo ? roundAmount(lo + (hi - lo) / 2) : hi;
  const large = roundAmount(hi > 0 ? hi * 2 : 1000);
  return { small, mid, large };
}

/**
 * Named requests covering every band and guard. Each carries the simulator fields and the
 * outcome the generated document must produce. Samples for disabled guards are left out.
 */
export function refundSampleRequests(input: RefundTemplateInput | RefundTemplateSettings): RefundSampleRequest[] {
  const s = refundTemplateSchema.parse(input);
  const cur = s.currency;
  const tool = s.tools[0]!;
  const fmt = (n: number) => formatRefundAmount(n, cur);
  const { small, mid, large } = refundSampleAmounts(s);
  const hour = businessHourSample(s);
  const base = (amount: number, extra: Record<string, unknown> = {}) => ({ orderId: SAMPLE_ORDER, customerId: SAMPLE_CUSTOMER, amount, currency: cur, reason: SAMPLE_REASON, ...extra });
  const out: RefundSampleRequest[] = [];

  if (s.autoApproveBelow > 0) {
    out.push({ id: "small", name: `Small refund of ${fmt(small)} runs automatically`, description: "Below the autonomous limit, with a reason, in the accepted currency, inside business hours.", tool, params: base(small), hour, priorRequestsSameReference: 0, deniedCount24h: 0, expected: "allow" });
  } else {
    // With no autonomous band the smallest refund still needs approval (or is refused when the ceiling is zero).
    out.push({ id: "small", name: `Small refund of ${fmt(1)} needs approval`, description: "The autonomous limit is zero, so even a small refund needs a human decision.", tool, params: base(1), hour, priorRequestsSameReference: 0, deniedCount24h: 0, expected: s.approvalUpTo >= 1 ? "require_approval" : "deny" });
  }
  if (s.approvalUpTo > 0 && (s.approvalUpTo > s.autoApproveBelow || s.autoApproveBelow > 0)) {
    out.push({ id: "mid", name: `Mid refund of ${fmt(mid)} needs approval`, description: "Inside the approval band.", tool, params: base(mid), hour, priorRequestsSameReference: 0, deniedCount24h: 0, expected: "require_approval" });
  }
  out.push({ id: "large", name: `Large refund of ${fmt(large)} is refused`, description: "Above the approval ceiling.", tool, params: base(large), hour, priorRequestsSameReference: 0, deniedCount24h: 0, expected: "deny" });
  const foreign = foreignCurrencyFor(s);
  // An amount that passes the amount bands on its own, so the guard under test decides the outcome.
  const okAmount = small > 0 ? small : mid > 0 ? mid : 1;
  // A guard that escalates still loses to a deny from the amount bands.
  const guarded = (effect: Effect): Effect => (okAmount <= 0 || okAmount > s.approvalUpTo ? "deny" : effect);
  out.push({ id: "wrong_currency", name: `Refund in ${foreign} is refused`, description: "The currency is not on the accepted list, whatever the amount.", tool, params: base(okAmount, { currency: foreign }), hour, priorRequestsSameReference: 0, deniedCount24h: 0, expected: "deny" });
  if (s.blockDuplicates) {
    out.push({ id: "duplicate", name: s.duplicateHandling === "deny" ? "Second refund for the same order is refused" : "Second refund for the same order needs approval", description: "An earlier refund request for this order exists in the last 30 days.", tool, params: base(okAmount), hour, priorRequestsSameReference: 1, deniedCount24h: 0, expected: guarded(s.duplicateHandling) });
  }
  if (s.requireReason) {
    const { reason: _omitted, ...withoutReason } = base(okAmount);
    out.push({ id: "missing_reason", name: "Refund without a reason is refused", description: "params.reason is missing.", tool, params: withoutReason, hour, priorRequestsSameReference: 0, deniedCount24h: 0, expected: "deny" });
  }
  if (s.businessHoursOnly.enabled) {
    out.push({ id: "after_hours", name: `Refund at ${pad(afterHoursSample(s))} UTC needs approval`, description: `Outside ${describeWindow(s)}, a refund that would otherwise run automatically needs a human decision.`, tool, params: base(okAmount), hour: afterHoursSample(s), priorRequestsSameReference: 0, deniedCount24h: 0, expected: guarded("require_approval") });
  }
  if (s.maxDailyDeniedAttempts > 0) {
    out.push({ id: "too_many_denials", name: `Agent with ${s.maxDailyDeniedAttempts} refusals today is refused`, description: "context.deniedCount24h has reached the daily limit.", tool, params: base(okAmount), hour, priorRequestsSameReference: 0, deniedCount24h: s.maxDailyDeniedAttempts, expected: "deny" });
  }
  if (s.tools.length > 1 && s.autoApproveBelow > 0) {
    out.push({ id: "second_tool", name: `Small refund through ${s.tools[1]} runs automatically`, description: "The second tool is in scope and follows the same bands.", tool: s.tools[1]!, params: base(small, { paymentIntentId: "pi_3Q8sample" }), hour, priorRequestsSameReference: 0, deniedCount24h: 0, expected: "allow" });
  }
  return out;
}

/** The authorization-input fragment the evaluator (and embedded tests) see for a sample. */
export function refundSampleToEvaluationInput(sample: RefundSampleRequest): Record<string, unknown> {
  return {
    action: { tool: sample.tool, name: "execute" },
    params: sample.params,
    context: { hour: sample.hour, priorRequestsSameReference: sample.priorRequestsSameReference, duplicateReferenceKey: sample.priorRequestsSameReference > 0 ? "orderId" : null, deniedCount24h: sample.deniedCount24h },
  };
}
