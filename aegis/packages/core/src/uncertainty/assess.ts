import { z } from "zod";

/**
 * Uncertainty governance (Phase 4). Independently specified for AEGIS; public foundations in docs/PROVENANCE.md
 * (JCGM 100:2008 for statistical versus non-statistical evaluation, ISO/IEC 25012 data quality dimensions,
 * Guo et al. 2017 for calibration). Pure functions: no database access, so the same input always gives the
 * same assessment and history can be replayed exactly.
 *
 * AEGIS never invents a confidence number. Every indicator says what it rests on:
 *   measured       a fact AEGIS checked (a field is present, two values differ, a timestamp is old). Evidence an
 *                  agent supplies and AEGIS cannot check (its sources, its observation times) is self_reported.
 *   heuristic      a rule of thumb that suggests risk but proves nothing (a policy decided by precedence)
 *   self_reported  a figure the agent supplied about itself, not checked against outcomes
 *   calibrated     an agent's figure mapped to the accuracy actually observed over labelled outcomes
 * and the overall level treats "unknown" as never safe.
 */

export type IndicatorBasis = "measured" | "heuristic" | "self_reported" | "calibrated";
export type IndicatorStatus = "ok" | "warning" | "fail" | "unknown";
export type UncertaintyLevel = "low" | "elevated" | "high" | "unknown";

export interface Indicator {
  key: string;
  label: string;
  basis: IndicatorBasis;
  status: IndicatorStatus;
  detail: string;
}

export interface UncertaintyAssessment {
  level: UncertaintyLevel;
  indicators: Indicator[];
  /** Paths the agent must supply before AEGIS can decide (for a request for more information). */
  missing: string[];
  /** Fields whose values disagree. */
  contradictions: string[];
  confidence: { value: number; basis: "self_reported" | "calibrated"; calibratedAccuracy: number | null; sampleSize: number | null } | null;
  /** True when the tool's uncertainty requirements were applied (otherwise only contradictions escalate). */
  requirementsApplied: boolean;
}

export const evidenceItemSchema = z.object({
  field: z.string().min(1).max(200),
  value: z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]),
  source: z.string().min(1).max(200),
  observedAt: z.string().datetime({ offset: true }).optional(),
  ref: z.string().max(500).optional(),
});
export type EvidenceItem = z.infer<typeof evidenceItemSchema>;

export const uncertaintyPolicySchema = z.object({
  enabled: z.boolean().default(false),
  /** Paths that must be present: params.<x> or context.<x>. */
  requiredContext: z.array(z.string().regex(/^(params|context)\.[A-Za-z0-9_.-]+$/)).max(50).default([]),
  /** Parameter names whose value must be backed by an evidence item for the same field. */
  requireEvidenceFor: z.array(z.string().min(1).max(200)).max(50).default([]),
  maxEvidenceAgeMinutes: z.number().int().positive().max(525_600).nullable().default(null),
  /** Evidence sources trusted for this tool; empty means any source. */
  trustedSources: z.array(z.string().min(1).max(200)).max(50).default([]),
  /** The agent's confidence must be at least this. Applies to a calibrated estimate when one exists. */
  minConfidence: z.number().min(0).max(1).nullable().default(null),
  /** What happens to an action policy would allow when uncertainty is high or unknown. */
  onHigh: z.enum(["require_approval", "request_more_information", "deny"]).default("require_approval"),
});
export type UncertaintyPolicy = z.infer<typeof uncertaintyPolicySchema>;

export function readUncertaintyPolicy(raw: unknown): UncertaintyPolicy {
  const parsed = uncertaintyPolicySchema.safeParse(raw ?? {});
  // An unreadable stored policy is applied in its strictest useful form rather than ignored.
  return parsed.success ? parsed.data : { ...uncertaintyPolicySchema.parse({}), enabled: true, onHigh: "require_approval" };
}

export interface CalibrationLookup {
  sampleSize: number;
  /** Observed accuracy for the bin the confidence falls in, or null when that bin has too few outcomes. */
  accuracyFor: (confidence: number) => number | null;
}

/** Minimum labelled outcomes before AEGIS calls an agent's confidence calibrated. */
export const MIN_CALIBRATION_SAMPLES = 50;

function readPath(root: { params: Record<string, unknown>; context: Record<string, unknown> }, path: string): unknown {
  const [head, ...rest] = path.split(".");
  let cur: unknown = head === "params" ? root.params : root.context;
  for (const k of rest) {
    if (cur === null || typeof cur !== "object" || !Object.prototype.hasOwnProperty.call(cur, k)) return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

const present = (v: unknown) => v !== undefined && v !== null && !(typeof v === "string" && v.trim() === "");
const same = (a: unknown, b: unknown) => (typeof a === "number" || typeof b === "number" ? Number(a) === Number(b) : String(a) === String(b));

export interface AssessInput {
  params: Record<string, unknown>;
  /** The caller-supplied context, as received. */
  supplied: Record<string, unknown>;
  policy: UncertaintyPolicy;
  now: Date;
  calibration?: CalibrationLookup | null;
  /** Extra indicators computed by the gateway (policy ambiguity, recent changes). */
  extra?: Indicator[];
}

export function assessUncertainty(input: AssessInput): UncertaintyAssessment {
  const { params, supplied, policy, now } = input;
  const indicators: Indicator[] = [];
  const missing: string[] = [];
  const contradictions: string[] = [];

  // Evidence as supplied. Malformed items are themselves a measured problem, not silently dropped.
  const rawEvidence = Array.isArray(supplied.evidence) ? supplied.evidence : supplied.evidence === undefined ? [] : null;
  const evidence: EvidenceItem[] = [];
  let malformed = rawEvidence === null ? 1 : 0;
  for (const item of rawEvidence ?? []) {
    const p = evidenceItemSchema.safeParse(item);
    if (p.success) evidence.push(p.data);
    else malformed++;
  }
  if (malformed > 0) indicators.push({ key: "evidence_format", label: "Evidence is well formed", basis: "measured", status: "fail", detail: `${malformed} evidence item(s) could not be read; each needs field, value and source.` });

  // 1. Contradictions: always checked, whatever the tool's requirements.
  const byField = new Map<string, EvidenceItem[]>();
  for (const e of evidence) byField.set(e.field, [...(byField.get(e.field) ?? []), e]);
  for (const [field, items] of byField) {
    const values = items.map((i) => i.value);
    if (values.some((v) => !same(v, values[0]))) {
      contradictions.push(field);
      indicators.push({ key: `contradiction:${field}`, label: `Evidence agrees on ${field}`, basis: "measured", status: "fail", detail: `Sources disagree on ${field}: ${items.map((i) => `${i.source} says ${JSON.stringify(i.value)}`).join(", ")}.` });
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(params, field) && !same(params[field], values[0])) {
      contradictions.push(field);
      indicators.push({ key: `contradiction:${field}`, label: `Request matches the evidence for ${field}`, basis: "measured", status: "fail", detail: `The request says ${field} is ${JSON.stringify(params[field])} but ${items[0]!.source} says ${JSON.stringify(values[0])}.` });
    }
  }

  // 2. What the agent says it could not determine.
  const agentMissing = Array.isArray(supplied.missing) ? supplied.missing.filter((m): m is string => typeof m === "string").slice(0, 50) : [];
  if (agentMissing.length) {
    indicators.push({ key: "agent_missing", label: "The agent has everything it needs", basis: "self_reported", status: "fail", detail: `The agent reports it could not determine: ${agentMissing.join(", ")}.` });
    missing.push(...agentMissing.map((m) => (m.startsWith("params.") || m.startsWith("context.") ? m : `context.${m}`)));
  }

  const requirementsApplied = policy.enabled;
  if (requirementsApplied) {
    // 3. Required fields.
    for (const path of policy.requiredContext) {
      const ok = present(readPath({ params, context: supplied }, path));
      if (!ok) missing.push(path);
      indicators.push({ key: `required:${path}`, label: `${path} is present`, basis: "measured", status: ok ? "ok" : "fail", detail: ok ? `${path} was supplied.` : `${path} is required for this tool and was not supplied.` });
    }
    // 4. Evidence backing.
    for (const field of policy.requireEvidenceFor) {
      const items = byField.get(field) ?? [];
      if (!items.length) {
        missing.push(`context.evidence[${field}]`);
        indicators.push({ key: `evidence:${field}`, label: `${field} is backed by evidence`, basis: "measured", status: "unknown", detail: `No evidence was supplied for ${field}, so its value cannot be checked.` });
      } else if (!contradictions.includes(field)) {
        // The evidence comes from the agent; AEGIS checked that it is present and consistent, not that it is true.
        indicators.push({ key: `evidence:${field}`, label: `${field} is backed by evidence`, basis: "self_reported", status: "ok", detail: `Backed by ${items.map((i) => i.source).join(", ")}, as reported by the agent.` });
      }
    }
    // 5. Freshness.
    if (policy.maxEvidenceAgeMinutes !== null) {
      for (const e of evidence) {
        if (!e.observedAt) {
          indicators.push({ key: `freshness:${e.field}`, label: `Evidence for ${e.field} is recent`, basis: "measured", status: "unknown", detail: `${e.source} gave no time of observation, so its age is unknown.` });
          continue;
        }
        const ageMin = (now.getTime() - new Date(e.observedAt).getTime()) / 60_000;
        const stale = ageMin > policy.maxEvidenceAgeMinutes;
        indicators.push({ key: `freshness:${e.field}`, label: `Evidence for ${e.field} is recent`, basis: ageMin < -5 || stale ? "measured" : "self_reported", status: ageMin < -5 ? "fail" : stale ? "warning" : "ok", detail: ageMin < -5 ? `${e.source} is dated in the future.` : `${e.source} observed it ${Math.round(ageMin)} minutes ago (limit ${policy.maxEvidenceAgeMinutes}).` });
      }
    }
    // 6. Trusted sources.
    if (policy.trustedSources.length) {
      for (const e of evidence) {
        const trusted = policy.trustedSources.includes(e.source);
        if (!trusted) indicators.push({ key: `source:${e.field}:${e.source}`, label: `${e.source} is a trusted source`, basis: "measured", status: "warning", detail: `${e.source} is not on this tool's list of trusted sources.` });
      }
    }
  }

  // 7. Confidence: the agent's own figure, calibrated only when enough outcomes support it.
  let confidence: UncertaintyAssessment["confidence"] = null;
  const rawConf = supplied.confidence;
  if (typeof rawConf === "number" && Number.isFinite(rawConf) && rawConf >= 0 && rawConf <= 1) {
    const cal = input.calibration && input.calibration.sampleSize >= MIN_CALIBRATION_SAMPLES ? input.calibration : null;
    const acc = cal ? cal.accuracyFor(rawConf) : null;
    confidence = { value: rawConf, basis: acc === null ? "self_reported" : "calibrated", calibratedAccuracy: acc, sampleSize: input.calibration?.sampleSize ?? null };
    const effective = acc ?? rawConf;
    if (requirementsApplied && policy.minConfidence !== null) {
      const below = effective < policy.minConfidence;
      indicators.push({
        key: "confidence",
        label: `Confidence is at least ${policy.minConfidence}`,
        basis: acc === null ? "self_reported" : "calibrated",
        // An agent reporting confidence below the minimum is at least as uncertain as one reporting none, so a low
        // figure fails whether or not it is calibrated (a missing one is unknown and escalates the same way).
        status: below ? "fail" : "ok",
        detail: acc === null ? `The agent reports ${rawConf}. Not calibrated: ${input.calibration ? `${input.calibration.sampleSize} labelled outcomes, ${MIN_CALIBRATION_SAMPLES} needed` : "no labelled outcomes"}.` : `The agent reports ${rawConf}; over ${cal!.sampleSize} labelled outcomes, requests at that confidence were right ${(acc * 100).toFixed(0)}% of the time.`,
      });
    } else {
      indicators.push({ key: "confidence", label: "Agent's confidence", basis: acc === null ? "self_reported" : "calibrated", status: "ok", detail: acc === null ? `The agent reports ${rawConf}. This is its own figure and has not been checked against outcomes.` : `The agent reports ${rawConf}; observed accuracy at that confidence is ${(acc * 100).toFixed(0)}% over ${cal!.sampleSize} labelled outcomes.` });
    }
  } else if (rawConf !== undefined) {
    indicators.push({ key: "confidence", label: "Agent's confidence is readable", basis: "measured", status: "fail", detail: "The supplied confidence is not a number between 0 and 1." });
  } else if (requirementsApplied && policy.minConfidence !== null) {
    indicators.push({ key: "confidence", label: `Confidence is at least ${policy.minConfidence}`, basis: "measured", status: "unknown", detail: "This tool requires a confidence figure and the agent supplied none." });
  }

  indicators.push(...(input.extra ?? []));
  return { level: levelOf(indicators), indicators, missing: [...new Set(missing)], contradictions: [...new Set(contradictions)], confidence, requirementsApplied };
}

/** Any failure is high; otherwise anything unknown is unknown (never safe); otherwise any warning is elevated. */
export function levelOf(indicators: Indicator[]): UncertaintyLevel {
  if (indicators.some((i) => i.status === "fail")) return "high";
  if (indicators.some((i) => i.status === "unknown")) return "unknown";
  if (indicators.some((i) => i.status === "warning")) return "elevated";
  return "low";
}

export type EscalationOutcome = "allow" | "restrict" | "require_approval" | "deny" | "quarantine" | "request_more_information" | "error";

/**
 * What uncertainty does to the decision. Monotonic like autonomy: it can only make an allowed or restricted
 * action stricter. Contradictions always escalate to a person; other high or unknown results escalate only
 * when the tool's requirements are on, using the tool's chosen response.
 */
export function escalateForUncertainty(outcome: EscalationOutcome, a: UncertaintyAssessment, policy: UncertaintyPolicy): { outcome: EscalationOutcome; reason: string | null; fields: string[] } {
  if (outcome !== "allow" && outcome !== "restrict") return { outcome, reason: null, fields: [] };
  if (a.contradictions.length) return { outcome: "require_approval", reason: `Conflicting evidence on ${a.contradictions.join(", ")}: a person must check before this runs.`, fields: [] };
  const needsAction = a.level === "high" || a.level === "unknown";
  if (!needsAction || !a.requirementsApplied) {
    if (needsAction && a.missing.length && a.indicators.some((i) => i.key === "agent_missing")) {
      return { outcome: "request_more_information", reason: "The agent reports information it could not determine.", fields: a.missing };
    }
    return { outcome, reason: null, fields: [] };
  }
  const why = a.level === "unknown" ? "Uncertainty is unknown (something needed to judge this action is missing), which is never treated as safe." : `Uncertainty is high: ${a.indicators.filter((i) => i.status === "fail").map((i) => i.label.toLowerCase()).join("; ")}.`;
  if (policy.onHigh === "request_more_information" && a.missing.length) return { outcome: "request_more_information", reason: why, fields: a.missing };
  if (policy.onHigh === "deny") return { outcome: "deny", reason: why, fields: [] };
  return { outcome: "require_approval", reason: why, fields: [] };
}
