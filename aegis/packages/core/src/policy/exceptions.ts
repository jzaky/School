import type { TenantDb } from "@aegis/db";
import { z } from "zod";
import { appendEvidence } from "../evidence/ledger.js";
import type { OrgContext } from "../lib/context.js";
import { forbidden, notFound, validation } from "../lib/errors.js";
import { assertPermission } from "../orgs/orgs.js";
import { parsePolicyDocument } from "./schema.js";

/**
 * Policy exceptions (docs/POLICY_LANGUAGE.md, "Exceptions"). An exception skips one rule of one
 * policy for one agent, optionally for one tool, until it expires. It needs a person to request it and
 * a different person with policies:activate to approve it. It never applies under a delegation, it
 * changes only the policy stage (data protection, uncertainty, reasoning, autonomy and the other
 * stages still apply), and every decision it touches records it.
 */

export const MAX_EXCEPTION_DAYS = 90;

export const exceptionRequestSchema = z.object({
  policyId: z.string().uuid(),
  ruleId: z.string().min(1).max(64),
  agentId: z.string().uuid(),
  toolKey: z.string().min(1).max(80).nullable().default(null),
  reason: z.string().trim().min(10, "Explain the business need in at least 10 characters").max(2000),
  days: z.number().int().min(1).max(MAX_EXCEPTION_DAYS),
});

function person(ctx: OrgContext, what: string): string {
  if (ctx.actor.type !== "user" || !ctx.actor.id) throw forbidden(`Only a person can ${what}`);
  return ctx.actor.id;
}

export async function requestPolicyException(db: TenantDb, ctx: OrgContext, raw: z.input<typeof exceptionRequestSchema>) {
  assertPermission(ctx, "policies:write");
  const by = person(ctx, "request a policy exception");
  const input = exceptionRequestSchema.parse(raw);
  const policy = await db.policy.findUnique({ where: { id: input.policyId }, include: { versions: { where: { state: "active" }, take: 1 } } });
  if (!policy || policy.orgId !== ctx.orgId) throw notFound("Policy");
  const active = policy.versions[0];
  if (!active) throw validation("The policy has no active version");
  const doc = parsePolicyDocument(active.document);
  if (!doc.rules.some((r) => r.id === input.ruleId)) throw validation(`Rule ${input.ruleId} is not in the active version`);
  const agent = await db.agent.findUnique({ where: { id: input.agentId } });
  if (!agent || agent.orgId !== ctx.orgId || agent.isLab) throw notFound("Agent");
  const now = ctx.now ?? new Date();
  const ex = await db.policyException.create({ data: { orgId: ctx.orgId, policyId: policy.id, policyKey: policy.key, ruleId: input.ruleId, agentId: agent.id, toolKey: input.toolKey, reason: input.reason, startsAt: now, expiresAt: new Date(now.getTime() + input.days * 86_400_000), requestedBy: by, createdAt: now, updatedAt: now } });
  await appendEvidence(db, ctx, { type: "policy.exception_requested", subjectType: "policy_exception", subjectId: ex.id, payload: { policy: policy.key, ruleId: ex.ruleId, agent: agent.slug, toolKey: ex.toolKey, days: input.days } });
  return ex;
}

async function load(db: TenantDb, ctx: OrgContext, id: string) {
  const ex = await db.policyException.findUnique({ where: { id } });
  if (!ex || ex.orgId !== ctx.orgId) throw notFound("Policy exception");
  return ex;
}

export async function decidePolicyException(db: TenantDb, ctx: OrgContext, id: string, input: { approve: boolean; note: string }) {
  assertPermission(ctx, "policies:activate");
  const by = person(ctx, "decide a policy exception");
  const ex = await load(db, ctx, id);
  if (ex.status !== "requested") throw validation(`The exception is already ${ex.status}`);
  if (ex.requestedBy === by) throw forbidden("The person who requested the exception cannot approve it");
  if (input.note.trim().length < 3) throw validation("Give a reason for the decision");
  const now = ctx.now ?? new Date();
  if (input.approve && ex.expiresAt <= now) throw validation("The requested period has already ended");
  const updated = await db.policyException.update({ where: { id }, data: { status: input.approve ? "approved" : "rejected", decidedBy: by, decidedAt: now, decisionNote: input.note.trim(), updatedAt: now } });
  await appendEvidence(db, ctx, { type: input.approve ? "policy.exception_approved" : "policy.exception_rejected", subjectType: "policy_exception", subjectId: id, payload: { policy: ex.policyKey, ruleId: ex.ruleId, agentId: ex.agentId, expiresAt: ex.expiresAt, note: input.note.trim() } });
  return updated;
}

export async function revokePolicyException(db: TenantDb, ctx: OrgContext, id: string, reason: string) {
  assertPermission(ctx, "policies:activate");
  person(ctx, "revoke a policy exception");
  const ex = await load(db, ctx, id);
  if (ex.status !== "approved" && ex.status !== "requested") throw validation(`The exception is ${ex.status}`);
  if (reason.trim().length < 3) throw validation("Give a reason");
  const updated = await db.policyException.update({ where: { id }, data: { status: "revoked", revokedReason: reason.trim() } });
  await appendEvidence(db, ctx, { type: "policy.exception_revoked", subjectType: "policy_exception", subjectId: id, payload: { policy: ex.policyKey, ruleId: ex.ruleId, reason: reason.trim() } });
  return updated;
}

/** The rule keys (policyKey/ruleId) currently excepted for an agent and tool, with the exception ids. */
export async function activeExceptionRules(db: TenantDb, agentId: string, toolKey: string, now: Date): Promise<{ keys: Set<string>; ids: string[] }> {
  const rows = await db.policyException.findMany({ where: { agentId, status: "approved", startsAt: { lte: now }, expiresAt: { gt: now }, OR: [{ toolKey: null }, { toolKey }] }, select: { id: true, policyKey: true, ruleId: true } });
  return { keys: new Set(rows.map((r) => `${r.policyKey}/${r.ruleId}`)), ids: rows.map((r) => r.id) };
}

export function exceptionState(ex: { status: string; expiresAt: Date }, now: Date): "requested" | "active" | "expired" | "rejected" | "revoked" {
  if (ex.status === "approved") return ex.expiresAt > now ? "active" : "expired";
  return ex.status as "requested" | "rejected" | "revoked";
}

export async function listPolicyExceptions(db: TenantDb, ctx: OrgContext, filter: { policyId?: string } = {}) {
  assertPermission(ctx, "policies:read");
  const now = ctx.now ?? new Date();
  const rows = await db.policyException.findMany({ where: { orgId: ctx.orgId, ...(filter.policyId ? { policyId: filter.policyId } : {}) }, orderBy: { createdAt: "desc" }, take: 200 });
  const agents = await db.agent.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.agentId))] } }, select: { id: true, name: true, slug: true } });
  const byId = new Map(agents.map((a) => [a.id, a]));
  return rows.map((r) => ({ ...r, state: exceptionState(r, now), agent: byId.get(r.agentId) ?? null }));
}
