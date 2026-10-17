import { z } from "zod";
import type { Effect } from "./evaluate.js";
import { parsePolicyDocument, type PolicyDocument, type Rule } from "./schema.js";

/**
 * Guided score-band policy template.
 *
 * The customer's own model (fraud, risk, confidence) already produces a score for each request.
 * This template routes that score into four bands the business owns: clear (runs on its own),
 * review (a person decides), hold (a person decides, the agent is told to hold the transaction,
 * and the approval can escalate) and block (refused, recorded as a security event). The agent
 * passes the score with the request; the model itself is never called by AEGIS.
 *
 * Like the refund template, the settings compile to an ordinary version 1 policy document that
 * evaluates with the normal engine and stays editable as JSON. The settings are kept under
 * `meta.template` so the console can reopen the guided form.
 */

export const SCORE_BAND_TEMPLATE_ID = "score-band-v1";

export const DEFAULT_SCORE_BAND_TOOLS = ["issue-refund"];

const roleKey = z.string().trim().min(1).max(64);

export const scoreBandTemplateSchema = z
  .object({
    /** Tool keys the policy applies to. */
    tools: z.array(z.string().trim().min(1).max(80)).min(1).max(20).default(DEFAULT_SCORE_BAND_TOOLS),
    /** Where the agent puts the score: request context (context.supplied.<attribute>) or the tool parameters. */
    scoreSource: z.enum(["context", "params"]).default("context"),
    /** Name of the score field, for example riskScore or fraudProbability. */
    scoreAttribute: z
      .string()
      .trim()
      .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, "letters, digits and underscores only")
      .max(64)
      .default("riskScore"),
    /** unit: 0 to 1 (probabilities). percent: 0 to 100. */
    scale: z.enum(["unit", "percent"]).default("unit"),
    /** Scores strictly below this run on their own. */
    reviewFrom: z.coerce.number().min(0).default(0.4),
    /** Scores from reviewFrom up to (not including) holdFrom need a person. */
    holdFrom: z.coerce.number().min(0).default(0.55),
    /** Scores from holdFrom up to (not including) blockFrom need a person and a hold. At or above blockFrom: refused. */
    blockFrom: z.coerce.number().min(0).default(0.7),
    /** What happens when the request carries no score. */
    missingScore: z.enum(["deny", "require_approval"]).default("deny"),
    /** Role keys allowed to decide the review and hold bands. Empty means anyone with approvals:decide. */
    approverRoles: z.array(roleKey).max(10).default(["approver"]),
    minApprovers: z.coerce.number().int().min(1).max(3).default(1),
    approvalExpiresMinutes: z.coerce.number().int().min(5).max(7 * 24 * 60).default(240),
    /** The hold band is time-critical; its approvals expire sooner. */
    holdExpiresMinutes: z.coerce.number().int().min(5).max(7 * 24 * 60).default(60),
    /** Roles the hold band escalates to when nobody decides in time. */
    holdEscalateToRoles: z.array(roleKey).max(10).default([]),
    separationOfDuties: z.boolean().default(true),
  })
  .superRefine((s, ctx) => {
    const max = s.scale === "unit" ? 1 : 100;
    for (const key of ["reviewFrom", "holdFrom", "blockFrom"] as const) {
      if (s[key] > max) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `Must be at most ${max} on the ${s.scale} scale` });
    }
    if (s.holdFrom < s.reviewFrom) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["holdFrom"], message: "The hold boundary must be at least the review boundary" });
    if (s.blockFrom < s.holdFrom) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["blockFrom"], message: "The block boundary must be at least the hold boundary" });
  });

export type ScoreBandSettings = z.infer<typeof scoreBandTemplateSchema>;
export type ScoreBandInput = z.input<typeof scoreBandTemplateSchema>;

export function defaultScoreBandSettings(): ScoreBandSettings {
  return scoreBandTemplateSchema.parse({});
}

export function scoreBandMax(settings: ScoreBandSettings): number {
  return settings.scale === "unit" ? 1 : 100;
}

/** Attribute path the generated rules read. */
export function scoreBandAttr(settings: ScoreBandSettings): string {
  return settings.scoreSource === "context" ? `context.supplied.${settings.scoreAttribute}` : `params.${settings.scoreAttribute}`;
}

export function formatScore(n: number, settings: ScoreBandSettings): string {
  return settings.scale === "unit" ? n.toFixed(2) : `${Math.round(n * 10) / 10}`;
}

function roleLabel(key: string): string {
  return key.replace(/[_-]+/g, " ");
}

function describeApprovers(s: ScoreBandSettings): string {
  const who = s.approverRoles.length ? s.approverRoles.map(roleLabel).join(" or ") : "anyone who may decide approvals";
  return s.minApprovers === 1 ? `one approval from ${who}` : `${s.minApprovers} approvals from ${who}`;
}

function describeDuration(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? "" : "s"}`;
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? "" : "s"}`;
  return `${minutes} minutes`;
}

export function explainScoreBandPolicy(input: ScoreBandInput | ScoreBandSettings): string[] {
  const s = scoreBandTemplateSchema.parse(input);
  const f = (n: number) => formatScore(n, s);
  const out: string[] = [];
  out.push(`Applies to the tool${s.tools.length === 1 ? "" : "s"} ${s.tools.join(", ")}.`);
  out.push(`The score is read from ${s.scoreSource === "context" ? "the request context" : "the tool parameters"} as ${s.scoreAttribute}, on a ${s.scale === "unit" ? "0 to 1" : "0 to 100"} scale.`);
  if (s.reviewFrom > 0) out.push(`Scores below ${f(s.reviewFrom)} run automatically.`);
  else out.push("Nothing runs automatically: every request needs a person or is refused.");
  if (s.holdFrom > s.reviewFrom) out.push(`Scores from ${f(s.reviewFrom)} to ${f(s.holdFrom)} need ${describeApprovers(s)} within ${describeDuration(s.approvalExpiresMinutes)}.`);
  if (s.blockFrom > s.holdFrom) out.push(`Scores from ${f(s.holdFrom)} to ${f(s.blockFrom)} are held: the agent is told to place a hold, and ${describeApprovers(s)} is needed within ${describeDuration(s.holdExpiresMinutes)}${s.holdEscalateToRoles.length ? `, escalating to ${s.holdEscalateToRoles.map(roleLabel).join(" or ")}` : ""}.`);
  out.push(`Scores of ${f(s.blockFrom)} and above are refused and recorded as a security event.`);
  out.push(s.missingScore === "deny" ? "A request without a score is refused." : "A request without a score needs a person.");
  out.push(`A score outside the ${s.scale === "unit" ? "0 to 1" : "0 to 100"} range is refused.`);
  if (s.separationOfDuties) out.push("Owners of the requesting agent cannot approve their own agent's requests.");
  return out;
}

const INSTRUCTIONS_MAX = 500;

/** Compiles the settings into a version 1 policy document. Throws on invalid settings. */
export function buildScoreBandPolicyDocument(input: ScoreBandInput | ScoreBandSettings): PolicyDocument {
  const s = scoreBandTemplateSchema.parse(input);
  const attr = scoreBandAttr(s);
  const max = scoreBandMax(s);
  const f = (n: number) => formatScore(n, s);
  const approval = (instructions: string, expires: number, escalate: string[] = []): NonNullable<Rule["approval"]> => ({
    roles: s.approverRoles,
    minApprovers: s.minApprovers,
    expiresInMinutes: expires,
    separationOfDuties: s.separationOfDuties,
    escalateToRoles: escalate,
    instructions: instructions.slice(0, INSTRUCTIONS_MAX),
  });
  const rules: Rule[] = [];

  rules.push({
    id: "score-missing",
    description: s.missingScore === "deny" ? "A request without a score is refused" : "A request without a score needs a person",
    effect: s.missingScore,
    when: { attr, op: "missing" },
    ...(s.missingScore === "require_approval" ? { approval: approval(`The request carries no ${s.scoreAttribute}. Decide from the request itself; ask the team why the score is missing.`, s.approvalExpiresMinutes) } : {}),
    reason: `No ${s.scoreAttribute} was supplied with the request`,
    riskIndicators: ["score_missing"],
  });

  rules.push({
    id: "score-out-of-range",
    description: `The score must be between 0 and ${max}`,
    effect: "deny",
    when: { any: [{ attr, op: "lt", value: 0 }, { attr, op: "gt", value: max }] },
    reason: `The ${s.scoreAttribute} is outside the 0 to ${max} range`,
    riskIndicators: ["invalid_request"],
  });

  rules.push({
    id: "clear-band",
    description: s.reviewFrom > 0 ? `Scores below ${f(s.reviewFrom)} run without a person` : "No clear band: the review boundary is zero",
    effect: "allow",
    when: { all: [{ attr, op: "gte", value: 0 }, { attr, op: "lt", value: s.reviewFrom }] },
    reason: `Score below the review boundary of ${f(s.reviewFrom)}`,
    riskIndicators: [],
  });

  rules.push({
    id: "review-band",
    description: `Scores from ${f(s.reviewFrom)} to ${f(s.holdFrom)} need a person`,
    effect: "require_approval",
    when: { all: [{ attr, op: "gte", value: s.reviewFrom }, { attr, op: "lt", value: s.holdFrom }] },
    approval: approval(`Score between ${f(s.reviewFrom)} and ${f(s.holdFrom)}: the model is unsure. Check the customer record and the request details, then approve or reject. The transaction continues while you review.`, s.approvalExpiresMinutes),
    reason: `Scores from ${f(s.reviewFrom)} to ${f(s.holdFrom)} need review`,
    riskIndicators: ["score_review"],
  });

  rules.push({
    id: "hold-band",
    description: `Scores from ${f(s.holdFrom)} to ${f(s.blockFrom)} are held for a decision`,
    effect: "require_approval",
    when: { all: [{ attr, op: "gte", value: s.holdFrom }, { attr, op: "lt", value: s.blockFrom }] },
    approval: approval(`Score between ${f(s.holdFrom)} and ${f(s.blockFrom)}: likely a problem. Place a hold on the transaction now, verify with the customer, then approve only with evidence.`, s.holdExpiresMinutes, s.holdEscalateToRoles),
    reason: `Scores from ${f(s.holdFrom)} to ${f(s.blockFrom)} are held for a human decision`,
    riskIndicators: ["score_hold", "hold"],
    securityEventSeverity: "low",
  });

  rules.push({
    id: "block-band",
    description: `Scores of ${f(s.blockFrom)} and above are refused`,
    effect: "deny",
    when: { attr, op: "gte", value: s.blockFrom },
    reason: `Score of ${f(s.blockFrom)} or above: refused`,
    riskIndicators: ["score_block"],
    securityEventSeverity: "medium",
  });

  const tests = scoreBandSampleRequests(s).map((sample) => ({ name: sample.name, input: scoreBandSampleToEvaluationInput(sample, s), expect: sample.expected }));

  return parsePolicyDocument({
    version: 1,
    appliesTo: { tools: s.tools, actions: [], environments: [] },
    rules,
    tests,
    meta: { template: { id: SCORE_BAND_TEMPLATE_ID, settings: s } },
  });
}

/** Recognises a document generated by this template and returns its settings, or null. */
export function extractScoreBandSettings(document: unknown): ScoreBandSettings | null {
  if (!document || typeof document !== "object") return null;
  const meta = (document as { meta?: unknown }).meta;
  if (!meta || typeof meta !== "object") return null;
  const template = (meta as { template?: unknown }).template;
  if (!template || typeof template !== "object") return null;
  const { id, settings } = template as { id?: unknown; settings?: unknown };
  if (id !== SCORE_BAND_TEMPLATE_ID) return null;
  const parsed = scoreBandTemplateSchema.safeParse(settings);
  return parsed.success ? parsed.data : null;
}

/** True when the document's rules are exactly what its recorded settings generate (no hand edits). */
export function scoreBandDocumentMatchesSettings(document: unknown): boolean {
  const settings = extractScoreBandSettings(document);
  if (!settings) return false;
  const generated = buildScoreBandPolicyDocument(settings);
  const parsed = parsePolicyDocument(document);
  return JSON.stringify(parsed.rules) === JSON.stringify(generated.rules) && JSON.stringify(parsed.appliesTo) === JSON.stringify(generated.appliesTo);
}

export type ScoreBandSampleId = "clear" | "review" | "hold" | "block" | "missing" | "out_of_range";

export interface ScoreBandSampleRequest {
  id: ScoreBandSampleId;
  name: string;
  description: string;
  tool: string;
  params: Record<string, unknown>;
  /** The score as the agent would send it, or null for the missing-score sample. */
  score: number | null;
  expected: Effect;
}

const SAMPLE_PARAMS = { orderId: "ORD-24117", customerId: "CUST-88213", amount: 180, currency: "AED", reason: "Customer returned the item" };

function round(n: number, settings: ScoreBandSettings): number {
  return settings.scale === "unit" ? Math.round(n * 1000) / 1000 : Math.round(n * 10) / 10;
}

/** Representative scores inside each band, derived from the boundaries. */
export function scoreBandSampleScores(settings: ScoreBandSettings): { clear: number; review: number; hold: number; block: number } {
  const max = scoreBandMax(settings);
  const mid = (lo: number, hi: number) => round(lo + (hi - lo) / 2, settings);
  return {
    clear: settings.reviewFrom > 0 ? mid(0, settings.reviewFrom) : 0,
    review: settings.holdFrom > settings.reviewFrom ? mid(settings.reviewFrom, settings.holdFrom) : settings.reviewFrom,
    hold: settings.blockFrom > settings.holdFrom ? mid(settings.holdFrom, settings.blockFrom) : settings.holdFrom,
    block: settings.blockFrom < max ? mid(settings.blockFrom, max) : max,
  };
}

/** Named requests covering every band and guard, each with the outcome the generated document must produce. */
export function scoreBandSampleRequests(input: ScoreBandInput | ScoreBandSettings): ScoreBandSampleRequest[] {
  const s = scoreBandTemplateSchema.parse(input);
  const f = (n: number) => formatScore(n, s);
  const tool = s.tools[0]!;
  const sc = scoreBandSampleScores(s);
  const out: ScoreBandSampleRequest[] = [];
  if (s.reviewFrom > 0) out.push({ id: "clear", name: `Score ${f(sc.clear)} runs automatically`, description: "Below the review boundary.", tool, params: SAMPLE_PARAMS, score: sc.clear, expected: "allow" });
  if (s.holdFrom > s.reviewFrom) out.push({ id: "review", name: `Score ${f(sc.review)} needs a person`, description: "Inside the review band.", tool, params: SAMPLE_PARAMS, score: sc.review, expected: "require_approval" });
  if (s.blockFrom > s.holdFrom) out.push({ id: "hold", name: `Score ${f(sc.hold)} is held for a decision`, description: "Inside the hold band: the agent is told to place a hold.", tool, params: SAMPLE_PARAMS, score: sc.hold, expected: "require_approval" });
  out.push({ id: "block", name: `Score ${f(sc.block)} is refused`, description: "At or above the block boundary.", tool, params: SAMPLE_PARAMS, score: sc.block, expected: "deny" });
  out.push({ id: "missing", name: s.missingScore === "deny" ? "Request without a score is refused" : "Request without a score needs a person", description: `No ${s.scoreAttribute} supplied.`, tool, params: SAMPLE_PARAMS, score: null, expected: s.missingScore });
  out.push({ id: "out_of_range", name: `Score ${f(scoreBandMax(s) * 2)} is refused`, description: "Outside the valid range.", tool, params: SAMPLE_PARAMS, score: scoreBandMax(s) * 2, expected: "deny" });
  return out;
}

/** The authorization-input fragment the evaluator (and embedded tests) see for a sample. */
export function scoreBandSampleToEvaluationInput(sample: ScoreBandSampleRequest, input?: ScoreBandInput | ScoreBandSettings): Record<string, unknown> {
  const s = scoreBandTemplateSchema.parse(input ?? {});
  const scored = sample.score === null ? {} : { [s.scoreAttribute]: sample.score };
  return s.scoreSource === "context"
    ? { action: { tool: sample.tool, name: "execute" }, params: sample.params, context: { supplied: scored } }
    : { action: { tool: sample.tool, name: "execute" }, params: { ...sample.params, ...scored }, context: { supplied: {} } };
}
