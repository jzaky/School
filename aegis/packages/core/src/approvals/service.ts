import type { ApprovalDecision, Prisma, TenantDb } from "@aegis/db";
import { z } from "zod";
import { appendEvidence } from "../evidence/ledger.js";
import type { OrgContext } from "../lib/context.js";
import { forbidden, notFound, validation } from "../lib/errors.js";
import { notifyUsers } from "../notify/notifications.js";
import { assertPermission } from "../orgs/orgs.js";
import { executeRequest } from "../gateway/gateway.js";
import { issueGrant } from "../gateway/grants.js";
import { hasPermission } from "../identity/permissions.js";

export const approvalListFilter = z.object({
  status: z.enum(["pending", "approved", "rejected", "expired", "more_info", "escalated", "all"]).default("pending"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  mine: z.coerce.boolean().default(false),
});

export async function listApprovals(db: TenantDb, ctx: OrgContext, f: z.infer<typeof approvalListFilter>) {
  assertPermission(ctx, "gateway:read");
  const where: Prisma.ApprovalRequestWhereInput = {
    orgId: ctx.orgId,
    ...(f.status === "all" ? {} : f.status === "pending" ? { status: { in: ["pending", "more_info", "escalated"] } } : { status: f.status }),
    ...(f.mine && ctx.actor.id ? { OR: [{ assignedUserId: ctx.actor.id }, { escalatedToUserId: ctx.actor.id }, { assignedUserId: null, escalatedToUserId: null }] } : {}),
  };
  const [items, total] = await Promise.all([
    db.approvalRequest.findMany({ where, orderBy: [{ status: "asc" }, { expiresAt: "asc" }], skip: (f.page - 1) * f.pageSize, take: f.pageSize, include: { request: { include: { agent: { select: { id: true, slug: true, name: true, riskTier: true } } } }, responses: { orderBy: { createdAt: "asc" } } } }),
    db.approvalRequest.count({ where }),
  ]);
  return { items, total, page: f.page, pageSize: f.pageSize, pageCount: Math.max(1, Math.ceil(total / f.pageSize)) };
}

export async function getApproval(db: TenantDb, ctx: OrgContext, approvalId: string) {
  assertPermission(ctx, "gateway:read");
  const a = await db.approvalRequest.findUnique({
    where: { id: approvalId },
    include: { request: { include: { agent: true, decisions: { orderBy: { createdAt: "desc" }, take: 1 }, receipts: true } }, responses: { orderBy: { createdAt: "asc" } } },
  });
  if (!a) throw notFound("Approval request");
  const tool = a.request.toolId ? await db.tool.findUnique({ where: { id: a.request.toolId }, include: { integration: true } }) : null;
  const policyVersion = a.policyVersionId ? await db.policyVersion.findUnique({ where: { id: a.policyVersionId }, include: { policy: { select: { key: true, name: true } } } }) : null;
  const evidence = await db.evidenceEvent.findMany({ where: { orgId: ctx.orgId, correlationId: a.request.correlationId }, orderBy: { seq: "asc" } });
  const history = await db.approvalRequest.findMany({ where: { orgId: ctx.orgId, request: { agentId: a.request.agentId }, id: { not: a.id } }, orderBy: { createdAt: "desc" }, take: 10, include: { responses: true, request: { select: { toolKey: true, params: true } } } });
  return { ...a, tool, policyVersion, evidence, history, eligibility: await approverEligibility(db, ctx, a) };
}

export interface Eligibility {
  canDecide: boolean;
  reasons: string[];
}

/**
 * Who may decide: approvals:decide permission; one of the required roles when the policy names them;
 * separation of duties: not the agent's business or technical owner, not the requesting principal,
 * not someone who already responded; the request must still be open and unexpired.
 */
export async function approverEligibility(db: TenantDb, ctx: OrgContext, a: { status: string; expiresAt: Date; requiredRoles: string[]; assignedUserId: string | null; escalatedToUserId: string | null; request: { agentId: string; principalUserId: string | null; agent: { businessOwnerId: string | null; technicalOwnerId: string | null } }; responses: { userId: string; decision: string }[] }): Promise<Eligibility> {
  const reasons: string[] = [];
  const userId = ctx.actor.id;
  if (ctx.actor.type !== "user" || !userId) return { canDecide: false, reasons: ["Only authenticated users decide approvals"] };
  if (!hasPermission(ctx.actor.permissions, "approvals:decide")) reasons.push("Missing permission approvals:decide");
  if (!["pending", "more_info", "escalated"].includes(a.status)) reasons.push(`Request is ${a.status}`);
  if (a.expiresAt < (ctx.now ?? new Date())) reasons.push("Request has expired");
  if (a.requiredRoles.length) {
    const m = await db.membership.findUnique({ where: { orgId_userId: { orgId: ctx.orgId, userId } }, include: { role: true } });
    if (!m || !a.requiredRoles.includes(m.role.key)) reasons.push(`Requires role: ${a.requiredRoles.join(" or ")}`);
  }
  if (a.escalatedToUserId && a.escalatedToUserId !== userId) reasons.push("Escalated to a specific approver");
  else if (a.assignedUserId && a.assignedUserId !== userId && !a.escalatedToUserId) reasons.push("Assigned to another approver");
  if (a.request.agent.businessOwnerId === userId || a.request.agent.technicalOwnerId === userId) reasons.push("Separation of duties: you own the requesting agent");
  if (a.request.principalUserId === userId) reasons.push("Separation of duties: you are the requesting principal");
  if (a.responses.some((r) => r.userId === userId && (r.decision === "approve" || r.decision === "reject"))) reasons.push("You already responded");
  return { canDecide: reasons.length === 0, reasons };
}

export const decideSchema = z.object({
  decision: z.enum(["approve", "reject", "request_info", "escalate", "reassign"]),
  comment: z.string().max(2000).default(""),
  targetUserId: z.string().uuid().optional(),
  /** The request hash the approver saw; must match what is stored. */
  requestHash: z.string().length(64),
});

/**
 * Records a decision. Approval executes the request (gateway mode) only when enough approvals
 * are collected, the agent is still active, the request is unexpired and the hash still matches.
 */
export async function decideApproval(db: TenantDb, ctx: OrgContext, approvalId: string, input: z.infer<typeof decideSchema>) {
  const a = await db.approvalRequest.findUnique({ where: { id: approvalId }, include: { request: { include: { agent: true } }, responses: true } });
  if (!a) throw notFound("Approval request");
  const elig = await approverEligibility(db, ctx, a);
  if (!elig.canDecide) throw forbidden(elig.reasons.join("; "));
  if (input.requestHash !== a.requestHash || a.requestHash !== a.request.paramsHash) {
    await appendEvidence(db, ctx, { type: "approval.hash_mismatch", subjectType: "approval_request", subjectId: a.id, correlationId: a.request.correlationId, payload: { seen: input.requestHash, stored: a.requestHash, current: a.request.paramsHash } });
    throw validation("The request changed since it was presented. Reload and review again.");
  }
  if ((input.decision === "reject" || input.decision === "request_info" || input.decision === "escalate") && input.comment.trim().length < 3) throw validation("A comment is required for this decision");
  if ((input.decision === "escalate" || input.decision === "reassign") && !input.targetUserId) throw validation("Choose a person to hand this to");
  if (input.targetUserId) {
    const target = await db.membership.findUnique({ where: { orgId_userId: { orgId: ctx.orgId, userId: input.targetUserId } }, include: { role: true } });
    if (!target || target.status !== "active") throw validation("Target user is not an active member");
    if (!hasPermission(target.role.permissions, "approvals:decide")) throw validation("Target user cannot decide approvals");
    if (input.decision === "reassign" && !hasPermission(ctx.actor.permissions, "users:write") && a.assignedUserId !== ctx.actor.id) throw forbidden("Only administrators or the assigned approver can reassign");
  }

  const now = ctx.now ?? new Date();
  await db.approvalResponse.create({ data: { createdAt: now, orgId: ctx.orgId, approvalRequestId: a.id, userId: ctx.actor.id!, decision: input.decision as ApprovalDecision, comment: input.comment, requestHashSeen: input.requestHash, targetUserId: input.targetUserId ?? null } });
  await appendEvidence(db, ctx, { type: `approval.${input.decision}`, subjectType: "approval_request", subjectId: a.id, correlationId: a.request.correlationId, payload: { actionRequestId: a.actionRequestId, comment: input.comment, targetUserId: input.targetUserId ?? null, requestHash: a.requestHash } });

  const agentOwners = [a.request.agent.technicalOwnerId, a.request.agent.businessOwnerId].filter((x): x is string => !!x);
  switch (input.decision) {
    case "reject": {
      await db.approvalRequest.update({ where: { id: a.id }, data: { status: "rejected", decidedAt: now, updatedAt: now } });
      await db.actionRequest.update({ where: { id: a.actionRequestId }, data: { status: "rejected", completedAt: now, updatedAt: now } });
      await notifyUsers(db, ctx, { userIds: agentOwners, type: "approval.rejected", title: `Rejected: ${a.request.agent.name} ${a.request.toolKey}`, body: input.comment, link: `/approvals/${a.id}`, idempotencyKey: `approval.rejected:${a.id}` });
      return { status: "rejected" as const, executed: false };
    }
    case "request_info": {
      await db.approvalRequest.update({ where: { id: a.id }, data: { status: "more_info" } });
      await notifyUsers(db, ctx, { userIds: agentOwners, type: "approval.more_info", title: `Information requested: ${a.request.agent.name} ${a.request.toolKey}`, body: input.comment, link: `/approvals/${a.id}`, idempotencyKey: `approval.more_info:${a.id}:${Date.now()}` });
      return { status: "more_info" as const, executed: false };
    }
    case "escalate": {
      await db.approvalRequest.update({ where: { id: a.id }, data: { status: "escalated", escalatedToUserId: input.targetUserId } });
      await notifyUsers(db, ctx, { userIds: [input.targetUserId!], type: "approval.escalated", title: `Escalated to you: ${a.request.agent.name} ${a.request.toolKey}`, body: input.comment, link: `/approvals/${a.id}`, idempotencyKey: `approval.escalated:${a.id}:${input.targetUserId}` });
      return { status: "escalated" as const, executed: false };
    }
    case "reassign": {
      await db.approvalRequest.update({ where: { id: a.id }, data: { assignedUserId: input.targetUserId, status: "pending" } });
      await notifyUsers(db, ctx, { userIds: [input.targetUserId!], type: "approval.reassigned", title: `Assigned to you: ${a.request.agent.name} ${a.request.toolKey}`, body: input.comment, link: `/approvals/${a.id}`, idempotencyKey: `approval.reassigned:${a.id}:${input.targetUserId}` });
      return { status: "pending" as const, executed: false };
    }
    case "approve": {
      const approvals = a.responses.filter((r) => r.decision === "approve").length + 1;
      if (approvals < a.requiredApprovals) {
        await db.approvalRequest.update({ where: { id: a.id }, data: { status: "pending" } });
        return { status: "pending" as const, executed: false, approvalsSoFar: approvals };
      }
      // Final re-check before anything executes.
      if (a.request.agent.status !== "active") {
        await db.approvalRequest.update({ where: { id: a.id }, data: { status: "expired", decidedAt: new Date(), reason: `agent ${a.request.agent.status}` } });
        await db.actionRequest.update({ where: { id: a.actionRequestId }, data: { status: "expired", completedAt: new Date() } });
        throw validation(`Approved, but the agent is ${a.request.agent.status}; the action will not execute`);
      }
      await db.approvalRequest.update({ where: { id: a.id }, data: { status: "approved", decidedAt: now, updatedAt: now } });
      await db.actionRequest.update({ where: { id: a.actionRequestId }, data: { status: "approved", updatedAt: now } });
      await appendEvidence(db, ctx, { type: "approval.granted", subjectType: "approval_request", subjectId: a.id, correlationId: a.request.correlationId, payload: { actionRequestId: a.actionRequestId, approvals, approverIds: [...a.responses.filter((r) => r.decision === "approve").map((r) => r.userId), ctx.actor.id] } });
      const mode = ((a.request.context as { executionMode?: string }) ?? {}).executionMode ?? "gateway";
      const grant = await issueGrant(db, ctx.orgId, a.actionRequestId, a.requestHash);
      if (mode === "agent") {
        // The agent fetches its grant through the gateway API; nothing executes here.
        await db.actionRequest.update({ where: { id: a.actionRequestId }, data: { context: { ...(a.request.context as object), grantIssued: true } as Prisma.InputJsonValue } });
        await notifyUsers(db, ctx, { userIds: agentOwners, type: "approval.approved", title: `Approved: ${a.request.agent.name} ${a.request.toolKey}`, body: "Grant issued; the agent may execute", link: `/approvals/${a.id}`, idempotencyKey: `approval.approved:${a.id}` });
        return { status: "approved" as const, executed: false, grantToken: grant.token };
      }
      const receipt = await executeRequest(db, ctx, a.actionRequestId, grant.token, a.request.params as Record<string, unknown>);
      await notifyUsers(db, ctx, { userIds: agentOwners, type: "approval.approved", title: `Approved and ${receipt.status}: ${a.request.agent.name} ${a.request.toolKey}`, body: receipt.reference ?? "", link: `/approvals/${a.id}`, idempotencyKey: `approval.approved:${a.id}` });
      return { status: "approved" as const, executed: receipt.status === "succeeded", receipt };
    }
  }
}

/** The agent (or its owner) answers a request for information; the approval returns to pending. */
export async function provideApprovalInfo(db: TenantDb, ctx: OrgContext, approvalId: string, info: string) {
  const a = await db.approvalRequest.findUnique({ where: { id: approvalId }, include: { request: true } });
  if (!a) throw notFound("Approval request");
  if (ctx.actor.type === "agent" && a.request.agentId !== ctx.actor.id) throw notFound("Approval request");
  if (a.status !== "more_info") throw validation("This request is not waiting for information");
  if (info.trim().length < 3) throw validation("Provide the requested information");
  await db.approvalResponse.create({ data: { orgId: ctx.orgId, approvalRequestId: a.id, userId: ctx.actor.id ?? a.request.agentId, decision: "info_provided", comment: info.slice(0, 2000), requestHashSeen: a.requestHash } });
  await db.approvalRequest.update({ where: { id: a.id }, data: { status: "pending" } });
  await appendEvidence(db, ctx, { type: "approval.info_provided", subjectType: "approval_request", subjectId: a.id, correlationId: a.request.correlationId, payload: { by: ctx.actor.type } });
}

/** Expires a pending approval. Idempotent. Called by the worker job and lazily by readers. */
export async function expireApproval(db: TenantDb, ctx: OrgContext, approvalId: string, reason = "approval window elapsed") {
  const a = await db.approvalRequest.findUnique({ where: { id: approvalId }, include: { request: true } });
  if (!a) return { changed: false };
  if (!["pending", "more_info", "escalated"].includes(a.status)) return { changed: false };
  const now = ctx.now ?? new Date();
  if (a.expiresAt > now && reason === "approval window elapsed") return { changed: false };
  await db.approvalRequest.update({ where: { id: a.id }, data: { status: "expired", decidedAt: now, reason, updatedAt: now } });
  await db.actionRequest.update({ where: { id: a.actionRequestId }, data: { status: "expired", completedAt: now, updatedAt: now } });
  await appendEvidence(db, ctx, { type: "approval.expired", subjectType: "approval_request", subjectId: a.id, correlationId: a.request.correlationId, payload: { actionRequestId: a.actionRequestId, reason } });
  return { changed: true };
}

/** Sweeps every overdue approval in an org (safety net if a job was lost). */
export async function expireOverdueApprovals(db: TenantDb, ctx: OrgContext) {
  const overdue = await db.approvalRequest.findMany({ where: { orgId: ctx.orgId, status: { in: ["pending", "more_info", "escalated"] }, expiresAt: { lt: new Date() } }, select: { id: true } });
  let n = 0;
  for (const a of overdue) if ((await expireApproval(db, ctx, a.id)).changed) n++;
  return n;
}
