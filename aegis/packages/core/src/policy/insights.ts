import type { TenantDb } from "@aegis/db";
import type { OrgContext } from "../lib/context.js";
import { assertPermission } from "../orgs/orgs.js";
import { analyzePolicies, type PolicyConflict } from "./analysis.js";
import { parsePolicyDocument } from "./schema.js";
import { resolvePoliciesForAgent } from "./service.js";

/**
 * Policy insights (docs/POLICY_LANGUAGE.md): whether each policy actually reaches an enforcement
 * point, which policies conflict for real agents, and recommendations drawn from recorded decisions.
 */

export type EnforcementState = "enforced" | "no_active_version" | "not_assigned" | "no_active_agents" | "no_matching_tools";

export const ENFORCEMENT_TEXT: Record<EnforcementState, string> = {
  enforced: "Enforced: evaluated by the gateway for every request from the covered agents",
  no_active_version: "Not enforced: no version is active",
  not_assigned: "Not enforced: not assigned to the organization, a team or an agent",
  no_active_agents: "Not enforced: no active agent is covered by its assignments",
  no_matching_tools: "Not enforced: no covered agent holds a tool the policy applies to",
};

/** For every policy: whether the gateway actually evaluates it, and for which agents and tools. */
export async function policyEnforcement(db: TenantDb, ctx: OrgContext) {
  assertPermission(ctx, "policies:read");
  const now = ctx.now ?? new Date();
  const [policies, agents, exceptions] = await Promise.all([
    db.policy.findMany({ where: { orgId: ctx.orgId }, include: { versions: { where: { state: "active" }, take: 1 }, assignments: true } }),
    db.agent.findMany({ where: { orgId: ctx.orgId, isLab: false, status: "active" }, select: { id: true, slug: true, teamId: true, tools: { where: { enabled: true, revokedAt: null }, select: { tool: { select: { key: true } } } } } }),
    db.policyException.groupBy({ by: ["policyId"], where: { orgId: ctx.orgId, status: "approved", expiresAt: { gt: now } }, _count: { _all: true } }),
  ]);
  const exceptionCount = new Map(exceptions.map((e) => [e.policyId, e._count._all]));
  const out = new Map<string, { state: EnforcementState; text: string; agents: string[]; tools: string[]; activeExceptions: number }>();
  for (const p of policies) {
    const active = p.versions[0];
    let state: EnforcementState;
    let covered: typeof agents = [];
    const tools = new Set<string>();
    if (!active) state = "no_active_version";
    else if (p.assignments.length === 0) state = "not_assigned";
    else {
      covered = agents.filter((a) => p.assignments.some((as) => as.targetType === "org" || (as.targetType === "agent" && as.targetId === a.id) || (as.targetType === "team" && a.teamId && as.targetId === a.teamId)));
      const scope = parsePolicyDocument(active.document).appliesTo.tools;
      for (const a of covered) for (const t of a.tools) if (scope.length === 0 || scope.includes(t.tool.key)) tools.add(t.tool.key);
      state = covered.length === 0 ? "no_active_agents" : tools.size === 0 ? "no_matching_tools" : "enforced";
    }
    out.set(p.id, { state, text: ENFORCEMENT_TEXT[state], agents: covered.filter((a) => a.tools.some((t) => tools.has(t.tool.key))).map((a) => a.slug), tools: [...tools].sort(), activeExceptions: exceptionCount.get(p.id) ?? 0 });
  }
  return out;
}

export interface OrgConflict extends PolicyConflict {
  agents: string[];
}

/** Conflicts among the policies that apply together to each active agent, deduplicated across agents. */
export async function organizationConflicts(db: TenantDb, ctx: OrgContext) {
  assertPermission(ctx, "policies:read");
  const agents = await db.agent.findMany({ where: { orgId: ctx.orgId, isLab: false, status: "active" }, select: { id: true, slug: true, teamId: true } });
  const bySet = new Map<string, { agents: string[]; result: ReturnType<typeof analyzePolicies> }>();
  for (const a of agents) {
    const set = await resolvePoliciesForAgent(db, ctx.orgId, a);
    if (set.length === 0) continue;
    const key = set.map((p) => p.policyVersionId).sort().join(",");
    const hit = bySet.get(key);
    if (hit) hit.agents.push(a.slug);
    else bySet.set(key, { agents: [a.slug], result: analyzePolicies(set) });
  }
  const conflicts = new Map<string, OrgConflict>();
  const dead = new Map<string, { policyKey: string; ruleId: string; reason: string }>();
  let pairsChecked = 0;
  let notAnalyzed = 0;
  for (const { agents: names, result } of bySet.values()) {
    pairsChecked += result.pairsChecked;
    notAnalyzed += result.notAnalyzed;
    for (const c of result.conflicts) {
      const k = [`${c.a.policyKey}/${c.a.ruleId}`, `${c.b.policyKey}/${c.b.ruleId}`].sort().join("|");
      const existing = conflicts.get(k);
      if (existing) existing.agents.push(...names.filter((n) => !existing.agents.includes(n)));
      else conflicts.set(k, { ...c, agents: [...names] });
    }
    for (const d of result.deadRules) dead.set(`${d.policyKey}/${d.ruleId}`, d);
  }
  const order = { high: 0, medium: 1, low: 2 };
  return { conflicts: [...conflicts.values()].sort((x, y) => order[x.severity] - order[y.severity]), deadRules: [...dead.values()], pairsChecked, notAnalyzed, agentSets: bySet.size };
}

export interface Recommendation {
  kind: "never_matched" | "always_approved" | "default_denied" | "lab_gap" | "conflict" | "not_enforced";
  title: string;
  detail: string;
  evidence: Record<string, number | string>;
  href: string;
}

/** Recommendations from what actually happened in the last `days` days. Nothing is applied automatically. */
export async function policyRecommendations(db: TenantDb, ctx: OrgContext, days = 30): Promise<Recommendation[]> {
  assertPermission(ctx, "policies:read");
  const now = ctx.now ?? new Date();
  const since = new Date(now.getTime() - days * 86_400_000);
  const recs: Recommendation[] = [];
  const decisions = await db.authorizationDecision.findMany({ where: { orgId: ctx.orgId, createdAt: { gte: since }, request: { agent: { isLab: false } } }, select: { explanation: true, request: { select: { toolKey: true, agent: { select: { slug: true } } } } } });
  const evaluated = new Map<string, number>();
  const matched = new Map<string, number>();
  const defaultDenied = new Map<string, number>();
  for (const d of decisions) {
    const e = (d.explanation ?? {}) as { trace?: { policyKey: string; ruleId: string; matched: boolean }[]; defaultDeny?: boolean; stage?: string };
    for (const t of e.trace ?? []) {
      const k = `${t.policyKey}/${t.ruleId}`;
      evaluated.set(k, (evaluated.get(k) ?? 0) + 1);
      if (t.matched) matched.set(k, (matched.get(k) ?? 0) + 1);
    }
    if (e.stage === "policy" && e.defaultDeny) {
      const k = `${d.request.agent.slug} ${d.request.toolKey}`;
      defaultDenied.set(k, (defaultDenied.get(k) ?? 0) + 1);
    }
  }
  const policies = await db.policy.findMany({ where: { orgId: ctx.orgId }, select: { id: true, key: true } });
  const policyId = new Map(policies.map((p) => [p.key, p.id]));
  for (const [k, n] of evaluated) {
    if (n >= 20 && !matched.get(k)) {
      const [policyKey, ruleId] = k.split("/") as [string, string];
      recs.push({ kind: "never_matched", title: `Rule ${k} never matched`, detail: `Evaluated ${n} times in ${days} days without matching. It may be obsolete, or its conditions may not say what was intended. Replay the policy without it before removing it.`, evidence: { evaluations: n, ruleId }, href: policyId.get(policyKey) ? `/policies/${policyId.get(policyKey)}?tab=replay` : "/policies" });
    }
  }
  const approvals = await db.approvalRequest.groupBy({ by: ["triggeringRuleId", "status"], where: { orgId: ctx.orgId, createdAt: { gte: since }, triggeringRuleId: { not: null }, status: { in: ["approved", "rejected"] }, request: { agent: { isLab: false } } }, _count: { _all: true } });
  const perRule = new Map<string, { approved: number; rejected: number }>();
  for (const a of approvals) {
    const r = perRule.get(a.triggeringRuleId!) ?? { approved: 0, rejected: 0 };
    r[a.status as "approved" | "rejected"] += a._count._all;
    perRule.set(a.triggeringRuleId!, r);
  }
  for (const [rule, r] of perRule) {
    const total = r.approved + r.rejected;
    if (total >= 10 && r.approved / total >= 0.95) {
      const policyKey = rule.split("/")[0]!;
      recs.push({ kind: "always_approved", title: `Approvals from ${rule} are almost always granted`, detail: `${r.approved} of ${total} approved in ${days} days. If people are approving by habit, the threshold may be too low; replay a raised threshold to see exactly which requests would change before deciding.`, evidence: { approved: r.approved, decided: total }, href: policyId.get(policyKey) ? `/policies/${policyId.get(policyKey)}?tab=replay` : "/policies" });
    }
  }
  for (const [k, n] of defaultDenied) {
    if (n >= 5) recs.push({ kind: "default_denied", title: `No policy allows ${k.split(" ")[1]} for ${k.split(" ")[0]}`, detail: `${n} requests in ${days} days were refused because no rule allowed them (default deny). If the agent should use this tool, write a rule for it; if not, remove the tool grant.`, evidence: { requests: n }, href: "/policies" });
  }
  const enforcement = await policyEnforcement(db, ctx);
  for (const p of policies) {
    const e = enforcement.get(p.id);
    if (e && e.state !== "enforced" && e.state !== "no_active_version") recs.push({ kind: "not_enforced", title: `Policy ${p.key} is not enforced`, detail: e.text, evidence: { state: e.state }, href: `/policies/${p.id}` });
  }
  const conflicts = await organizationConflicts(db, ctx);
  for (const c of conflicts.conflicts.filter((x) => x.severity === "high").slice(0, 5)) {
    recs.push({ kind: "conflict", title: `${c.a.policyKey}/${c.a.ruleId} and ${c.b.policyKey}/${c.b.ruleId} overlap`, detail: c.explanation, evidence: { agents: c.agents.length }, href: "/policies?tab=conflicts" });
  }
  const lab = await db.attackSimulationResult.findMany({ where: { orgId: ctx.orgId, outcome: "gap", run: { status: "completed", startedAt: { gte: since } } }, orderBy: { createdAt: "desc" }, take: 20, select: { scenarioKey: true, runId: true } });
  const seen = new Set<string>();
  for (const g of lab) {
    if (seen.has(g.scenarioKey)) continue;
    seen.add(g.scenarioKey);
    recs.push({ kind: "lab_gap", title: `Attack Simulation Lab gap: ${g.scenarioKey.replace(/_/g, " ")}`, detail: "The latest lab run allowed this attack with the current configuration. The run lists what would close it.", evidence: { scenario: g.scenarioKey }, href: `/security/lab/${g.runId}` });
  }
  return recs;
}
