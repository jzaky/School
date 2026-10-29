import type { Prisma, TenantDb } from "@aegis/db";
import { z } from "zod";
import { appendEvidence } from "../evidence/ledger.js";
import type { OrgContext } from "../lib/context.js";
import { forbidden, notFound, validation } from "../lib/errors.js";
import { assertPermission } from "../orgs/orgs.js";
import { hasPermission } from "../identity/permissions.js";

/**
 * Agent-to-agent delegation. A person (never an agent) lets one agent act on another's behalf for a
 * limited time, within a subset of the delegator's tools and optional numeric caps. Enforcement is in
 * the gateway: a delegated request must pass the delegate's own grants, the delegator's grants, the
 * delegation scope, and both agents' policies. A delegate therefore never holds more than either agent.
 */
export const MAX_DELEGATION_DAYS = 30;

export const createDelegationSchema = z.object({
  delegatorAgentId: z.string().uuid(),
  delegateAgentId: z.string().uuid(),
  toolKeys: z.array(z.string().min(1).max(80)).max(50).default([]),
  constraints: z.object({ maxAmount: z.number().positive().optional() }).strict().default({}),
  reason: z.string().min(5).max(500),
  expiresInHours: z.number().int().min(1).max(MAX_DELEGATION_DAYS * 24),
});

export async function createDelegation(db: TenantDb, ctx: OrgContext, input: z.infer<typeof createDelegationSchema>) {
  if (ctx.actor.type !== "user") throw forbidden("Only a person can create a delegation; agents cannot extend their own authority");
  assertPermission(ctx, "agents:write");
  if (input.delegatorAgentId === input.delegateAgentId) throw validation("An agent cannot delegate to itself");
  const [delegator, delegate] = await Promise.all([
    db.agent.findUnique({ where: { id: input.delegatorAgentId }, include: { tools: { include: { tool: true } } } }),
    db.agent.findUnique({ where: { id: input.delegateAgentId } }),
  ]);
  if (!delegator || !delegate) throw notFound("Agent");
  if (delegator.status !== "active" || delegate.status !== "active") throw validation("Both agents must be active");
  const held = new Set(delegator.tools.filter((t) => t.enabled && !t.revokedAt).map((t) => t.tool.key));
  const outside = input.toolKeys.filter((k) => !held.has(k));
  if (outside.length) throw validation(`The delegating agent does not hold: ${outside.join(", ")}. A delegation cannot grant more than the delegator has.`);
  const now = ctx.now ?? new Date();
  const row = await db.agentDelegation.create({
    data: { orgId: ctx.orgId, delegatorAgentId: delegator.id, delegateAgentId: delegate.id, toolKeys: input.toolKeys, constraints: input.constraints as Prisma.InputJsonValue, reason: input.reason, grantedBy: ctx.actor.id, expiresAt: new Date(now.getTime() + input.expiresInHours * 3600_000), createdAt: now },
  });
  await appendEvidence(db, ctx, { type: "agent.delegation_created", subjectType: "agent", subjectId: delegator.id, payload: { delegationId: row.id, delegator: delegator.slug, delegate: delegate.slug, toolKeys: input.toolKeys, constraints: input.constraints, expiresAt: row.expiresAt, reason: input.reason } });
  return row;
}

/** Revocation is immediate: the next delegated request is refused. Requests already executed are not reversed. */
export async function revokeDelegation(db: TenantDb, ctx: OrgContext, delegationId: string, reason: string) {
  if (ctx.actor.type !== "user") throw forbidden("Only a person can revoke a delegation");
  // Revoking narrows authority, so anyone who may grant a delegation (agents:write) may also take it back,
  // as may anyone who controls agents (agents:control).
  if (!hasPermission(ctx.actor.permissions, "agents:write") && !hasPermission(ctx.actor.permissions, "agents:control")) throw forbidden("Missing permission agents:write or agents:control");
  if (reason.trim().length < 3) throw validation("A reason is required");
  const row = await db.agentDelegation.findUnique({ where: { id: delegationId } });
  if (!row) throw notFound("Delegation");
  if (row.revokedAt) return row;
  const now = ctx.now ?? new Date();
  const updated = await db.agentDelegation.update({ where: { id: row.id }, data: { revokedAt: now, revokedReason: reason } });
  await appendEvidence(db, ctx, { type: "agent.delegation_revoked", subjectType: "agent", subjectId: row.delegatorAgentId, payload: { delegationId: row.id, reason } });
  return updated;
}

export async function listDelegations(db: TenantDb, ctx: OrgContext, filter: { agentId?: string; activeOnly?: boolean } = {}) {
  assertPermission(ctx, "agents:read");
  const now = ctx.now ?? new Date();
  return db.agentDelegation.findMany({
    where: { orgId: ctx.orgId, ...(filter.agentId ? { OR: [{ delegatorAgentId: filter.agentId }, { delegateAgentId: filter.agentId }] } : {}), ...(filter.activeOnly ? { revokedAt: null, expiresAt: { gt: now } } : {}) },
    orderBy: { createdAt: "desc" },
    include: { delegator: { select: { id: true, slug: true, name: true } }, delegate: { select: { id: true, slug: true, name: true } }, _count: { select: { requests: true } } },
    take: 200,
  });
}
