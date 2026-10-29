import { orgSettings, primeOrgSettingsCache } from "../lib/tx-cache.js";
import { breakers } from "../lib/circuit.js";
import { m, secondsSince } from "../lib/metrics.js";
import { withSpan } from "../lib/otel.js";
import type { ActionRequest, Agent, AgentDelegation, AgentTool, Permission, Prisma, Resource, TenantDb, Tool } from "@aegis/db";
import { z } from "zod";
import { appendEvidence } from "../evidence/ledger.js";
import { makeContext, type OrgContext } from "../lib/context.js";
import { hashObject } from "../lib/crypto.js";
import { AegisError, conflict, forbidden, notFound } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { enqueueJob } from "../jobs/queue.js";
import { notifyUsers, userIdsWithPermission } from "../notify/notifications.js";
import { evaluatePolicies, type Effect, type EvaluationResult, type PolicyToEvaluate } from "../policy/evaluate.js";
import type { MoreInformationSpec, QuarantineSpec } from "../policy/schema.js";
import { policyIntegrityFailures, resolvePoliciesForAgent } from "../policy/service.js";
import { hasPermission } from "../identity/permissions.js";
import { createSecurityEvent } from "../shield/security-events.js";
import { baselineChecks, CLASS_ORDER as CLASSIFICATION_ORDER, domainMatches, type BaselineFailure } from "./baseline.js";
import { agentAttributes, buildAuthorizationInput, extractAmount, extractDestinationDomain, type AuthorizationInput } from "./input.js";
import { consumeGrant, EXECUTABLE_STATUSES, hashGrantToken, issueGrant, parseGrantToken, staleAuthorization, voidLiveGrants } from "./grants.js";
import { applyRestrictions } from "./restrictions.js";
import { applyAutonomyLevel, isAutonomyLevel, stricterAutonomy, type AutonomyLevel } from "../autonomy/levels.js";
import { applyAutomaticDowngrade, checkDenialBurst } from "../autonomy/service.js";
import { escalateForUncertainty, levelOf, readUncertaintyPolicy, type EscalationOutcome, type UncertaintyAssessment } from "../uncertainty/assess.js";
import { ambiguityIndicator, assessForRequest } from "../uncertainty/service.js";
import { assessReasoning, escalateForReasoning, readReasoningPolicy, type ReasoningAssessment, type ReasoningOutcome } from "../reasoning/assess.js";
import { precedentIndicator } from "../reasoning/service.js";
import { getShieldInspector } from "./shield-hook.js";
import { escalateForInjection, getInjectionResponse } from "../shield/injection-response.js";
import { escalateForModel, getModelGovernance, modelGateCheck } from "../governance/models.js";
import { activeExceptionRules } from "../policy/exceptions.js";
import { readIntegrationCredential, resolveDownstreamSystem, type DownstreamContext } from "./simulators.js";
import { readWatchOnly } from "../pilots/watch-only.js";
import { activeFreezeFor, freezeMessage, readFreezes, twoPersonRecovery, type ChangeFreeze } from "./freeze.js";
import { checkPaymentDocument, readDocumentMatch, reservePaymentDocument, type DocumentMatch, type MatchResult } from "../payments/matching.js";
import { checkClaimForPayment, readClaimRule, reserveClaim, type ClaimCheck } from "../payments/receipts.js";

export const actionRequestInputSchema = z.object({
  tool: z.string().min(1).max(80),
  action: z.string().min(1).max(80).default("execute"),
  params: z.record(z.string(), z.unknown()).default({}),
  resource: z.string().max(80).optional(),
  idempotencyKey: z.string().min(8).max(200),
  correlationId: z.string().max(120).optional(),
  justification: z.string().max(2000).default(""),
  principal: z.object({ type: z.enum(["user", "customer", "system", "none"]).default("none"), ref: z.string().max(200).optional(), userId: z.string().uuid().optional() }).default({ type: "none" }),
  context: z.record(z.string(), z.unknown()).default({}),
  /** "gateway": AEGIS executes through the integration. "agent": AEGIS returns a grant for the agent to present downstream. */
  executionMode: z.enum(["gateway", "agent"]).default("gateway"),
  /** Act on behalf of another agent under an active delegation. The delegate never gains more than its delegator holds. */
  onBehalfOf: z.object({ agentId: z.string().uuid(), delegationId: z.string().uuid().optional() }).optional(),
});
export type ActionRequestInput = z.infer<typeof actionRequestInputSchema>;

export interface GatewayResponse {
  requestId: string;
  status: ActionRequest["status"];
  decision: Effect | "error";
  reasons: string[];
  riskIndicators: string[];
  policyVersionIds: string[];
  matchedRuleIds: string[];
  approval?: { approvalRequestId: string; expiresAt: string; requiredApprovals: number; requiredRoles: string[] };
  grant?: { token: string; expiresAt: string };
  receipt?: { status: string; downstreamSystem: string; reference: string | null; summary: Record<string, unknown> };
  /** On a restrict decision: what policy narrowed and the parameters that will execute (the grant binds these). */
  restrictions?: { applied: string[]; params: Record<string, unknown>; note: string };
  /** On request_more_information: resubmit with the same idempotency key and these fields present. */
  moreInformation?: { fields: string[]; message: string; expiresAt: string };
  /** On quarantine: held until a security reviewer releases or refuses it. */
  quarantine?: { securityEventId: string | null; expiresAt: string };
  delegation?: { delegationId: string; onBehalfOf: string };
  duplicate?: boolean;
  /** Watch-only pilot mode: the action proceeded, and this is what AEGIS would otherwise have decided. */
  watchOnly?: { wouldHave: string };
  correlationId: string;
}

const DEFAULT_MORE_INFORMATION: MoreInformationSpec = { fields: [], message: "", expiresInMinutes: 24 * 60 };
const DEFAULT_QUARANTINE: QuarantineSpec = { severity: "high", reviewRoles: [], expiresInMinutes: 24 * 60, note: "" };
type Severity = "low" | "medium" | "high" | "critical";

interface DelegationContext {
  row: AgentDelegation;
  delegator: Agent & { tools: (AgentTool & { tool: Tool })[]; permissions: Permission[] };
}

/** Finds the active delegation the request claims. A missing, revoked, expired or inactive delegation is a structural failure (deny). */
async function resolveDelegation(db: TenantDb, orgId: string, delegateAgentId: string, ref: { agentId: string; delegationId?: string }, now: Date): Promise<{ delegation: DelegationContext } | { failure: BaselineFailure }> {
  const row = await db.agentDelegation.findFirst({ where: { orgId, delegateAgentId, delegatorAgentId: ref.agentId, ...(ref.delegationId ? { id: ref.delegationId } : {}), revokedAt: null, expiresAt: { gt: now } }, orderBy: { createdAt: "desc" } });
  if (!row) return { failure: { code: "delegation_invalid", message: "No active delegation from that agent to this agent" } };
  const delegator = await db.agent.findUnique({ where: { id: row.delegatorAgentId }, include: { tools: { include: { tool: true } }, permissions: true } });
  if (!delegator) return { failure: { code: "delegation_invalid", message: "Delegating agent not found" } };
  if (delegator.status !== "active") return { failure: { code: "delegation_invalid", message: `Delegating agent is ${delegator.status}` } };
  return { delegation: { row, delegator } };
}

/** The delegate never gains more than the intersection of its own grants, the delegator's grants and the delegation's scope. */
function delegationChecks(d: DelegationContext, tool: Tool | null, resource: Resource | null, action: string, params: Record<string, unknown>, destinationDomain: string | null, now: Date): BaselineFailure[] {
  const failures: BaselineFailure[] = [];
  if (tool) {
    if (d.row.toolKeys.length && !d.row.toolKeys.includes(tool.key)) failures.push({ code: "delegation_not_permitted", message: `Delegation does not cover tool ${tool.key}` });
    const g = d.delegator.tools.find((t) => t.toolId === tool.id);
    if (!g || !g.enabled || g.revokedAt || (g.expiresAt && g.expiresAt <= now)) failures.push({ code: "delegation_not_permitted", message: `Delegating agent ${d.delegator.slug} has no active grant for tool ${tool.key}; a delegate never gains more than its delegator holds` });
  }
  if (resource) {
    const p = d.delegator.permissions.find((x) => x.resourceId === resource.id && !x.revokedAt && (!x.expiresAt || x.expiresAt > now));
    if (!p) failures.push({ code: "delegation_not_permitted", message: `Delegating agent ${d.delegator.slug} has no permission on resource ${resource.key}` });
    else if (!p.actions.includes(action) && !p.actions.includes("*")) failures.push({ code: "delegation_not_permitted", message: `Delegating agent ${d.delegator.slug} may not ${action} on ${resource.key}` });
  }
  // The delegating agent's own boundaries bind the delegate too: its authority must not have lapsed, and its
  // destination allow-list and data classification limit apply exactly as if it made the call itself.
  if (d.delegator.credentialExpiresAt && d.delegator.credentialExpiresAt <= now) failures.push({ code: "delegation_invalid", message: `Delegating agent ${d.delegator.slug}'s authority lapsed on ${d.delegator.credentialExpiresAt.toISOString().slice(0, 10)}; it must be re-certified` });
  if (d.delegator.allowedDestinations?.length && destinationDomain && !d.delegator.allowedDestinations.some((x) => domainMatches(destinationDomain, x))) failures.push({ code: "destination_not_allowed", message: `Destination ${destinationDomain} is outside the delegating agent's allowed destinations` });
  if (resource) {
    const rc = CLASSIFICATION_ORDER.indexOf(resource.classification);
    const lim = CLASSIFICATION_ORDER.indexOf(d.delegator.dataClassificationLimit);
    if (rc < 0 || lim < 0 || rc > lim) failures.push({ code: "classification_exceeded", message: `Resource ${resource.key} is ${resource.classification}; the delegating agent is limited to ${d.delegator.dataClassificationLimit}` });
  }
  const constraints = (d.row.constraints ?? {}) as { maxAmount?: number };
  const { amount } = extractAmount(params);
  if (typeof constraints.maxAmount === "number" && amount !== null && amount > constraints.maxAmount) failures.push({ code: "delegation_limit_exceeded", message: `Amount ${amount} exceeds the delegation limit of ${constraints.maxAmount}` });
  return failures;
}

export function requestHashOf(toolKey: string, action: string, params: Record<string, unknown>): string {
  return hashObject({ toolKey, action, params });
}

/** Reads through the transaction client: never touch the shared pool from inside a tenant transaction (pool exhaustion under load). */
/** The organization's pause state and change freezes, read in one query for the decision. */
export async function gatewayOrgState(db: TenantDb, orgId: string): Promise<{ paused: { paused: boolean; reason?: string }; freezes: ChangeFreeze[] }> {
  const settings = await orgSettings(db, orgId);
  const s = (settings ?? {}) as { gatewayPaused?: boolean; gatewayPausedReason?: string };
  return { paused: { paused: !!s.gatewayPaused, reason: s.gatewayPausedReason }, freezes: readFreezes(settings) };
}

export async function gatewayPausedState(db: TenantDb, orgId: string): Promise<{ paused: boolean; reason?: string }> {
  const org = { settings: await orgSettings(db, orgId) };
  const s = (org?.settings ?? {}) as { gatewayPaused?: boolean; gatewayPausedReason?: string };
  return { paused: !!s.gatewayPaused, reason: s.gatewayPausedReason };
}

/**
 * Entry point for every protected action. Runs inside one tenant transaction up to the decision,
 * so a failure anywhere (including evidence) leaves no partial state. Execution happens after the
 * decision commits so a crash cannot execute without a recorded decision.
 */
/** Decides one action request (docs/UNIVERSAL_GATEWAY.md), measured and traced. */
export async function submitActionRequest(db: TenantDb, ctx: OrgContext, input: ActionRequestInput): Promise<GatewayResponse> {
  const start = process.hrtime.bigint();
  m.gatewayInFlight.add(1);
  try {
    const r = await withSpan("gateway.decide", { "aegis.tool": input.tool }, () => decideActionRequest(db, ctx, input));
    m.gatewayDecisions.inc({ result: r.duplicate ? "duplicate" : r.decision });
    m.gatewayDecisionSeconds.observe(secondsSince(start), { result: r.duplicate ? "duplicate" : r.decision });
    return r;
  } catch (e) {
    m.gatewayDecisions.inc({ result: "failed" });
    throw e;
  } finally {
    m.gatewayInFlight.add(-1);
  }
}

async function decideActionRequest(db: TenantDb, ctx: OrgContext, input: ActionRequestInput): Promise<GatewayResponse> {
  if (ctx.actor.type !== "agent" || !ctx.actor.id) throw forbidden("Only agents submit action requests");
  primeOrgSettingsCache(db);
  const agentId = ctx.actor.id;
  const correlationId = input.correlationId ?? ctx.requestId;
  const paramsHash = requestHashOf(input.tool, input.action, input.params);
  const now = ctx.now ?? new Date();

  // Narrow locks (docs/PERFORMANCE.md), always taken in this order: idempotency key, agent, then (in
  // buildAuthorizationInput) the business reference. With the default lock mode the organization lock
  // already serializes these decisions; in "deferred" mode these locks are what keep the idempotency check,
  // the agent's counters and concurrency limit, and the duplicate-reference check exact.
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${ctx.orgId}:idem:${input.idempotencyKey}`}, 7302))`;
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${agentId}, 7301))`;

  // Idempotency: same key returns the recorded outcome; same key with different parameters is rejected,
  // except that a request waiting for more information accepts the agent's resubmission under the same key.
  const existing = await db.actionRequest.findUnique({ where: { orgId_idempotencyKey: { orgId: ctx.orgId, idempotencyKey: input.idempotencyKey } }, include: { decisions: { orderBy: { createdAt: "desc" }, take: 1 }, approvals: { orderBy: { createdAt: "desc" }, take: 1 }, receipts: { orderBy: { createdAt: "desc" }, take: 1 } } });
  let resubmission: NonNullable<typeof existing> | null = null;
  if (existing) {
    if (existing.status === "awaiting_information" && existing.agentId === agentId) {
      resubmission = existing;
    } else if (existing.paramsHash !== paramsHash || existing.agentId !== agentId) {
      await appendEvidence(db, ctx, { type: "gateway.idempotency_conflict", subjectType: "action_request", subjectId: existing.id, correlationId, payload: { idempotencyKey: input.idempotencyKey, sameAgent: existing.agentId === agentId } });
      throw conflict("Idempotency key was already used with different parameters or by a different agent");
    } else {
      await appendEvidence(db, ctx, { type: "gateway.duplicate_request", subjectType: "action_request", subjectId: existing.id, correlationId, payload: { idempotencyKey: input.idempotencyKey, status: existing.status } });
      return toResponse(existing, existing.decisions[0] ?? null, existing.approvals[0] ?? null, existing.receipts[0] ?? null, true);
    }
  }

  const agent = await db.agent.findUnique({ where: { id: agentId }, include: { tools: { include: { tool: true } }, permissions: true } });
  if (!agent) throw notFound("Agent");
  const tool = await db.tool.findUnique({ where: { orgId_key: { orgId: ctx.orgId, key: input.tool } }, include: { integration: { omit: { settings: true, enforcementSummary: true } } } });
  const resource = input.resource ? await db.resource.findUnique({ where: { orgId_key: { orgId: ctx.orgId, key: input.resource } } }) : null;

  let delegation: DelegationContext | null = null;
  let delegationFailure: BaselineFailure | null = null;
  if (input.onBehalfOf) {
    const resolved = await resolveDelegation(db, ctx.orgId, agentId, input.onBehalfOf, now);
    if ("failure" in resolved) delegationFailure = resolved.failure;
    else delegation = resolved.delegation;
  }

  const started = Date.now();
  const requestData = {
    toolId: tool?.id ?? null,
    toolKey: input.tool,
    action: input.action,
    resourceKey: input.resource ?? null,
    params: input.params as Prisma.InputJsonValue,
    paramsHash,
    correlationId,
    traceId: ctx.traceId ?? null,
    principalUserId: input.principal.userId ?? null,
    principalRef: input.principal.ref ?? null,
    environment: agent.environment,
    justification: input.justification,
    context: { ...input.context, executionMode: input.executionMode, ip: ctx.ip ?? null } as Prisma.InputJsonValue,
    delegationId: delegation?.row.id ?? null,
    onBehalfOfAgentId: input.onBehalfOf?.agentId ?? null,
  };
  const request = resubmission
    ? await db.actionRequest.update({ where: { id: resubmission.id }, data: { ...requestData, status: "evaluating", expiresAt: null, completedAt: null, updatedAt: now } })
    : await db.actionRequest.create({ data: { createdAt: now, updatedAt: now, orgId: ctx.orgId, agentId, idempotencyKey: input.idempotencyKey, ...requestData } });
  await appendEvidence(db, ctx, { type: resubmission ? "gateway.information_provided" : "gateway.request_received", subjectType: "action_request", subjectId: request.id, correlationId, payload: { tool: input.tool, action: input.action, resource: input.resource ?? null, paramsHash, agent: agent.slug, onBehalfOf: delegation?.delegator.slug ?? input.onBehalfOf?.agentId ?? null, delegationId: delegation?.row.id ?? null } });

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
  let restrictApplied: string[] = [];
  let securitySeverity: Severity | null = null;
  let securityType: string | null = null;
  let autonomyRecord: { level: number; ceiling: number | null; policyOutcome: string; effect: string; code: string | null } | null = null;
  let uncertainty: UncertaintyAssessment | null = null;
  let uncertaintyEscalated = false;
  let reasoning: ReasoningAssessment | null = null;
  let reasoningEscalated = false;
  let injectionEscalated: { response: string; signals: string[] } | null = null;
  let exceptionIds: string[] = [];
  let modelRecordState: { status: string; enforcement: string; escalated: boolean; model: string | null } | null = null;
  /** What the policies alone decided, before data protection, uncertainty and autonomy (used by replay). */
  let policyOnlyResult: string | null = null;
  /** Parameters before policy narrowing, so watch-only mode can let the original request through. */
  let paramsBeforeRestrict: Record<string, unknown> | null = null;
  /** A change freeze in force for this request (freeze.ts); a hold it causes is never relaxed by watch-only mode. */
  let freeze: ChangeFreeze | null = null;
  let freezeHeld = false;
  /** Payment document matching (payments/matching.ts): the tool's rule and the match for this request. */
  let docRule: DocumentMatch | null = null;
  let docMatch: MatchResult | null = null;
  let docHeld = false;
  /** Expense claim validation (payments/receipts.ts): the claim check for a reimbursement tool. */
  let claimCheck: ClaimCheck | null = null;

  try {
    const destinationDomain = extractDestinationDomain(input.params);
    const { paused, freezes } = await gatewayOrgState(db, ctx.orgId);
    freeze = tool ? activeFreezeFor(freezes, { now, toolKey: tool.key, toolRisk: tool.riskLevel, agentId }) : null;
    const baseline = baselineChecks({ agent, tool, action: input.action, resource, resourceKeyRequested: input.resource ?? null, params: input.params, destinationDomain, gatewayPaused: paused, freeze, now });
    const failures: BaselineFailure[] = [...baseline.failures, ...(delegationFailure ? [delegationFailure] : []), ...(delegation ? delegationChecks(delegation, tool, resource, input.action, input.params, destinationDomain, now) : [])];
    const claimRule = tool ? readClaimRule(tool.destinationRules) : null;
    if (claimRule) {
      claimCheck = await checkClaimForPayment(db, ctx.orgId, claimRule, input.params, request.id);
      if (claimCheck.outcome === "deny") failures.push({ code: "expense_claim_mismatch", message: claimCheck.message });
    }
    docRule = tool ? readDocumentMatch(tool.destinationRules) : null;
    if (docRule) {
      docMatch = await checkPaymentDocument(db, ctx.orgId, docRule, input.params, request.id);
      if (!docMatch.ok && docRule.effect === "deny") failures.push({ code: "payment_document_mismatch", message: docMatch.message, details: { code: docMatch.code } });
    }
    // Policy tampering: a stored policy that no longer matches its recorded hash is never evaluated.
    const ownPolicies = await resolvePoliciesForAgent(db, ctx.orgId, agent);
    const delegatorPolicies = delegation ? await resolvePoliciesForAgent(db, ctx.orgId, delegation.delegator) : [];
    const tampered = policyIntegrityFailures([...ownPolicies, ...delegatorPolicies]);
    if (tampered.length) failures.push({ code: "policy_integrity", message: `Policy ${tampered.map((t) => t.policyKey).join(", ")} does not match its recorded hash: it was changed outside AEGIS, so the request is refused`, details: tampered });
    // Concurrent action limit (agent.metadata.maxConcurrentActions): actions in flight are live, unconsumed
    // grants plus executions under way. A per-agent advisory lock, held until this transaction commits,
    // makes simultaneous requests count one after another, so they cannot all slip under the limit.
    const maxConcurrent = readConcurrencyLimit(agent.metadata);
    if (maxConcurrent !== null) {
      // The per-agent lock taken at the start of the decision is held until commit.
      const [liveGrants, executing] = await Promise.all([
        db.executionGrant.count({ where: { orgId: ctx.orgId, consumedAt: null, voidedAt: null, expiresAt: { gt: now }, request: { agentId } } }),
        db.actionRequest.count({ where: { orgId: ctx.orgId, agentId, status: "executing" } }),
      ]);
      if (liveGrants + executing >= maxConcurrent) failures.push({ code: "concurrency_limit", message: `The agent already has ${liveGrants + executing} action(s) in flight, its limit is ${maxConcurrent}; wait for one to finish`, details: { inFlight: liveGrants + executing, limit: maxConcurrent } });
    }

    const shield = await getShieldInspector()(db, ctx.orgId, { params: input.params, toolKey: input.tool, destinationDomain, agentId });
    effectiveParams = shield.params;

    if (failures.length > 0 || !tool) {
      decisionResult = "deny";
      reasons = failures.map((f) => f.message);
      explanation = { stage: "baseline", failures, shield: shield.findings };
      if (failures.some((f) => f.code === "policy_integrity")) {
        securitySeverity = "critical";
        securityType = "policy.integrity_failure";
      } else if (failures.some((f) => f.code.startsWith("delegation_"))) {
        securitySeverity = "high";
        securityType = "authorization.delegation_refused";
      } else if (failures.some((f) => f.code === "destination_not_allowed" || f.code === "classification_exceeded" || f.code === "tool_not_granted")) {
        securitySeverity = "high";
        securityType = failures.find((f) => f.code === "destination_not_allowed") ? "egress.blocked" : "authorization.boundary_violation";
      }
    } else if (shield.blockReason) {
      decisionResult = "deny";
      reasons = [shield.blockReason];
      explanation = { stage: "shield", shield: shield.findings, injectionSignals: shield.shield.injectionSignals };
      securitySeverity = (shield.shield.highestSeverity as Severity | null) ?? "high";
      securityType = "data_protection.blocked";
    } else {
      // Uncertainty (Phase 4): assessed from what the request carries before policies run, so policies can refer to it.
      uncertainty = await assessForRequest(db, { agent, tool, params: input.params, supplied: (input.context ?? {}) as Record<string, unknown>, now });
      const uncertaintyPolicy = readUncertaintyPolicy(tool.uncertaintyPolicy);
      authzInput = await buildAuthorizationInput(db, {
        currentRequestId: request.id,
        agent,
        tool,
        action: input.action,
        resource: resource ? { ...resource, permittedActions: baseline.permittedActions } : null,
        params: input.params,
        principal: { type: input.principal.type, userId: input.principal.userId ?? null, ref: input.principal.ref ?? null },
        ip: ctx.ip ?? null,
        supplied: input.context,
        shield: shield.shield,
        delegation: delegation ? { id: delegation.row.id, delegatorAgentId: delegation.delegator.id, delegatorSlug: delegation.delegator.slug, toolKeys: delegation.row.toolKeys, constraints: (delegation.row.constraints ?? {}) as Record<string, unknown> } : null,
        uncertainty: { level: uncertainty.level, missing: uncertainty.missing, contradictions: uncertainty.contradictions, confidence: uncertainty.confidence?.calibratedAccuracy ?? uncertainty.confidence?.value ?? null, confidenceBasis: uncertainty.confidence?.basis ?? null },
        now,
      });
      // Under a delegation both agents' policies apply, strictest outcome wins. The delegating agent's policies are
      // judged on its own attributes (risk tier, team, owners), since it is that agent's authority being used.
      const delegatorInput = delegation ? { ...authzInput, agent: agentAttributes(delegation.delegator) } : null;
      const asDelegator = new Set<PolicyToEvaluate>(delegation ? delegatorPolicies.map((p) => ({ ...p })) : []);
      const policies = delegation ? [...ownPolicies, ...asDelegator].sort((x, y) => x.policyKey.localeCompare(y.policyKey)) : ownPolicies;
      // Approved, unexpired exceptions skip their rule for this agent; never under a delegation.
      const exceptions = delegation ? { keys: new Set<string>(), ids: [] as string[] } : await activeExceptionRules(db, agent.id, input.tool, now);
      exceptionIds = exceptions.ids;
      const evalStart = process.hrtime.bigint();
      evaluation = evaluatePolicies(policies, authzInput, { skipRules: exceptions.keys, inputFor: (p) => (asDelegator.has(p) ? delegatorInput : undefined) });
      m.policyEvaluationSeconds.observe(secondsSince(evalStart));
      decisionResult = evaluation.result;
      policyOnlyResult = evaluation.result;
      if (decisionResult === "restrict") {
        paramsBeforeRestrict = effectiveParams;
        const narrowed = applyRestrictions(effectiveParams, evaluation.restrict);
        effectiveParams = narrowed.params;
        restrictApplied = narrowed.applied;
      }
      if (shield.requireApproval && (decisionResult === "allow" || decisionResult === "restrict")) {
        decisionResult = "require_approval";
        evaluation = { ...evaluation, result: "require_approval", approval: { roles: [], minApprovers: 1, expiresInMinutes: 240, separationOfDuties: true, escalateToRoles: [], instructions: "Sensitive data detected in parameters" }, reasons: [...evaluation.reasons, "Sensitive data detected; approval required by data protection settings"] };
      }
      // Rules that matched with different effects make the outcome rest on precedence (a heuristic signal).
      const ambiguity = ambiguityIndicator(evaluation.matchedRules.map((m) => ({ effect: m.effect, ruleId: m.ruleId, policyKey: m.policyKey })));
      if (ambiguity) uncertainty = { ...uncertainty, indicators: [...uncertainty.indicators, ambiguity], level: levelOf([...uncertainty.indicators, ambiguity]) };
      // Uncertainty can only make an allowed action stricter: contradictions always go to a person, other high or
      // unknown results follow the tool's requirements when they are on. Unknown is never treated as safe.
      const escalation = escalateForUncertainty(decisionResult as EscalationOutcome, uncertainty, uncertaintyPolicy);
      if (escalation.outcome !== decisionResult) {
        uncertaintyEscalated = true;
        const why = escalation.reason ?? "Uncertainty requires a stricter outcome";
        if (escalation.outcome === "require_approval") {
          decisionResult = "require_approval";
          evaluation = { ...evaluation, result: "require_approval", approval: { roles: [], minApprovers: 1, expiresInMinutes: 240, separationOfDuties: true, escalateToRoles: [], instructions: why }, reasons: [...evaluation.reasons, why] };
        } else if (escalation.outcome === "request_more_information") {
          decisionResult = "request_more_information";
          evaluation = { ...evaluation, result: "request_more_information", moreInformation: { fields: escalation.fields.slice(0, 20).map((f) => f.slice(0, 80)), message: why.slice(0, 500), expiresInMinutes: 60 }, reasons: [...evaluation.reasons, why] };
        } else {
          decisionResult = "deny";
          evaluation = { ...evaluation, result: "deny", reasons: [...evaluation.reasons, why] };
        }
      }
      // Reasoning governance (Phase 5): the agent's own stated reasons, if it gave any, are checked against what it
      // asked for, the evidence it cited and the policies that applied. Observable artifacts only; never model internals.
      const reasoningPolicy = readReasoningPolicy(tool.reasoningPolicy);
      const precedent = await precedentIndicator(db, { requestId: request.id, toolKey: input.tool, amount: authzInput.context.amount, policyVersionIds: [...new Set(evaluation.trace.map((t) => t.policyVersionId))], policyResult: policyOnlyResult ?? decisionResult, now });
      reasoning = assessReasoning({
        tool: input.tool,
        action: input.action,
        params: input.params,
        supplied: (input.context ?? {}) as Record<string, unknown>,
        policy: reasoningPolicy,
        evaluated: policies.map((p) => ({ policyKey: p.policyKey, matched: evaluation!.matchedRules.some((m) => m.policyKey === p.policyKey) })),
        extra: precedent ? [precedent] : [],
      });
      const reasoningEscalation = escalateForReasoning(decisionResult as ReasoningOutcome, reasoning, reasoningPolicy);
      if (reasoningEscalation.outcome !== decisionResult) {
        reasoningEscalated = true;
        const why = reasoningEscalation.reason ?? "The stated reasons require a stricter outcome";
        if (reasoningEscalation.outcome === "require_approval") {
          decisionResult = "require_approval";
          evaluation = { ...evaluation, result: "require_approval", approval: { roles: [], minApprovers: 1, expiresInMinutes: 240, separationOfDuties: true, escalateToRoles: [], instructions: why.slice(0, 500) }, reasons: [...evaluation.reasons, why] };
        } else if (reasoningEscalation.outcome === "request_more_information") {
          decisionResult = "request_more_information";
          evaluation = { ...evaluation, result: "request_more_information", moreInformation: { fields: reasoningEscalation.fields, message: why.slice(0, 500), expiresInMinutes: 60 }, reasons: [...evaluation.reasons, why] };
        } else {
          decisionResult = "deny";
          evaluation = { ...evaluation, result: "deny", reasons: [...evaluation.reasons, why] };
        }
      }
      // Injection response (Phase 6): an organization setting turns Shield's heuristic injection signals into a
      // stricter outcome. Monotonic; off by default, when the signals only inform policies.
      const injectionSetting = await getInjectionResponse(db, ctx.orgId);
      const injection = escalateForInjection(decisionResult, injectionSetting, shield.shield.injectionSignals);
      if (injection.escalated) {
        const why = `Possible prompt injection in the parameters (heuristic signals: ${injection.triggering.join(", ")})`;
        injectionEscalated = { response: injectionSetting.response, signals: injection.triggering };
        if (injection.outcome === "require_approval") {
          decisionResult = "require_approval";
          evaluation = { ...evaluation, result: "require_approval", approval: { roles: [], minApprovers: 1, expiresInMinutes: 240, separationOfDuties: true, escalateToRoles: [], instructions: why }, reasons: [...evaluation.reasons, why] };
        } else if (injection.outcome === "quarantine") {
          decisionResult = "quarantine";
          evaluation = { ...evaluation, result: "quarantine", quarantine: { severity: "high", reviewRoles: [], expiresInMinutes: 24 * 60, note: why }, reasons: [...evaluation.reasons, why] };
        } else {
          decisionResult = "deny";
          evaluation = { ...evaluation, result: "deny", reasons: [...evaluation.reasons, why] };
        }
      }
      // Model governance (Phase 7): when the organization enforces it, an agent whose model is unregistered,
      // not approved or retired goes to a person or is refused. Monotonic; off by default.
      const modelSetting = await getModelGovernance(db, ctx.orgId);
      const modelRecord = agent.modelRecordId ? await db.aiModel.findUnique({ where: { id: agent.modelRecordId }, select: { key: true, stage: true, reviewDueAt: true } }) : null;
      const modelCheck = modelGateCheck(modelRecord, now);
      const modelEscalation = escalateForModel(decisionResult, modelCheck, modelSetting);
      modelRecordState = { status: modelCheck.status, enforcement: modelSetting.enforcement, escalated: modelEscalation.escalated, model: modelRecord?.key ?? null };
      if (modelEscalation.escalated) {
        const why = `Model governance: ${modelCheck.reason}`;
        if (modelEscalation.outcome === "require_approval") {
          decisionResult = "require_approval";
          evaluation = { ...evaluation, result: "require_approval", approval: { roles: [], minApprovers: 1, expiresInMinutes: 240, separationOfDuties: true, escalateToRoles: [], instructions: why }, reasons: [...evaluation.reasons, why] };
        } else {
          decisionResult = "deny";
          evaluation = { ...evaluation, result: "deny", reasons: [...evaluation.reasons, why] };
        }
      }
      // Change freeze with an approval path: changes in the window go to a person as emergency changes.
      if (freeze?.effect === "require_approval" && (decisionResult === "allow" || decisionResult === "restrict")) {
        freezeHeld = true;
        const why = `${freezeMessage(freeze)}. Changes during the freeze need a person's approval.`;
        decisionResult = "require_approval";
        evaluation = { ...evaluation, result: "require_approval", approval: { roles: [], minApprovers: 1, expiresInMinutes: 240, separationOfDuties: true, escalateToRoles: [], instructions: why.slice(0, 500) }, reasons: [...evaluation.reasons, why] };
      }
      // Payment document matching with an approval path: a mismatch goes to a person to check.
      if (docMatch && !docMatch.ok && docRule?.effect === "require_approval" && (decisionResult === "allow" || decisionResult === "restrict")) {
        docHeld = true;
        const why = `${docMatch.message}. A person must check the payment against the records.`;
        decisionResult = "require_approval";
        evaluation = { ...evaluation, result: "require_approval", approval: { roles: [], minApprovers: 1, expiresInMinutes: 240, separationOfDuties: true, escalateToRoles: [], instructions: why.slice(0, 500) }, reasons: [...evaluation.reasons, why] };
      }
      // Expense claims that need a person, or have nothing authoritative to verify against, are held.
      if (claimCheck?.outcome === "require_approval" && (decisionResult === "allow" || decisionResult === "restrict")) {
        docHeld = true;
        decisionResult = "require_approval";
        evaluation = { ...evaluation, result: "require_approval", approval: { roles: [], minApprovers: 1, expiresInMinutes: 24 * 60, separationOfDuties: true, escalateToRoles: [], instructions: claimCheck.message.slice(0, 500) }, reasons: [...evaluation.reasons, claimCheck.message] };
      }
      // Managed autonomy (Phase 3): the agent's level is applied after policy and data protection and can only
      // make the outcome stricter. Under a delegation the stricter of the two agents' settings applies.
      const policyOutcome = decisionResult;
      const own = { level: autonomyLevelOf(agent.autonomyLevel), ceiling: agent.autonomyCeilingAmount === null ? null : Number(agent.autonomyCeilingAmount) };
      const autonomySetting = delegation ? stricterAutonomy(own, { level: autonomyLevelOf(delegation.delegator.autonomyLevel), ceiling: delegation.delegator.autonomyCeilingAmount === null ? null : Number(delegation.delegator.autonomyCeilingAmount) }) : own;
      const orgCurrency = await organizationCurrency(db, ctx.orgId);
      const autonomy = applyAutonomyLevel({
        level: autonomySetting.level,
        policyOutcome,
        toolRisk: tool.riskLevel,
        amount: authzInput.context.amount,
        ceiling: autonomySetting.ceiling,
        currencyMismatch: !!authzInput.context.currency && authzInput.context.currency !== orgCurrency,
      });
      if (autonomy.effect === "observe_only") {
        decisionResult = "deny";
        evaluation = { ...evaluation, result: "deny", reasons: [...evaluation.reasons, autonomy.reason ?? "Autonomy level 0: observe only"] };
      } else if (autonomy.effect === "approval_required") {
        decisionResult = "require_approval";
        evaluation = { ...evaluation, result: "require_approval", approval: { roles: [], minApprovers: 1, expiresInMinutes: 240, separationOfDuties: true, escalateToRoles: [], instructions: autonomy.reason ?? "" }, reasons: [...evaluation.reasons, autonomy.reason ?? "Autonomy level requires approval"] };
      }
      autonomyRecord = { level: autonomySetting.level, ceiling: autonomySetting.ceiling, policyOutcome, effect: autonomy.effect, code: autonomy.code };
      reasons = evaluation.reasons;
      riskIndicators = [...evaluation.riskIndicators, ...(modelRecordState && modelRecordState.status !== "ok" && modelRecordState.status !== "unregistered" ? [`model:${modelRecordState.status}`] : []), ...(autonomy.effect !== "unchanged" ? [`autonomy:level-${autonomySetting.level}`] : []), ...shield.findings.map((f) => `data:${f.dataClass}`), ...(restrictApplied.length ? ["restricted"] : []), ...(delegation ? ["delegated"] : [])];
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
        restrictions: restrictApplied,
        restrictNote: evaluation.restrict.map((r) => r.note).filter(Boolean).join(" "),
        moreInformation: evaluation.moreInformation,
        quarantine: evaluation.quarantine,
        delegation: delegation ? { id: delegation.row.id, onBehalfOf: delegation.delegator.slug, policiesFromDelegator: policies.length - ownPolicies.length } : null,
        policyResult: policyOnlyResult,
        autonomy: autonomyRecord,
        uncertainty: { ...uncertainty, escalated: uncertaintyEscalated },
        reasoning: reasoning ? { ...reasoning, escalated: reasoningEscalated } : null,
        injection: { signals: shield.shield.injectionSignals, escalated: injectionEscalated },
        model: modelRecordState,
        exceptions: exceptionIds,
        exceptedRules: evaluation.trace.filter((t) => t.excepted).map((t) => `${t.policyKey}/${t.ruleId}`),
        inputSummary: { amount: authzInput.context.amount, currency: authzInput.context.currency, destinationDomain: authzInput.context.destinationDomain, resource: authzInput.resource?.key ?? null, requestCount24h: authzInput.context.requestCount24h, deniedCount24h: authzInput.context.deniedCount24h, hour: authzInput.context.hour, priorRequestsSameReference: authzInput.context.priorRequestsSameReference, duplicateReferenceKey: authzInput.context.duplicateReferenceKey },
      };
      if (decisionResult === "deny" && evaluation.securityEventSeverity) {
        securitySeverity = evaluation.securityEventSeverity;
        securityType = "policy.violation";
      }
      if (decisionResult === "quarantine") {
        securitySeverity = evaluation.quarantine?.severity ?? "high";
        securityType = "policy.quarantine";
      }
      if (injectionEscalated && (decisionResult === "deny" || decisionResult === "quarantine")) {
        securitySeverity = "high";
        securityType = "injection.detected";
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

  // Watch-only pilot mode (src/pilots/watch-only.ts): a policy-stage outcome other than allow is recorded as what
  // AEGIS would have done, and the action proceeds unchanged. Baseline, data protection and error refusals are
  // never relaxed, and the decision row keeps the real outcome.
  // An operator's autonomy level 0 (observe only) is a deliberate stop and is not relaxed either.
  let watchOnly = readWatchOnly(agent.metadata) && !agent.isLab && explanation.stage === "policy" && !freezeHeld && !docHeld && autonomyRecord?.effect !== "observe_only" && decisionResult !== "allow" && decisionResult !== "error" ? { wouldHave: decisionResult } : null;
  if (watchOnly) {
    explanation = { ...explanation, watchOnly };
    riskIndicators = [...riskIndicators, `watch_only:${decisionResult}`];
    if (paramsBeforeRestrict) effectiveParams = paramsBeforeRestrict;
  }

  // A reimbursement claims its expense claim now, so the same claim cannot be paid twice.
  if (claimCheck && claimCheck.outcome !== "deny" && decisionResult !== "deny" && decisionResult !== "error") {
    const won = await reserveClaim(db, claimCheck.claim.id, claimCheck.stale, request.id, now);
    if (!won) {
      decisionResult = "deny";
      watchOnly = null;
      reasons = [...reasons, `Claim ${claimCheck.claim.ref} was just claimed by another reimbursement: this would pay it twice`];
      explanation = { ...explanation, stage: "baseline", expenseClaim: { ref: claimCheck.claim.ref, code: "duplicate" } };
    }
  }
  // A matched payment claims its document now, so a second payment against it is refused as a duplicate.
  // The claim is conditional: of two payments racing for one document, only one wins.
  if (docMatch?.ok && decisionResult !== "deny" && decisionResult !== "error") {
    const won = await reservePaymentDocument(db, docMatch, request.id, now);
    if (!won) {
      decisionResult = "deny";
      watchOnly = null;
      reasons = [...reasons, `Document ${docMatch.doc.ref} was just claimed by another payment: this would pay it twice`];
      explanation = { ...explanation, stage: "baseline", paymentDocument: { ref: docMatch.doc.ref, code: "duplicate" } };
    }
  }

  const decision = await db.authorizationDecision.create({
    data: { createdAt: now, orgId: ctx.orgId, actionRequestId: request.id, result: decisionResult, policyVersionIds, matchedRuleIds, explanation: explanation as Prisma.InputJsonValue, inputHash: authzInput ? hashObject(authzInput) : paramsHash, latencyMs: Date.now() - started, uncertaintyLevel: uncertainty?.level ?? null },
  });
  await appendEvidence(db, ctx, { type: `gateway.decision.${decisionResult}`, subjectType: "action_request", subjectId: request.id, correlationId, payload: { decisionId: decision.id, result: decisionResult, reasons, policyVersionIds, matchedRuleIds, riskIndicators, restrictions: restrictApplied, latencyMs: decision.latencyMs } });

  // Attack Simulation Lab agents exist to be refused: their events are recorded but open no incident, change no level and notify nobody.
  const isLab = agent.isLab;
  let securityEventId: string | null = null;
  if (securityType) {
    // Through the Shield module so critical and repeated high events open or join an incident.
    const created = await createSecurityEvent(db, ctx, { type: securityType, severity: securitySeverity ?? "medium", title: `${isLab ? "[lab] " : ""}${securityType.replace(/[._]/g, " ")}: ${agent.slug} ${input.tool}`, agentId, actionRequestId: request.id, escalate: isLab ? false : undefined, detail: { reasons, tool: input.tool, action: input.action, resource: input.resource ?? null, destinationDomain: extractDestinationDomain(input.params), onBehalfOf: input.onBehalfOf?.agentId ?? null, ...(isLab ? { lab: true } : {}) } });
    securityEventId = created.event.id;
    // A tampered policy is not the agent's doing, so it does not lower the agent's autonomy.
    if (!isLab && !watchOnly && securityType !== "policy.integrity_failure") await applyAutomaticDowngrade(db, { ...systemContextFor(ctx.orgId), now }, agentId, { rule: "security_event", severity: securitySeverity ?? "medium", securityEventType: securityType, actionRequestId: request.id });
  }

  let status: ActionRequest["status"];
  let approvalRow = null as Awaited<ReturnType<typeof db.approvalRequest.create>> | null;
  let grant: { token: string; expiresAt: Date } | null = null;
  let holdExpiresAt: Date | null = null;
  const effectiveHash = requestHashOf(input.tool, input.action, effectiveParams);
  if (watchOnly) {
    status = "allowed";
    await db.actionRequest.update({ where: { id: request.id }, data: { status: "allowed", updatedAt: now } });
    const g = await issueGrant(db, ctx.orgId, request.id, effectiveHash, { now, integrationId: tool?.integrationId ?? null });
    grant = { token: g.token, expiresAt: g.grant.expiresAt };
    await appendEvidence(db, ctx, { type: "gateway.watch_only_passed", subjectType: "action_request", subjectId: request.id, correlationId, payload: { wouldHave: watchOnly.wouldHave, reasons } });
  } else if (decisionResult === "allow" || decisionResult === "restrict") {
    status = "allowed";
    // The request becomes executable before its single grant is issued; the grant binds the parameters that will
    // execute (after Shield masking and policy narrowing), so the downstream check matches.
    await db.actionRequest.update({ where: { id: request.id }, data: { status: "allowed", updatedAt: now } });
    const g = await issueGrant(db, ctx.orgId, request.id, effectiveHash, { now, integrationId: tool?.integrationId ?? null });
    grant = { token: g.token, expiresAt: g.grant.expiresAt };
  } else if (decisionResult === "require_approval") {
    status = "pending_approval";
    const spec = approvalSpec ?? { roles: [], minApprovers: 1, expiresInMinutes: 240, separationOfDuties: true, escalateToRoles: [], instructions: "" };
    const expiresAt = new Date(now.getTime() + spec.expiresInMinutes * 60_000);
    // The approval binds the parameters the approver will see and that will execute.
    approvalRow = await db.approvalRequest.create({
      data: { createdAt: now, updatedAt: now, orgId: ctx.orgId, actionRequestId: request.id, requiredApprovals: spec.minApprovers, requiredRoles: spec.roles, requestHash: effectiveHash, triggeringRuleId: evaluation?.decidingRule ? `${evaluation.decidingRule.policyKey}/${evaluation.decidingRule.ruleId}` : null, policyVersionId: evaluation?.decidingRule?.policyVersionId ?? null, reason: spec.instructions || reasons.join("; "), expiresAt },
    });
    await enqueueJob({ type: "approval.expire", payload: { approvalRequestId: approvalRow.id, orgId: ctx.orgId }, idempotencyKey: `approval.expire:${approvalRow.id}`, orgId: ctx.orgId, runAt: expiresAt }, db);
    const approvers = isLab ? [] : await userIdsWithPermission(db, ctx, "approvals:decide");
    if (approvers.length) await notifyUsers(db, ctx, { userIds: approvers, type: "approval.requested", title: `Approval needed: ${agent.name} wants to ${input.tool}`, body: reasons.join("; "), link: `/approvals/${approvalRow.id}`, idempotencyKey: `approval.requested:${approvalRow.id}` });
    await appendEvidence(db, ctx, { type: "approval.requested", subjectType: "approval_request", subjectId: approvalRow.id, correlationId, payload: { actionRequestId: request.id, expiresAt, requiredApprovals: spec.minApprovers, requiredRoles: spec.roles } });
  } else if (decisionResult === "quarantine") {
    status = "quarantined";
    const spec = evaluation?.quarantine ?? DEFAULT_QUARANTINE;
    holdExpiresAt = new Date(now.getTime() + spec.expiresInMinutes * 60_000);
    await enqueueJob({ type: "request.expire", payload: { actionRequestId: request.id, orgId: ctx.orgId }, idempotencyKey: `request.expire:${request.id}:${holdExpiresAt.getTime()}`, orgId: ctx.orgId, runAt: holdExpiresAt }, db);
    const reviewers = isLab ? [] : await userIdsWithPermission(db, ctx, "security:write");
    if (reviewers.length) await notifyUsers(db, ctx, { userIds: reviewers, type: "gateway.quarantined", title: `Quarantined: ${agent.name} ${input.tool}`, body: reasons.join("; ") || spec.note, link: `/gateway/${request.id}`, idempotencyKey: `gateway.quarantined:${request.id}:${holdExpiresAt.getTime()}` });
    await appendEvidence(db, ctx, { type: "gateway.quarantined", subjectType: "action_request", subjectId: request.id, correlationId, payload: { securityEventId, expiresAt: holdExpiresAt, reviewRoles: spec.reviewRoles, severity: spec.severity } });
  } else if (decisionResult === "request_more_information") {
    status = "awaiting_information";
    const spec = evaluation?.moreInformation ?? DEFAULT_MORE_INFORMATION;
    holdExpiresAt = new Date(now.getTime() + spec.expiresInMinutes * 60_000);
    await enqueueJob({ type: "request.expire", payload: { actionRequestId: request.id, orgId: ctx.orgId }, idempotencyKey: `request.expire:${request.id}:${holdExpiresAt.getTime()}`, orgId: ctx.orgId, runAt: holdExpiresAt }, db);
    await appendEvidence(db, ctx, { type: "gateway.information_requested", subjectType: "action_request", subjectId: request.id, correlationId, payload: { fields: spec.fields, expiresAt: holdExpiresAt } });
  } else {
    status = "denied";
  }
  const updated = await db.actionRequest.update({ where: { id: request.id }, data: { status, riskIndicators, expiresAt: approvalRow?.expiresAt ?? holdExpiresAt, completedAt: status === "denied" ? now : null, params: effectiveParams as Prisma.InputJsonValue, updatedAt: now } });
  await db.agent.update({ where: { id: agentId }, data: { lastActivityAt: now } });
  if (status === "denied" && !isLab) await checkDenialBurst(db, { ...systemContextFor(ctx.orgId), now }, agentId, request.id);

  const response = toResponse(updated, decision, approvalRow, null, false);
  response.reasons = reasons;
  if (response.quarantine) response.quarantine.securityEventId = securityEventId;
  if (delegation) response.delegation = { delegationId: delegation.row.id, onBehalfOf: delegation.delegator.slug };
  if (watchOnly) {
    response.watchOnly = watchOnly;
    delete response.restrictions;
  }
  if (grant) response.grant = { token: grant.token, expiresAt: grant.expiresAt.toISOString() };
  // Store what the executor needs (post-commit) without leaking the grant into the response for gateway mode.
  if (status === "allowed") (response as GatewayResponse & { __pendingExecution?: { grantToken: string; params: Record<string, unknown> } }).__pendingExecution = { grantToken: grant!.token, params: effectiveParams };
  if (input.executionMode === "gateway") delete response.grant;
  return response;
}

function toResponse(req: ActionRequest, decision: { result: string; policyVersionIds: string[]; matchedRuleIds: string[]; explanation: unknown } | null, approval: { id: string; expiresAt: Date; requiredApprovals: number; requiredRoles: string[] } | null, receipt: { status: string; downstreamSystem: string; downstreamReference: string | null; responseSummary: unknown } | null, duplicate: boolean): GatewayResponse {
  const explanation = (decision?.explanation ?? {}) as { failures?: { message: string }[]; decidingRule?: { policy: string; rule: string } | null; defaultDeny?: boolean; restrictions?: string[]; restrictNote?: string; moreInformation?: MoreInformationSpec | null; quarantine?: QuarantineSpec | null };
  const reasons = explanation.failures?.map((f) => f.message) ?? [];
  const result = (decision?.result as GatewayResponse["decision"]) ?? "error";
  const expiresAt = req.expiresAt?.toISOString() ?? new Date(0).toISOString();
  return {
    requestId: req.id,
    status: req.status,
    decision: result,
    reasons,
    riskIndicators: (req.riskIndicators as string[]) ?? [],
    policyVersionIds: decision?.policyVersionIds ?? [],
    matchedRuleIds: decision?.matchedRuleIds ?? [],
    approval: approval ? { approvalRequestId: approval.id, expiresAt: approval.expiresAt.toISOString(), requiredApprovals: approval.requiredApprovals, requiredRoles: approval.requiredRoles } : undefined,
    grant: undefined,
    receipt: receipt ? { status: receipt.status, downstreamSystem: receipt.downstreamSystem, reference: receipt.downstreamReference, summary: (receipt.responseSummary ?? {}) as Record<string, unknown> } : undefined,
    restrictions: result === "restrict" ? { applied: explanation.restrictions ?? [], params: (req.params ?? {}) as Record<string, unknown>, note: explanation.restrictNote ?? "" } : undefined,
    moreInformation: result === "request_more_information" ? { fields: explanation.moreInformation?.fields ?? [], message: explanation.moreInformation?.message ?? "", expiresAt } : undefined,
    quarantine: result === "quarantine" ? { securityEventId: null, expiresAt } : undefined,
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
    const owner = await db.actionRequest.findUnique({ where: { id: req.id }, select: { agentId: true } });
    if (owner) await applyAutomaticDowngrade(db, { ...systemContextFor(ctx.orgId), now }, owner.agentId, { rule: "unknown_outcome", actionRequestId: req.id });
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
    const tool = req.toolId ? await db.tool.findUnique({ where: { id: req.toolId }, include: { integration: { omit: { settings: true, enforcementSummary: true } } } }) : null;
    const systemKey = tool?.integration?.key ?? "none";
    const system = tool?.integration ? resolveDownstreamSystem(tool.integration) : undefined;
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
  const circuitKey = `${ctx.orgId}:${systemKey}`;
  if (!breakers.execution.allow(circuitKey)) {
    // The system failed repeatedly just now: refuse at once. Nothing is sent, so the failure is definitive.
    result = { outcome: "failed", reference: null, summary: {}, error: `${systemKey} is failing repeatedly; AEGIS paused calls to it for a short time and sent nothing` };
  } else {
    try {
      result = await withSpan("gateway.execute", { "aegis.system": systemKey }, () => system.execute(downstreamContext(run, ctx.orgId, integrationId), downstream));
    } catch (e) {
      // A thrown error after the call started is ambiguous by definition: record unknown, reconcile later.
      result = { outcome: "unknown", reference: null, summary: {}, error: e instanceof Error ? e.message : "execution failed" };
    }
    // Only ambiguous outcomes (timeouts, lost connections) count against the circuit; a definitive refusal is an answer.
    if (result.outcome === "unknown") breakers.execution.failure(circuitKey);
    else breakers.execution.success(circuitKey);
  }
  m.executions.inc({ system: systemKey, outcome: result.outcome });
  m.executionSeconds.observe((Date.now() - started) / 1000, { system: systemKey });
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
    const tool = req.toolId ? await db.tool.findUnique({ where: { id: req.toolId }, include: { integration: { omit: { settings: true, enforcementSummary: true } } } }) : null;
    const systemKey = tool?.integration?.key ?? "none";
    const system = tool?.integration ? resolveDownstreamSystem(tool.integration) : undefined;
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
 * agents:control. The resolution is a receipt plus evidence naming who decided and why.
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
  const settings = { ...((org.settings ?? {}) as Record<string, unknown>), gatewayPaused: true, gatewayPausedReason: reason, gatewayPausedAt: now.toISOString(), gatewayPausedBy: ctx.actor.label ?? ctx.actor.id ?? "user", gatewayPausedById: ctx.actor.id ?? null };
  await db.organization.update({ where: { id: ctx.orgId }, data: { settings: settings as Prisma.InputJsonValue } });
  const voidedGrants = await voidLiveGrants(db, ctx, `gateway paused: ${reason}`);
  await appendEvidence(db, ctx, { type: "gateway.paused", subjectType: "organization", subjectId: ctx.orgId, payload: { reason, voidedGrants } });
  return { voidedGrants };
}

export async function resumeGateway(db: TenantDb, ctx: OrgContext, reason: string): Promise<void> {
  if (!ctx.actor.permissions?.includes("*") && !ctx.actor.permissions?.includes("org:admin")) throw forbidden("Missing permission org:admin");
  const now = ctx.now ?? new Date();
  const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { settings: true } });
  const current = (org.settings ?? {}) as Record<string, unknown>;
  // Two-person recovery: the person who stopped everything cannot also be the one who starts it again.
  if (current.gatewayPaused && twoPersonRecovery(current) && current.gatewayPausedById && current.gatewayPausedById === ctx.actor.id) throw forbidden("Two-person recovery is on: a different administrator must resume the gateway");
  if (current.gatewayPaused && twoPersonRecovery(current) && reason.trim().length < 5) throw new AegisError("validation", "A reason of at least 5 characters is required to resume");
  const settings: Record<string, unknown> = { ...current, gatewayPaused: false, gatewayResumedAt: now.toISOString(), gatewayResumeReason: reason };
  delete settings.gatewayPausedReason;
  delete settings.gatewayPausedAt;
  delete settings.gatewayPausedBy;
  delete settings.gatewayPausedById;
  await db.organization.update({ where: { id: ctx.orgId }, data: { settings: settings as Prisma.InputJsonValue } });
  await appendEvidence(db, ctx, { type: "gateway.resumed", subjectType: "organization", subjectId: ctx.orgId, payload: { reason } });
}

/**
 * The API path for an agent-mode grant. A request whose authorization has gone stale (past the execution window,
 * or a deciding policy version retired) is marked expired in its own committed transaction, then refused;
 * otherwise the grant is issued. issueGrant re-checks staleness inside the issuing transaction.
 */
export async function requestGrant(run: <T>(orgId: string, fn: (db: TenantDb) => Promise<T>) => Promise<T>, ctx: OrgContext, actionRequestId: string) {
  const now = ctx.now ?? new Date();
  const stale = await run(ctx.orgId, async (db) => {
    const r = await db.actionRequest.findUnique({ where: { id: actionRequestId }, select: { id: true, agentId: true, status: true, correlationId: true } });
    if (!r || (ctx.actor.type === "agent" && r.agentId !== ctx.actor.id)) throw notFound("Action request");
    if (!(EXECUTABLE_STATUSES as readonly string[]).includes(r.status)) return null;
    const why = await staleAuthorization(db, r.id, r.status, now);
    if (!why) return null;
    const moved = await db.actionRequest.updateMany({ where: { id: r.id, status: { in: [...EXECUTABLE_STATUSES] } }, data: { status: "expired", completedAt: now } });
    if (moved.count) await appendEvidence(db, ctx, { type: "gateway.authorization_expired", subjectType: "action_request", subjectId: r.id, correlationId: r.correlationId, payload: { reason: why } });
    return why;
  });
  if (stale) throw conflict(stale);
  return run(ctx.orgId, (db) => issueGrantForRequest(db, ctx, actionRequestId));
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
  if (!parseGrantToken(input.grant)) throw forbidden("The grant token is not valid");
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

/** A positive whole number in agent.metadata.maxConcurrentActions, or null when the agent has no limit. */
export function readConcurrencyLimit(metadata: unknown): number | null {
  const v = (metadata as { maxConcurrentActions?: unknown } | null)?.maxConcurrentActions;
  return typeof v === "number" && Number.isInteger(v) && v > 0 && v <= 10_000 ? v : null;
}

export function systemContextFor(orgId: string): OrgContext {
  return makeContext(orgId, { type: "system", id: null, label: "aegis-gateway" });
}

export async function getActionRequest(db: TenantDb, ctx: OrgContext, id: string) {
  const req = await db.actionRequest.findUnique({ where: { id }, include: { agent: { select: { id: true, slug: true, name: true, status: true } }, decisions: { orderBy: { createdAt: "asc" } }, approvals: { include: { responses: { orderBy: { createdAt: "asc" } } }, orderBy: { createdAt: "asc" } }, receipts: { orderBy: { createdAt: "asc" } }, grants: { select: { id: true, expiresAt: true, consumedAt: true, voidedAt: true, voidReason: true, createdAt: true }, orderBy: { createdAt: "asc" } } } });
  if (!req) throw notFound("Action request");
  if (ctx.actor.type === "agent" && req.agentId !== ctx.actor.id) throw notFound("Action request");
  if (ctx.actor.type === "user" && !hasPermission(ctx.actor.permissions, "gateway:read")) throw forbidden("Missing permission gateway:read");
  if (ctx.actor.type === "integration") {
    // A downstream system sees only the requests routed through its own tools.
    const tool = req.toolId ? await db.tool.findUnique({ where: { id: req.toolId }, select: { integrationId: true } }) : null;
    if (!tool || tool.integrationId !== ctx.actor.id) throw notFound("Action request");
  }
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
  if (ctx.actor.type === "user" && !hasPermission(ctx.actor.permissions, "gateway:read")) throw forbidden("Missing permission gateway:read");
  const integrationToolIds = ctx.actor.type === "integration" ? (await db.tool.findMany({ where: { orgId: ctx.orgId, integrationId: ctx.actor.id! }, select: { id: true } })).map((t) => t.id) : null;
  const where: Prisma.ActionRequestWhereInput = {
    orgId: ctx.orgId,
    ...(integrationToolIds ? { toolId: { in: integrationToolIds } } : {}),
    ...(f.status ? { status: f.status as ActionRequest["status"] } : {}),
    ...(f.agentId ? { agentId: f.agentId } : {}),
    // Last, so a filter can never widen an agent's view beyond its own requests.
    ...(ctx.actor.type === "agent" ? { agentId: ctx.actor.id! } : {}),
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

/** Expires one held request (quarantined or awaiting information) whose window has passed. Idempotent. */
export async function expireHeldRequest(db: TenantDb, ctx: OrgContext, actionRequestId: string): Promise<boolean> {
  const r = await db.actionRequest.findUnique({ where: { id: actionRequestId } });
  if (!r || (r.status !== "quarantined" && r.status !== "awaiting_information")) return false;
  const now = ctx.now ?? new Date();
  if (r.expiresAt && r.expiresAt > now) return false;
  await db.actionRequest.update({ where: { id: r.id }, data: { status: "expired", completedAt: now, updatedAt: now } });
  await appendEvidence(db, ctx, { type: "gateway.hold_expired", subjectType: "action_request", subjectId: r.id, correlationId: r.correlationId, payload: { previousStatus: r.status } });
  return true;
}

/** Sweep for held requests whose window passed while no job ran. */
export async function expireHeldRequests(db: TenantDb, ctx: OrgContext): Promise<number> {
  const now = ctx.now ?? new Date();
  const due = await db.actionRequest.findMany({ where: { orgId: ctx.orgId, status: { in: ["quarantined", "awaiting_information"] }, expiresAt: { lte: now } }, select: { id: true }, take: 100 });
  let n = 0;
  for (const d of due) if (await expireHeldRequest(db, ctx, d.id)) n++;
  return n;
}

export const releaseQuarantineSchema = z.object({ action: z.enum(["refuse", "to_approval"]), reason: z.string().min(5).max(2000) });

/**
 * A security reviewer settles a quarantined request: refuse it, or release it into the normal approval
 * flow so a business approver decides. Requires security:write and, when the deciding rule names
 * review roles, one of those roles. Nothing executes from quarantine without a later approval.
 */
export async function releaseQuarantine(db: TenantDb, ctx: OrgContext, actionRequestId: string, input: z.infer<typeof releaseQuarantineSchema>): Promise<{ status: "denied" | "pending_approval"; approvalRequestId: string | null }> {
  if (ctx.actor.type !== "user" || !ctx.actor.id || !hasPermission(ctx.actor.permissions, "security:write")) throw forbidden("Missing permission security:write");
  const req = await db.actionRequest.findUnique({ where: { id: actionRequestId }, include: { agent: true, decisions: { orderBy: { createdAt: "desc" }, take: 1 } } });
  if (!req) throw notFound("Action request");
  if (req.status !== "quarantined") throw conflict(`Request is ${req.status}; only quarantined requests are released`);
  const spec = ((req.decisions[0]?.explanation as { quarantine?: QuarantineSpec | null } | null) ?? {}).quarantine ?? DEFAULT_QUARANTINE;
  if (spec.reviewRoles.length) {
    const m = await db.membership.findUnique({ where: { orgId_userId: { orgId: ctx.orgId, userId: ctx.actor.id } }, include: { role: true } });
    if (!m || !spec.reviewRoles.includes(m.role.key)) throw forbidden(`Release requires role: ${spec.reviewRoles.join(" or ")}`);
  }
  const now = ctx.now ?? new Date();
  if (input.action === "refuse") {
    await db.actionRequest.update({ where: { id: req.id }, data: { status: "denied", completedAt: now, updatedAt: now } });
    await appendEvidence(db, ctx, { type: "gateway.quarantine_refused", subjectType: "action_request", subjectId: req.id, correlationId: req.correlationId, payload: { reason: input.reason } });
    return { status: "denied", approvalRequestId: null };
  }
  const expiresAt = new Date(now.getTime() + 240 * 60_000);
  const approvalRow = await db.approvalRequest.create({
    data: { createdAt: now, updatedAt: now, orgId: ctx.orgId, actionRequestId: req.id, requiredApprovals: 1, requiredRoles: [], requestHash: requestHashOf(req.toolKey, req.action, req.params as Record<string, unknown>), triggeringRuleId: null, policyVersionId: req.decisions[0]?.policyVersionIds[0] ?? null, reason: `Released from quarantine by security review: ${input.reason}`, expiresAt },
  });
  await db.actionRequest.update({ where: { id: req.id }, data: { status: "pending_approval", expiresAt, updatedAt: now } });
  await enqueueJob({ type: "approval.expire", payload: { approvalRequestId: approvalRow.id, orgId: ctx.orgId }, idempotencyKey: `approval.expire:${approvalRow.id}`, orgId: ctx.orgId, runAt: expiresAt }, db);
  const approvers = (await userIdsWithPermission(db, ctx, "approvals:decide")).filter((u) => u !== ctx.actor.id);
  await notifyUsers(db, ctx, { userIds: approvers, type: "approval.requested", title: `Approval needed after security review: ${req.agent.name} ${req.toolKey}`, body: input.reason, link: `/approvals/${approvalRow.id}`, idempotencyKey: `approval.requested:${approvalRow.id}` });
  await appendEvidence(db, ctx, { type: "gateway.quarantine_released", subjectType: "action_request", subjectId: req.id, correlationId: req.correlationId, payload: { reason: input.reason, approvalRequestId: approvalRow.id, releasedBy: ctx.actor.id } });
  await appendEvidence(db, ctx, { type: "approval.requested", subjectType: "approval_request", subjectId: approvalRow.id, correlationId: req.correlationId, payload: { actionRequestId: req.id, expiresAt, requiredApprovals: 1, requiredRoles: [], source: "quarantine_release" } });
  return { status: "pending_approval", approvalRequestId: approvalRow.id };
}

/** A stored level outside 0 to 4 is treated as level 0: an unreadable setting never grants autonomy. */
function autonomyLevelOf(v: number): AutonomyLevel {
  return isAutonomyLevel(v) ? v : 0;
}

async function organizationCurrency(db: TenantDb, orgId: string): Promise<string> {
  const org = { settings: await orgSettings(db, orgId) };
  const c = (org?.settings as { currency?: unknown } | null)?.currency;
  return typeof c === "string" && c ? c.toUpperCase() : "AED";
}
