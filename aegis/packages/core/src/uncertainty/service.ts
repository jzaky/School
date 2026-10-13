import type { Prisma, TenantDb } from "@aegis/db";
import { z } from "zod";
import { appendEvidence } from "../evidence/ledger.js";
import type { OrgContext } from "../lib/context.js";
import { forbidden, notFound, validation } from "../lib/errors.js";
import { assertPermission } from "../orgs/orgs.js";
import { assessUncertainty, readUncertaintyPolicy, uncertaintyPolicySchema, type CalibrationLookup, type Indicator, type UncertaintyAssessment, type UncertaintyLevel } from "./assess.js";
import { computeCalibration, lookupFromReport, type CalibrationBin, type CalibrationReport } from "./calibration.js";

export const CALIBRATION_WINDOW_DAYS = 90;
/** Within this many hours of a new agent version or a policy change, AEGIS flags the change (heuristic). */
export const RECENT_CHANGE_HOURS = 24;

/** The stored calibration the gateway uses for one agent and tool: the tool's own profile, else the agent's overall one. */
export async function calibrationLookupFor(db: TenantDb, agentId: string, toolKey: string): Promise<CalibrationLookup | null> {
  const rows = await db.calibrationProfile.findMany({ where: { agentId, toolKey: { in: [toolKey, "*"] } } });
  const row = rows.find((r) => r.toolKey === toolKey) ?? rows.find((r) => r.toolKey === "*");
  if (!row) return null;
  return lookupFromReport({ sampleSize: row.sampleSize, bins: row.bins as unknown as CalibrationBin[] });
}

/** Heuristic indicators about recent changes around the agent: a new version, or a policy that changed. */
export async function environmentIndicators(db: TenantDb, agent: { id: string; currentVersion: number }, now: Date): Promise<Indicator[]> {
  const since = new Date(now.getTime() - RECENT_CHANGE_HOURS * 3_600_000);
  const [version, policyChange] = await Promise.all([
    db.agentVersion.findFirst({ where: { agentId: agent.id, version: agent.currentVersion, deployedAt: { gte: since, lte: now } }, select: { deployedAt: true } }),
    db.policyEvent.findFirst({ where: { type: { in: ["activated", "rolled_back"] }, createdAt: { gte: since, lte: now } }, select: { createdAt: true } }),
  ]);
  const out: Indicator[] = [];
  if (version) out.push({ key: "recent_agent_version", label: "The agent's version is settled", basis: "heuristic", status: "warning", detail: `Version ${agent.currentVersion} was deployed less than ${RECENT_CHANGE_HOURS} hours ago; its behaviour has little history.` });
  if (policyChange) out.push({ key: "recent_policy_change", label: "Policies are settled", basis: "heuristic", status: "warning", detail: `A policy in this organization was activated or rolled back less than ${RECENT_CHANGE_HOURS} hours ago.` });
  return out;
}

/** Heuristic: several rules matched with different effects, so the outcome rests on precedence rather than one clear rule. */
export function ambiguityIndicator(matched: { effect: string; ruleId: string; policyKey: string }[]): Indicator | null {
  const effects = [...new Set(matched.map((m) => m.effect))];
  if (effects.length < 2) return null;
  return { key: "policy_ambiguity", label: "One clear rule decided", basis: "heuristic", status: "warning", detail: `${matched.length} rules matched with different effects (${effects.join(", ")}); the strictest applied by precedence.` };
}

export async function assessForRequest(db: TenantDb, input: { agent: { id: string; currentVersion: number }; tool: { key: string; uncertaintyPolicy: unknown }; params: Record<string, unknown>; supplied: Record<string, unknown>; now: Date }): Promise<UncertaintyAssessment> {
  const policy = readUncertaintyPolicy(input.tool.uncertaintyPolicy);
  const [calibration, extra] = await Promise.all([calibrationLookupFor(db, input.agent.id, input.tool.key), environmentIndicators(db, input.agent, input.now)]);
  return assessUncertainty({ params: input.params, supplied: input.supplied, policy, now: input.now, calibration, extra });
}

// ---------- tool requirements ----------

export async function updateToolUncertaintyPolicy(db: TenantDb, ctx: OrgContext, toolId: string, input: z.input<typeof uncertaintyPolicySchema>) {
  assertPermission(ctx, "agents:write");
  const policy = uncertaintyPolicySchema.parse(input);
  const tool = await db.tool.findUnique({ where: { id: toolId } });
  if (!tool) throw notFound("Tool");
  const row = await db.tool.update({ where: { id: toolId }, data: { uncertaintyPolicy: policy as unknown as Prisma.InputJsonValue } });
  await appendEvidence(db, ctx, { type: "tool.uncertainty_policy_changed", subjectType: "tool", subjectId: toolId, payload: { tool: tool.key, before: tool.uncertaintyPolicy as Prisma.InputJsonValue, after: policy as unknown as Prisma.InputJsonValue } });
  return row;
}

// ---------- outcome labels ----------

export const labelSchema = z.object({ actionRequestId: z.string().uuid(), correct: z.boolean(), note: z.string().trim().max(1000).default("") });

function confidenceOf(context: unknown): number | null {
  const c = (context as { confidence?: unknown } | null)?.confidence;
  return typeof c === "number" && Number.isFinite(c) && c >= 0 && c <= 1 ? c : null;
}

/**
 * Records whether an action was right. People need monitoring:write; a customer system reports with an
 * integration key that carries the outcomes:report scope (checked at the API). One label per source.
 */
export async function labelOutcome(db: TenantDb, ctx: OrgContext, input: z.input<typeof labelSchema>, source: "reviewer" | "system" = "reviewer") {
  if (source === "reviewer") assertPermission(ctx, "monitoring:write");
  else if (ctx.actor.type !== "integration") throw forbidden("Only an integration reports outcomes as a system");
  const data = labelSchema.parse(input);
  const req = await db.actionRequest.findUnique({ where: { id: data.actionRequestId }, select: { id: true, agentId: true, toolKey: true, context: true, status: true } });
  if (!req) throw notFound("Action request");
  if (["evaluating", "received"].includes(req.status)) throw validation("The request has not been decided yet");
  const row = await db.outcomeLabel.upsert({
    where: { actionRequestId_source: { actionRequestId: req.id, source } },
    create: { orgId: ctx.orgId, actionRequestId: req.id, agentId: req.agentId, toolKey: req.toolKey, confidence: confidenceOf(req.context), correct: data.correct, source, labelledBy: ctx.actor.id ?? null, note: data.note, createdAt: ctx.now ?? new Date() },
    update: { correct: data.correct, note: data.note, labelledBy: ctx.actor.id ?? null },
  });
  await appendEvidence(db, ctx, { type: "uncertainty.outcome_labelled", subjectType: "action_request", subjectId: req.id, payload: { labelId: row.id, correct: data.correct, source, confidence: row.confidence } });
  return row;
}

/** An approver's decision is a label for requests that carried a confidence: approved means the agent was right. */
export async function labelFromApprovalDecision(db: TenantDb, ctx: OrgContext, actionRequestId: string, approved: boolean) {
  const req = await db.actionRequest.findUnique({ where: { id: actionRequestId }, select: { id: true, agentId: true, toolKey: true, context: true } });
  if (!req) return null;
  const confidence = confidenceOf(req.context);
  if (confidence === null) return null;
  return db.outcomeLabel.upsert({
    where: { actionRequestId_source: { actionRequestId: req.id, source: "approver" } },
    create: { orgId: ctx.orgId, actionRequestId: req.id, agentId: req.agentId, toolKey: req.toolKey, confidence, correct: approved, source: "approver", labelledBy: ctx.actor.id ?? null, createdAt: ctx.now ?? new Date() },
    update: { correct: approved, labelledBy: ctx.actor.id ?? null },
  });
}

// ---------- calibration ----------

/** One label per request: a reviewer or system label wins over the approver's (it judged the outcome, not the request). */
function pairsFrom(labels: { actionRequestId: string; confidence: number | null; correct: boolean; source: string }[]) {
  const rank = (s: string) => (s === "system" ? 3 : s === "reviewer" ? 2 : 1);
  const best = new Map<string, { confidence: number; correct: boolean; rank: number }>();
  for (const l of labels) {
    if (l.confidence === null) continue;
    const cur = best.get(l.actionRequestId);
    if (!cur || rank(l.source) > cur.rank) best.set(l.actionRequestId, { confidence: l.confidence, correct: l.correct, rank: rank(l.source) });
  }
  return [...best.values()].map(({ confidence, correct }) => ({ confidence, correct }));
}

/** Recomputes and stores calibration profiles for one agent, or every agent with labels. */
export async function recomputeCalibration(db: TenantDb, ctx: OrgContext, opts: { agentId?: string; windowDays?: number } = {}) {
  const windowDays = opts.windowDays ?? CALIBRATION_WINDOW_DAYS;
  const now = ctx.now ?? new Date();
  const labels = await db.outcomeLabel.findMany({ where: { ...(opts.agentId ? { agentId: opts.agentId } : {}), createdAt: { gte: new Date(now.getTime() - windowDays * 86_400_000), lte: now }, confidence: { not: null } }, select: { actionRequestId: true, agentId: true, toolKey: true, confidence: true, correct: true, source: true } });
  const groups = new Map<string, typeof labels>();
  for (const l of labels) {
    for (const key of [`${l.agentId}|${l.toolKey}`, `${l.agentId}|*`]) groups.set(key, [...(groups.get(key) ?? []), l]);
  }
  const written: { agentId: string; toolKey: string; report: CalibrationReport }[] = [];
  for (const [key, ls] of groups) {
    const [agentId, toolKey] = key.split("|") as [string, string];
    const report = computeCalibration(pairsFrom(ls));
    await db.calibrationProfile.upsert({
      where: { orgId_agentId_toolKey: { orgId: ctx.orgId, agentId, toolKey } },
      create: { orgId: ctx.orgId, agentId, toolKey, sampleSize: report.sampleSize, ece: report.ece, brier: report.brier, accuracy: report.accuracy, bins: report.bins as unknown as Prisma.InputJsonValue, windowDays, computedAt: now },
      update: { sampleSize: report.sampleSize, ece: report.ece, brier: report.brier, accuracy: report.accuracy, bins: report.bins as unknown as Prisma.InputJsonValue, windowDays, computedAt: now },
    });
    written.push({ agentId, toolKey, report });
  }
  return written;
}

// ---------- reading ----------

export async function uncertaintyOverview(db: TenantDb, ctx: OrgContext, days = 30) {
  assertPermission(ctx, "monitoring:read");
  const now = ctx.now ?? new Date();
  const since = new Date(now.getTime() - Math.min(Math.max(days, 1), 180) * 86_400_000);
  const [decisions, profiles, agents, labels] = await Promise.all([
    db.authorizationDecision.findMany({ where: { createdAt: { gte: since, lte: now }, uncertaintyLevel: { not: null } }, select: { uncertaintyLevel: true, result: true, explanation: true, actionRequestId: true } }),
    db.calibrationProfile.findMany({ orderBy: [{ agentId: "asc" }, { toolKey: "asc" }] }),
    db.agent.findMany({ select: { id: true, name: true } }),
    db.outcomeLabel.count({ where: { createdAt: { gte: since, lte: now } } }),
  ]);
  const byLevel: Record<UncertaintyLevel, number> = { low: 0, elevated: 0, high: 0, unknown: 0 };
  const failing = new Map<string, { label: string; basis: string; count: number }>();
  let escalated = 0;
  for (const d of decisions) {
    byLevel[(d.uncertaintyLevel ?? "low") as UncertaintyLevel]++;
    const u = (d.explanation as { uncertainty?: { indicators?: Indicator[]; escalated?: boolean } } | null)?.uncertainty;
    if (u?.escalated) escalated++;
    for (const i of u?.indicators ?? []) {
      if (i.status === "ok") continue;
      const k = i.key.split(":")[0]!;
      const cur = failing.get(k) ?? { label: i.label.replace(/ for .*| on .*/, ""), basis: i.basis, count: 0 };
      cur.count++;
      failing.set(k, cur);
    }
  }
  const nameOf = new Map(agents.map((a) => [a.id, a.name]));
  return {
    since,
    assessed: decisions.length,
    byLevel,
    escalated,
    labels,
    indicators: [...failing.entries()].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.count - a.count).slice(0, 12),
    profiles: profiles.map((p) => ({ ...p, agentName: nameOf.get(p.agentId) ?? "agent", bins: p.bins as unknown as CalibrationBin[] })),
  };
}

export async function agentCalibration(db: TenantDb, ctx: OrgContext, agentId: string) {
  assertPermission(ctx, "monitoring:read");
  const profiles = await db.calibrationProfile.findMany({ where: { agentId }, orderBy: { toolKey: "asc" } });
  return profiles.map((p) => ({ ...p, bins: p.bins as unknown as CalibrationBin[] }));
}
