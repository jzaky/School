import type { Comparison, Condition, PolicyDocument, Rule } from "./schema.js";

export type Effect = "allow" | "deny" | "require_approval";

export interface ComparisonTrace {
  attr: string;
  op: string;
  expected: unknown;
  actual: unknown;
  result: boolean;
}

export interface RuleTrace {
  policyKey: string;
  policyVersionId: string;
  policyVersion: number;
  ruleId: string;
  effect: Effect;
  matched: boolean;
  description: string;
  reason: string;
  comparisons: ComparisonTrace[];
}

export interface PolicyToEvaluate {
  policyKey: string;
  policyVersionId: string;
  policyVersion: number;
  document: PolicyDocument;
}

export interface EvaluationResult {
  result: Effect;
  /** Rule that decided the outcome (highest precedence). Null for default deny. */
  decidingRule: RuleTrace | null;
  matchedRules: RuleTrace[];
  trace: RuleTrace[];
  skippedPolicies: { policyKey: string; reason: string }[];
  approval: Rule["approval"] | null;
  riskIndicators: string[];
  reasons: string[];
  securityEventSeverity: "low" | "medium" | "high" | "critical" | null;
  defaultDeny: boolean;
}

/** Reads a dotted path from the input. Supports numeric segments and [n] for arrays. */
export function getAttr(input: unknown, path: string): unknown {
  const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".");
  let cur: unknown = input;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function domainOf(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  const at = s.lastIndexOf("@");
  if (at >= 0 && !s.includes("://")) return s.slice(at + 1);
  try {
    const u = new URL(s.includes("://") ? s : `https://${s}`);
    return u.hostname;
  } catch {
    return null;
  }
}

function domainMatches(host: string, allowed: string): boolean {
  const a = allowed.toLowerCase();
  if (a.startsWith("*.")) return host === a.slice(2) || host.endsWith(a.slice(1));
  return host === a || host.endsWith(`.${a}`);
}

const SAFE_REGEX_MAX = 200;

/** Evaluates one comparison. Never throws: any type mismatch evaluates to false. */
export function compare(c: Comparison, input: unknown): ComparisonTrace {
  const actual = getAttr(input, c.attr);
  const expected = c.value;
  let result = false;
  switch (c.op) {
    case "exists":
      result = actual !== undefined && actual !== null;
      break;
    case "missing":
      result = actual === undefined || actual === null;
      break;
    case "eq":
      result = actual === expected || (asNumber(actual) !== null && asNumber(expected) !== null && asNumber(actual) === asNumber(expected));
      break;
    case "neq":
      result = !(actual === expected || (asNumber(actual) !== null && asNumber(expected) !== null && asNumber(actual) === asNumber(expected)));
      break;
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const a = asNumber(actual);
      const b = asNumber(expected);
      if (a === null || b === null) break;
      result = c.op === "gt" ? a > b : c.op === "gte" ? a >= b : c.op === "lt" ? a < b : a <= b;
      break;
    }
    case "between": {
      const a = asNumber(actual);
      if (a === null || !Array.isArray(expected) || expected.length !== 2) break;
      const lo = asNumber(expected[0]);
      const hi = asNumber(expected[1]);
      if (lo === null || hi === null) break;
      result = a >= lo && a <= hi;
      break;
    }
    case "in":
      result = Array.isArray(expected) && expected.some((e) => e === actual || (asNumber(e) !== null && asNumber(e) === asNumber(actual)));
      break;
    case "not_in":
      result = Array.isArray(expected) && !expected.some((e) => e === actual || (asNumber(e) !== null && asNumber(e) === asNumber(actual)));
      break;
    case "contains":
      if (typeof actual === "string" && typeof expected === "string") result = actual.toLowerCase().includes(expected.toLowerCase());
      else if (Array.isArray(actual)) result = actual.includes(expected);
      break;
    case "not_contains":
      if (typeof actual === "string" && typeof expected === "string") result = !actual.toLowerCase().includes(expected.toLowerCase());
      else if (Array.isArray(actual)) result = !actual.includes(expected);
      else result = actual === undefined || actual === null;
      break;
    case "starts_with":
      result = typeof actual === "string" && typeof expected === "string" && actual.startsWith(expected);
      break;
    case "ends_with":
      result = typeof actual === "string" && typeof expected === "string" && actual.endsWith(expected);
      break;
    case "matches": {
      if (typeof actual !== "string" || typeof expected !== "string" || expected.length > SAFE_REGEX_MAX) break;
      try {
        result = new RegExp(expected, "i").test(actual.slice(0, 10_000));
      } catch {
        result = false;
      }
      break;
    }
    case "domain_in":
    case "domain_not_in": {
      const host = domainOf(actual);
      const list = Array.isArray(expected) ? expected.filter((x): x is string => typeof x === "string") : [];
      const inList = host !== null && list.some((d) => domainMatches(host, d));
      result = c.op === "domain_in" ? inList : host !== null && !inList;
      break;
    }
    case "subset_of":
      result = Array.isArray(actual) && Array.isArray(expected) && actual.every((a) => expected.includes(a));
      break;
    case "intersects":
      result = Array.isArray(actual) && Array.isArray(expected) && actual.some((a) => expected.includes(a));
      break;
  }
  return { attr: c.attr, op: c.op, expected, actual: redactForTrace(actual), result };
}

/** Long strings in traces are truncated so evidence never stores entire documents or payloads. */
function redactForTrace(v: unknown): unknown {
  if (typeof v === "string" && v.length > 120) return `${v.slice(0, 117)}...`;
  if (Array.isArray(v) && v.length > 20) return [...v.slice(0, 20), `(+${v.length - 20} more)`];
  if (v && typeof v === "object" && !Array.isArray(v)) return "[object]";
  return v;
}

export function evaluateCondition(cond: Condition, input: unknown, out: ComparisonTrace[]): boolean {
  if ("always" in cond) return cond.always;
  if ("all" in cond) {
    let ok = true;
    for (const c of cond.all) ok = evaluateCondition(c, input, out) && ok; // evaluate every branch for a complete trace
    return ok;
  }
  if ("any" in cond) {
    let ok = false;
    for (const c of cond.any) ok = evaluateCondition(c, input, out) || ok;
    return ok;
  }
  if ("not" in cond) return !evaluateCondition(cond.not, input, out);
  const t = compare(cond, input);
  out.push(t);
  return t.result;
}

const PRECEDENCE: Record<Effect, number> = { deny: 3, require_approval: 2, allow: 1 };

function policyApplies(doc: PolicyDocument, input: unknown): string | null {
  const tool = getAttr(input, "action.tool");
  const action = getAttr(input, "action.name");
  const envt = getAttr(input, "agent.environment");
  const s = doc.appliesTo;
  if (s.tools.length && !s.tools.includes(String(tool))) return `tool ${String(tool)} not in scope`;
  if (s.actions.length && !s.actions.includes(String(action))) return `action ${String(action)} not in scope`;
  if (s.environments.length && !s.environments.includes(envt as "production")) return `environment ${String(envt)} not in scope`;
  return null;
}

/**
 * Deterministic evaluation of every assigned policy. Pure function: same input and policies
 * always give the same result. Throws only on programmer error; comparisons never throw.
 */
export function evaluatePolicies(policies: PolicyToEvaluate[], input: unknown): EvaluationResult {
  const trace: RuleTrace[] = [];
  const skipped: { policyKey: string; reason: string }[] = [];
  for (const p of policies) {
    const skipReason = policyApplies(p.document, input);
    if (skipReason) {
      skipped.push({ policyKey: p.policyKey, reason: skipReason });
      continue;
    }
    for (const rule of p.document.rules) {
      const comparisons: ComparisonTrace[] = [];
      const matched = evaluateCondition(rule.when, input, comparisons);
      trace.push({ policyKey: p.policyKey, policyVersionId: p.policyVersionId, policyVersion: p.policyVersion, ruleId: rule.id, effect: rule.effect, matched, description: rule.description, reason: rule.reason, comparisons });
    }
  }
  const matchedRules = trace.filter((t) => t.matched);
  let deciding: RuleTrace | null = null;
  for (const m of matchedRules) {
    if (!deciding || PRECEDENCE[m.effect] > PRECEDENCE[deciding.effect]) deciding = m;
  }
  const result: Effect = deciding ? deciding.effect : "deny";
  const matchedRuleDefs = new Map<string, Rule>();
  for (const p of policies) for (const r of p.document.rules) matchedRuleDefs.set(`${p.policyVersionId}:${r.id}`, r);
  const decidingRule = deciding ? matchedRuleDefs.get(`${deciding.policyVersionId}:${deciding.ruleId}`) ?? null : null;
  const indicators = new Set<string>();
  const reasons: string[] = [];
  let severity: EvaluationResult["securityEventSeverity"] = null;
  for (const m of matchedRules) {
    const def = matchedRuleDefs.get(`${m.policyVersionId}:${m.ruleId}`);
    if (!def) continue;
    if (def.effect === result) {
      def.riskIndicators.forEach((i) => indicators.add(i));
      if (def.reason) reasons.push(def.reason);
      if (def.effect === "deny" && def.securityEventSeverity) severity = maxSeverity(severity, def.securityEventSeverity);
    }
  }
  if (!deciding) reasons.push("No policy rule allowed this action (default deny)");
  return {
    result,
    decidingRule: deciding,
    matchedRules,
    trace,
    skippedPolicies: skipped,
    approval: result === "require_approval" ? decidingRule?.approval ?? null : null,
    riskIndicators: [...indicators],
    reasons,
    securityEventSeverity: severity,
    defaultDeny: !deciding,
  };
}

const SEV_ORDER = ["low", "medium", "high", "critical"] as const;
function maxSeverity(a: EvaluationResult["securityEventSeverity"], b: (typeof SEV_ORDER)[number]) {
  if (!a) return b;
  return SEV_ORDER.indexOf(a) >= SEV_ORDER.indexOf(b) ? a : b;
}

/** Runs the document's embedded test cases. Used when a version is submitted for review. */
export function runPolicyTests(doc: PolicyDocument, policyKey = "under-test") {
  return doc.tests.map((t) => {
    const r = evaluatePolicies([{ policyKey, policyVersionId: "test", policyVersion: 0, document: doc }], t.input);
    return { name: t.name, expected: t.expect, actual: r.result, passed: r.result === t.expect, decidingRule: r.decidingRule?.ruleId ?? null };
  });
}
