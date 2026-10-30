import type { TenantDb } from "@aegis/db";
import { z } from "zod";
import { appendEvidence } from "../evidence/ledger.js";
import type { OrgContext } from "../lib/context.js";
import { conflict, forbidden, notFound, validation } from "../lib/errors.js";
import { notifyUsers, userIdsWithPermission } from "../notify/notifications.js";
import { assertPermission } from "../orgs/orgs.js";
import { voidLiveGrants } from "../gateway/grants.js";

/**
 * Time-limited access. Someone with agents:write asks for a tool or resource permission for one agent,
 * for a reason and a number of hours. A different person with agents:control approves or rejects it.
 * On approval the grant is created with an end time; the gateway refuses it afterwards, and the sweep
 * marks it expired. Agents cannot request or approve access for themselves: both steps need a person.
 */
export const MAX_ACCESS_HOURS = 24 * 14;

export const accessRequestSchema = z
  .object({
    agentId: z.string().uuid(),
    toolId: z.string().uuid().optional(),
    resourceId: z.string().uuid().optional(),
    actions: z.array(z.string().min(1).max(40)).max(10).default([]),
    reason: z.string().min(10).max(1000),
    durationHours: z.number().int().min(1).max(MAX_ACCESS_HOURS),
  })
  .refine((v) => !!v.toolId !== !!v.resourceId, "Ask for exactly one tool or one resource")
  .refine((v) => !v.resourceId || v.actions.length > 0, "Name the actions needed on the resource");

export async function requestAccess(db: TenantDb, ctx: OrgContext, input: z.infer<typeof accessRequestSchema>) {
  if (ctx.actor.type !== "user" || !ctx.actor.id) throw forbidden("Only a person can request access for an agent");
  assertPermission(ctx, "agents:write");
  const agent = await db.agent.findUnique({ where: { id: input.agentId } });
  if (!agent) throw notFound("Agent");
  if (agent.status !== "active" && agent.status !== "registered") throw validation(`The agent is ${agent.status}`);
  if (input.toolId && !(await db.tool.findUnique({ where: { id: input.toolId } }))) throw notFound("Tool");
  if (input.resourceId && !(await db.resource.findUnique({ where: { id: input.resourceId } }))) throw notFound("Resource");
  const row = await db.accessRequest.create({ data: { orgId: ctx.orgId, agentId: input.agentId, toolId: input.toolId ?? null, resourceId: input.resourceId ?? null, actions: input.actions, reason: input.reason, durationHours: input.durationHours, requestedBy: ctx.actor.id, createdAt: ctx.now ?? new Date() } });
  const deciders = (await userIdsWithPermission(db, ctx, "agents:control")).filter((u) => u !== ctx.actor.id);
  await notifyUsers(db, ctx, { userIds: deciders, type: "access.requested", title: `Temporary access requested for ${agent.name}`, body: input.reason, link: `/agents/${agent.id}`, idempotencyKey: `access.requested:${row.id}` });
  await appendEvidence(db, ctx, { type: "access.requested", subjectType: "agent", subjectId: agent.id, payload: { accessRequestId: row.id, toolId: input.toolId ?? null, resourceId: input.resourceId ?? null, actions: input.actions, durationHours: input.durationHours } });
  return row;
}

export async function decideAccessRequest(db: TenantDb, ctx: OrgContext, id: string, input: { decision: "approve" | "reject"; note: string }) {
  if (ctx.actor.type !== "user" || !ctx.actor.id) throw forbidden("Only a person can decide access requests");
  assertPermission(ctx, "agents:control");
  const r = await db.accessRequest.findUnique({ where: { id } });
  if (!r) throw notFound("Access request");
  if (r.status !== "pending") throw conflict(`This request is ${r.status}`);
  if (r.requestedBy === ctx.actor.id) throw forbidden("Separation of duties: you cannot decide your own request");
  if (input.decision === "reject" && input.note.trim().length < 3) throw validation("Say why you are rejecting it");
  const now = ctx.now ?? new Date();
  if (input.decision === "reject") {
    const row = await db.accessRequest.update({ where: { id }, data: { status: "rejected", decidedBy: ctx.actor.id, decidedAt: now, decisionNote: input.note } });
    await appendEvidence(db, ctx, { type: "access.rejected", subjectType: "agent", subjectId: r.agentId, payload: { accessRequestId: id, note: input.note } });
    return row;
  }
  const expiresAt = new Date(now.getTime() + r.durationHours * 3600_000);
  if (r.toolId) {
    const existing = await db.agentTool.findUnique({ where: { agentId_toolId: { agentId: r.agentId, toolId: r.toolId } } });
    // A permanent grant already in force is left alone: temporary access never shortens or replaces it.
    if (!existing || !existing.enabled || existing.revokedAt || existing.expiresAt) {
      await db.agentTool.upsert({ where: { agentId_toolId: { agentId: r.agentId, toolId: r.toolId } }, create: { orgId: ctx.orgId, agentId: r.agentId, toolId: r.toolId, enabled: true, expiresAt }, update: { enabled: true, revokedAt: null, revokedReason: null, expiresAt } });
    }
  } else if (r.resourceId) {
    await db.permission.create({ data: { orgId: ctx.orgId, agentId: r.agentId, resourceId: r.resourceId, actions: r.actions, grantedBy: ctx.actor.id, expiresAt } });
  }
  const row = await db.accessRequest.update({ where: { id }, data: { status: "approved", decidedBy: ctx.actor.id, decidedAt: now, decisionNote: input.note, expiresAt } });
  await notifyUsers(db, ctx, { userIds: [r.requestedBy], type: "access.approved", title: "Temporary access approved", body: `Until ${expiresAt.toISOString()}`, link: `/agents/${r.agentId}`, idempotencyKey: `access.approved:${id}` });
  await appendEvidence(db, ctx, { type: "access.approved", subjectType: "agent", subjectId: r.agentId, payload: { accessRequestId: id, expiresAt, toolId: r.toolId, resourceId: r.resourceId, actions: r.actions } });
  return row;
}

/** Ends approved temporary access early. */
export async function revokeAccess(db: TenantDb, ctx: OrgContext, id: string, reason: string) {
  assertPermission(ctx, "agents:control");
  const r = await db.accessRequest.findUnique({ where: { id } });
  if (!r) throw notFound("Access request");
  if (r.status !== "approved") throw conflict(`This request is ${r.status}`);
  await endTemporaryAccess(db, ctx, r, "revoked", reason);
}

async function endTemporaryAccess(db: TenantDb, ctx: OrgContext, r: { id: string; agentId: string; toolId: string | null; resourceId: string | null; expiresAt: Date | null }, status: "expired" | "revoked", reason: string) {
  const now = ctx.now ?? new Date();
  if (r.toolId) await db.agentTool.updateMany({ where: { agentId: r.agentId, toolId: r.toolId, expiresAt: { not: null }, revokedAt: null }, data: { enabled: false, revokedAt: now, revokedReason: `temporary access ${status}: ${reason}` } });
  if (r.resourceId) await db.permission.updateMany({ where: { agentId: r.agentId, resourceId: r.resourceId, expiresAt: r.expiresAt, revokedAt: null }, data: { revokedAt: now } });
  await db.accessRequest.update({ where: { id: r.id }, data: { status } });
  if (status === "revoked") await voidLiveGrants(db, ctx, `temporary access revoked: ${reason}`, { agentId: r.agentId });
  await appendEvidence(db, ctx, { type: `access.${status}`, subjectType: "agent", subjectId: r.agentId, payload: { accessRequestId: r.id, reason } });
}

/** Marks approved temporary access whose time is up as expired and turns the grant off. Idempotent. */
export async function expireTemporaryAccess(db: TenantDb, ctx: OrgContext): Promise<number> {
  const now = ctx.now ?? new Date();
  const due = await db.accessRequest.findMany({ where: { orgId: ctx.orgId, status: "approved", expiresAt: { lte: now } }, take: 200 });
  for (const r of due) await endTemporaryAccess(db, ctx, r, "expired", "time limit reached");
  return due.length;
}

export async function listAccessRequests(db: TenantDb, ctx: OrgContext, filter: { agentId?: string; status?: string } = {}) {
  assertPermission(ctx, "agents:read");
  return db.accessRequest.findMany({ where: { orgId: ctx.orgId, ...(filter.agentId ? { agentId: filter.agentId } : {}), ...(filter.status ? { status: filter.status as never } : {}) }, orderBy: { createdAt: "desc" }, take: 100 });
}
