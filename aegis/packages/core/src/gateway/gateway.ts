import type { ActionRequest, Prisma, TenantDb } from "@aegis/db";
import { z } from "zod";
import { appendEvidence } from "../evidence/ledger.js";
import { makeContext, type OrgContext } from "../lib/context.js";
import { hashObject } from "../lib/crypto.js";
import { AegisError, conflict, forbidden, notFound } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { enqueueJob } from "../jobs/queue.js";
import { notifyUsers, userIdsWithPermission } from "../notify/notifications.js";
import { evaluatePolicies, type EvaluationResult } from "../policy/evaluate.js";
import { resolvePoliciesForAgent } from "../policy/service.js";
import { baselineChecks } from "./baseline.js";
import { buildAuthorizationInput, extractDestinationDomain, type AuthorizationInput } from "./input.js";
import { issueGrant } from "./grants.js";
import { getShieldInspector } from "./shield-hook.js";
import { getDownstreamSystem } from "./simulators.js";
import { rawPrisma } from "@aegis/db";

export const actionRequestInputSchema = z.object({
  tool: z.string().min(1).max(80),
  action: z.string().min(1).max(80).default("execute"),
  params: z.record(z.unknown()).default({}),
  resource: z.string().max(80).optional(),
  idempotencyKey: z.string().min(8).max(200),
  correlationId: z.string().max(120).optional(),
  justification: z.string().max(2000).default(""),
  principal: z.object({ type: z.enum(["user", "customer", "system", "none"]).default("none"), ref: z.string().max(200).optional(), userId: z.string().uuid().optional() }).default({ type: "none" }),
  context: z.record(z.unknown()).default({}),
  /** "gateway": AEGIS executes through the integration. "agent": AEGIS returns a grant for the agent to present downstream. */
  executionMode: z.enum(["gateway", "agent"]).default("gateway"),
});
export type ActionRequestInput = z.infer<typeof actionRequestInputSchema>;

export interface GatewayResponse {
  requestId: string;
  status: ActionRequest["status"];
  decision: "allow" | "deny" | "require_approval" | "error";
  reasons: string[];
  riskIndicators: string[];
  policyVersionIds: string[];
  matchedRuleIds: string[];
  approval?: { approvalRequestId: string; expiresAt: string; requiredApprovals: number; requiredRoles: string[] };
  grant?: { token: string; expiresAt: string };
  receipt?: { status: string; downstreamSystem: string; reference: string | null; summary: Record<string, unknown> };
  duplicate?: boolean;
  correlationId: string;
}

export function requestHashOf(toolKey: string, action: string, params: Record<string, unknown>): string {
  return hashObject({ toolKey, action, params });
}

async function gatewayPausedState(orgId: string): Promise<{ paused: boolean; reason?: string }> {
  const org = await rawPrisma().organization.findUnique({ where: { id: orgId }, select: { settings: true } });
  const s = (org?.settings ?? {}) as { gatewayPaused?: boolean; gatewayPausedReason?: string };
  return { paused: !!s.gatewayPaused, reason: s.gatewayPausedReason };
}

/**
 * Entry point for every protected action. Runs inside one tenant transaction up to the decision,
 * so a failure anywhere (including evidence) leaves no partial state. Execution happens after the
 * decision commits so a crash cannot execute without a recorded decision.
 */
export async function submitActionRequest(db: TenantDb, ctx: OrgContext, input: ActionRequestInput): Promise<GatewayResponse> {
  if (ctx.actor.type !== "agent" || !ctx.actor.id) throw forbidden("Only agents submit action requests");
  const agentId = ctx.actor.id;
  const correlationId = input.correlationId ?? ctx.requestId;
  const paramsHash = requestHashOf(input.tool, input.action, input.params);

  // Idempotency: same key returns the recorded outcome; same key with different parameters is rejected.
  const existing = await db.actionRequest.findUnique({ where: { orgId_idempotencyKey: { orgId: ctx.orgId, idempotencyKey: input.idempotencyKey } }, include: { decisions: { orderBy: { createdAt: "desc" }, take: 1 }, approvals: { orderBy: { createdAt: "desc" }, take: 1 }, receipts: { orderBy: { createdAt: "desc" }, take: 1 } } });
  if (existing) {
    if (existing.paramsHash !== paramsHash || existing.agentId !== agentId) {
      await appendEvidence(db, ctx, { type: "gateway.idempotency_conflict", subjectType: "action_request", subjectId: existing.id, correlationId, payload: { idempotencyKey: input.idempotencyKey, sameAgent: existing.agentId === agentId } });
      throw conflict("Idempotency key was already used with different parameters or by a different agent");
    }
    await appendEvidence(db, ctx, { type: "gateway.duplicate_request", subjectType: "action_request", subjectId: existing.id, correlationId, payload: { idempotencyKey: input.idempotencyKey, status: existing.status } });
    return toResponse(existing, existing.decisions[0] ?? null, existing.approvals[0] ?? null, existing.receipts[0] ?? null, true);
  }

  const agent = await db.agent.findUnique({ where: { id: agentId }, include: { tools: { include: { tool: true } }, permissions: true } });
  if (!agent) throw notFound("Agent");
  const tool = await db.tool.findUnique({ where: { orgId_key: { orgId: ctx.orgId, key: input.tool } }, include: { integration: true } });
  const resource = input.resource ? await db.resource.findUnique({ where: { orgId_key: { orgId: ctx.orgId, key: input.resource } } }) : null;

  const started = Date.now();
  const now = ctx.now ?? new Date();
  const request = await db.actionRequest.create({
    data: {
      createdAt: now,
      updatedAt: now,
      orgId: ctx.orgId,
      agentId,
      toolId: tool?.id ?? null,
      toolKey: input.tool,
      action: input.action,
      resourceKey: input.resource ?? null,
      params: input.params as Prisma.InputJsonValue,
      paramsHash,
      idempotencyKey: input.idempotencyKey,
      correlationId,
      traceId: ctx.traceId ?? null,
      principalUserId: input.principal.userId ?? null,
      principalRef: input.principal.ref ?? null,
      environment: agent.environment,
      justification: input.justification,
      context: { ...input.context, executionMode: input.executionMode, ip: ctx.ip ?? null } as Prisma.InputJsonValue,
    },
  });
  await appendEvidence(db, ctx, { type: "gateway.request_received", subjectType: "action_request", subjectId: request.id, correlationId, payload: { tool: input.tool, action: input.action, resource: input.resource ?? null, paramsHash, agent: agent.slug } });

  let evaluation: EvaluationResult | null = null;
  let authzInput: AuthorizationInput | null = null;
  let effectiveParams = input.params;
  let decisionResult: GatewayResponse["decision"] = "deny";
  let reasons: string[] = [];
  let riskIndicators: string[] = [];
  let policyVersionIds: string[] = [];
  let matchedRuleIds: string[] = [];
  let explanation: Record<string, unknown> = {};
  let approvalSpec: EvaluationResult["approval"] = null;
  let securitySeverity: string | null = null;
  let securityType: string | null = null;

  try {
    const destinationDomain = extractDestinationDomain(input.params);
    const paused = await gatewayPausedState(ctx.orgId);
    const baseline = baselineChecks({ agent, tool, action: input.action, resource, resourceKeyRequested: input.resource ?? null, params: input.params, destinationDomain, gatewayPaused: paused });

    const shield = await getShieldInspector()(db, ctx.orgId, { params: input.params, toolKey: input.tool, destinationDomain, agentId });
    effectiveParams = shield.params;

    if (baseline.failures.length > 0 || !tool) {
      decisionResult = "deny";
      reasons = baseline.failures.map((f) => f.message);
      explanation = { stage: "baseline", failures: baseline.failures, shield: shield.findings };
      if (baseline.failures.some((f) => f.code === "destination_not_allowed" || f.code === "classification_exceeded" || f.code === "tool_not_granted")) {
        securitySeverity = "high";
        securityType = baseline.failures.find((f) => f.code === "destination_not_allowed") ? "egress.blocked" : "authorization.boundary_violation";
      }
    } else if (shield.blockReason) {
      decisionResult = "deny";
      reasons = [shield.blockReason];
      explanation = { stage: "shield", shield: shield.findings, injectionSignals: shield.shield.injectionSignals };
      securitySeverity = shield.shield.highestSeverity ?? "high";
      securityType = "data_protection.blocked";
    } else {
      authzInput = await buildAuthorizationInput(db, {
        agent,
        tool,
        action: input.action,
        resource: resource ? { ...resource, permittedActions: baseline.permittedActions } : null,
        params: input.params,
        principal: { type: input.principal.type, userId: input.principal.userId ?? null, ref: input.principal.ref ?? null },
        ip: ctx.ip ?? null,
        supplied: input.context,
        shield: shield.shield,
        now,
      });
      const policies = await resolvePoliciesForAgent(db, ctx.orgId, agent);
      evaluation = evaluatePolicies(policies, authzInput);
      decisionResult = evaluation.result;
      if (shield.requireApproval && decisionResult === "allow") {
        decisionResult = "require_approval";
        evaluation = { ...evaluation, result: "require_approval", approval: { roles: [], minApprovers: 1, expiresInMinutes: 240, separationOfDuties: true, escalateToRoles: [], instructions: "Sensitive data detected in parameters" }, reasons: [...evaluation.reasons, "Sensitive data detected; approval required by data protection settings"] };
      }
      reasons = evaluation.reasons;
      riskIndicators = [...evaluation.riskIndicators, ...shield.findings.map((f) => `data:${f.dataClass}`)];
      policyVersionIds = [...new Set(evaluation.trace.map((t) => t.policyVersionId))];
      matchedRuleIds = evaluation.matchedRules.map((m) => `${m.policyKey}/${m.ruleId}`);
      approvalSpec = evaluation.approval;
      explanation = {
        stage: "policy",
        decidingRule: evaluation.decidingRule ? { policy: evaluation.decidingRule.policyKey, rule: evaluation.decidingRule.ruleId, effect: evaluation.decidingRule.effect } : null,
        defaultDeny: evaluation.defaultDeny,
        policiesEvaluated: policies.map((p) => ({ key: p.policyKey, version: p.policyVersion })),
        skipped: evaluation.skippedPolicies,
        trace: evaluation.trace,
        shield: shield.findings,
        inputSummary: { amount: authzInput.context.amount, currency: authzInput.context.currency, destinationDomain: authzInput.context.destinationDomain, resource: authzInput.resource?.key ?? null, requestCount24h: authzInput.context.requestCount24h, deniedCount24h: authzInput.context.deniedCount24h },
      };
      if (decisionResult === "deny" && evaluation.securityEventSeverity) {
        securitySeverity = evaluation.securityEventSeverity;
        securityType = "policy.violation";
      }
    }
  } catch (err) {
    // Fail closed: any evaluation error is a deny, recorded as such.
    decisionResult = "error";
    reasons = ["Policy evaluation failed; action denied"];
    explanation = { stage: "error", error: err instanceof Error ? err.message : "unknown" };
    securitySeverity = "high";
    securityType = "policy.evaluation_failed";
    logger.error({ requestId: request.id, err: err instanceof Error ? err.message : String(err) }, "policy evaluation failed");
  }

  const decision = await db.authorizationDecision.create({
    data: { createdAt: now, orgId: ctx.orgId, actionRequestId: request.id, result: decisionResult, policyVersionIds, matchedRuleIds, explanation: explanation as Prisma.InputJsonValue, inputHash: authzInput ? hashObject(authzInput) : paramsHash, latencyMs: Date.now() - started },
  });
  await appendEvidence(db, ctx, { type: `gateway.decision.${decisionResult}`, subjectType: "action_request", subjectId: request.id, correlationId, payload: { decisionId: decision.id, result: decisionResult, reasons, policyVersionIds, matchedRuleIds, riskIndicators, latencyMs: decision.latencyMs } });

  if (securityType) {
    await db.securityEvent.create({ data: { createdAt: now, orgId: ctx.orgId, type: securityType, severity: securitySeverity ?? "medium", title: `${securityType.replace(/[._]/g, " ")}: ${agent.slug} ${input.tool}`, agentId, actionRequestId: request.id, policyVersionIds: undefined, detail: { reasons, tool: input.tool, action: input.action, resource: input.resource ?? null, destinationDomain: extractDestinationDomain(input.params) } as Prisma.InputJsonValue } as Prisma.SecurityEventUncheckedCreateInput });
  }

  let status: ActionRequest["status"];
  let approvalRow = null as Awaited<ReturnType<typeof db.approvalRequest.create>> | null;
  let grant: { token: string; expiresAt: Date } | null = null;
  if (decisionResult === "allow") {
    status = "allowed";
    const g = await issueGrant(db, ctx.orgId, request.id, paramsHash);
    grant = { token: g.token, expiresAt: g.grant.expiresAt };
  } else if (decisionResult === "require_approval") {
    status = "pending_approval";
    const spec = approvalSpec ?? { roles: [], minApprovers: 1, expiresInMinutes: 240, separationOfDuties: true, escalateToRoles: [], instructions: "" };
    const expiresAt = new Date(now.getTime() + spec.expiresInMinutes * 60_000);
    approvalRow = await db.approvalRequest.create({
      data: { createdAt: now, updatedAt: now, orgId: ctx.orgId, actionRequestId: request.id, requiredApprovals: spec.minApprovers, requiredRoles: spec.roles, requestHash: paramsHash, triggeringRuleId: evaluation?.decidingRule ? `${evaluation.decidingRule.policyKey}/${evaluation.decidingRule.ruleId}` : null, policyVersionId: evaluation?.decidingRule?.policyVersionId ?? null, reason: spec.instructions || reasons.join("; "), expiresAt },
    });
    await enqueueJob({ type: "approval.expire", payload: { approvalRequestId: approvalRow.id, orgId: ctx.orgId }, idempotencyKey: `approval.expire:${approvalRow.id}`, orgId: ctx.orgId, runAt: expiresAt }, db);
    const approvers = await userIdsWithPermission(db, ctx, "approvals:decide");
    await notifyUsers(db, ctx, { userIds: approvers, type: "approval.requested", title: `Approval needed: ${agent.name} wants to ${input.tool}`, body: reasons.join("; "), link: `/approvals/${approvalRow.id}`, idempotencyKey: `approval.requested:${approvalRow.id}` });
    await appendEvidence(db, ctx, { type: "approval.requested", subjectType: "approval_request", subjectId: approvalRow.id, correlationId, payload: { actionRequestId: request.id, expiresAt, requiredApprovals: spec.minApprovers, requiredRoles: spec.roles } });
  } else {
    status = "denied";
  }
  const updated = await db.actionRequest.update({ where: { id: request.id }, data: { status, riskIndicators, expiresAt: approvalRow?.expiresAt ?? null, completedAt: status === "denied" ? now : null, params: effectiveParams as Prisma.InputJsonValue, updatedAt: now } });
  await db.agent.update({ where: { id: agentId }, data: { lastActivityAt: now } });

  const response = toResponse(updated, decision, approvalRow, null, false);
  response.reasons = reasons;
  if (grant) response.grant = { token: grant.token, expiresAt: grant.expiresAt.toISOString() };
  // Store what the executor needs (post-commit) without leaking the grant into the response for gateway mode.
  if (status === "allowed") (response as GatewayResponse & { __pendingExecution?: { grantToken: string; params: Record<string, unknown> } }).__pendingExecution = { grantToken: grant!.token, params: effectiveParams };
  if (input.executionMode === "gateway") delete response.grant;
  return response;
}

function toResponse(req: ActionRequest, decision: { result: string; policyVersionIds: string[]; matchedRuleIds: string[]; explanation: unknown } | null, approval: { id: string; expiresAt: Date; requiredApprovals: number; requiredRoles: string[] } | null, receipt: { status: string; downstreamSystem: string; downstreamReference: string | null; responseSummary: unknown } | null, duplicate: boolean): GatewayResponse {
  const explanation = (decision?.explanation ?? {}) as { failures?: { message: string }[]; decidingRule?: { policy: string; rule: string } | null; defaultDeny?: boolean };
  const reasons = explanation.failures?.map((f) => f.message) ?? [];
  return {
    requestId: req.id,
    status: req.status,
    decision: (decision?.result as GatewayResponse["decision"]) ?? "error",
    reasons,
    riskIndicators: (req.riskIndicators as string[]) ?? [],
    policyVersionIds: decision?.policyVersionIds ?? [],
    matchedRuleIds: decision?.matchedRuleIds ?? [],
    approval: approval ? { approvalRequestId: approval.id, expiresAt: approval.expiresAt.toISOString(), requiredApprovals: approval.requiredApprovals, requiredRoles: approval.requiredRoles } : undefined,
    receipt: receipt ? { status: receipt.status, downstreamSystem: receipt.downstreamSystem, reference: receipt.downstreamReference, summary: (receipt.responseSummary ?? {}) as Record<string, unknown> } : undefined,
    duplicate: duplicate || undefined,
    correlationId: req.correlationId,
  };
}

/**
 * Executes an allowed or approved request through the tool's integration (gateway mode).
 * Runs in its own transaction after the decision committed. The downstream simulator verifies
 * and consumes the grant before acting. Idempotent: a request with a receipt is never re-executed.
 */
export async function executeRequest(db: TenantDb, ctx: OrgContext, actionRequestId: string, grantToken: string, params: Record<string, unknown>): Promise<GatewayResponse["receipt"] & { status: string }> {
  const req = await db.actionRequest.findUnique({ where: { id: actionRequestId }, include: { agent: true, receipts: true } });
  if (!req) throw notFound("Action request");
  if (req.receipts.length > 0) {
    const r = req.receipts[0]!;
    return { status: r.status, downstreamSystem: r.downstreamSystem, reference: r.downstreamReference, summary: (r.responseSummary ?? {}) as Record<string, unknown> };
  }
  if (!["allowed", "approved"].includes(req.status)) throw new AegisError("conflict", `Request is ${req.status}; only allowed or approved requests execute`);
  if (req.agent.status !== "active") {
    await db.actionRequest.update({ where: { id: req.id }, data: { status: "failed", completedAt: new Date() } });
    await db.executionReceipt.create({ data: { orgId: ctx.orgId, actionRequestId: req.id, status: "skipped", downstreamSystem: "aegis-gateway", responseSummary: { error: `agent is ${req.agent.status}` } } });
    await appendEvidence(db, ctx, { type: "gateway.execution_skipped", subjectType: "action_request", subjectId: req.id, correlationId: req.correlationId, payload: { reason: `agent ${req.agent.status}` } });
    return { status: "skipped", downstreamSystem: "aegis-gateway", reference: null, summary: { error: `agent is ${req.agent.status}` } };
  }
  const tool = req.toolId ? await db.tool.findUnique({ where: { id: req.toolId }, include: { integration: true } }) : null;
  const systemKey = tool?.integration?.key ?? "none";
  const system = getDownstreamSystem(systemKey);
  const started = Date.now();
  let result: { ok: boolean; reference: string | null; summary: Record<string, unknown>; error?: string };
  if (!system || !tool?.integration) {
    result = { ok: false, reference: null, summary: {}, error: `no downstream system registered for ${systemKey}` };
  } else if (tool.integration.status !== "active") {
    result = { ok: false, reference: null, summary: {}, error: `integration ${systemKey} is disabled` };
  } else {
    try {
      result = await system.execute(db, ctx.orgId, tool.integration.id, { grantToken, toolKey: req.toolKey, action: req.action, params, correlationId: req.correlationId, agentSlug: req.agent.slug });
    } catch (e) {
      result = { ok: false, reference: null, summary: {}, error: e instanceof Error ? e.message : "execution failed" };
    }
  }
  const receipt = await db.executionReceipt.create({
    data: { createdAt: ctx.now ?? new Date(), orgId: ctx.orgId, actionRequestId: req.id, status: result.ok ? "succeeded" : "failed", downstreamSystem: systemKey, downstreamReference: result.reference, responseSummary: { ...result.summary, ...(result.error ? { error: result.error } : {}) } as Prisma.InputJsonValue, durationMs: Date.now() - started },
  });
  await db.actionRequest.update({ where: { id: req.id }, data: { status: result.ok ? "executed" : "failed", completedAt: ctx.now ?? new Date(), updatedAt: ctx.now ?? new Date() } });
  await appendEvidence(db, ctx, { type: result.ok ? "gateway.executed" : "gateway.execution_failed", subjectType: "action_request", subjectId: req.id, correlationId: req.correlationId, payload: { receiptId: receipt.id, downstreamSystem: systemKey, reference: result.reference, error: result.error ?? null, durationMs: receipt.durationMs } });
  return { status: receipt.status, downstreamSystem: systemKey, reference: result.reference, summary: (receipt.responseSummary ?? {}) as Record<string, unknown> };
}

/**
 * Full gateway flow for API callers: decision in transaction 1, execution (gateway mode) in
 * transaction 2. The decision is durable before anything executes.
 */
export async function authorizeAndExecute(withTenant: <T>(orgId: string, fn: (db: TenantDb) => Promise<T>) => Promise<T>, ctx: OrgContext, input: ActionRequestInput): Promise<GatewayResponse> {
  const decision = await withTenant(ctx.orgId, (db) => submitActionRequest(db, ctx, input));
  const pending = (decision as GatewayResponse & { __pendingExecution?: { grantToken: string; params: Record<string, unknown> } }).__pendingExecution;
  delete (decision as GatewayResponse & { __pendingExecution?: unknown }).__pendingExecution;
  if (pending && input.executionMode === "gateway" && !decision.duplicate) {
    const receipt = await withTenant(ctx.orgId, (db) => executeRequest(db, ctx, decision.requestId, pending.grantToken, pending.params));
    decision.receipt = receipt;
    decision.status = receipt.status === "succeeded" ? "executed" : "failed";
  }
  return decision;
}

export function systemContextFor(orgId: string): OrgContext {
  return makeContext(orgId, { type: "system", id: null, label: "aegis-gateway" });
}

export async function getActionRequest(db: TenantDb, ctx: OrgContext, id: string) {
  const req = await db.actionRequest.findUnique({ where: { id }, include: { agent: { select: { id: true, slug: true, name: true, status: true } }, decisions: { orderBy: { createdAt: "asc" } }, approvals: { include: { responses: { orderBy: { createdAt: "asc" } } }, orderBy: { createdAt: "asc" } }, receipts: true, grants: { select: { id: true, expiresAt: true, consumedAt: true, createdAt: true } } } });
  if (!req) throw notFound("Action request");
  if (ctx.actor.type === "agent" && req.agentId !== ctx.actor.id) throw notFound("Action request");
  const evidence = await db.evidenceEvent.findMany({ where: { orgId: ctx.orgId, correlationId: req.correlationId }, orderBy: { seq: "asc" } });
  return { ...req, evidence };
}

export const requestListFilter = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  status: z.string().optional(),
  agentId: z.string().uuid().optional(),
  tool: z.string().optional(),
  q: z.string().max(120).optional(),
  since: z.coerce.date().optional(),
});

export async function listActionRequests(db: TenantDb, ctx: OrgContext, f: z.infer<typeof requestListFilter>) {
  const where: Prisma.ActionRequestWhereInput = {
    orgId: ctx.orgId,
    ...(ctx.actor.type === "agent" ? { agentId: ctx.actor.id! } : {}),
    ...(f.status ? { status: f.status as ActionRequest["status"] } : {}),
    ...(f.agentId ? { agentId: f.agentId } : {}),
    ...(f.tool ? { toolKey: f.tool } : {}),
    ...(f.since ? { createdAt: { gte: f.since } } : {}),
    ...(f.q ? { OR: [{ correlationId: { contains: f.q } }, { toolKey: { contains: f.q } }, { idempotencyKey: { contains: f.q } }, { justification: { contains: f.q, mode: "insensitive" } }] } : {}),
  };
  const [items, total] = await Promise.all([
    db.actionRequest.findMany({ where, orderBy: { createdAt: "desc" }, skip: (f.page - 1) * f.pageSize, take: f.pageSize, include: { agent: { select: { slug: true, name: true } }, decisions: { orderBy: { createdAt: "desc" }, take: 1, select: { result: true, matchedRuleIds: true, latencyMs: true } }, receipts: { take: 1, select: { status: true, downstreamReference: true } } } }),
    db.actionRequest.count({ where }),
  ]);
  return { items, total, page: f.page, pageSize: f.pageSize, pageCount: Math.max(1, Math.ceil(total / f.pageSize)) };
}
