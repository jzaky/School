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
import { consumeGrant, EXECUTABLE_STATUSES, hashGrantToken, issueGrant, voidLiveGrants } from "./grants.js";
import { getShieldInspector } from "./shield-hook.js";
import { getDownstreamSystem, readIntegrationCredential, type DownstreamContext } from "./simulators.js";

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

/** Reads through the transaction client: never touch the shared pool from inside a tenant transaction (pool exhaustion under load). */
export async function gatewayPausedState(db: TenantDb, orgId: string): Promise<{ paused: boolean; reason?: string }> {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { settings: true } });
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
    const paused = await gatewayPausedState(db, ctx.orgId);
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
        inputSummary: { amount: authzInput.context.amount, currency: authzInput.context.currency, destinationDomain: authzInput.context.destinationDomain, resource: authzInput.resource?.key ?? null, requestCount24h: authzInput.context.requestCount24h, deniedCount24h: authzInput.context.deniedCount24h, hour: authzInput.context.hour, priorRequestsSameReference: authzInput.context.priorRequestsSameReference, duplicateReferenceKey: authzInput.context.duplicateReferenceKey },
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
    // The request becomes executable before its single grant is issued; the grant binds the parameters that will
    // execute (after Shield masking), so the downstream check matches.
    await db.actionRequest.update({ where: { id: request.id }, data: { status: "allowed", updatedAt: now } });
    const g = await issueGrant(db, ctx.orgId, request.id, requestHashOf(input.tool, input.action, effectiveParams), { now });
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

export type TenantRunner = <T>(fn: (db: TenantDb) => Promise<T>) => Promise<T>;

export interface ExecutionOutcome {
  status: string;
  downstreamSystem: string;
  reference: string | null;
  summary: Record<string, unknown>;
  /** The request's status after this call (executed, failed, executing, unknown). */
  requestStatus: ActionRequest["status"];
}

/** How long an `executing` request may stay unresolved before the sweep forces reconciliation. */
export const EXECUTION_RECONCILE_AFTER_MS = 30_000;
/** Reconciliation attempts before an outcome is declared unknown and handed to a human. */
export const EXECUTION_MAX_RECONCILE_ATTEMPTS = 6;

function receiptView(r: { status: string; downstreamSystem: string; downstreamReference: string | null; responseSummary: unknown }, requestStatus: ActionRequest["status"]): ExecutionOutcome {
  return { status: r.status, downstreamSystem: r.downstreamSystem, reference: r.downstreamReference, summary: (r.responseSummary ?? {}) as Record<string, unknown>, requestStatus };
}

function downstreamContext(run: TenantRunner, orgId: string, integrationId: string): DownstreamContext {
  return {
    orgId,
    integrationId,
    run,
    credential: (name = "service-token") => run((db) => readIntegrationCredential(db, integrationId, name)),
  };
}

async function recordOutcome(db: TenantDb, ctx: OrgContext, req: { id: string; correlationId: string; executionAttempts: number }, systemKey: string, result: { outcome: "succeeded" | "failed" | "unknown"; reference: string | null; summary: Record<string, unknown>; error?: string }, durationMs: number): Promise<ExecutionOutcome> {
  const now = ctx.now ?? new Date();
  const receipt = await db.executionReceipt.create({
    data: { createdAt: now, orgId: ctx.orgId, actionRequestId: req.id, status: result.outcome, downstreamSystem: systemKey, downstreamReference: result.reference, responseSummary: { ...result.summary, ...(result.error ? { error: result.error } : {}) } as Prisma.InputJsonValue, durationMs, attempt: Math.max(1, req.executionAttempts) },
  });
  if (result.outcome === "unknown") {
    // Ambiguous: the call may have happened. Keep `executing`, schedule reconciliation, never retry blindly.
    await db.actionRequest.update({ where: { id: req.id }, data: { updatedAt: now } });
    await enqueueJob({ type: "execution.reconcile", payload: { actionRequestId: req.id, orgId: ctx.orgId }, idempotencyKey: `execution.reconcile:${req.id}:${req.executionAttempts}`, orgId: ctx.orgId, runAt: new Date(now.getTime() + EXECUTION_RECONCILE_AFTER_MS), maxAttempts: EXECUTION_MAX_RECONCILE_ATTEMPTS }, db);
    await appendEvidence(db, ctx, { type: "gateway.execution_outcome_unknown", subjectType: "action_request", subjectId: req.id, correlationId: req.correlationId, payload: { receiptId: receipt.id, downstreamSystem: systemKey, error: result.error ?? null, attempt: req.executionAttempts } });
    return receiptView(receipt, "executing");
  }
  const status: ActionRequest["status"] = result.outcome === "succeeded" ? "executed" : "failed";
  await db.actionRequest.update({ where: { id: req.id }, data: { status, completedAt: now, updatedAt: now } });
  await appendEvidence(db, ctx, { type: result.outcome === "succeeded" ? "gateway.executed" : "gateway.execution_failed", subjectType: "action_request", subjectId: req.id, correlationId: req.correlationId, payload: { receiptId: receipt.id, downstreamSystem: systemKey, reference: result.reference, error: result.error ?? null, durationMs, attempt: req.executionAttempts } });
  return receiptView(receipt, status);
}

const FINAL_RECEIPTS = new Set(["succeeded", "failed", "skipped"]);

/**
 * Executes an allowed or approved request through the tool's integration (gateway mode).
 *
 * Phase 1 (transaction): re-check the request, consume the grant (which moves the request to
 * `executing`), record that execution started. Phase 2 (no transaction): the downstream call, with
 * the stable idempotency key `aegis:<requestId>`. Phase 3 (transaction): the receipt and the final
 * status. A crash between phases leaves an `executing` request with no final receipt; the sweep and
 * the reconcile job resolve it from the downstream system's own records. Nothing is ever executed
 * twice by the gateway: a second call for a request that already has a final receipt returns it.
 */
export async function executeRequest(run: TenantRunner, ctx: OrgContext, actionRequestId: string, grantToken: string, params: Record<string, unknown>): Promise<ExecutionOutcome> {
  const prepared = await run(async (db) => {
    const req = await db.actionRequest.findUnique({ where: { id: actionRequestId }, include: { agent: true, receipts: { orderBy: { createdAt: "desc" }, take: 1 } } });
    if (!req) throw notFound("Action request");
    const latest = req.receipts[0];
    if (latest && FINAL_RECEIPTS.has(latest.status)) return { done: receiptView(latest, req.status) };
    if (req.status === "executing" || req.status === "unknown") return { reconcile: true as const };
    if (!(EXECUTABLE_STATUSES as readonly string[]).includes(req.status)) throw new AegisError("conflict", `Request is ${req.status}; only allowed or approved requests execute`);
    const paused = await gatewayPausedState(db, ctx.orgId);
    if (paused.paused) {
      await appendEvidence(db, ctx, { type: "gateway.execution_blocked", subjectType: "action_request", subjectId: req.id, correlationId: req.correlationId, payload: { reason: `gateway paused: ${paused.reason ?? "emergency control"}` } });
      throw conflict(`Gateway is paused: ${paused.reason ?? "emergency control"}. The approved action has not executed and will not until the gateway resumes.`);
    }
    const now = ctx.now ?? new Date();
    if (req.agent.status !== "active") {
      await db.actionRequest.update({ where: { id: req.id }, data: { status: "failed", completedAt: now } });
      const receipt = await db.executionReceipt.create({ data: { createdAt: now, orgId: ctx.orgId, actionRequestId: req.id, status: "skipped", downstreamSystem: "aegis-gateway", responseSummary: { error: `agent is ${req.agent.status}` } } });
      await appendEvidence(db, ctx, { type: "gateway.execution_skipped", subjectType: "action_request", subjectId: req.id, correlationId: req.correlationId, payload: { reason: `agent ${req.agent.status}` } });
      return { done: receiptView(receipt, "failed") };
    }
    const tool = req.toolId ? await db.tool.findUnique({ where: { id: req.toolId }, include: { integration: true } }) : null;
    const systemKey = tool?.integration?.key ?? "none";
    const system = getDownstreamSystem(systemKey);
    const definitiveFailure = !system || !tool?.integration ? `no downstream system registered for ${systemKey}` : tool.integration.status !== "active" ? `integration ${systemKey} is disabled` : null;
    // The grant is consumed before anything leaves the gateway; from here the request is `executing`.
    const check = await consumeGrant(db, grantToken, requestHashOf(req.toolKey, req.action, params), { now });
    if (!check.ok) {
      const result = { outcome: "failed" as const, reference: null, summary: {}, error: `execution grant rejected: ${check.reason}` };
      await db.actionRequest.update({ where: { id: req.id }, data: { status: "failed", completedAt: now, updatedAt: now } });
      const receipt = await db.executionReceipt.create({ data: { createdAt: now, orgId: ctx.orgId, actionRequestId: req.id, status: "failed", downstreamSystem: systemKey, responseSummary: { error: result.error } as Prisma.InputJsonValue, attempt: Math.max(1, req.executionAttempts + 1) } });
      await appendEvidence(db, ctx, { type: "gateway.execution_failed", subjectType: "action_request", subjectId: req.id, correlationId: req.correlationId, payload: { receiptId: receipt.id, downstreamSystem: systemKey, reference: null, error: result.error, durationMs: 0 } });
      return { done: receiptView(receipt, "failed") };
    }
    const fresh = await db.actionRequest.findUniqueOrThrow({ where: { id: req.id }, select: { executionAttempts: true, downstreamIdempotencyKey: true } });
    await appendEvidence(db, ctx, { type: "gateway.execution_started", subjectType: "action_request", subjectId: req.id, correlationId: req.correlationId, payload: { downstreamSystem: systemKey, idempotencyKey: fresh.downstreamIdempotencyKey, attempt: fresh.executionAttempts } });
    if (definitiveFailure) {
      const out = await recordOutcome(db, ctx, { id: req.id, correlationId: req.correlationId, executionAttempts: fresh.executionAttempts }, systemKey, { outcome: "failed", reference: null, summary: {}, error: definitiveFailure }, 0);
      return { done: out };
    }
    const grantRow = await db.executionGrant.findFirstOrThrow({ where: { actionRequestId: req.id, consumedAt: { not: null } }, orderBy: { consumedAt: "desc" }, select: { requestHash: true, consumedAt: true } });
    return {
      call: {
        systemKey,
        system: system!,
        integrationId: tool!.integration!.id,
        req: { id: req.id, correlationId: req.correlationId, executionAttempts: fresh.executionAttempts },
        downstream: { actionRequestId: req.id, idempotencyKey: fresh.downstreamIdempotencyKey ?? `aegis:${req.id}`, attempt: fresh.executionAttempts, toolKey: req.toolKey, action: req.action, params, correlationId: req.correlationId, agentSlug: req.agent.slug, grant: { requestHash: grantRow.requestHash, consumedAt: grantRow.consumedAt! } },
      },
    };
  });
  if ("done" in prepared && prepared.done) return prepared.done;
  if ("reconcile" in prepared || !("call" in prepared)) return reconcileExecution(run, ctx, actionRequestId);

  const { systemKey, system, integrationId, req, downstream } = prepared.call;
  const started = Date.now();
  let result: { outcome: "succeeded" | "failed" | "unknown"; reference: string | null; summary: Record<string, unknown>; error?: string };
  try {
    result = await system.execute(downstreamContext(run, ctx.orgId, integrationId), downstream);
  } catch (e) {
    // A thrown error after the call started is ambiguous by definition: record unknown, reconcile later.
    result = { outcome: "unknown", reference: null, summary: {}, error: e instanceof Error ? e.message : "execution failed" };
  }
  return run((db) => recordOutcome(db, ctx, req, systemKey, result, Date.now() - started));
}

/**
 * Resolves an `executing` or `unknown` request from the downstream system's own records (by the
 * idempotency key). Called by the reconcile job, the sweep, and the console's "reconcile now". When
 * the system cannot tell and attempts are exhausted, the request becomes `unknown` and a security
 * event asks a human to resolve it; it is never silently marked executed or failed.
 */
export async function reconcileExecution(run: TenantRunner, ctx: OrgContext, actionRequestId: string, opts: { force?: boolean } = {}): Promise<ExecutionOutcome> {
  const prepared = await run(async (db) => {
    const req = await db.actionRequest.findUnique({ where: { id: actionRequestId }, include: { agent: true, receipts: { orderBy: { createdAt: "desc" }, take: 1 }, grants: { where: { consumedAt: { not: null } }, orderBy: { consumedAt: "desc" }, take: 1 } } });
    if (!req) throw notFound("Action request");
    const latest = req.receipts[0];
    if (latest && FINAL_RECEIPTS.has(latest.status)) return { done: receiptView(latest, req.status) };
    if (req.status !== "executing" && req.status !== "unknown") throw conflict(`Request is ${req.status}; only executing or unknown requests reconcile`);
    const tool = req.toolId ? await db.tool.findUnique({ where: { id: req.toolId }, include: { integration: true } }) : null;
    const systemKey = tool?.integration?.key ?? "none";
    const system = getDownstreamSystem(systemKey);
    const grant = req.grants[0];
    const attempts = await db.executionReceipt.count({ where: { actionRequestId: req.id, status: "unknown" } });
    return { call: { systemKey, system, integrationId: tool?.integration?.id ?? null, attempts, req: { id: req.id, correlationId: req.correlationId, executionAttempts: req.executionAttempts, agentId: req.agentId, toolKey: req.toolKey }, downstream: { actionRequestId: req.id, idempotencyKey: req.downstreamIdempotencyKey ?? `aegis:${req.id}`, attempt: req.executionAttempts, toolKey: req.toolKey, action: req.action, params: req.params as Record<string, unknown>, correlationId: req.correlationId, agentSlug: req.agent.slug, grant: { requestHash: grant?.requestHash ?? "", consumedAt: grant?.consumedAt ?? new Date(0) } } } };
  });
  if ("done" in prepared && prepared.done) return prepared.done;
  if (!("call" in prepared)) throw conflict("Nothing to reconcile");
  const { systemKey, system, integrationId, attempts, req, downstream } = prepared.call;
  const started = Date.now();
  let result: { outcome: "succeeded" | "failed" | "unknown"; reference: string | null; summary: Record<string, unknown>; error?: string };
  if (!system || !integrationId) result = { outcome: "unknown", reference: null, summary: {}, error: `no downstream system registered for ${systemKey}` };
  else if (!system.reconcile) result = { outcome: "unknown", reference: null, summary: {}, error: `${systemKey} cannot look up earlier attempts` };
  else {
    try {
      result = await system.reconcile(downstreamContext(run, ctx.orgId, integrationId), downstream);
    } catch (e) {
      result = { outcome: "unknown", reference: null, summary: {}, error: e instanceof Error ? e.message : "reconciliation failed" };
    }
  }
  return run(async (db) => {
    if (result.outcome !== "unknown") return recordOutcome(db, ctx, req, systemKey, { ...result, summary: { ...result.summary, reconciled: true } }, Date.now() - started);
    const now = ctx.now ?? new Date();
    const exhausted = opts.force || attempts + 1 >= EXECUTION_MAX_RECONCILE_ATTEMPTS;
    const receipt = await db.executionReceipt.create({ data: { createdAt: now, orgId: ctx.orgId, actionRequestId: req.id, status: "unknown", downstreamSystem: systemKey, responseSummary: { reconciled: true, resolved: false, error: result.error ?? null } as Prisma.InputJsonValue, durationMs: Date.now() - started, attempt: Math.max(1, req.executionAttempts) } });
    if (!exhausted) {
      await enqueueJob({ type: "execution.reconcile", payload: { actionRequestId: req.id, orgId: ctx.orgId }, idempotencyKey: `execution.reconcile:${req.id}:${req.executionAttempts}:${attempts + 1}`, orgId: ctx.orgId, runAt: new Date(now.getTime() + EXECUTION_RECONCILE_AFTER_MS * (attempts + 2)), maxAttempts: 3 }, db);
      await appendEvidence(db, ctx, { type: "gateway.execution_outcome_unknown", subjectType: "action_request", subjectId: req.id, correlationId: req.correlationId, payload: { receiptId: receipt.id, downstreamSystem: systemKey, error: result.error ?? null, reconcileAttempt: attempts + 1 } });
      return receiptView(receipt, "executing");
    }
    await db.actionRequest.update({ where: { id: req.id }, data: { status: "unknown", updatedAt: now } });
    await db.securityEvent.create({ data: { createdAt: now, orgId: ctx.orgId, type: "execution.outcome_unknown", severity: "high", title: `Execution outcome unresolved: ${req.toolKey}`, agentId: req.agentId, actionRequestId: req.id, detail: { downstreamSystem: systemKey, idempotencyKey: downstream.idempotencyKey, error: result.error ?? null, instructions: "Check the downstream system for this idempotency key and resolve the request manually." } as Prisma.InputJsonValue } as Prisma.SecurityEventUncheckedCreateInput });
    await appendEvidence(db, ctx, { type: "gateway.execution_unresolved", subjectType: "action_request", subjectId: req.id, correlationId: req.correlationId, payload: { receiptId: receipt.id, downstreamSystem: systemKey, error: result.error ?? null, reconcileAttempts: attempts + 1 } });
    return receiptView(receipt, "unknown");
  });
}

/**
 * A human settles an unresolved outcome after checking the downstream system directly. Requires
 * gateway:control. The resolution is a receipt plus evidence naming who decided and why.
 */
export async function resolveExecutionManually(db: TenantDb, ctx: OrgContext, actionRequestId: string, input: { outcome: "succeeded" | "failed"; reference: string | null; reason: string }): Promise<ExecutionOutcome> {
  if (!ctx.actor.permissions?.includes("*") && !ctx.actor.permissions?.includes("agents:control")) throw forbidden("Missing permission agents:control");
  if (input.reason.trim().length < 5) throw new AegisError("validation", "Explain what you verified downstream");
  const req = await db.actionRequest.findUnique({ where: { id: actionRequestId }, include: { receipts: { orderBy: { createdAt: "desc" }, take: 1 } } });
  if (!req) throw notFound("Action request");
  if (req.status !== "unknown" && req.status !== "executing") throw conflict(`Request is ${req.status}; only unresolved requests can be settled manually`);
  const systemKey = req.receipts[0]?.downstreamSystem ?? "manual";
  return recordOutcome(db, ctx, { id: req.id, correlationId: req.correlationId, executionAttempts: req.executionAttempts }, systemKey, { outcome: input.outcome, reference: input.reference, summary: { manualResolution: true, resolvedBy: ctx.actor.label ?? ctx.actor.id ?? "user", reason: input.reason } }, 0);
}

/**
 * Executes an approved (or allowed) gateway-mode request whose earlier execution never started, for
 * example because the gateway was paused between approval and execution. Issues the single grant and
 * runs the normal phases. Refuses while a live grant is outstanding (an execution is in flight).
 */
export async function executeApprovedRequest(run: TenantRunner, ctx: OrgContext, actionRequestId: string): Promise<ExecutionOutcome> {
  if (!ctx.actor.permissions?.includes("*") && !ctx.actor.permissions?.includes("agents:control") && !ctx.actor.permissions?.includes("approvals:decide")) throw forbidden("Missing permission approvals:decide");
  const issued = await run(async (db) => {
    const r = await db.actionRequest.findUnique({ where: { id: actionRequestId }, include: { receipts: { take: 1 } } });
    if (!r) throw notFound("Action request");
    if (r.receipts.length > 0 || !(EXECUTABLE_STATUSES as readonly string[]).includes(r.status)) throw conflict(`Request is ${r.status}; nothing to execute`);
    const params = r.params as Record<string, unknown>;
    const g = await issueGrant(db, ctx.orgId, r.id, requestHashOf(r.toolKey, r.action, params), { now: ctx.now });
    await appendEvidence(db, ctx, { type: "gateway.execution_retried", subjectType: "action_request", subjectId: r.id, correlationId: r.correlationId, payload: { grantId: g.grant.id } });
    return { token: g.token, params };
  });
  return executeRequest(run, ctx, actionRequestId, issued.token, issued.params);
}

/** Requests stuck in `executing` beyond the reconcile window (worker crashed between phases). */
export async function sweepStuckExecutions(run: TenantRunner, ctx: OrgContext, olderThanMs = EXECUTION_RECONCILE_AFTER_MS * 2): Promise<number> {
  const stuck = await run((db) => db.actionRequest.findMany({ where: { orgId: ctx.orgId, status: "executing", updatedAt: { lt: new Date(Date.now() - olderThanMs) } }, select: { id: true }, take: 50 }));
  let n = 0;
  for (const s of stuck) {
    try {
      await reconcileExecution(run, ctx, s.id);
      n++;
    } catch (e) {
      logger.warn({ requestId: s.id, err: e instanceof Error ? e.message : String(e) }, "stuck execution reconcile failed");
    }
  }
  return n;
}

/**
 * Full gateway flow for API callers: decision in transaction 1, execution (gateway mode) in its own
 * phases afterwards. The decision is durable before anything executes.
 */
export async function authorizeAndExecute(withTenant: <T>(orgId: string, fn: (db: TenantDb) => Promise<T>) => Promise<T>, ctx: OrgContext, input: ActionRequestInput): Promise<GatewayResponse> {
  const run: TenantRunner = (fn) => withTenant(ctx.orgId, fn);
  const decision = await run((db) => submitActionRequest(db, ctx, input));
  const pending = (decision as GatewayResponse & { __pendingExecution?: { grantToken: string; params: Record<string, unknown> } }).__pendingExecution;
  delete (decision as GatewayResponse & { __pendingExecution?: unknown }).__pendingExecution;
  if (pending && input.executionMode === "gateway" && !decision.duplicate) {
    const out = await executeRequest(run, ctx, decision.requestId, pending.grantToken, pending.params);
    decision.receipt = { status: out.status, downstreamSystem: out.downstreamSystem, reference: out.reference, summary: out.summary };
    decision.status = out.requestStatus;
  }
  return decision;
}

/** Emergency control: pauses the gateway for the organization and voids every live execution grant. */
export async function pauseGateway(db: TenantDb, ctx: OrgContext, reason: string): Promise<{ voidedGrants: number }> {
  if (!ctx.actor.permissions?.includes("*") && !ctx.actor.permissions?.includes("org:admin")) throw forbidden("Missing permission org:admin");
  if (reason.trim().length < 3) throw new AegisError("validation", "A reason is required");
  const now = ctx.now ?? new Date();
  const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { settings: true } });
  const settings = { ...((org.settings ?? {}) as Record<string, unknown>), gatewayPaused: true, gatewayPausedReason: reason, gatewayPausedAt: now.toISOString(), gatewayPausedBy: ctx.actor.label ?? ctx.actor.id ?? "user" };
  await db.organization.update({ where: { id: ctx.orgId }, data: { settings: settings as Prisma.InputJsonValue } });
  const voidedGrants = await voidLiveGrants(db, ctx, `gateway paused: ${reason}`);
  await appendEvidence(db, ctx, { type: "gateway.paused", subjectType: "organization", subjectId: ctx.orgId, payload: { reason, voidedGrants } });
  return { voidedGrants };
}

export async function resumeGateway(db: TenantDb, ctx: OrgContext, reason: string): Promise<void> {
  if (!ctx.actor.permissions?.includes("*") && !ctx.actor.permissions?.includes("org:admin")) throw forbidden("Missing permission org:admin");
  const now = ctx.now ?? new Date();
  const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { settings: true } });
  const settings: Record<string, unknown> = { ...((org.settings ?? {}) as Record<string, unknown>), gatewayPaused: false, gatewayResumedAt: now.toISOString(), gatewayResumeReason: reason };
  delete settings.gatewayPausedReason;
  delete settings.gatewayPausedAt;
  delete settings.gatewayPausedBy;
  await db.organization.update({ where: { id: ctx.orgId }, data: { settings: settings as Prisma.InputJsonValue } });
  await appendEvidence(db, ctx, { type: "gateway.resumed", subjectType: "organization", subjectId: ctx.orgId, payload: { reason } });
}

/** Issues the agent-mode grant for an allowed or approved request (one live grant per request, see grants.ts). */
export async function issueGrantForRequest(db: TenantDb, ctx: OrgContext, actionRequestId: string) {
  const r = await db.actionRequest.findUnique({ where: { id: actionRequestId }, include: { agent: { select: { status: true } } } });
  if (!r || (ctx.actor.type === "agent" && r.agentId !== ctx.actor.id)) throw notFound("Action request");
  const params = r.params as Record<string, unknown>;
  const requestHash = requestHashOf(r.toolKey, r.action, params);
  const g = await issueGrant(db, ctx.orgId, r.id, requestHash, { now: ctx.now });
  await appendEvidence(db, ctx, { type: "gateway.grant_issued", subjectType: "action_request", subjectId: r.id, correlationId: r.correlationId, payload: { grantId: g.grant.id, expiresAt: g.grant.expiresAt, mode: "agent" } });
  return { grant: g.token, expiresAt: g.grant.expiresAt, requestHash, params };
}

/**
 * Agent-mode completion: the agent (which executed through its own channel after the downstream
 * system verified the grant) reports the outcome. The grant must be the consumed one for this
 * request. Idempotent: a repeated report returns the recorded receipt.
 */
export async function recordAgentExecution(db: TenantDb, ctx: OrgContext, actionRequestId: string, input: { grant: string; outcome: "succeeded" | "failed"; reference?: string | null; summary?: Record<string, unknown> }): Promise<ExecutionOutcome> {
  const req = await db.actionRequest.findUnique({ where: { id: actionRequestId }, include: { receipts: { orderBy: { createdAt: "desc" }, take: 1 } } });
  if (!req || (ctx.actor.type === "agent" && req.agentId !== ctx.actor.id)) throw notFound("Action request");
  const latest = req.receipts[0];
  if (latest && FINAL_RECEIPTS.has(latest.status)) return receiptView(latest, req.status);
  const grant = await db.executionGrant.findUnique({ where: { tokenHash: hashGrantToken(input.grant) } });
  if (!grant || grant.actionRequestId !== req.id) throw forbidden("The grant does not belong to this request");
  if (!grant.consumedAt) {
    // The downstream system never verified this grant: consume it now so nothing else can.
    const check = await consumeGrant(db, input.grant, requestHashOf(req.toolKey, req.action, req.params as Record<string, unknown>), { now: ctx.now });
    if (!check.ok) throw conflict(`Grant cannot be used: ${check.reason}`);
  } else if (req.status !== "executing") throw conflict(`Request is ${req.status}`);
  const fresh = await db.actionRequest.findUniqueOrThrow({ where: { id: req.id }, select: { executionAttempts: true } });
  const tool = req.toolId ? await db.tool.findUnique({ where: { id: req.toolId }, include: { integration: { select: { key: true } } } }) : null;
  return recordOutcome(db, ctx, { id: req.id, correlationId: req.correlationId, executionAttempts: fresh.executionAttempts }, tool?.integration?.key ?? "agent-channel", { outcome: input.outcome, reference: input.reference ?? null, summary: { reportedByAgent: true, ...(input.summary ?? {}) } }, 0);
}

export function systemContextFor(orgId: string): OrgContext {
  return makeContext(orgId, { type: "system", id: null, label: "aegis-gateway" });
}

export async function getActionRequest(db: TenantDb, ctx: OrgContext, id: string) {
  const req = await db.actionRequest.findUnique({ where: { id }, include: { agent: { select: { id: true, slug: true, name: true, status: true } }, decisions: { orderBy: { createdAt: "asc" } }, approvals: { include: { responses: { orderBy: { createdAt: "asc" } } }, orderBy: { createdAt: "asc" } }, receipts: { orderBy: { createdAt: "asc" } }, grants: { select: { id: true, expiresAt: true, consumedAt: true, voidedAt: true, voidReason: true, createdAt: true }, orderBy: { createdAt: "asc" } } } });
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
