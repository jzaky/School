/**
 * Managed autonomy levels (Phase 3). Independently specified for AEGIS; the public references are listed in
 * docs/PROVENANCE.md. A level is a property of an agent that the gateway enforces after policy evaluation.
 *
 * The one rule that makes levels safe to combine with policy: a level can only make a decision stricter.
 * It never turns a refusal, a quarantine or a request for information into anything looser, and it never
 * removes an approval that policy requires. Level 4 applies policy exactly as written.
 *
 *   0  Observe only        nothing executes; AEGIS records what policy would have decided
 *   1  Approve every action every action policy allows waits for a person
 *   2  Low-risk autonomy   only low-risk tools within the agent's amount ceiling run without a person
 *   3  Bounded autonomy    high and critical risk tools, and amounts above the ceiling, wait for a person
 *   4  Policy autonomy     the active policies decide alone
 */

export const AUTONOMY_LEVELS = [0, 1, 2, 3, 4] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

export interface AutonomyLevelInfo {
  level: AutonomyLevel;
  name: string;
  /** One plain sentence on what the gateway enforces at this level. */
  enforces: string;
}

export const AUTONOMY_LEVEL_INFO: Record<AutonomyLevel, AutonomyLevelInfo> = {
  0: { level: 0, name: "Observe only", enforces: "Nothing the agent asks for is executed. AEGIS records what the active policies would have decided, so the agent can be evaluated before it acts." },
  1: { level: 1, name: "Approve every action", enforces: "Every action the policies would allow waits for a person to approve it." },
  2: { level: 2, name: "Low-risk autonomy", enforces: "Only actions on low-risk tools run without a person, and only up to the agent's amount ceiling. Everything else the policies allow waits for approval." },
  3: { level: 3, name: "Bounded autonomy", enforces: "Actions on high and critical risk tools, and amounts above the agent's ceiling, wait for approval. Other actions the policies allow run on their own." },
  4: { level: 4, name: "Policy autonomy", enforces: "The active policies decide alone. The level adds no further limit." },
};

export function isAutonomyLevel(v: unknown): v is AutonomyLevel {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 4;
}

export type PolicyOutcome = "allow" | "restrict" | "require_approval" | "deny" | "quarantine" | "request_more_information" | "error";

export interface AutonomyInput {
  level: AutonomyLevel;
  /** The decision the policies (and data protection) reached. */
  policyOutcome: PolicyOutcome;
  /** Risk level of the tool: low, medium, high or critical. Unknown values count as critical. */
  toolRisk: string;
  /** Amount of the action in the organization's currency, when it has one. */
  amount: number | null;
  /** The agent's autonomous amount ceiling, when set. */
  ceiling: number | null;
  /** True when the amount is in another currency than the organization's, so it cannot be compared with the ceiling. */
  currencyMismatch?: boolean;
}

export type AutonomyEffect = "unchanged" | "approval_required" | "observe_only";

export interface AutonomyResult {
  outcome: PolicyOutcome;
  effect: AutonomyEffect;
  /** Machine-readable reason when the level changed the outcome. */
  code: string | null;
  /** Plain sentence for people when the level changed the outcome. */
  reason: string | null;
}

const RISK_ORDER: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };
const riskRank = (risk: string) => RISK_ORDER[risk] ?? 3;

function fmtAmount(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/**
 * Applies an agent's autonomy level to the policy outcome. Pure and deterministic: the same input always
 * gives the same result, which is what lets the simulation replay history exactly.
 */
export function applyAutonomyLevel(input: AutonomyInput): AutonomyResult {
  const { level, policyOutcome, toolRisk, amount, ceiling, currencyMismatch } = input;
  const unchanged: AutonomyResult = { outcome: policyOutcome, effect: "unchanged", code: null, reason: null };
  const wouldRun = policyOutcome === "allow" || policyOutcome === "restrict";
  if (level === 4) return unchanged;
  if (level === 0) {
    if (wouldRun || policyOutcome === "require_approval") {
      return { outcome: "deny", effect: "observe_only", code: "autonomy_observe_only", reason: `Autonomy level 0 (observe only): nothing is executed. The policies would have decided: ${policyOutcome.replace(/_/g, " ")}.` };
    }
    return unchanged;
  }
  if (!wouldRun) return unchanged;
  const approval = (code: string, reason: string): AutonomyResult => ({ outcome: "require_approval", effect: "approval_required", code, reason });
  if (level === 1) return approval("autonomy_every_action", "Autonomy level 1: every action needs a person's approval.");
  if (level === 2) {
    if (riskRank(toolRisk) > 0) return approval("autonomy_tool_risk", `Autonomy level 2: only low-risk tools run without a person, and this tool is ${toolRisk} risk.`);
    if (amount !== null && currencyMismatch) return approval("autonomy_currency", "Autonomy level 2: the amount is in another currency than the organization's, so it cannot be checked against the ceiling.");
    if (amount !== null && ceiling === null) return approval("autonomy_no_ceiling", "Autonomy level 2: the agent has no amount ceiling, so actions with an amount need approval.");
    if (amount !== null && ceiling !== null && amount > ceiling) return approval("autonomy_above_ceiling", `Autonomy level 2: ${fmtAmount(amount)} is above the agent's ceiling of ${fmtAmount(ceiling)}.`);
    return unchanged;
  }
  // Level 3.
  if (riskRank(toolRisk) >= 2) return approval("autonomy_tool_risk", `Autonomy level 3: ${toolRisk} risk tools need a person's approval.`);
  if (amount !== null && ceiling !== null && currencyMismatch) return approval("autonomy_currency", "Autonomy level 3: the amount is in another currency than the organization's, so it cannot be checked against the ceiling.");
  if (amount !== null && ceiling !== null && amount > ceiling) return approval("autonomy_above_ceiling", `Autonomy level 3: ${fmtAmount(amount)} is above the agent's ceiling of ${fmtAmount(ceiling)}.`);
  return unchanged;
}

/**
 * Under a delegation the stricter of the two agents' settings applies: the lower level, and the ceiling that
 * limits more at that level (a missing ceiling is strictest at level 2 and loosest at level 3).
 */
export function stricterAutonomy(a: { level: AutonomyLevel; ceiling: number | null }, b: { level: AutonomyLevel; ceiling: number | null }): { level: AutonomyLevel; ceiling: number | null } {
  const level = (a.level < b.level ? a.level : b.level) as AutonomyLevel;
  const defined = [a.ceiling, b.ceiling].filter((c): c is number => c !== null);
  if (level === 2) return { level, ceiling: defined.length === 2 ? Math.min(...defined) : null };
  return { level, ceiling: defined.length ? Math.min(...defined) : null };
}

/** Whether a (level, ceiling) pair is stricter than, equal to, or looser than another. Ceilings only matter at levels 2 and 3. */
export function compareAutonomy(a: { level: number; ceiling: number | null }, b: { level: number; ceiling: number | null }): "stricter" | "same" | "looser" {
  if (a.level !== b.level) return a.level < b.level ? "stricter" : "looser";
  if (a.level !== 2 && a.level !== 3) return "same";
  if (a.ceiling === b.ceiling) return "same";
  // A missing ceiling is strictest at level 2 (amounts need approval) and loosest at level 3 (no amount limit).
  if (a.ceiling === null) return a.level === 2 ? "stricter" : "looser";
  if (b.ceiling === null) return a.level === 2 ? "looser" : "stricter";
  return a.ceiling < b.ceiling ? "stricter" : "looser";
}

