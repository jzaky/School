import type { Prisma, TenantDb } from "@aegis/db";
import { z } from "zod";
import { appendEvidence } from "../evidence/ledger.js";
import type { OrgContext } from "../lib/context.js";
import { AegisError, conflict, forbidden, notFound, validation } from "../lib/errors.js";
import { assertPermission } from "../orgs/orgs.js";
import { revokeAgentTool } from "./registry.js";

/**
 * Agent access reviews (docs/ACCESS_REVIEWS.md). Auditors ask whether permissions on financial and other
 * systems are reviewed periodically, AI agents included. A review takes a snapshot of every live tool grant
 * and resource permission each agent holds, with how often it was used, and a person keeps or removes each.
 * Removing revokes the grant at once. The review completes only when every item is decided, and the
 * summary goes into the evidence record. Grants unused for the review's window are marked so the reviewer
 * sees them as candidates to remove: least privilege, applied to agents.
 *
 * Starting and deciding need agents:control. An agent's technical owner cannot decide its items: the
 * person who builds and runs an agent does not certify its access.
 */
export const startReviewSchema = z.object({
  title: z.string().trim().min(3).max(120),
  dueInDays: z.number().int().min(1).max(180).default(14),
  intervalDays: z.number().int().min(7).max(366).nullable().default(90),
  unusedDays: z.number().int().min(7).max(365).default(90),
  agentIds: z.array(z.string().uuid()).max(500).default([]),
});

export const decideItemSchema = z.object({
  decision: z.enum(["keep", "remove"]),
  note: z.string().trim().max(500).default(""),
});

const DAY = 86_400_000;

export async function startAccessReview(db: TenantDb, ctx: OrgContext, input: unknown) {
  assertPermission(ctx, "agents:control");
  if (ctx.actor.type !== "user") throw forbidden("Access reviews are run by people");
  const v = startReviewSchema.parse(input);
  const now = ctx.now ?? new Date();
  const open = await db.accessReview.count({ where: { orgId: ctx.orgId, status: "open" } });
  if (open > 0) throw conflict("An access review is already open; complete it before starting another");
  const agents = await db.agent.findMany({
    where: { orgId: ctx.orgId, status: { notIn: ["revoked", "archived"] }, isLab: false, ...(v.agentIds.length ? { id: { in: v.agentIds } } : {}) },
    select: { id: true, slug: true, name: true, tools: { where: { enabled: true, revokedAt: null }, select: { id: true, toolId: true, expiresAt: true, tool: { select: { key: true, riskLevel: true } } } }, permissions: { where: { revokedAt: null }, select: { id: true, actions: true, expiresAt: true, resource: { select: { key: true, classification: true } } } } },
  });
  // Every named agent must be a reviewable agent of this organization; an unknown id is refused, never silently
  // dropped (an empty review would also block starting a real one).
  if (v.agentIds.length && agents.length !== new Set(v.agentIds).size) throw validation("Every agent to review must be an active, registered agent of this organization");
  // Usage over the review window, from the gateway's own request log.
  const since = new Date(now.getTime() - v.unusedDays * DAY);
  const usage = await db.actionRequest.groupBy({ by: ["agentId", "toolKey"], where: { orgId: ctx.orgId, createdAt: { gte: since }, agentId: { in: agents.map((a) => a.id) } }, _count: { _all: true }, _max: { createdAt: true } });
  const resourceUsage = await db.actionRequest.groupBy({ by: ["agentId", "resourceKey"], where: { orgId: ctx.orgId, createdAt: { gte: since }, agentId: { in: agents.map((a) => a.id) }, resourceKey: { not: null } }, _count: { _all: true }, _max: { createdAt: true } });
  const review = await db.accessReview.create({ data: { orgId: ctx.orgId, title: v.title, dueAt: new Date(now.getTime() + v.dueInDays * DAY), intervalDays: v.intervalDays, unusedDays: v.unusedDays, createdBy: ctx.actor.id ?? null, createdAt: now } });
  const items: Prisma.AccessReviewItemCreateManyInput[] = [];
  for (const a of agents) {
    for (const g of a.tools) {
      const u = usage.find((x) => x.agentId === a.id && x.toolKey === g.tool.key);
      items.push({ orgId: ctx.orgId, reviewId: review.id, agentId: a.id, kind: "tool", targetId: g.id, label: g.tool.key, detail: { agent: a.slug, agentName: a.name, riskLevel: g.tool.riskLevel, toolId: g.toolId, expiresAt: g.expiresAt?.toISOString() ?? null }, uses: u?._count._all ?? 0, lastUsedAt: u?._max.createdAt ?? null });
    }
    for (const p of a.permissions) {
      const u = resourceUsage.find((x) => x.agentId === a.id && x.resourceKey === p.resource.key);
      items.push({ orgId: ctx.orgId, reviewId: review.id, agentId: a.id, kind: "resource", targetId: p.id, label: p.resource.key, detail: { agent: a.slug, agentName: a.name, classification: p.resource.classification, actions: p.actions, expiresAt: p.expiresAt?.toISOString() ?? null }, uses: u?._count._all ?? 0, lastUsedAt: u?._max.createdAt ?? null });
    }
  }
  if (items.length) await db.accessReviewItem.createMany({ data: items });
  await appendEvidence(db, ctx, { type: "access_review.started", subjectType: "access_review", subjectId: review.id, payload: { title: review.title, dueAt: review.dueAt.toISOString(), agents: agents.length, items: items.length, unused: items.filter((i) => (i.uses ?? 0) === 0).length } });
  return { review, items: items.length };
}

export async function decideAccessReviewItem(db: TenantDb, ctx: OrgContext, itemId: string, input: unknown) {
  assertPermission(ctx, "agents:control");
  if (ctx.actor.type !== "user") throw forbidden("Access reviews are decided by people");
  const v = decideItemSchema.parse(input);
  const item = await db.accessReviewItem.findFirst({ where: { id: itemId, orgId: ctx.orgId }, include: { review: true } });
  if (!item) throw notFound("Review item");
  if (item.review.status !== "open") throw conflict("This review is closed");
  if (item.decision) throw conflict("This item is already decided");
  if (v.decision === "remove" && v.note.length < 5) throw new AegisError("validation", "Say why the access is removed (at least 5 characters)");
  // Separation of duties: the agent's technical owner, who builds and runs it, does not certify its access.
  const agent = await db.agent.findUnique({ where: { id: item.agentId }, select: { technicalOwnerId: true, slug: true } });
  if (agent?.technicalOwnerId && agent.technicalOwnerId === ctx.actor.id) throw forbidden("You are this agent's technical owner; another person must review its access");
  const now = ctx.now ?? new Date();
  if (v.decision === "remove") {
    if (item.kind === "tool") {
      const grant = await db.agentTool.findUnique({ where: { id: item.targetId } });
      if (grant && !grant.revokedAt) await revokeAgentTool(db, ctx, item.agentId, grant.toolId, `Access review "${item.review.title}": ${v.note}`);
    } else {
      const perm = await db.permission.findUnique({ where: { id: item.targetId }, include: { resource: { select: { key: true } } } });
      if (perm && !perm.revokedAt) {
        await db.permission.update({ where: { id: perm.id }, data: { revokedAt: now } });
        await appendEvidence(db, ctx, { type: "agent.permission_revoked", subjectType: "agent", subjectId: item.agentId, payload: { resource: perm.resource.key, reason: `Access review "${item.review.title}": ${v.note}` } });
      }
    }
  }
  const row = await db.accessReviewItem.update({ where: { id: item.id }, data: { decision: v.decision, note: v.note, decidedBy: ctx.actor.id ?? null, decidedAt: now } });
  await appendEvidence(db, ctx, { type: "access_review.item_decided", subjectType: "access_review", subjectId: item.reviewId, payload: { itemId: item.id, agent: agent?.slug ?? item.agentId, kind: item.kind, target: item.label, decision: v.decision, uses: item.uses, note: v.note } });
  return row;
}

/** Closes the review once every item is decided; the summary is the auditor's record. */
export async function completeAccessReview(db: TenantDb, ctx: OrgContext, reviewId: string) {
  assertPermission(ctx, "agents:control");
  if (ctx.actor.type !== "user") throw forbidden("Access reviews are completed by people");
  const review = await db.accessReview.findFirst({ where: { id: reviewId, orgId: ctx.orgId }, include: { items: true } });
  if (!review) throw notFound("Access review");
  if (review.status !== "open") throw conflict("This review is already completed");
  const undecided = review.items.filter((i) => !i.decision).length;
  if (undecided) throw conflict(`${undecided} item(s) still need a decision`);
  const now = ctx.now ?? new Date();
  const summary = {
    items: review.items.length,
    kept: review.items.filter((i) => i.decision === "keep").length,
    removed: review.items.filter((i) => i.decision === "remove").length,
    unusedKept: review.items.filter((i) => i.decision === "keep" && i.uses === 0).length,
    agents: new Set(review.items.map((i) => i.agentId)).size,
    reviewers: [...new Set(review.items.map((i) => i.decidedBy).filter(Boolean))].length,
    onTime: now <= review.dueAt,
    nextDueAt: review.intervalDays ? new Date(now.getTime() + review.intervalDays * DAY).toISOString() : null,
  };
  const row = await db.accessReview.update({ where: { id: review.id }, data: { status: "completed", completedAt: now, completedBy: ctx.actor.id ?? null, summary } });
  await appendEvidence(db, ctx, { type: "access_review.completed", subjectType: "access_review", subjectId: review.id, payload: { title: review.title, ...summary } });
  return row;
}

export type ReviewState = "open" | "overdue" | "completed";
export function reviewState(r: { status: string; dueAt: Date }, now = new Date()): ReviewState {
  if (r.status === "completed") return "completed";
  return r.dueAt < now ? "overdue" : "open";
}

/** Reviews newest first, with the open one's items, and when the next review is due. */
export async function accessReviewOverview(db: TenantDb, ctx: OrgContext) {
  assertPermission(ctx, "agents:read");
  const now = ctx.now ?? new Date();
  const reviews = await db.accessReview.findMany({ where: { orgId: ctx.orgId }, orderBy: { createdAt: "desc" }, take: 20 });
  const open = reviews.find((r) => r.status === "open") ?? null;
  const items = open ? await db.accessReviewItem.findMany({ where: { reviewId: open.id }, orderBy: [{ uses: "asc" }, { label: "asc" }] }) : [];
  const last = reviews.find((r) => r.status === "completed") ?? null;
  const nextDueAt = open ? open.dueAt : last?.intervalDays && last.completedAt ? new Date(last.completedAt.getTime() + last.intervalDays * DAY) : null;
  return { reviews: reviews.map((r) => ({ ...r, state: reviewState(r, now) })), open, items, nextDueAt, nextOverdue: !!nextDueAt && nextDueAt < now };
}
