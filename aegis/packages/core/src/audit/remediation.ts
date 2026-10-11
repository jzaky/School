/**
 * Remediation tasks: the work items that close findings. Transitions follow a fixed order so the
 * review step cannot be skipped, and every change is appended to the task history and the ledger.
 */
import type { Prisma, RemediationStatus, TenantDb } from "@aegis/db";
import { z } from "zod";
import { appendEvidence } from "../evidence/ledger.js";
import type { OrgContext } from "../lib/context.js";
import { notFound, validation } from "../lib/errors.js";
import { notifyUsers } from "../notify/notifications.js";
import { assertPermission } from "../orgs/orgs.js";

export const REMEDIATION_TRANSITIONS: Record<RemediationStatus, RemediationStatus[]> = {
  open: ["in_progress"],
  in_progress: ["review"],
  review: ["resolved", "in_progress"],
  resolved: ["reopened"],
  reopened: ["in_progress"],
};

export interface HistoryEntry {
  at: string;
  by: string | null;
  from: RemediationStatus | null;
  to: RemediationStatus | string;
  note: string;
}

export const createTaskSchema = z.object({
  findingId: z.string().uuid().optional(),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(5000).default(""),
  ownerId: z.string().uuid().optional(),
  dueAt: z.coerce.date().optional(),
});

export const updateTaskSchema = z.object({
  title: z.string().trim().min(3).max(200).optional(),
  description: z.string().trim().max(5000).optional(),
  ownerId: z.string().uuid().nullable().optional(),
  dueAt: z.coerce.date().nullable().optional(),
});

export const taskListFilter = z.object({
  status: z.enum(["open", "in_progress", "review", "resolved", "reopened", "active", "all"]).default("active"),
  ownerId: z.string().uuid().optional(),
  findingId: z.string().uuid().optional(),
  assessmentId: z.string().uuid().optional(),
  overdue: z.coerce.boolean().default(false),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

async function assertOwnerIsMember(db: TenantDb, ctx: OrgContext, ownerId: string) {
  const m = await db.membership.findUnique({ where: { orgId_userId: { orgId: ctx.orgId, userId: ownerId } } });
  if (!m || m.status !== "active") throw validation("Owner must be an active member of this organization");
}

function entry(ctx: OrgContext, from: RemediationStatus | null, to: string, note: string): HistoryEntry {
  return { at: (ctx.now ?? new Date()).toISOString(), by: ctx.actor.id, from, to, note };
}

export async function createTask(db: TenantDb, ctx: OrgContext, input: z.infer<typeof createTaskSchema>) {
  assertPermission(ctx, "audit:write");
  const data = createTaskSchema.parse(input);
  if (data.findingId) {
    const f = await db.finding.findUnique({ where: { id: data.findingId }, select: { id: true } });
    if (!f) throw notFound("Finding");
  }
  if (data.ownerId) await assertOwnerIsMember(db, ctx, data.ownerId);
  const now = ctx.now ?? new Date();
  const history: HistoryEntry[] = [entry(ctx, null, "open", "created")];
  const task = await db.remediationTask.create({
    data: { orgId: ctx.orgId, findingId: data.findingId ?? null, title: data.title, description: data.description, ownerId: data.ownerId ?? null, dueAt: data.dueAt ?? null, status: "open", history: history as unknown as Prisma.InputJsonValue, createdBy: ctx.actor.id, createdAt: now, updatedAt: now },
  });
  await appendEvidence(db, ctx, { type: "remediation.created", subjectType: "remediation_task", subjectId: task.id, payload: { findingId: task.findingId, ownerId: task.ownerId, dueAt: task.dueAt } });
  if (task.ownerId) await notifyOwner(db, ctx, task, "assigned");
  return task;
}

async function notifyOwner(db: TenantDb, ctx: OrgContext, task: { id: string; title: string; ownerId: string | null; dueAt: Date | null }, reason: string) {
  if (!task.ownerId || task.ownerId === ctx.actor.id) return;
  await notifyUsers(db, ctx, { userIds: [task.ownerId], type: `remediation.${reason}`, title: `Remediation task ${reason}: ${task.title}`, body: task.dueAt ? `Due ${task.dueAt.toISOString().slice(0, 10)}` : "", link: `/audit/remediation/${task.id}`, idempotencyKey: `remediation.${reason}:${task.id}:${task.ownerId}` });
}

export async function listTasks(db: TenantDb, ctx: OrgContext, f: Partial<z.infer<typeof taskListFilter>> = {}) {
  assertPermission(ctx, "audit:read");
  const filter = taskListFilter.parse(f);
  const now = ctx.now ?? new Date();
  const where: Prisma.RemediationTaskWhereInput = {
    orgId: ctx.orgId,
    ...(filter.status === "all" ? {} : filter.status === "active" ? { status: { not: "resolved" } } : { status: filter.status }),
    ...(filter.ownerId ? { ownerId: filter.ownerId } : {}),
    ...(filter.findingId ? { findingId: filter.findingId } : {}),
    ...(filter.assessmentId ? { finding: { assessmentId: filter.assessmentId } } : {}),
    ...(filter.overdue ? { dueAt: { lt: now }, status: { not: "resolved" } } : {}),
  };
  const [items, total] = await Promise.all([
    db.remediationTask.findMany({ where, orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }], skip: (filter.page - 1) * filter.pageSize, take: filter.pageSize, include: { finding: { select: { id: true, status: true, humanStatus: true, assessmentId: true, control: { select: { code: true, title: true } } } } } }),
    db.remediationTask.count({ where }),
  ]);
  return { items: items.map((t) => ({ ...t, overdue: !!t.dueAt && t.dueAt < now && t.status !== "resolved" })), total, page: filter.page, pageSize: filter.pageSize, pageCount: Math.max(1, Math.ceil(total / filter.pageSize)) };
}

export async function getTask(db: TenantDb, ctx: OrgContext, taskId: string) {
  assertPermission(ctx, "audit:read");
  const t = await db.remediationTask.findUnique({ where: { id: taskId }, include: { finding: { include: { control: true, assessment: { select: { id: true, name: true, frameworkId: true } } } } } });
  if (!t) throw notFound("Remediation task");
  const evidenceDocuments = t.evidenceDocumentIds.length ? await db.document.findMany({ where: { orgId: ctx.orgId, id: { in: t.evidenceDocumentIds } }, select: { id: true, title: true, filename: true, status: true, sha256: true } }) : [];
  return { ...t, evidenceDocuments, history: t.history as unknown as HistoryEntry[] };
}

export async function updateTask(db: TenantDb, ctx: OrgContext, taskId: string, patch: z.infer<typeof updateTaskSchema>) {
  assertPermission(ctx, "audit:write");
  const data = updateTaskSchema.parse(patch);
  const t = await db.remediationTask.findUnique({ where: { id: taskId } });
  if (!t) throw notFound("Remediation task");
  if (data.ownerId) await assertOwnerIsMember(db, ctx, data.ownerId);
  const history = [...(t.history as unknown as HistoryEntry[])];
  const changed = Object.keys(data).filter((k) => (data as Record<string, unknown>)[k] !== undefined);
  if (changed.length === 0) return t;
  if (data.ownerId !== undefined && data.ownerId !== t.ownerId) history.push(entry(ctx, t.status, t.status, data.ownerId ? "reassigned" : "owner removed"));
  const updated = await db.remediationTask.update({ where: { id: taskId }, data: { ...data, history: history as unknown as Prisma.InputJsonValue, updatedAt: ctx.now ?? new Date() } });
  await appendEvidence(db, ctx, { type: "remediation.updated", subjectType: "remediation_task", subjectId: taskId, payload: { fields: changed } });
  if (data.ownerId && data.ownerId !== t.ownerId) await notifyOwner(db, ctx, updated, "assigned");
  return updated;
}

export const transitionSchema = z.object({ status: z.enum(["open", "in_progress", "review", "resolved", "reopened"]), note: z.string().trim().max(2000).default("") });

/**
 * Moves a task along open -> in_progress -> review -> resolved, resolved -> reopened -> in_progress
 * (review may also go back to in_progress). Resolving the last open task of a finding marks the
 * finding resolved; reopening clears it.
 */
export async function transition(db: TenantDb, ctx: OrgContext, taskId: string, status: RemediationStatus, note = "") {
  assertPermission(ctx, "audit:write");
  const t = await db.remediationTask.findUnique({ where: { id: taskId } });
  if (!t) throw notFound("Remediation task");
  const allowed = REMEDIATION_TRANSITIONS[t.status];
  if (!allowed.includes(status)) throw validation(`Cannot move a task from ${t.status} to ${status}. Allowed: ${allowed.join(", ") || "none"}.`);
  if ((status === "reopened" || (status === "in_progress" && t.status === "review")) && note.trim().length < 3) throw validation("A note is required when reopening or sending a task back");
  const now = ctx.now ?? new Date();
  const history = [...(t.history as unknown as HistoryEntry[]), entry(ctx, t.status, status, note)];
  const updated = await db.remediationTask.update({ where: { id: taskId }, data: { status, history: history as unknown as Prisma.InputJsonValue, updatedAt: now } });
  await appendEvidence(db, ctx, { type: `remediation.${status}`, subjectType: "remediation_task", subjectId: taskId, payload: { from: t.status, to: status, note, findingId: t.findingId } });
  if (t.findingId) {
    if (status === "resolved") {
      const stillOpen = await db.remediationTask.count({ where: { findingId: t.findingId, status: { not: "resolved" } } });
      if (stillOpen === 0) {
        await db.finding.update({ where: { id: t.findingId }, data: { resolvedAt: now, updatedAt: now } });
        await appendEvidence(db, ctx, { type: "finding.resolved", subjectType: "finding", subjectId: t.findingId, payload: { via: "remediation", taskId } });
      }
    } else if (status === "reopened") {
      await db.finding.update({ where: { id: t.findingId }, data: { resolvedAt: null, updatedAt: now } });
    }
  }
  if (status === "review") {
    // Let reviewers know; owners are notified when a task comes back or is reopened.
    const reviewers = await db.membership.findMany({ where: { orgId: ctx.orgId, status: "active", role: { OR: [{ permissions: { has: "*" } }, { permissions: { has: "audit:write" } }] } }, select: { userId: true } });
    await notifyUsers(db, ctx, { userIds: reviewers.map((r) => r.userId).filter((id) => id !== ctx.actor.id), type: "remediation.review_requested", title: `Review requested: ${t.title}`, body: note, link: `/audit/remediation/${t.id}`, idempotencyKey: `remediation.review:${t.id}:${now.getTime()}` });
  } else if (status === "reopened" || (status === "in_progress" && t.status === "review")) {
    await notifyOwner(db, ctx, updated, status === "reopened" ? "reopened" : "returned");
  }
  return updated;
}

export const requestReview = (db: TenantDb, ctx: OrgContext, taskId: string, note = "") => transition(db, ctx, taskId, "review", note);

export async function attachEvidence(db: TenantDb, ctx: OrgContext, taskId: string, documentId: string) {
  assertPermission(ctx, "audit:write");
  const t = await db.remediationTask.findUnique({ where: { id: taskId } });
  if (!t) throw notFound("Remediation task");
  const doc = await db.document.findUnique({ where: { id: documentId }, select: { id: true, sha256: true } });
  if (!doc) throw notFound("Document");
  if (t.evidenceDocumentIds.includes(documentId)) return t;
  const history = [...(t.history as unknown as HistoryEntry[]), entry(ctx, t.status, t.status, `evidence attached: ${documentId}`)];
  const updated = await db.remediationTask.update({ where: { id: taskId }, data: { evidenceDocumentIds: [...t.evidenceDocumentIds, documentId], history: history as unknown as Prisma.InputJsonValue, updatedAt: ctx.now ?? new Date() } });
  await appendEvidence(db, ctx, { type: "remediation.evidence_attached", subjectType: "remediation_task", subjectId: taskId, payload: { documentId, sha256: doc.sha256 } });
  return updated;
}
