import type { TenantDb } from "@aegis/db";
import type { OrgContext } from "../lib/context.js";
import { assertPermission } from "../orgs/orgs.js";
import { resolvePoliciesForAgent } from "../policy/service.js";
import { explainRefundPolicy, extractRefundSettings } from "../policy/templates.js";
import { explainScoreBandPolicy, extractScoreBandSettings } from "../policy/score-band.js";
import type { PolicyToEvaluate } from "../policy/evaluate.js";

/**
 * Autonomy posture: one named level per agent, derived from facts AEGIS already holds, so a person can
 * see at a glance how much an agent may do on its own. No new setting is introduced; the posture
 * changes only when the agent's state, its tool grants or the active policies change.
 *
 *   suspended   the agent is not active; every request is refused at the gate
 *   restricted  nothing runs: no tool granted, or no active policy covers its tools (default deny)
 *   supervised  at least one applicable rule sends requests to a person
 *   autonomous  applicable rules only allow or refuse; nothing waits for a person
 */
export type AutonomyPosture = "suspended" | "restricted" | "supervised" | "autonomous";

export interface PostureSummary {
  posture: AutonomyPosture;
  label: string;
  /** One plain sentence explaining the posture, taken from the guided template when there is one. */
  sentence: string;
  grantedTools: string[];
  policies: { key: string; version: number; approvalRules: number; allowRules: number; denyRules: number }[];
}

export const POSTURE_LABELS: Record<AutonomyPosture, string> = {
  suspended: "Suspended",
  restricted: "Restricted",
  supervised: "Supervised",
  autonomous: "Autonomous",
};

export interface PostureAgentInput {
  id: string;
  status: string;
  teamId: string | null;
  tools: { enabled: boolean; revokedAt: Date | null; tool: { key: string } }[];
}

function templateSentence(p: PolicyToEvaluate): string | null {
  const refund = extractRefundSettings(p.document);
  if (refund) {
    const lines = explainRefundPolicy(refund);
    const band = lines.find((l) => l.includes("need "));
    const auto = lines.find((l) => l.includes("run automatically"));
    return [auto, band].filter(Boolean).join(" ") || null;
  }
  const score = extractScoreBandSettings(p.document);
  if (score) {
    const lines = explainScoreBandPolicy(score);
    return lines.slice(2, 5).join(" ") || null;
  }
  return null;
}

/** Posture for one agent, from its state, granted tools and the active policies that reach it. */
export function postureFromFacts(agent: PostureAgentInput, policies: PolicyToEvaluate[]): PostureSummary {
  const grantedTools = agent.tools.filter((t) => t.enabled && !t.revokedAt).map((t) => t.tool.key);
  if (agent.status !== "active") {
    return { posture: "suspended", label: POSTURE_LABELS.suspended, sentence: `The agent is ${agent.status}: every request is refused before any policy runs.`, grantedTools, policies: [] };
  }
  if (grantedTools.length === 0) {
    return { posture: "restricted", label: POSTURE_LABELS.restricted, sentence: "No tool is granted, so every request is refused.", grantedTools, policies: [] };
  }
  const applicable = policies.filter((p) => p.document.appliesTo.tools.length === 0 || p.document.appliesTo.tools.some((t) => grantedTools.includes(t)));
  const summary = applicable.map((p) => ({
    key: p.policyKey,
    version: p.policyVersion,
    approvalRules: p.document.rules.filter((r) => r.effect === "require_approval").length,
    allowRules: p.document.rules.filter((r) => r.effect === "allow").length,
    denyRules: p.document.rules.filter((r) => r.effect === "deny").length,
  }));
  const approvals = summary.reduce((n, p) => n + p.approvalRules, 0);
  const allows = summary.reduce((n, p) => n + p.allowRules, 0);
  const denies = summary.reduce((n, p) => n + p.denyRules, 0);
  if (applicable.length === 0 || (approvals === 0 && allows === 0)) {
    return { posture: "restricted", label: POSTURE_LABELS.restricted, sentence: applicable.length === 0 ? "No active policy covers its tools, so every request is refused by default." : "The policies that cover its tools only refuse; nothing is allowed to run.", grantedTools, policies: summary };
  }
  const named = applicable.map(templateSentence).find((s) => s);
  if (approvals > 0) {
    const sentence = named ?? `${approvals} rule${approvals === 1 ? "" : "s"} across ${applicable.map((p) => p.policyKey).join(", ")} send${approvals === 1 ? "s" : ""} requests to a person; ${denies} refuse outright.`;
    return { posture: "supervised", label: POSTURE_LABELS.supervised, sentence, grantedTools, policies: summary };
  }
  const sentence = named ?? `Runs on its own within ${applicable.map((p) => p.policyKey).join(", ")}; ${denies} rule${denies === 1 ? "" : "s"} refuse requests outside the limits and nothing waits for a person.`;
  return { posture: "autonomous", label: POSTURE_LABELS.autonomous, sentence, grantedTools, policies: summary };
}

/** Postures for several agents. Policies are resolved once per agent (assignments differ by agent and team). */
export async function agentPostures(db: TenantDb, ctx: OrgContext, agents: PostureAgentInput[]): Promise<Map<string, PostureSummary>> {
  assertPermission(ctx, "agents:read");
  const out = new Map<string, PostureSummary>();
  for (const a of agents) {
    const policies = a.status === "active" ? await resolvePoliciesForAgent(db, ctx.orgId, a) : [];
    out.set(a.id, postureFromFacts(a, policies));
  }
  return out;
}

export async function agentPosture(db: TenantDb, ctx: OrgContext, agent: PostureAgentInput): Promise<PostureSummary> {
  return (await agentPostures(db, ctx, [agent])).get(agent.id)!;
}
