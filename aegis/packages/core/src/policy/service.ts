import type { Prisma, TenantDb } from "@aegis/db";
import { z } from "zod";
import { appendEvidence } from "../evidence/ledger.js";
import type { OrgContext } from "../lib/context.js";
import { hashObject } from "../lib/crypto.js";
import { conflict, notFound, validation } from "../lib/errors.js";
import { assertPermission, slugSchema } from "../orgs/orgs.js";
import { evaluatePolicies, runPolicyTests } from "./evaluate.js";
import { parsePolicyDocument, type PolicyDocument } from "./schema.js";
import type { PolicyToEvaluate } from "./evaluate.js";

export const policyInputSchema = z.object({
  key: slugSchema,
  name: z.string().min(2).max(120),
  description: z.string().max(2000).default(""),
  category: z.enum(["authorization", "data_protection", "tool_security", "operational"]).default("authorization"),
  document: z.unknown(),
  changeNote: z.string().max(500).default("Initial version"),
});

export async function listPolicies(db: TenantDb, ctx: OrgContext) {
  assertPermission(ctx, "policies:read");
  const policies = await db.policy.findMany({
    where: { orgId: ctx.orgId },
    include: { versions: { orderBy: { version: "desc" }, take: 1 }, assignments: true, _count: { select: { versions: true } } },
    orderBy: { name: "asc" },
  });
  const activeIds = policies.map((p) => p.currentVersionId).filter((x): x is string => !!x);
  const active = await db.policyVersion.findMany({ where: { id: { in: activeIds } } });
  const activeById = new Map(active.map((v) => [v.id, v]));
  return policies.map((p) => ({ ...p, activeVersion: p.currentVersionId ? activeById.get(p.currentVersionId) ?? null : null, latestVersion: p.versions[0] ?? null }));
}

export async function getPolicy(db: TenantDb, ctx: OrgContext, policyId: string) {
  assertPermission(ctx, "policies:read");
  const p = await db.policy.findUnique({ where: { id: policyId }, include: { versions: { orderBy: { version: "desc" } }, assignments: true, events: { orderBy: { createdAt: "desc" } } } });
  if (!p) throw notFound("Policy");
  const decisions = await db.authorizationDecision.count({ where: { orgId: ctx.orgId, policyVersionIds: { hasSome: p.versions.map((v) => v.id) } } });
  return { ...p, decisionCount: decisions };
}

/** Creates a policy with its first draft version. */
export async function createPolicy(db: TenantDb, ctx: OrgContext, input: z.infer<typeof policyInputSchema>) {
  assertPermission(ctx, "policies:write");
  const document = parsePolicyDocument(input.document);
  const dup = await db.policy.findUnique({ where: { orgId_key: { orgId: ctx.orgId, key: input.key } } });
  if (dup) throw conflict("A policy with this key already exists");
  const policy = await db.policy.create({ data: { orgId: ctx.orgId, key: input.key, name: input.name, description: input.description, category: input.category, createdBy: ctx.actor.id } });
  const version = await db.policyVersion.create({
    data: { orgId: ctx.orgId, policyId: policy.id, version: 1, document: document as unknown as Prisma.InputJsonValue, contentHash: hashObject(document), state: "draft", changeNote: input.changeNote, createdBy: ctx.actor.id },
  });
  await db.policyEvent.create({ data: { orgId: ctx.orgId, policyId: policy.id, versionId: version.id, type: "created", actorId: ctx.actor.id, note: input.changeNote } });
  await appendEvidence(db, ctx, { type: "policy.created", subjectType: "policy", subjectId: policy.id, payload: { key: policy.key, versionId: version.id, contentHash: version.contentHash } });
  return { policy, version };
}

export async function updatePolicyMeta(db: TenantDb, ctx: OrgContext, policyId: string, patch: { name?: string; description?: string; category?: string }) {
  assertPermission(ctx, "policies:write");
  const p = await db.policy.update({ where: { id: policyId }, data: patch });
  await appendEvidence(db, ctx, { type: "policy.meta_updated", subjectType: "policy", subjectId: policyId, payload: { fields: Object.keys(patch) } });
  return p;
}

/** Adds a new draft version. Documents of non-draft versions are frozen by a database trigger. */
export async function createPolicyVersion(db: TenantDb, ctx: OrgContext, policyId: string, input: { document: unknown; changeNote: string; baseVersionId?: string }) {
  assertPermission(ctx, "policies:write");
  const policy = await db.policy.findUnique({ where: { id: policyId }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
  if (!policy) throw notFound("Policy");
  const document = parsePolicyDocument(input.document);
  const contentHash = hashObject(document);
  const latest = policy.versions[0];
  if (latest && latest.contentHash === contentHash) throw validation("This document is identical to the latest version");
  const version = await db.policyVersion.create({
    data: { orgId: ctx.orgId, policyId, version: (latest?.version ?? 0) + 1, document: document as unknown as Prisma.InputJsonValue, contentHash, state: "draft", changeNote: input.changeNote, createdBy: ctx.actor.id },
  });
  await db.policyEvent.create({ data: { orgId: ctx.orgId, policyId, versionId: version.id, type: "revised", actorId: ctx.actor.id, note: input.changeNote } });
  await appendEvidence(db, ctx, { type: "policy.revised", subjectType: "policy", subjectId: policyId, payload: { versionId: version.id, version: version.version, contentHash } });
  return version;
}

/** Saves over a draft (drafts are the only mutable state). */
export async function updateDraftVersion(db: TenantDb, ctx: OrgContext, versionId: string, input: { document: unknown; changeNote?: string }) {
  assertPermission(ctx, "policies:write");
  const v = await db.policyVersion.findUnique({ where: { id: versionId } });
  if (!v) throw notFound("Policy version");
  if (v.state !== "draft") throw validation("Only drafts can be edited. Create a new version instead.");
  const document = parsePolicyDocument(input.document);
  return db.policyVersion.update({ where: { id: versionId }, data: { document: document as unknown as Prisma.InputJsonValue, contentHash: hashObject(document), ...(input.changeNote ? { changeNote: input.changeNote } : {}) } });
}

export async function submitForReview(db: TenantDb, ctx: OrgContext, versionId: string) {
  assertPermission(ctx, "policies:write");
  const v = await db.policyVersion.findUnique({ where: { id: versionId } });
  if (!v) throw notFound("Policy version");
  if (v.state !== "draft") throw validation("Only drafts can be submitted");
  const doc = parsePolicyDocument(v.document);
  const tests = runPolicyTests(doc);
  const failed = tests.filter((t) => !t.passed);
  if (failed.length) throw validation(`${failed.length} embedded policy test(s) failed`, { tests });
  const updated = await db.policyVersion.update({ where: { id: versionId }, data: { state: "review" } });
  await db.policyEvent.create({ data: { orgId: ctx.orgId, policyId: v.policyId, versionId, type: "submitted", actorId: ctx.actor.id, note: `${tests.length} embedded tests passed` } });
  await appendEvidence(db, ctx, { type: "policy.submitted", subjectType: "policy", subjectId: v.policyId, payload: { versionId, tests: tests.length } });
  return { version: updated, tests };
}

/**
 * Activates a version. Four-eyes: the activator must not be the author of the version unless the
 * organization setting `policyFourEyes` is false. The previously active version is retired, never changed.
 */
export async function activateVersion(db: TenantDb, ctx: OrgContext, versionId: string, opts: { fourEyes?: boolean } = {}) {
  assertPermission(ctx, "policies:activate");
  const v = await db.policyVersion.findUnique({ where: { id: versionId }, include: { policy: true } });
  if (!v) throw notFound("Policy version");
  if (v.state === "active") throw validation("Version is already active");
  if (v.state === "retired") throw validation("Retired versions cannot be reactivated. Use rollback to create a new version from it.");
  if ((opts.fourEyes ?? true) && v.createdBy && v.createdBy === ctx.actor.id) throw validation("Four-eyes rule: the author of a version cannot activate it");
  const now = new Date();
  if (v.policy.currentVersionId && v.policy.currentVersionId !== versionId) {
    await db.policyVersion.update({ where: { id: v.policy.currentVersionId }, data: { state: "retired", retiredAt: now } });
    await db.policyEvent.create({ data: { orgId: ctx.orgId, policyId: v.policyId, versionId: v.policy.currentVersionId, type: "deactivated", actorId: ctx.actor.id, note: `superseded by v${v.version}` } });
  }
  const updated = await db.policyVersion.update({ where: { id: versionId }, data: { state: "active", activatedAt: now, approvedBy: ctx.actor.id } });
  await db.policy.update({ where: { id: v.policyId }, data: { currentVersionId: versionId } });
  await db.policyEvent.create({ data: { orgId: ctx.orgId, policyId: v.policyId, versionId, type: "activated", actorId: ctx.actor.id } });
  await appendEvidence(db, ctx, { type: "policy.activated", subjectType: "policy", subjectId: v.policyId, payload: { versionId, version: v.version, contentHash: v.contentHash, previousVersionId: v.policy.currentVersionId } });
  return updated;
}

export async function deactivatePolicy(db: TenantDb, ctx: OrgContext, policyId: string, reason: string) {
  assertPermission(ctx, "policies:activate");
  const p = await db.policy.findUnique({ where: { id: policyId } });
  if (!p) throw notFound("Policy");
  if (!p.currentVersionId) throw validation("Policy has no active version");
  await db.policyVersion.update({ where: { id: p.currentVersionId }, data: { state: "retired", retiredAt: new Date() } });
  await db.policy.update({ where: { id: policyId }, data: { currentVersionId: null } });
  await db.policyEvent.create({ data: { orgId: ctx.orgId, policyId, versionId: p.currentVersionId, type: "deactivated", actorId: ctx.actor.id, note: reason } });
  await appendEvidence(db, ctx, { type: "policy.deactivated", subjectType: "policy", subjectId: policyId, payload: { versionId: p.currentVersionId, reason } });
}

/** Rollback = a new version whose document is copied from an older one, then activated. History is preserved. */
export async function rollbackToVersion(db: TenantDb, ctx: OrgContext, targetVersionId: string, reason: string) {
  assertPermission(ctx, "policies:activate");
  const target = await db.policyVersion.findUnique({ where: { id: targetVersionId }, include: { policy: { include: { versions: { orderBy: { version: "desc" }, take: 1 } } } } });
  if (!target) throw notFound("Policy version");
  const latest = target.policy.versions[0]!;
  const now = new Date();
  const copy = await db.policyVersion.create({
    data: { orgId: ctx.orgId, policyId: target.policyId, version: latest.version + 1, document: target.document as Prisma.InputJsonValue, contentHash: target.contentHash, state: "active", changeNote: `Rollback to v${target.version}: ${reason}`, createdBy: ctx.actor.id, approvedBy: ctx.actor.id, activatedAt: now },
  });
  if (target.policy.currentVersionId) {
    await db.policyVersion.update({ where: { id: target.policy.currentVersionId }, data: { state: "retired", retiredAt: now } });
  }
  await db.policy.update({ where: { id: target.policyId }, data: { currentVersionId: copy.id } });
  await db.policyEvent.create({ data: { orgId: ctx.orgId, policyId: target.policyId, versionId: copy.id, type: "rolled_back", actorId: ctx.actor.id, note: `to v${target.version}: ${reason}` } });
  await appendEvidence(db, ctx, { type: "policy.rolled_back", subjectType: "policy", subjectId: target.policyId, payload: { fromVersionId: target.policy.currentVersionId, toVersionId: copy.id, sourceVersion: target.version, reason } });
  return copy;
}

export const assignmentSchema = z.object({ targetType: z.enum(["agent", "team", "org"]), targetId: z.string().uuid().nullable().optional(), priority: z.number().int().min(1).max(1000).default(100) });

export async function assignPolicy(db: TenantDb, ctx: OrgContext, policyId: string, input: z.infer<typeof assignmentSchema>) {
  assertPermission(ctx, "policies:activate");
  if (input.targetType !== "org" && !input.targetId) throw validation("targetId is required");
  const existing = await db.policyAssignment.findFirst({ where: { policyId, targetType: input.targetType, targetId: input.targetType === "org" ? null : input.targetId } });
  if (existing) return existing;
  const row = await db.policyAssignment.create({ data: { orgId: ctx.orgId, policyId, targetType: input.targetType, targetId: input.targetType === "org" ? null : input.targetId, priority: input.priority, createdBy: ctx.actor.id } });
  await appendEvidence(db, ctx, { type: "policy.assigned", subjectType: "policy", subjectId: policyId, payload: { targetType: input.targetType, targetId: row.targetId } });
  return row;
}

export async function unassignPolicy(db: TenantDb, ctx: OrgContext, assignmentId: string) {
  assertPermission(ctx, "policies:activate");
  const a = await db.policyAssignment.findUnique({ where: { id: assignmentId } });
  if (!a) throw notFound("Assignment");
  await db.policyAssignment.delete({ where: { id: assignmentId } });
  await appendEvidence(db, ctx, { type: "policy.unassigned", subjectType: "policy", subjectId: a.policyId, payload: { targetType: a.targetType, targetId: a.targetId } });
}

/** Active policy versions that apply to an agent, ordered by assignment priority then key. */
export async function resolvePoliciesForAgent(db: TenantDb, orgId: string, agent: { id: string; teamId: string | null }): Promise<PolicyToEvaluate[]> {
  const assignments = await db.policyAssignment.findMany({
    where: { orgId, OR: [{ targetType: "org" }, { targetType: "agent", targetId: agent.id }, ...(agent.teamId ? [{ targetType: "team" as const, targetId: agent.teamId }] : [])] },
    include: { policy: true },
    orderBy: [{ priority: "asc" }],
  });
  const seen = new Set<string>();
  const out: PolicyToEvaluate[] = [];
  for (const a of assignments) {
    if (a.policy.archived || !a.policy.currentVersionId || seen.has(a.policyId)) continue;
    seen.add(a.policyId);
    const v = await db.policyVersion.findUnique({ where: { id: a.policy.currentVersionId } });
    if (!v || v.state !== "active") continue;
    out.push({ policyKey: a.policy.key, policyVersionId: v.id, policyVersion: v.version, document: v.document as unknown as PolicyDocument });
  }
  return out.sort((x, y) => x.policyKey.localeCompare(y.policyKey));
}

/** Policy history across the organization for the Policy History screen. */
export async function listPolicyHistory(db: TenantDb, ctx: OrgContext, opts: { policyId?: string; limit?: number } = {}) {
  assertPermission(ctx, "policies:read");
  return db.policyEvent.findMany({ where: { orgId: ctx.orgId, ...(opts.policyId ? { policyId: opts.policyId } : {}) }, include: { policy: { select: { key: true, name: true } } }, orderBy: { createdAt: "desc" }, take: opts.limit ?? 200 });
}

/** Dry run: evaluate a candidate document (or the active set) against an input without recording anything. */
export function simulatePolicy(document: unknown, input: Record<string, unknown>) {
  const doc = parsePolicyDocument(document);
  return evaluatePolicies([{ policyKey: "simulation", policyVersionId: "simulation", policyVersion: 0, document: doc }], input);
}
