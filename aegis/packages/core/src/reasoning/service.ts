import type { Prisma, TenantDb } from "@aegis/db";
import type { z } from "zod";
import { appendEvidence } from "../evidence/ledger.js";
import type { OrgContext } from "../lib/context.js";
import { canonicalJson, sha256Hex } from "../lib/crypto.js";
import { notFound } from "../lib/errors.js";
import { assertPermission } from "../orgs/orgs.js";
import { buildAuthorizationInput } from "../gateway/input.js";
import { evaluatePolicies } from "../policy/evaluate.js";
import { resolvePoliciesForAgent } from "../policy/service.js";
import type { Indicator } from "../uncertainty/assess.js";
import { reasoningPolicySchema } from "./assess.js";

export const PRECEDENT_DAYS = 30;

/**
 * Heuristic: earlier requests for the same tool with an amount within 10% that the same policy versions decided
 * differently. A difference can be legitimate (time of day, duplicates, the agent's history); it is shown so a
 * person can see when like cases were not treated alike.
 */
export async function precedentIndicator(db: TenantDb, input: { requestId: string; toolKey: string; amount: number | null; policyVersionIds: string[]; policyResult: string; now: Date }): Promise<Indicator | null> {
  if (input.amount === null || input.policyVersionIds.length === 0) return null;
  const since = new Date(input.now.getTime() - PRECEDENT_DAYS * 86_400_000);
  const rows = await db.authorizationDecision.findMany({
    where: { createdAt: { gte: since, lt: input.now }, actionRequestId: { not: input.requestId }, request: { toolKey: input.toolKey, agent: { isLab: false } } },
    orderBy: { createdAt: "desc" },
    take: 300,
    select: { result: true, policyVersionIds: true, explanation: true },
  });
  const key = [...input.policyVersionIds].sort().join(",");
  let similar = 0;
  let different = 0;
  for (const r of rows) {
    const exp = r.explanation as { inputSummary?: { amount?: number | null }; policyResult?: string } | null;
    const amount = exp?.inputSummary?.amount;
    if (typeof amount !== "number" || [...r.policyVersionIds].sort().join(",") !== key) continue;
    if (Math.abs(amount - input.amount) > Math.abs(input.amount) * 0.1) continue;
    similar++;
    if ((exp?.policyResult ?? r.result) !== input.policyResult) different++;
  }
  if (similar === 0) return null;
  return different
    ? { key: "precedent", label: "Like requests were decided alike", basis: "heuristic", status: "warning", detail: `${different} of ${similar} similar requests in the last ${PRECEDENT_DAYS} days (same tool, amount within 10%, same policy versions) were decided differently by policy.` }
    : { key: "precedent", label: "Like requests were decided alike", basis: "heuristic", status: "ok", detail: `${similar} similar requests in the last ${PRECEDENT_DAYS} days were decided the same way.` };
}

export async function updateToolReasoningPolicy(db: TenantDb, ctx: OrgContext, toolId: string, input: z.input<typeof reasoningPolicySchema>) {
  assertPermission(ctx, "agents:write");
  const policy = reasoningPolicySchema.parse(input);
  const tool = await db.tool.findUnique({ where: { id: toolId } });
  if (!tool) throw notFound("Tool");
  const row = await db.tool.update({ where: { id: toolId }, data: { reasoningPolicy: policy as unknown as Prisma.InputJsonValue } });
  await appendEvidence(db, ctx, { type: "tool.reasoning_policy_changed", subjectType: "tool", subjectId: toolId, payload: { tool: tool.key, before: tool.reasoningPolicy as Prisma.InputJsonValue, after: policy as unknown as Prisma.InputJsonValue } });
  return row;
}

// ---------- Decision Inspector ----------

export interface InspectorStage {
  key: "received" | "baseline" | "data_protection" | "policy" | "uncertainty" | "reasoning" | "autonomy" | "outcome" | "approval" | "execution";
  title: string;
  status: "passed" | "changed" | "stopped" | "skipped" | "pending";
  summary: string;
  detail: Record<string, unknown>;
}

interface Comparison {
  attr: string;
  op: string;
  expected?: unknown;
  actual?: unknown;
  result: boolean;
}

/** What would have changed the outcome, from the numeric comparisons recorded in the trace. Exact for those comparisons only. */
export function counterfactuals(trace: { policyKey: string; ruleId: string; effect: string; matched: boolean; comparisons?: Comparison[] }[]): string[] {
  const out: string[] = [];
  for (const t of trace) {
    for (const c of t.comparisons ?? []) {
      if (typeof c.actual !== "number" || typeof c.expected !== "number") continue;
      const verb = t.matched ? "would no longer match" : "would match";
      const flip: Record<string, string> = { gt: c.result ? `at most ${c.expected}` : `above ${c.expected}`, gte: c.result ? `below ${c.expected}` : `${c.expected} or more`, lt: c.result ? `${c.expected} or more` : `below ${c.expected}`, lte: c.result ? `above ${c.expected}` : `at most ${c.expected}` };
      const when = flip[c.op];
      if (!when) continue;
      out.push(`If ${c.attr} were ${when} (it was ${c.actual}), rule ${t.policyKey}/${t.ruleId} (${t.effect.replace(/_/g, " ")}) ${verb}.`);
    }
  }
  return [...new Set(out)].slice(0, 12);
}

export async function inspectDecision(db: TenantDb, ctx: OrgContext, requestId: string) {
  assertPermission(ctx, "gateway:read");
  const req = await db.actionRequest.findUnique({
    where: { id: requestId },
    include: { decisions: { orderBy: { createdAt: "asc" } }, approvals: { include: { responses: true } }, receipts: { orderBy: { createdAt: "asc" } }, grants: { orderBy: { createdAt: "asc" } }, agent: { select: { id: true, name: true, slug: true } } },
  });
  if (!req) throw notFound("Action request");
  const decision = req.decisions.at(-1) ?? null;
  const exp = (decision?.explanation ?? {}) as Record<string, unknown> & {
    stage?: string;
    failures?: { code: string; message: string }[];
    shield?: unknown[];
    trace?: { policyKey: string; ruleId: string; effect: string; matched: boolean; comparisons?: Comparison[] }[];
    decidingRule?: { policy: string; rule: string; effect: string } | null;
    defaultDeny?: boolean;
    policyResult?: string;
    uncertainty?: { level: string; escalated?: boolean; indicators?: unknown[] };
    reasoning?: { provided: boolean; level: string; escalated?: boolean; indicators?: unknown[]; rationale?: unknown };
    autonomy?: { level: number; policyOutcome: string; effect: string; code: string | null } | null;
  };
  const stages: InspectorStage[] = [];
  stages.push({ key: "received", title: "Request received", status: "passed", summary: `${req.agent.name} asked to ${req.action} with ${req.toolKey}.`, detail: { tool: req.toolKey, action: req.action, resource: req.resourceKey, params: req.params, context: req.context, idempotencyKey: req.idempotencyKey, receivedAt: req.createdAt } });
  if (exp.stage === "baseline") {
    stages.push({ key: "baseline", title: "Baseline checks", status: "stopped", summary: (exp.failures ?? []).map((f) => f.message).join("; ") || "A baseline check failed.", detail: { failures: exp.failures ?? [] } });
  } else if (exp.stage === "shield") {
    stages.push({ key: "baseline", title: "Baseline checks", status: "passed", summary: "Identity, grants, destinations and limits passed.", detail: {} });
    stages.push({ key: "data_protection", title: "Data protection", status: "stopped", summary: "Shield refused the request.", detail: { findings: exp.shield ?? [] } });
  } else if (exp.stage === "error") {
    stages.push({ key: "policy", title: "Policy evaluation", status: "stopped", summary: "Evaluation failed, so the action was refused (fail closed).", detail: { error: exp.error ?? null } });
  } else if (exp.stage === "policy") {
    stages.push({ key: "baseline", title: "Baseline checks", status: "passed", summary: "Identity, grants, destinations and limits passed.", detail: {} });
    stages.push({ key: "data_protection", title: "Data protection", status: (exp.shield ?? []).length ? "changed" : "passed", summary: (exp.shield ?? []).length ? `${(exp.shield ?? []).length} sensitive value(s) found.` : "No sensitive data found.", detail: { findings: exp.shield ?? [] } });
    const deciding = exp.decidingRule;
    stages.push({ key: "policy", title: "Policy evaluation", status: "passed", summary: deciding ? `Decided by ${deciding.policy}/${deciding.rule}: ${deciding.effect.replace(/_/g, " ")}.` : exp.defaultDeny ? "No rule matched: refused by default." : `Policies decided: ${exp.policyResult ?? decision?.result}.`, detail: { policyResult: exp.policyResult ?? null, decidingRule: deciding ?? null, trace: exp.trace ?? [], counterfactuals: counterfactuals(exp.trace ?? []) } });
    if (exp.uncertainty) stages.push({ key: "uncertainty", title: "Uncertainty", status: exp.uncertainty.escalated ? "changed" : "passed", summary: `Level ${exp.uncertainty.level}${exp.uncertainty.escalated ? "; the decision was made stricter" : ""}.`, detail: exp.uncertainty as Record<string, unknown> });
    if (exp.reasoning) stages.push({ key: "reasoning", title: "Stated reasons", status: exp.reasoning.escalated ? "changed" : "passed", summary: exp.reasoning.provided ? `The agent's rationale was checked: ${exp.reasoning.level}${exp.reasoning.escalated ? "; the decision was made stricter" : ""}.` : "The agent sent no rationale.", detail: exp.reasoning as Record<string, unknown> });
    if (exp.autonomy) stages.push({ key: "autonomy", title: "Autonomy level", status: exp.autonomy.effect === "unchanged" ? "passed" : "changed", summary: `Level ${exp.autonomy.level}: ${exp.autonomy.effect === "unchanged" ? "no change" : exp.autonomy.effect.replace(/_/g, " ")}.`, detail: exp.autonomy as Record<string, unknown> });
  }
  stages.push({ key: "outcome", title: "Outcome", status: decision?.result === "allow" || decision?.result === "restrict" ? "passed" : decision?.result === "require_approval" ? "pending" : "stopped", summary: decision ? `Final decision: ${decision.result.replace(/_/g, " ")}. Status now: ${req.status.replace(/_/g, " ")}.` : "No decision recorded.", detail: { result: decision?.result ?? null, latencyMs: decision?.latencyMs ?? null, policyVersionIds: decision?.policyVersionIds ?? [] } });
  for (const a of req.approvals) {
    stages.push({ key: "approval", title: "Approval", status: a.status === "approved" ? "passed" : a.status === "pending" ? "pending" : "stopped", summary: `${a.status.replace(/_/g, " ")}: ${a.responses.length} response(s), ${a.requiredApprovals} needed.`, detail: { status: a.status, reason: a.reason, responses: a.responses.map((r) => ({ decision: r.decision, comment: r.comment, at: r.createdAt })), requestHash: a.requestHash } });
  }
  if (req.grants.length || req.receipts.length) {
    const last = req.receipts.at(-1);
    stages.push({ key: "execution", title: "Execution", status: last?.status === "succeeded" ? "passed" : last ? (last.status === "unknown" ? "pending" : "stopped") : "pending", summary: last ? `Receipt: ${last.status} from ${last.downstreamSystem}${last.downstreamReference ? ` (${last.downstreamReference})` : ""}.` : "A one-time grant was issued; no receipt yet.", detail: { grants: req.grants.map((g) => ({ issuedAt: g.createdAt, expiresAt: g.expiresAt, consumedAt: g.consumedAt, voidedAt: g.voidedAt })), receipts: req.receipts.map((r) => ({ status: r.status, system: r.downstreamSystem, reference: r.downstreamReference, at: r.createdAt })) } });
  }
  const evidence = await db.evidenceEvent.findMany({ where: { subjectId: requestId }, orderBy: { seq: "asc" }, select: { seq: true, type: true, hash: true, occurredAt: true } });
  return { request: { id: req.id, agent: req.agent, tool: req.toolKey, action: req.action, status: req.status, createdAt: req.createdAt, correlationId: req.correlationId }, stages, evidence, decided: !!decision };
}

/** Re-evaluates the request's recorded input against the policies active now, without changing anything. */
export async function recheckWithCurrentPolicies(db: TenantDb, ctx: OrgContext, requestId: string) {
  assertPermission(ctx, "policies:read");
  const req = await db.actionRequest.findUnique({ where: { id: requestId }, include: { decisions: { orderBy: { createdAt: "desc" }, take: 1 } } });
  if (!req) throw notFound("Action request");
  const decision = req.decisions[0];
  const exp = (decision?.explanation ?? {}) as { stage?: string; policyResult?: string; uncertainty?: { level?: string; missing?: string[]; contradictions?: string[]; confidence?: { value?: number; calibratedAccuracy?: number | null; basis?: string } | null } };
  if (!decision || exp.stage !== "policy") return { comparable: false as const, reason: "The request was refused before policies ran, so there is no policy decision to compare." };
  const agent = await db.agent.findUnique({ where: { id: req.agentId }, include: { tools: { include: { tool: true } }, permissions: true } });
  const tool = await db.tool.findUnique({ where: { orgId_key: { orgId: ctx.orgId, key: req.toolKey } }, include: { integration: true } });
  if (!agent || !tool) return { comparable: false as const, reason: "The agent or tool no longer exists." };
  const resource = req.resourceKey ? await db.resource.findUnique({ where: { orgId_key: { orgId: ctx.orgId, key: req.resourceKey } } }) : null;
  const permittedActions = resource ? agent.permissions.filter((p) => p.resourceId === resource.id && !p.revokedAt).flatMap((p) => p.actions) : [];
  const { executionMode: _m, ip, ...supplied } = (req.context ?? {}) as Record<string, unknown>;
  const u = exp.uncertainty;
  const input = await buildAuthorizationInput(db, {
    agent,
    tool,
    action: req.action,
    resource: resource ? { ...resource, permittedActions } : null,
    params: (req.params ?? {}) as Record<string, unknown>,
    principal: { type: req.principalUserId ? "user" : "service", userId: req.principalUserId, ref: req.principalRef },
    ip: typeof ip === "string" ? ip : null,
    supplied,
    uncertainty: u ? { level: u.level ?? "low", missing: u.missing ?? [], contradictions: u.contradictions ?? [], confidence: u.confidence?.calibratedAccuracy ?? u.confidence?.value ?? null, confidenceBasis: u.confidence?.basis ?? null } : undefined,
    now: req.createdAt,
  });
  const policies = await resolvePoliciesForAgent(db, ctx.orgId, agent);
  const evaluation = evaluatePolicies(policies, input);
  const then = exp.policyResult ?? decision.result;
  return {
    comparable: true as const,
    then,
    now: evaluation.result,
    same: then === evaluation.result,
    decidingRuleNow: evaluation.decidingRule ? `${evaluation.decidingRule.policyKey}/${evaluation.decidingRule.ruleId}` : null,
    policiesNow: policies.map((p) => `${p.policyKey} v${p.policyVersion}`),
  };
}

/**
 * A self-contained decision record, structured after W3C PROV-DM: the entities used and generated, the
 * activities that used them, and the agents responsible. Hashes tie it to the evidence ledger. It contains what
 * AEGIS recorded and what the agent submitted; it contains no model internals because AEGIS has none.
 */
export async function decisionRecord(db: TenantDb, ctx: OrgContext, requestId: string) {
  const view = await inspectDecision(db, ctx, requestId);
  const req = await db.actionRequest.findUniqueOrThrow({ where: { id: requestId }, include: { decisions: { orderBy: { createdAt: "asc" } } } });
  const body = {
    format: "aegis-decision-record/1",
    note: "Observable artifacts only: the request, what the agent submitted, and what AEGIS computed. No model-internal reasoning is included or available.",
    generatedAt: (ctx.now ?? new Date()).toISOString(),
    agents: [{ id: `agent:${view.request.agent.slug}`, type: "ai_agent", name: view.request.agent.name }, { id: "aegis:gateway", type: "software", name: "AEGIS Action Gateway" }],
    entities: [
      { id: `request:${req.id}`, type: "action_request", attributes: { tool: req.toolKey, action: req.action, params: req.params, context: req.context, paramsHash: req.paramsHash } },
      ...req.decisions.map((d) => ({ id: `decision:${d.id}`, type: "authorization_decision", attributes: { result: d.result, inputHash: d.inputHash, policyVersionIds: d.policyVersionIds, explanation: d.explanation } })),
    ],
    activities: view.stages.map((s, i) => ({ id: `activity:${i + 1}:${s.key}`, type: s.key, status: s.status, summary: s.summary })),
    relations: req.decisions.map((d) => ({ type: "wasGeneratedBy", entity: `decision:${d.id}`, activity: "activity:evaluation", using: `request:${req.id}`, attributedTo: "aegis:gateway" })),
    evidence: view.evidence.map((e) => ({ seq: e.seq.toString(), type: e.type, hash: e.hash, at: e.occurredAt })),
  };
  const digest = sha256Hex(canonicalJson(body));
  await appendEvidence(db, ctx, { type: "decision.record_exported", subjectType: "action_request", subjectId: requestId, payload: { sha256: digest } });
  return { record: body, sha256: digest };
}
