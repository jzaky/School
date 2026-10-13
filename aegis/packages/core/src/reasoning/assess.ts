import { z } from "zod";
import { levelOf, type Indicator, type UncertaintyLevel } from "../uncertainty/assess.js";

/**
 * Reasoning governance (Phase 5). Independently specified for AEGIS; structure follows the W3C PROV-DM idea of
 * entities, activities and agents (docs/PROVENANCE.md). AEGIS governs observable decision artifacts only: the
 * rationale an agent chooses to submit and what AEGIS itself computed. It has no access to, and makes no claim
 * about, any model's internal reasoning. A rationale is a statement by the agent; AEGIS checks it against the
 * request, the evidence the agent cited and the policies that were actually evaluated.
 */

export const rationaleSchema = z.object({
  summary: z.string().trim().min(1).max(2000),
  /** What the agent says it is doing. Compared with the request it actually sent. */
  action: z.object({ tool: z.string().max(200).optional(), action: z.string().max(200).optional() }).optional(),
  steps: z.array(z.object({ statement: z.string().trim().min(1).max(2000), cites: z.array(z.string().min(1).max(200)).max(20).default([]) })).max(30).default([]),
  /** Facts the agent took as given. Compared with the request and its evidence. */
  assumptions: z.array(z.object({ field: z.string().min(1).max(200), value: z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]), statement: z.string().max(1000).optional() })).max(30).default([]),
  /** Policy keys the agent believes permit the action. */
  policyBasis: z.array(z.string().min(1).max(200)).max(20).default([]),
  alternatives: z.array(z.string().max(1000)).max(10).default([]),
});
export type Rationale = z.infer<typeof rationaleSchema>;

export const reasoningPolicySchema = z.object({
  enabled: z.boolean().default(false),
  requireRationale: z.boolean().default(false),
  /** Every step must cite evidence the agent supplied. */
  requireCitations: z.boolean().default(false),
  onFailure: z.enum(["require_approval", "request_more_information", "deny"]).default("require_approval"),
});
export type ReasoningPolicy = z.infer<typeof reasoningPolicySchema>;

export function readReasoningPolicy(raw: unknown): ReasoningPolicy {
  const parsed = reasoningPolicySchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : { enabled: true, requireRationale: true, requireCitations: false, onFailure: "require_approval" };
}

export interface ReasoningAssessment {
  provided: boolean;
  level: UncertaintyLevel;
  indicators: Indicator[];
  /** Integrity failures: the rationale contradicts the request, cites what does not exist, or assumes what the evidence denies. */
  integrityFailures: string[];
  rationale: Rationale | null;
  requirementsApplied: boolean;
}

const same = (a: unknown, b: unknown) => (typeof a === "number" || typeof b === "number" ? Number(a) === Number(b) : String(a) === String(b));

export interface ReasoningInput {
  tool: string;
  action: string;
  params: Record<string, unknown>;
  supplied: Record<string, unknown>;
  policy: ReasoningPolicy;
  /** Policies evaluated for this request and whether any of their rules matched (known after evaluation). */
  evaluated?: { policyKey: string; matched: boolean }[];
  extra?: Indicator[];
}

export function assessReasoning(input: ReasoningInput): ReasoningAssessment {
  const { policy } = input;
  const indicators: Indicator[] = [];
  const integrity: string[] = [];
  const raw = input.supplied.rationale;
  let rationale: Rationale | null = null;
  if (raw !== undefined) {
    const p = rationaleSchema.safeParse(raw);
    if (p.success) rationale = p.data;
    else {
      indicators.push({ key: "rationale_format", label: "The rationale is well formed", basis: "measured", status: "fail", detail: "The rationale could not be read; it needs at least a summary." });
      integrity.push("rationale_format");
    }
  }
  if (!rationale) {
    if (policy.enabled && policy.requireRationale && raw === undefined) indicators.push({ key: "rationale_present", label: "A rationale was submitted", basis: "measured", status: "unknown", detail: "This tool requires the agent to state why it is acting, and it sent no rationale." });
    indicators.push(...(input.extra ?? []));
    return { provided: false, level: levelOf(indicators), indicators, integrityFailures: integrity, rationale: null, requirementsApplied: policy.enabled };
  }

  // The action the agent says it is taking must be the one it asked for.
  if (rationale.action?.tool && rationale.action.tool !== input.tool) {
    integrity.push("stated_action");
    indicators.push({ key: "stated_action", label: "The rationale describes this action", basis: "measured", status: "fail", detail: `The rationale says the agent is using ${rationale.action.tool}, but the request is for ${input.tool}.` });
  } else if (rationale.action?.action && rationale.action.action !== input.action) {
    integrity.push("stated_action");
    indicators.push({ key: "stated_action", label: "The rationale describes this action", basis: "measured", status: "fail", detail: `The rationale says ${rationale.action.action}, but the request is ${input.action}.` });
  }

  // Citations must point at evidence the agent actually supplied (by its ref or its field).
  const evidence = Array.isArray(input.supplied.evidence) ? (input.supplied.evidence as { field?: unknown; ref?: unknown; value?: unknown }[]) : [];
  const known = new Set(evidence.flatMap((e) => [e.ref, e.field]).filter((x): x is string => typeof x === "string"));
  const cites = rationale.steps.flatMap((s) => s.cites);
  const unresolved = [...new Set(cites.filter((c) => !known.has(c)))];
  if (unresolved.length) {
    integrity.push("citations");
    indicators.push({ key: "citations", label: "Citations point at supplied evidence", basis: "measured", status: "fail", detail: `The rationale cites ${unresolved.join(", ")}, which the request's evidence does not contain.` });
  } else if (cites.length) {
    indicators.push({ key: "citations", label: "Citations point at supplied evidence", basis: "measured", status: "ok", detail: `${cites.length} citation(s), all found in the request's evidence.` });
  }
  if (policy.enabled && policy.requireCitations) {
    const uncited = rationale.steps.filter((s) => s.cites.length === 0).length;
    indicators.push({ key: "uncited_steps", label: "Every step cites evidence", basis: "measured", status: uncited ? "fail" : "ok", detail: uncited ? `${uncited} of ${rationale.steps.length} step(s) cite nothing.` : "Every step cites evidence." });
    if (rationale.steps.length === 0) indicators.push({ key: "no_steps", label: "The rationale gives its steps", basis: "measured", status: "fail", detail: "Citations are required but the rationale lists no steps." });
  }

  // Assumptions must not contradict the request or its evidence.
  for (const a of rationale.assumptions) {
    const fromParams = Object.prototype.hasOwnProperty.call(input.params, a.field) ? input.params[a.field] : undefined;
    const fromEvidence = evidence.find((e) => e.field === a.field)?.value;
    const clash = (fromParams !== undefined && !same(fromParams, a.value)) || (fromEvidence !== undefined && !same(fromEvidence, a.value));
    if (clash) {
      integrity.push(`assumption:${a.field}`);
      indicators.push({ key: `assumption:${a.field}`, label: `The assumption about ${a.field} holds`, basis: "measured", status: "fail", detail: `The rationale assumes ${a.field} is ${JSON.stringify(a.value)}, but the ${fromParams !== undefined && !same(fromParams, a.value) ? `request says ${JSON.stringify(fromParams)}` : `evidence says ${JSON.stringify(fromEvidence)}`}.` });
    }
  }

  // The policies the agent relies on must be ones that applied and decided something.
  if (rationale.policyBasis.length && input.evaluated) {
    for (const key of rationale.policyBasis) {
      const ev = input.evaluated.find((e) => e.policyKey === key);
      if (!ev) indicators.push({ key: `policy_basis:${key}`, label: `${key} applies to this action`, basis: "measured", status: "fail", detail: `The rationale relies on ${key}, which does not apply to this agent and tool.` });
      else if (!ev.matched) indicators.push({ key: `policy_basis:${key}`, label: `${key} decided this action`, basis: "measured", status: "warning", detail: `The rationale relies on ${key}; it applies, but none of its rules matched this request.` });
    }
  }

  indicators.push(...(input.extra ?? []));
  return { provided: true, level: levelOf(indicators), indicators, integrityFailures: integrity, rationale, requirementsApplied: policy.enabled };
}

export type ReasoningOutcome = "allow" | "restrict" | "require_approval" | "deny" | "quarantine" | "request_more_information" | "error";

/**
 * Monotonic like autonomy and uncertainty. Integrity failures always send the action to a person: an agent
 * whose stated reasons contradict what it does should not act alone. Requirement failures follow the tool.
 */
export function escalateForReasoning(outcome: ReasoningOutcome, a: ReasoningAssessment, policy: ReasoningPolicy): { outcome: ReasoningOutcome; reason: string | null; fields: string[] } {
  if (outcome !== "allow" && outcome !== "restrict") return { outcome, reason: null, fields: [] };
  if (a.integrityFailures.length) {
    const labels = a.indicators.filter((i) => i.status === "fail").map((i) => i.detail);
    return { outcome: "require_approval", reason: `The agent's stated reasons do not match its request: ${labels[0] ?? "see the decision record"}`, fields: [] };
  }
  if (!policy.enabled || (a.level !== "high" && a.level !== "unknown")) return { outcome, reason: null, fields: [] };
  const why = a.provided ? `The rationale does not meet this tool's requirements: ${a.indicators.filter((i) => i.status === "fail" || i.status === "unknown").map((i) => i.label.toLowerCase()).join("; ")}.` : "This tool requires a rationale and the agent sent none.";
  if (policy.onFailure === "request_more_information") return { outcome: "request_more_information", reason: why, fields: ["context.rationale"] };
  if (policy.onFailure === "deny") return { outcome: "deny", reason: why, fields: [] };
  return { outcome: "require_approval", reason: why, fields: [] };
}
