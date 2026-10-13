import type { TenantDb } from "@aegis/db";
import { z } from "zod";
import { buildAuthorizationInput } from "../gateway/input.js";
import type { OrgContext } from "../lib/context.js";
import { notFound } from "../lib/errors.js";
import { assertPermission } from "../orgs/orgs.js";
import { evaluatePolicies, type Effect, type PolicyToEvaluate } from "./evaluate.js";
import { parsePolicyDocument, type PolicyDocument } from "./schema.js";
import { resolvePoliciesForAgent } from "./service.js";

/**
 * Replay calibration: what would a draft policy have done to the organization's recent requests?
 *
 * Every recorded request that reached policy evaluation is re-evaluated with the active policy set,
 * except that the policy being edited is replaced by the draft (or the draft is added, for a new
 * policy). Nothing is written: no decisions, approvals, evidence or security events. The result is a
 * before and after count per outcome and the list of requests whose outcome changes.
 *
 * Approximations, stated in the result: the agent's current state (status, tools, permissions) is
 * used, not its state at the time; Shield findings are not replayed; "approvals pending" counts are
 * as of now. Counts that depend on history (requests and denials in 24 hours, duplicates in 30 days)
 * are recomputed as of each request's own time.
 */

export const replayOptionsSchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
  limit: z.coerce.number().int().min(10).max(2000).default(500),
});
export type ReplayOptions = z.infer<typeof replayOptionsSchema>;

export interface ReplayChange {
  requestId: string;
  createdAt: string;
  agentId: string;
  agentName: string;
  tool: string;
  action: string;
  amount: number | null;
  currency: string | null;
  before: Effect;
  after: Effect;
  decidingRule: string | null;
  reasons: string[];
}

export interface ReplayResult {
  policyKey: string | null;
  days: number;
  from: string;
  to: string;
  /** Requests in the window for the tools the draft applies to (capped by the limit). */
  considered: number;
  /** Requests re-evaluated (those that reached policy evaluation the first time). */
  replayed: number;
  skipped: { beforePolicy: number; unresolvable: number };
  before: Record<Effect, number>;
  after: Record<Effect, number>;
  changed: number;
  /** Up to 50 most recent requests whose outcome changes. */
  changes: ReplayChange[];
  approvalsPerDayBefore: number;
  approvalsPerDayAfter: number;
  notes: string[];
}

const zero = (): Record<Effect, number> => ({ allow: 0, require_approval: 0, deny: 0 });
const MAX_CHANGES = 50;

function asEffect(result: string): Effect {
  return result === "allow" || result === "require_approval" ? result : "deny";
}

export async function replayPolicy(db: TenantDb, ctx: OrgContext, input: { policyId?: string | null; document: unknown; options?: Partial<ReplayOptions> }): Promise<ReplayResult> {
  assertPermission(ctx, "policies:read");
  const draft: PolicyDocument = parsePolicyDocument(input.document);
  const opts = replayOptionsSchema.parse(input.options ?? {});
  const now = ctx.now ?? new Date();
  const from = new Date(now.getTime() - opts.days * 24 * 3600_000);
  let policyKey: string | null = null;
  if (input.policyId) {
    const policy = await db.policy.findUnique({ where: { id: input.policyId }, select: { key: true } });
    if (!policy) throw notFound("Policy");
    policyKey = policy.key;
  }
  const tools = draft.appliesTo.tools;
  const requests = await db.actionRequest.findMany({
    where: { orgId: ctx.orgId, createdAt: { gte: from, lte: now }, ...(tools.length ? { toolKey: { in: tools } } : {}) },
    orderBy: { createdAt: "desc" },
    take: opts.limit,
    include: { decisions: { orderBy: { createdAt: "asc" }, take: 1 }, agent: { select: { name: true } } },
  });

  const agents = new Map<string, Awaited<ReturnType<typeof loadAgent>>>();
  const toolRows = new Map<string, Awaited<ReturnType<typeof loadTool>>>();
  const resources = new Map<string, Awaited<ReturnType<typeof loadResource>>>();
  const policySets = new Map<string, PolicyToEvaluate[]>();
  const loadAgent = (id: string) => db.agent.findUnique({ where: { id }, include: { tools: { include: { tool: true } }, permissions: true } });
  const loadTool = (key: string) => db.tool.findUnique({ where: { orgId_key: { orgId: ctx.orgId, key } }, include: { integration: true } });
  const loadResource = (key: string) => db.resource.findUnique({ where: { orgId_key: { orgId: ctx.orgId, key } } });

  const before = zero();
  const after = zero();
  const skipped = { beforePolicy: 0, unresolvable: 0 };
  const changes: ReplayChange[] = [];
  let replayed = 0;
  let changed = 0;

  for (const r of requests) {
    const decision = r.decisions[0];
    const stage = decision && decision.explanation && typeof decision.explanation === "object" ? (decision.explanation as { stage?: unknown }).stage : undefined;
    if (!decision || stage !== "policy") {
      skipped.beforePolicy += 1;
      continue;
    }
    if (!agents.has(r.agentId)) agents.set(r.agentId, await loadAgent(r.agentId));
    const agent = agents.get(r.agentId);
    if (!toolRows.has(r.toolKey)) toolRows.set(r.toolKey, await loadTool(r.toolKey));
    const tool = toolRows.get(r.toolKey);
    if (!agent || !tool) {
      skipped.unresolvable += 1;
      continue;
    }
    let resource = null;
    if (r.resourceKey) {
      if (!resources.has(r.resourceKey)) resources.set(r.resourceKey, await loadResource(r.resourceKey));
      resource = resources.get(r.resourceKey) ?? null;
    }
    const permittedActions = resource ? agent.permissions.filter((p) => p.resourceId === resource!.id && !p.revokedAt && (!p.expiresAt || p.expiresAt > r.createdAt)).flatMap((p) => p.actions) : [];
    const stored = (r.context ?? {}) as Record<string, unknown>;
    const { executionMode: _mode, ip, ...supplied } = stored;
    const params = (r.params ?? {}) as Record<string, unknown>;
    const authzInput = await buildAuthorizationInput(db, {
      agent,
      tool,
      action: r.action,
      resource: resource ? { ...resource, permittedActions } : null,
      params,
      principal: { type: r.principalUserId ? "user" : "service", userId: r.principalUserId, ref: r.principalRef },
      ip: typeof ip === "string" ? ip : null,
      supplied,
      now: r.createdAt,
    });
    if (!policySets.has(r.agentId)) policySets.set(r.agentId, await resolvePoliciesForAgent(db, ctx.orgId, agent));
    const active = policySets.get(r.agentId)!;
    const draftEntry: PolicyToEvaluate = { policyKey: policyKey ?? "draft", policyVersionId: "draft", policyVersion: 0, document: draft };
    const set = policyKey && active.some((p) => p.policyKey === policyKey) ? active.map((p) => (p.policyKey === policyKey ? draftEntry : p)) : [...active, draftEntry];
    const evaluation = evaluatePolicies(set, authzInput);
    const was = asEffect(decision.result);
    const is = evaluation.result;
    before[was] += 1;
    after[is] += 1;
    replayed += 1;
    if (was !== is) {
      changed += 1;
      if (changes.length < MAX_CHANGES) {
        changes.push({
          requestId: r.id,
          createdAt: r.createdAt.toISOString(),
          agentId: r.agentId,
          agentName: r.agent.name,
          tool: r.toolKey,
          action: r.action,
          amount: authzInput.context.amount,
          currency: authzInput.context.currency,
          before: was,
          after: is,
          decidingRule: evaluation.decidingRule ? `${evaluation.decidingRule.policyKey}/${evaluation.decidingRule.ruleId}` : null,
          reasons: evaluation.reasons,
        });
      }
    }
  }

  return {
    policyKey,
    days: opts.days,
    from: from.toISOString(),
    to: now.toISOString(),
    considered: requests.length,
    replayed,
    skipped,
    before,
    after,
    changed,
    changes,
    approvalsPerDayBefore: Math.round((before.require_approval / opts.days) * 10) / 10,
    approvalsPerDayAfter: Math.round((after.require_approval / opts.days) * 10) / 10,
    notes: [
      "Nothing was recorded: no decisions, approvals, evidence or alerts were created.",
      "Each request is re-evaluated with today's active policies, with this draft in place of the policy being edited (or added, for a new policy).",
      "Agents are taken as they are today (status, tools, permissions); counts over the previous 24 hours and 30 days are recomputed as of each request's own time.",
      "Requests refused before policy evaluation (unknown tool, no grant, data protection block, paused gateway) are listed as skipped: no policy changes them.",
      "Sensitive-data findings are not replayed, so a request that needed approval only because of detected data may show as allowed here.",
      ...(requests.length >= opts.limit ? [`Only the most recent ${opts.limit} requests in the window were replayed.`] : []),
    ],
  };
}
