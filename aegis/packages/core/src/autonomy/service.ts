import { orgSettings } from "../lib/tx-cache.js";
import type { Prisma, TenantDb } from "@aegis/db";
import { z } from "zod";
import { appendEvidence } from "../evidence/ledger.js";
import type { OrgContext } from "../lib/context.js";
import { conflict, forbidden, notFound, validation } from "../lib/errors.js";
import { notifyUsers, userIdsWithPermission } from "../notify/notifications.js";
import { assertPermission } from "../orgs/orgs.js";
import { voidLiveGrants } from "../gateway/grants.js";
import { applyAutonomyLevel, AUTONOMY_LEVEL_INFO, compareAutonomy, isAutonomyLevel, type AutonomyLevel, type PolicyOutcome } from "./levels.js";

/** How long a raise request stays open for a second person. */
export const RAISE_REQUEST_HOURS = 72;

const levelSchema = z.number().int().min(0).max(4);
const ceilingSchema = z.number().nonnegative().max(1e15).nullable().optional();

export const lowerAutonomySchema = z.object({ level: levelSchema, ceilingAmount: ceilingSchema, reason: z.string().trim().min(5, "Give a reason of at least 5 characters").max(1000) });
export const raiseAutonomySchema = lowerAutonomySchema;
export const decideRaiseSchema = z.object({ approve: z.boolean(), note: z.string().trim().max(1000).default("") });

type Ceiling = number | null;
const toNum = (d: Prisma.Decimal | null | undefined): Ceiling => (d === null || d === undefined ? null : Number(d));

async function recordTransition(
  db: TenantDb,
  ctx: OrgContext,
  agent: { id: string; slug: string; autonomyLevel: number; autonomyCeilingAmount: Prisma.Decimal | null },
  to: { level: number; ceiling: Ceiling },
  kind: "lowered" | "raised" | "automatic_downgrade",
  reason: string,
  extra: { trigger?: Record<string, unknown>; changeRequestId?: string } = {},
) {
  const now = ctx.now ?? new Date();
  await db.agent.update({ where: { id: agent.id }, data: { autonomyLevel: to.level, autonomyCeilingAmount: to.ceiling, autonomyChangedAt: now } });
  const row = await db.autonomyTransition.create({
    data: {
      orgId: ctx.orgId,
      agentId: agent.id,
      fromLevel: agent.autonomyLevel,
      toLevel: to.level,
      kind,
      reason,
      trigger: (extra.trigger ?? undefined) as Prisma.InputJsonValue | undefined,
      actorType: ctx.actor.type,
      actorId: ctx.actor.id ?? null,
      changeRequestId: extra.changeRequestId ?? null,
      createdAt: now,
    },
  });
  await appendEvidence(db, ctx, {
    type: `autonomy.${kind}`,
    subjectType: "agent",
    subjectId: agent.id,
    payload: { transitionId: row.id, agent: agent.slug, fromLevel: agent.autonomyLevel, toLevel: to.level, fromCeiling: toNum(agent.autonomyCeilingAmount), toCeiling: to.ceiling, reason, trigger: extra.trigger ?? null, changeRequestId: extra.changeRequestId ?? null },
  });
  return row;
}

/** Cancels open raise requests: they were made against a level that no longer holds. */
async function cancelOpenRaises(db: TenantDb, ctx: OrgContext, agentId: string, note: string) {
  const now = ctx.now ?? new Date();
  await db.autonomyChangeRequest.updateMany({ where: { agentId, status: "pending" }, data: { status: "cancelled", decidedAt: now, decisionNote: note } });
}

/**
 * Lowers an agent's autonomy, or tightens its ceiling, at once. Restricting is always allowed to anyone
 * with agents:control: making an agent more supervised never needs a second person. Unused execution grants
 * issued under the old level are voided so nothing approved under looser terms can still run.
 */
export async function lowerAutonomy(db: TenantDb, ctx: OrgContext, agentId: string, input: z.input<typeof lowerAutonomySchema>) {
  assertPermission(ctx, "agents:control");
  const data = lowerAutonomySchema.parse(input);
  const agent = await db.agent.findUnique({ where: { id: agentId } });
  if (!agent) throw notFound("Agent");
  const target = { level: data.level, ceiling: data.ceilingAmount ?? (data.level === agent.autonomyLevel ? null : toNum(agent.autonomyCeilingAmount)) };
  const cmp = compareAutonomy(target, { level: agent.autonomyLevel, ceiling: toNum(agent.autonomyCeilingAmount) });
  if (cmp === "same") throw validation("The agent is already at that level and ceiling");
  if (cmp === "looser") throw validation("That would raise the agent's autonomy; raising needs a request approved by a second person");
  const row = await recordTransition(db, ctx, agent, target, "lowered", data.reason);
  await cancelOpenRaises(db, ctx, agentId, "autonomy was lowered after this request");
  await voidLiveGrants(db, ctx, `autonomy lowered to level ${target.level}: ${data.reason}`, { agentId });
  return row;
}

/** Asks for more autonomy. Nothing changes until a different person with agents:control approves. */
export async function requestAutonomyRaise(db: TenantDb, ctx: OrgContext, agentId: string, input: z.input<typeof raiseAutonomySchema>) {
  assertPermission(ctx, "agents:control");
  if (ctx.actor.type !== "user" || !ctx.actor.id) throw forbidden("Only a person can ask for more autonomy");
  const data = raiseAutonomySchema.parse(input);
  const agent = await db.agent.findUnique({ where: { id: agentId } });
  if (!agent) throw notFound("Agent");
  if (agent.status !== "active") throw validation(`The agent is ${agent.status}; resume it before raising its autonomy`);
  const target = { level: data.level, ceiling: data.ceilingAmount ?? null };
  if (compareAutonomy(target, { level: agent.autonomyLevel, ceiling: toNum(agent.autonomyCeilingAmount) }) !== "looser") throw validation("That is not more autonomy than the agent has; lower it directly instead");
  const open = await db.autonomyChangeRequest.findFirst({ where: { agentId, status: "pending" } });
  if (open) throw conflict("A raise request for this agent is already waiting for a decision");
  const now = ctx.now ?? new Date();
  const row = await db.autonomyChangeRequest.create({
    data: { orgId: ctx.orgId, agentId, fromLevel: agent.autonomyLevel, toLevel: target.level, ceilingAmount: target.ceiling, reason: data.reason, requestedBy: ctx.actor.id, expiresAt: new Date(now.getTime() + RAISE_REQUEST_HOURS * 3_600_000), createdAt: now },
  });
  const deciders = (await userIdsWithPermission(db, ctx, "agents:control")).filter((u) => u !== ctx.actor.id);
  await notifyUsers(db, ctx, { userIds: deciders, type: "autonomy.raise_requested", title: `More autonomy requested for ${agent.name}: level ${agent.autonomyLevel} to ${target.level}`, body: data.reason, link: `/agents/${agentId}?tab=autonomy`, idempotencyKey: `autonomy.raise_requested:${row.id}` });
  await appendEvidence(db, ctx, { type: "autonomy.raise_requested", subjectType: "agent", subjectId: agentId, payload: { changeRequestId: row.id, fromLevel: agent.autonomyLevel, toLevel: target.level, ceiling: target.ceiling, reason: data.reason } });
  return row;
}

/** A second person approves or rejects a raise. The requester can never decide their own request. */
export async function decideAutonomyRaise(db: TenantDb, ctx: OrgContext, requestId: string, input: z.input<typeof decideRaiseSchema>) {
  assertPermission(ctx, "agents:control");
  if (ctx.actor.type !== "user" || !ctx.actor.id) throw forbidden("Only a person can decide an autonomy raise");
  const data = decideRaiseSchema.parse(input);
  const req = await db.autonomyChangeRequest.findUnique({ where: { id: requestId } });
  if (!req) throw notFound("Autonomy request");
  if (req.status !== "pending") throw conflict(`This request is already ${req.status}`);
  if (req.requestedBy === ctx.actor.id) throw forbidden("You asked for this raise; a different person must decide it");
  const now = ctx.now ?? new Date();
  if (req.expiresAt <= now) {
    await db.autonomyChangeRequest.update({ where: { id: req.id }, data: { status: "expired", decidedAt: now } });
    throw conflict("This request has expired");
  }
  const agent = await db.agent.findUnique({ where: { id: req.agentId } });
  if (!agent) throw notFound("Agent");
  if (!data.approve) {
    if (data.note.length < 3) throw validation("Say why the raise is rejected");
    const updated = await db.autonomyChangeRequest.update({ where: { id: req.id }, data: { status: "rejected", decidedBy: ctx.actor.id, decidedAt: now, decisionNote: data.note } });
    await appendEvidence(db, ctx, { type: "autonomy.raise_rejected", subjectType: "agent", subjectId: agent.id, payload: { changeRequestId: req.id, note: data.note } });
    return { request: updated, transition: null };
  }
  if (agent.autonomyLevel !== req.fromLevel) {
    await db.autonomyChangeRequest.update({ where: { id: req.id }, data: { status: "cancelled", decidedAt: now, decisionNote: "the agent's level changed after the request" } });
    throw conflict("The agent's level changed after this request was made; ask again from the current level");
  }
  if (agent.status !== "active") throw validation(`The agent is ${agent.status}; resume it before raising its autonomy`);
  const updated = await db.autonomyChangeRequest.update({ where: { id: req.id }, data: { status: "approved", decidedBy: ctx.actor.id, decidedAt: now, decisionNote: data.note || null } });
  const transition = await recordTransition(db, ctx, agent, { level: req.toLevel, ceiling: toNum(req.ceilingAmount) }, "raised", req.reason, { changeRequestId: req.id });
  return { request: updated, transition };
}

export async function cancelAutonomyRaise(db: TenantDb, ctx: OrgContext, requestId: string) {
  assertPermission(ctx, "agents:control");
  const req = await db.autonomyChangeRequest.findUnique({ where: { id: requestId } });
  if (!req) throw notFound("Autonomy request");
  if (req.status !== "pending") throw conflict(`This request is already ${req.status}`);
  if (req.requestedBy !== ctx.actor.id) throw forbidden("Only the person who asked can withdraw the request");
  return db.autonomyChangeRequest.update({ where: { id: req.id }, data: { status: "cancelled", decidedAt: ctx.now ?? new Date(), decisionNote: "withdrawn by the requester" } });
}

// ---------- automatic downgrades ----------

export interface AutonomySettings {
  /** Off by default: when on, the rules below lower an agent's level by themselves. */
  automaticDowngrades: boolean;
  /** A critical security event about the agent lowers it to level 0; a high one to level 1. */
  onSecurityEvents: boolean;
  /** This many refused requests within the window lower the agent by one level (never below 1). */
  denialBurst: { count: number; windowMinutes: number } | null;
  /** An execution whose outcome is unknown lowers the agent to level 2 at most. */
  onUnknownOutcome: boolean;
}

export const DEFAULT_AUTONOMY_SETTINGS: AutonomySettings = { automaticDowngrades: false, onSecurityEvents: true, denialBurst: { count: 5, windowMinutes: 60 }, onUnknownOutcome: true };

export const autonomySettingsSchema = z.object({
  automaticDowngrades: z.boolean(),
  onSecurityEvents: z.boolean(),
  denialBurst: z.object({ count: z.number().int().min(2).max(1000), windowMinutes: z.number().int().min(5).max(1440) }).nullable(),
  onUnknownOutcome: z.boolean(),
});

export function readAutonomySettings(orgSettings: unknown): AutonomySettings {
  const raw = (orgSettings as { autonomy?: unknown } | null)?.autonomy;
  const parsed = autonomySettingsSchema.safeParse({ ...DEFAULT_AUTONOMY_SETTINGS, ...(raw && typeof raw === "object" ? raw : {}) });
  return parsed.success ? parsed.data : DEFAULT_AUTONOMY_SETTINGS;
}

/**
 * Per-agent opt-in, kept in agent.metadata.autonomyAutomation: turns the automatic rules on for one agent
 * when they are off for the organization (useful for a pilot), and can add one more step for that agent:
 * suspend it when it is refused again in a burst while already at level 1, the lowest level a burst reaches.
 */
export interface AgentAutomation {
  automaticDowngrades: boolean;
  suspendAtFloor: boolean;
}

export function readAgentAutomation(metadata: unknown): AgentAutomation {
  const raw = (metadata as { autonomyAutomation?: Record<string, unknown> } | null)?.autonomyAutomation;
  return { automaticDowngrades: raw?.automaticDowngrades === true, suspendAtFloor: raw?.suspendAtFloor === true };
}

function settingsFor(orgSettings: unknown, agentMetadata: unknown): AutonomySettings & { suspendAtFloor: boolean } {
  const org = readAutonomySettings(orgSettings);
  const agent = readAgentAutomation(agentMetadata);
  return { ...org, automaticDowngrades: org.automaticDowngrades || agent.automaticDowngrades, suspendAtFloor: agent.suspendAtFloor };
}

export async function updateAutonomySettings(db: TenantDb, ctx: OrgContext, input: z.input<typeof autonomySettingsSchema>) {
  assertPermission(ctx, "org:admin");
  const data = autonomySettingsSchema.parse(input);
  const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.orgId } });
  const settings = { ...((org.settings ?? {}) as Record<string, unknown>), autonomy: data };
  await db.organization.update({ where: { id: ctx.orgId }, data: { settings: settings as Prisma.InputJsonValue } });
  await appendEvidence(db, ctx, { type: "autonomy.settings_changed", subjectType: "organization", subjectId: ctx.orgId, payload: { ...data } });
  return data;
}

export type DowngradeTrigger =
  | { rule: "security_event"; severity: string; securityEventType: string; actionRequestId: string | null }
  | { rule: "denial_burst"; denials: number; windowMinutes: number; actionRequestId: string | null }
  | { rule: "unknown_outcome"; actionRequestId: string };

/** The level a trigger lowers an agent to, or null when the rule does not lower it. Pure. */
export function downgradeTarget(current: AutonomyLevel, trigger: DowngradeTrigger): AutonomyLevel | null {
  let target: number;
  if (trigger.rule === "security_event") {
    if (trigger.severity === "critical") target = 0;
    else if (trigger.severity === "high") target = 1;
    else return null;
  } else if (trigger.rule === "denial_burst") {
    target = Math.max(1, current - 1);
  } else {
    target = 2;
  }
  return target < current ? (target as AutonomyLevel) : null;
}

/**
 * Applies an automatic downgrade when the organization has turned them on. Runs in the caller's
 * transaction (the gateway's or the execution's), so the downgrade and its cause commit together.
 */
export async function applyAutomaticDowngrade(db: TenantDb, ctx: OrgContext, agentId: string, trigger: DowngradeTrigger): Promise<{ fromLevel: number; toLevel: number } | null> {
  const org = { settings: await orgSettings(db, ctx.orgId) };
  const agent = await db.agent.findUnique({ where: { id: agentId } });
  if (!agent || !isAutonomyLevel(agent.autonomyLevel)) return null;
  const settings = settingsFor(org?.settings, agent.metadata);
  if (!settings.automaticDowngrades) return null;
  if (trigger.rule === "security_event" && !settings.onSecurityEvents) return null;
  if (trigger.rule === "unknown_outcome" && !settings.onUnknownOutcome) return null;
  if (trigger.rule === "denial_burst" && !settings.denialBurst) return null;
  const target = downgradeTarget(agent.autonomyLevel, trigger);
  if (target === null) return null;
  const reasons: Record<DowngradeTrigger["rule"], string> = {
    security_event: `Automatic: a ${trigger.rule === "security_event" ? trigger.severity : ""} security event (${trigger.rule === "security_event" ? trigger.securityEventType : ""}) about this agent.`,
    denial_burst: `Automatic: ${trigger.rule === "denial_burst" ? trigger.denials : 0} refused requests within ${trigger.rule === "denial_burst" ? trigger.windowMinutes : 0} minutes.`,
    unknown_outcome: "Automatic: an execution's outcome could not be confirmed.",
  };
  await recordTransition(db, ctx, agent, { level: target, ceiling: toNum(agent.autonomyCeilingAmount) }, "automatic_downgrade", reasons[trigger.rule], { trigger: trigger as unknown as Record<string, unknown> });
  await cancelOpenRaises(db, ctx, agentId, "autonomy was lowered automatically after this request");
  await voidLiveGrants(db, ctx, `autonomy lowered automatically to level ${target}`, { agentId });
  const controllers = await userIdsWithPermission(db, ctx, "agents:control");
  await notifyUsers(db, ctx, { userIds: controllers, type: "autonomy.downgraded", title: `${agent.name} lowered to autonomy level ${target}`, body: reasons[trigger.rule], link: `/agents/${agentId}?tab=autonomy`, idempotencyKey: `autonomy.downgraded:${agentId}:${(ctx.now ?? new Date()).getTime()}` });
  return { fromLevel: agent.autonomyLevel, toLevel: target };
}

/** Counts refusals in the window and applies the burst rule at most once per window. */
export async function checkDenialBurst(db: TenantDb, ctx: OrgContext, agentId: string, actionRequestId: string | null) {
  const org = { settings: await orgSettings(db, ctx.orgId) };
  const agent = await db.agent.findUnique({ where: { id: agentId }, select: { metadata: true, autonomyLevel: true, status: true } });
  if (!agent) return null;
  const settings = settingsFor(org?.settings, agent.metadata);
  if (!settings.automaticDowngrades || !settings.denialBurst) return null;
  const now = ctx.now ?? new Date();
  const since = new Date(now.getTime() - settings.denialBurst.windowMinutes * 60_000);
  const denials = await db.actionRequest.count({ where: { agentId, status: "denied", createdAt: { gte: since } } });
  if (denials < settings.denialBurst.count) return null;
  const recent = await db.autonomyTransition.findFirst({ where: { agentId, kind: "automatic_downgrade", createdAt: { gte: since }, trigger: { path: ["rule"], equals: "denial_burst" } } });
  if (recent) return null;
  const trigger = { rule: "denial_burst" as const, denials, windowMinutes: settings.denialBurst.windowMinutes, actionRequestId };
  if (settings.suspendAtFloor && agent.status === "active" && isAutonomyLevel(agent.autonomyLevel) && downgradeTarget(agent.autonomyLevel, trigger) === null) {
    // Already at the lowest level a burst can reach and refused again: the opted-in agent is suspended.
    const { emergencyRevokeAgent } = await import("../agents/revocation.js");
    await emergencyRevokeAgent(db, ctx, agentId, { mode: "suspend", reason: `Automatic: ${denials} refused requests within ${settings.denialBurst.windowMinutes} minutes while already at autonomy level ${agent.autonomyLevel}` });
    return null;
  }
  return applyAutomaticDowngrade(db, ctx, agentId, trigger);
}

// ---------- reading, simulation and measurement ----------

export async function getAgentAutonomy(db: TenantDb, ctx: OrgContext, agentId: string) {
  assertPermission(ctx, "agents:read");
  const agent = await db.agent.findUnique({ where: { id: agentId }, select: { id: true, name: true, slug: true, status: true, autonomyLevel: true, autonomyCeilingAmount: true, autonomyChangedAt: true } });
  if (!agent) throw notFound("Agent");
  const level = (isAutonomyLevel(agent.autonomyLevel) ? agent.autonomyLevel : 0) as AutonomyLevel;
  const [history, requests, eligibility] = await Promise.all([
    db.autonomyTransition.findMany({ where: { agentId }, orderBy: { createdAt: "desc" }, take: 50 }),
    db.autonomyChangeRequest.findMany({ where: { agentId }, orderBy: { createdAt: "desc" }, take: 20 }),
    raiseEligibility(db, ctx, agentId),
  ]);
  const people = [...new Set([...history.map((h) => h.actorId), ...requests.flatMap((r) => [r.requestedBy, r.decidedBy])].filter((x): x is string => !!x))];
  const users = people.length ? await db.user.findMany({ where: { id: { in: people } }, select: { id: true, name: true } }) : [];
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  return {
    agent: { id: agent.id, name: agent.name, slug: agent.slug, status: agent.status },
    level,
    info: AUTONOMY_LEVEL_INFO[level],
    ceiling: toNum(agent.autonomyCeilingAmount),
    changedAt: agent.autonomyChangedAt,
    history: history.map((h) => ({ ...h, actorName: h.actorId ? (nameOf.get(h.actorId) ?? null) : null })),
    requests: requests.map((r) => ({ ...r, ceilingAmount: toNum(r.ceilingAmount), requestedByName: nameOf.get(r.requestedBy) ?? null, decidedByName: r.decidedBy ? (nameOf.get(r.decidedBy) ?? null) : null })),
    eligibility,
  };
}

/** Thresholds a person sees before asking for more autonomy. A recommendation, never an automatic raise. */
export const RAISE_CRITERIA = { windowDays: 30, minDecisions: 20, maxDenialRate: 0.05, maxRejectedApprovalRate: 0.05, quietDaysAfterDowngrade: 14 } as const;

export async function raiseEligibility(db: TenantDb, ctx: OrgContext, agentId: string) {
  const now = ctx.now ?? new Date();
  const since = new Date(now.getTime() - RAISE_CRITERIA.windowDays * 86_400_000);
  const [decided, denied, approvalsDecided, approvalsRejected, severeEvents, lastDowngrade] = await Promise.all([
    db.actionRequest.count({ where: { agentId, createdAt: { gte: since }, status: { not: "evaluating" } } }),
    db.actionRequest.count({ where: { agentId, createdAt: { gte: since }, status: "denied" } }),
    db.approvalRequest.count({ where: { request: { agentId }, createdAt: { gte: since }, status: { in: ["approved", "rejected"] } } }),
    db.approvalRequest.count({ where: { request: { agentId }, createdAt: { gte: since }, status: "rejected" } }),
    db.securityEvent.count({ where: { agentId, createdAt: { gte: since }, severity: { in: ["high", "critical"] } } }),
    db.autonomyTransition.findFirst({ where: { agentId, kind: "automatic_downgrade" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);
  const denialRate = decided ? denied / decided : 0;
  const rejectedRate = approvalsDecided ? approvalsRejected / approvalsDecided : 0;
  const quietSince = lastDowngrade ? (now.getTime() - lastDowngrade.createdAt.getTime()) / 86_400_000 : null;
  const checks = [
    { key: "volume", label: `At least ${RAISE_CRITERIA.minDecisions} decided requests in ${RAISE_CRITERIA.windowDays} days`, value: `${decided}`, met: decided >= RAISE_CRITERIA.minDecisions },
    { key: "denials", label: `Refusal rate at most ${RAISE_CRITERIA.maxDenialRate * 100}%`, value: `${(denialRate * 100).toFixed(1)}%`, met: denialRate <= RAISE_CRITERIA.maxDenialRate },
    { key: "approvals", label: `Approvers rejected at most ${RAISE_CRITERIA.maxRejectedApprovalRate * 100}% of its requests`, value: approvalsDecided ? `${(rejectedRate * 100).toFixed(1)}% of ${approvalsDecided}` : "none decided", met: rejectedRate <= RAISE_CRITERIA.maxRejectedApprovalRate },
    { key: "security", label: "No high or critical security events", value: `${severeEvents}`, met: severeEvents === 0 },
    { key: "quiet", label: `No automatic downgrade in the last ${RAISE_CRITERIA.quietDaysAfterDowngrade} days`, value: quietSince === null ? "never downgraded" : `${Math.floor(quietSince)} days ago`, met: quietSince === null || quietSince >= RAISE_CRITERIA.quietDaysAfterDowngrade },
  ];
  return { eligible: checks.every((c) => c.met), checks, measuredOver: { from: since, to: now } };
}

export interface SimulationRow {
  requestId: string;
  createdAt: Date;
  tool: string;
  amount: number | null;
  recorded: string;
  policyOutcome: PolicyOutcome;
  simulated: PolicyOutcome;
  changed: boolean;
  code: string | null;
}

/**
 * Replays the agent's recent requests at another level and ceiling. Uses the policy outcome recorded with
 * each decision (decisions made before levels existed recorded the policy outcome as their result), the
 * tool's risk level and the amount, so it is exact for the level step; it does not re-run policies.
 */
export async function simulateAutonomy(db: TenantDb, ctx: OrgContext, agentId: string, input: { level: number; ceilingAmount?: number | null; days?: number }) {
  assertPermission(ctx, "agents:read");
  if (!isAutonomyLevel(input.level)) throw validation("Level must be 0 to 4");
  const days = Math.min(Math.max(input.days ?? 30, 1), 90);
  const now = ctx.now ?? new Date();
  const agent = await db.agent.findUnique({ where: { id: agentId }, select: { id: true, autonomyLevel: true, autonomyCeilingAmount: true } });
  if (!agent) throw notFound("Agent");
  const org = { settings: await orgSettings(db, ctx.orgId) };
  const orgCurrency = ((org?.settings as { currency?: string } | null)?.currency ?? "AED").toUpperCase();
  const ceiling = input.ceilingAmount === undefined ? toNum(agent.autonomyCeilingAmount) : input.ceilingAmount;
  const requests = await db.actionRequest.findMany({
    where: { agentId, createdAt: { gte: new Date(now.getTime() - days * 86_400_000) } },
    orderBy: { createdAt: "desc" },
    take: 2000,
    include: { decisions: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  const toolIds = [...new Set(requests.map((r) => r.toolId).filter((x): x is string => !!x))];
  const tools = toolIds.length ? await db.tool.findMany({ where: { id: { in: toolIds } }, select: { id: true, riskLevel: true } }) : [];
  const riskOf = new Map(tools.map((t) => [t.id, t.riskLevel]));
  const rows: SimulationRow[] = [];
  for (const r of requests) {
    const d = r.decisions[0];
    if (!d) continue;
    const exp = (d.explanation ?? {}) as { autonomy?: { policyOutcome?: PolicyOutcome }; inputSummary?: { amount?: number | null; currency?: string | null } };
    const policyOutcome = (exp.autonomy?.policyOutcome ?? d.result) as PolicyOutcome;
    const amount = exp.inputSummary?.amount ?? null;
    const currency = exp.inputSummary?.currency ?? null;
    const sim = applyAutonomyLevel({ level: input.level, policyOutcome, toolRisk: (r.toolId ? riskOf.get(r.toolId) : undefined) ?? "critical", amount, ceiling, currencyMismatch: !!currency && currency.toUpperCase() !== orgCurrency });
    rows.push({ requestId: r.id, createdAt: r.createdAt, tool: r.toolKey, amount, recorded: d.result, policyOutcome, simulated: sim.outcome, changed: sim.outcome !== d.result, code: sim.code });
  }
  const count = (pred: (o: PolicyOutcome) => boolean, key: "simulated" | "recorded") => rows.filter((r) => pred(r[key] as PolicyOutcome)).length;
  const runs = (o: PolicyOutcome) => o === "allow" || o === "restrict";
  return {
    level: input.level,
    info: AUTONOMY_LEVEL_INFO[input.level],
    ceiling,
    days,
    total: rows.length,
    recorded: { autonomous: count(runs, "recorded"), approval: count((o) => o === "require_approval", "recorded"), refused: count((o) => !runs(o) && o !== "require_approval", "recorded") },
    simulated: { autonomous: count(runs, "simulated"), approval: count((o) => o === "require_approval", "simulated"), refused: count((o) => !runs(o) && o !== "require_approval", "simulated") },
    changed: rows.filter((r) => r.changed).slice(0, 100),
  };
}

/** Organization-wide measurement: where agents sit, how levels changed, and what the levels did to decisions. */
export async function autonomyAnalytics(db: TenantDb, ctx: OrgContext, days = 30) {
  assertPermission(ctx, "agents:read");
  const now = ctx.now ?? new Date();
  const since = new Date(now.getTime() - Math.min(Math.max(days, 1), 180) * 86_400_000);
  const [agents, transitions, pending, decisions] = await Promise.all([
    db.agent.findMany({ where: { isLab: false, status: { notIn: ["revoked", "archived"] } }, select: { id: true, name: true, status: true, autonomyLevel: true, autonomyCeilingAmount: true, autonomyChangedAt: true }, orderBy: { name: "asc" } }),
    db.autonomyTransition.findMany({ where: { createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 200 }),
    db.autonomyChangeRequest.findMany({ where: { status: "pending" }, orderBy: { createdAt: "asc" } }),
    db.authorizationDecision.findMany({ where: { createdAt: { gte: since } }, select: { result: true, explanation: true } }),
  ]);
  const byLevel = [0, 1, 2, 3, 4].map((l) => ({ level: l, name: AUTONOMY_LEVEL_INFO[l as AutonomyLevel].name, agents: agents.filter((a) => a.autonomyLevel === l && a.status === "active").length }));
  let changedByLevel = 0;
  const effects: Record<string, number> = {};
  for (const d of decisions) {
    const a = (d.explanation as { autonomy?: { effect?: string; code?: string | null } } | null)?.autonomy;
    if (a?.effect && a.effect !== "unchanged") {
      changedByLevel++;
      const k = a.code ?? a.effect;
      effects[k] = (effects[k] ?? 0) + 1;
    }
  }
  const kinds = { lowered: 0, raised: 0, automatic_downgrade: 0 } as Record<string, number>;
  for (const t of transitions) kinds[t.kind] = (kinds[t.kind] ?? 0) + 1;
  const nameOf = new Map(agents.map((a) => [a.id, a.name]));
  return {
    since,
    byLevel,
    agents: agents.map((a) => ({ ...a, autonomyCeilingAmount: toNum(a.autonomyCeilingAmount) })),
    transitions: transitions.map((t) => ({ ...t, agentName: nameOf.get(t.agentId) ?? "agent" })),
    transitionCounts: kinds,
    pending: pending.map((p) => ({ ...p, ceilingAmount: toNum(p.ceilingAmount), agentName: nameOf.get(p.agentId) ?? "agent" })),
    decisions: { total: decisions.length, changedByLevel, effects },
  };
}
