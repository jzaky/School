import { evaluateCondition, evaluatePolicies, type Effect, type PolicyToEvaluate } from "./evaluate.js";
import type { Comparison, Condition, PolicyDocument, Rule } from "./schema.js";

/**
 * Static policy analysis (docs/POLICY_LANGUAGE.md, "Conflicts").
 *
 * Rules combine by precedence: the strictest matching effect decides. Two rules with different
 * effects that can match the same request are a conflict in the sense that the less strict one never
 * decides there. The analysis builds a concrete witness request from both rules' conditions and runs
 * the real evaluator on it, so every reported conflict is confirmed by an example. Conditions it
 * cannot build a witness for (regular expressions, negated string tests) are counted as not analyzed,
 * never reported as safe.
 */

type Leaf = { attr: string; op: Comparison["op"]; value: unknown; negated?: boolean };
type Term = Leaf[];

const MAX_TERMS = 32;
const OPAQUE = new Set(["matches", "subset_of"]);

function negate(l: Leaf): Leaf[] | null {
  const flip: Partial<Record<Comparison["op"], Comparison["op"]>> = { eq: "neq", neq: "eq", gt: "lte", gte: "lt", lt: "gte", lte: "gt", in: "not_in", not_in: "in", exists: "missing", missing: "exists", contains: "not_contains", not_contains: "contains", domain_in: "domain_not_in", domain_not_in: "domain_in" };
  const op = flip[l.op];
  if (op) return [{ attr: l.attr, op, value: l.value }];
  return null;
}

/** Disjunctive normal form, bounded. Null when the expansion is too large or contains an opaque negation. */
export function toDnf(c: Condition, negated = false): Term[] | null {
  if ("always" in c) return (c.always !== negated) ? [[]] : [];
  if ("not" in c) return toDnf(c.not, !negated);
  if ("all" in c || "any" in c) {
    const parts = ("all" in c ? c.all : c.any).map((x) => toDnf(x, negated));
    if (parts.some((p) => p === null)) return null;
    const conj = ("all" in c) !== negated;
    if (!conj) return (parts as Term[][]).flat().slice(0, MAX_TERMS + 1).length > MAX_TERMS ? null : (parts as Term[][]).flat();
    let acc: Term[] = [[]];
    for (const p of parts as Term[][]) {
      const next: Term[] = [];
      for (const a of acc) for (const b of p) next.push([...a, ...b]);
      if (next.length > MAX_TERMS) return null;
      acc = next;
    }
    return acc;
  }
  const leaf: Leaf = { attr: c.attr, op: c.op, value: c.value };
  if (!negated) return [[leaf]];
  if (c.op === "between" && Array.isArray(c.value) && c.value.length === 2) return [[{ attr: c.attr, op: "lt", value: c.value[0] }], [{ attr: c.attr, op: "gt", value: c.value[1] }]];
  const n = negate(leaf);
  return n ? [n] : [[{ ...leaf, negated: true }]];
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** Picks a value for one attribute satisfying its leaves, or undefined to leave it absent. "fail" when contradictory. */
function valueFor(leaves: Leaf[]): unknown | "fail" {
  if (leaves.some((l) => l.negated || OPAQUE.has(l.op))) {
    // Built optimistically; verification decides.
  }
  if (leaves.some((l) => l.op === "missing")) return leaves.every((l) => l.op === "missing" || l.op === "neq" || l.op === "not_in" || l.op === "not_contains" || l.op === "lt" || l.op === "lte" || l.op === "gt" || l.op === "gte") ? undefined : "fail";
  const eq = leaves.find((l) => l.op === "eq");
  const excluded = leaves.filter((l) => l.op === "neq").map((l) => l.value).concat(leaves.filter((l) => l.op === "not_in").flatMap((l) => (Array.isArray(l.value) ? l.value : [])));
  let lo = -Infinity;
  let hi = Infinity;
  let loStrict = false;
  let hiStrict = false;
  for (const l of leaves) {
    const v = l.op === "between" && Array.isArray(l.value) ? null : num(l.value);
    if (l.op === "gt" && v !== null && (v > lo || (v === lo && !loStrict))) [lo, loStrict] = [v, true];
    if (l.op === "gte" && v !== null && v > lo) [lo, loStrict] = [v, false];
    if (l.op === "lt" && v !== null && (v < hi || (v === hi && !hiStrict))) [hi, hiStrict] = [v, true];
    if (l.op === "lte" && v !== null && v < hi) [hi, hiStrict] = [v, false];
    if (l.op === "between" && Array.isArray(l.value)) {
      const a = num(l.value[0]);
      const b = num(l.value[1]);
      if (a !== null && a > lo) [lo, loStrict] = [a, false];
      if (b !== null && b < hi) [hi, hiStrict] = [b, false];
    }
  }
  const numeric = lo !== -Infinity || hi !== Infinity;
  const inSets = leaves.filter((l) => l.op === "in").map((l) => (Array.isArray(l.value) ? l.value : []));
  const okNum = (x: unknown) => {
    const n = num(x);
    if (!numeric) return true;
    if (n === null) return false;
    return (loStrict ? n > lo : n >= lo) && (hiStrict ? n < hi : n <= hi);
  };
  const notExcluded = (x: unknown) => !excluded.some((e) => e === x || (num(e) !== null && num(e) === num(x)));
  const inAll = (x: unknown) => inSets.every((s) => s.some((e) => e === x || (num(e) !== null && num(e) === num(x))));
  if (eq) return okNum(eq.value) && notExcluded(eq.value) && inAll(eq.value) ? eq.value : "fail";
  if (inSets.length) {
    const pick = inSets[0]!.find((x) => okNum(x) && notExcluded(x) && inAll(x));
    return pick === undefined ? "fail" : pick;
  }
  if (numeric) {
    if (lo > hi || (lo === hi && (loStrict || hiStrict))) return "fail";
    let candidate = lo === -Infinity ? (hiStrict ? hi - 1 : hi) : hi === Infinity ? (loStrict ? lo + 1 : lo) : (lo + hi) / 2;
    for (let i = 0; i < 5 && !notExcluded(candidate); i++) candidate += 0.25;
    return okNum(candidate) && notExcluded(candidate) ? candidate : "fail";
  }
  const arrays = leaves.filter((l) => l.op === "intersects" && Array.isArray(l.value));
  if (arrays.length) return [(arrays[0]!.value as unknown[])[0]];
  const containsArr = leaves.filter((l) => l.op === "contains" && typeof l.value !== "string");
  if (containsArr.length) return containsArr.map((l) => l.value);
  const domain = leaves.find((l) => l.op === "domain_in" && Array.isArray(l.value) && l.value.length);
  if (domain) {
    const d = String((domain.value as unknown[])[0]);
    return `https://witness.${d.startsWith("*.") ? d.slice(2) : d}/`;
  }
  const starts = leaves.find((l) => l.op === "starts_with")?.value;
  const ends = leaves.find((l) => l.op === "ends_with")?.value;
  const contains = leaves.filter((l) => l.op === "contains" && typeof l.value === "string").map((l) => String(l.value));
  if (starts !== undefined || ends !== undefined || contains.length) return `${starts ?? ""}${contains.join(" ")}${ends ?? ""}`;
  if (leaves.some((l) => l.op === "domain_not_in")) return "https://witness.example/";
  if (leaves.some((l) => l.op === "exists" || l.op === "neq" || l.op === "not_in" || l.op === "not_contains")) return "witness";
  return undefined;
}

function setPath(target: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".");
  let cur = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i]!;
    if (typeof cur[k] !== "object" || cur[k] === null) cur[k] = {};
    cur = cur[k] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
}

/** A concrete input satisfying every leaf in the term, or null when the leaves contradict each other. */
export function witnessFor(term: Term, base: Record<string, unknown> = {}): Record<string, unknown> | null {
  const byAttr = new Map<string, Leaf[]>();
  for (const l of term) byAttr.set(l.attr, [...(byAttr.get(l.attr) ?? []), l]);
  const input: Record<string, unknown> = structuredClone(base);
  for (const [attr, leaves] of byAttr) {
    const v = valueFor(leaves);
    if (v === "fail") return null;
    if (v !== undefined) setPath(input, attr, v);
  }
  return input;
}

function scopeBase(a: PolicyDocument, b: PolicyDocument | null): Record<string, unknown> | null {
  const pick = (x: string[], y: string[] | undefined, fallback: string) => {
    if (!x.length && (!y || !y.length)) return fallback;
    if (!x.length) return y![0]!;
    if (!y || !y.length) return x[0]!;
    return x.find((v) => y.includes(v)) ?? null;
  };
  const tool = pick(a.appliesTo.tools, b?.appliesTo.tools, "any-tool");
  const action = pick(a.appliesTo.actions, b?.appliesTo.actions, "execute");
  const env = pick(a.appliesTo.environments, b?.appliesTo.environments, "production");
  if (tool === null || action === null || env === null) return null;
  return { action: { tool, name: action }, agent: { environment: env } };
}

function hasOpaque(terms: Term[] | null): boolean {
  return terms === null || terms.some((t) => t.some((l) => l.negated || OPAQUE.has(l.op)));
}

export interface RuleRef {
  policyKey: string;
  ruleId: string;
  effect: Effect;
}

export interface PolicyConflict {
  a: RuleRef;
  b: RuleRef;
  /** The rule that decides when both match (the stricter effect). */
  winner: RuleRef;
  severity: "high" | "medium" | "low";
  explanation: string;
  /** A request both rules match, confirmed with the evaluator. */
  witness: Record<string, unknown>;
}

export interface AnalysisResult {
  conflicts: PolicyConflict[];
  /** Rules whose conditions contradict themselves: they can never match. */
  deadRules: (RuleRef & { reason: string })[];
  pairsChecked: number;
  /** Rule pairs the analysis could not decide (regular expressions, negated string tests, very large conditions). */
  notAnalyzed: number;
}

const RANK: Record<Effect, number> = { deny: 6, quarantine: 5, require_approval: 4, request_more_information: 3, restrict: 2, allow: 1 };

function severityOf(a: Effect, b: Effect): PolicyConflict["severity"] {
  const pair = [a, b].sort().join("+");
  if (pair.includes("allow") && (pair.includes("deny") || pair.includes("quarantine"))) return "high";
  if (pair.includes("allow") || pair.includes("restrict")) return "medium";
  return "low";
}

/** Analyzes a set of policies that can apply together (for example, everything resolved for one agent). */
export function analyzePolicies(policies: PolicyToEvaluate[]): AnalysisResult {
  const rules: { p: PolicyToEvaluate; r: Rule; terms: Term[] | null }[] = [];
  for (const p of policies) for (const r of p.document.rules) rules.push({ p, r, terms: toDnf(r.when) });
  const deadRules: AnalysisResult["deadRules"] = [];
  for (const x of rules) {
    if (hasOpaque(x.terms)) continue;
    const base = scopeBase(x.p.document, null) ?? {};
    const satisfiable = x.terms!.some((t) => {
      const w = witnessFor(t, base);
      return w !== null && evaluateCondition(x.r.when, w, []);
    });
    if (!satisfiable) deadRules.push({ policyKey: x.p.policyKey, ruleId: x.r.id, effect: x.r.effect, reason: "Its conditions contradict each other, so it can never match" });
  }
  const conflicts: PolicyConflict[] = [];
  let pairsChecked = 0;
  let notAnalyzed = 0;
  for (let i = 0; i < rules.length; i++) {
    for (let j = i + 1; j < rules.length; j++) {
      const x = rules[i]!;
      const y = rules[j]!;
      if (x.r.effect === y.r.effect) continue;
      pairsChecked += 1;
      const base = scopeBase(x.p.document, y.p.document);
      if (!base) continue; // scopes never overlap (different tools, actions or environments)
      if (x.terms === null || y.terms === null) {
        notAnalyzed += 1;
        continue;
      }
      let witness: Record<string, unknown> | null = null;
      outer: for (const tx of x.terms) {
        for (const ty of y.terms) {
          const w = witnessFor([...tx, ...ty], base);
          if (w && evaluateCondition(x.r.when, w, []) && evaluateCondition(y.r.when, w, [])) {
            witness = w;
            break outer;
          }
        }
      }
      if (!witness) {
        if (hasOpaque(x.terms) || hasOpaque(y.terms)) notAnalyzed += 1;
        continue;
      }
      const run = evaluatePolicies([x.p, ...(y.p === x.p ? [] : [y.p])], witness);
      const winner = RANK[x.r.effect] >= RANK[y.r.effect] ? x : y;
      const loser = winner === x ? y : x;
      const a = { policyKey: x.p.policyKey, ruleId: x.r.id, effect: x.r.effect };
      const b = { policyKey: y.p.policyKey, ruleId: y.r.id, effect: y.r.effect };
      const w = { policyKey: winner.p.policyKey, ruleId: winner.r.id, effect: winner.r.effect };
      conflicts.push({ a, b, winner: w, severity: x.p === y.p ? "low" : severityOf(x.r.effect, y.r.effect), witness, explanation: `${x.p === y.p ? "Within one policy (usually intended precedence). " : ""}When both match, ${w.policyKey}/${w.ruleId} (${w.effect}) decides and ${loser.p.policyKey}/${loser.r.id} (${loser.r.effect}) has no effect. On the example request the evaluator decided ${run.result}.` });
    }
  }
  return { conflicts, deadRules, pairsChecked, notAnalyzed };
}
