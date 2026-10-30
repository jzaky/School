import type { TenantDb } from "@aegis/db";
import { z } from "zod";
import { env } from "../env.js";
import { appendEvidence } from "../evidence/ledger.js";
import { hmacHex, sha256Hex } from "../lib/crypto.js";
import type { OrgContext } from "../lib/context.js";
import { conflict, forbidden, notFound, validation } from "../lib/errors.js";
import { assertPermission, slugSchema } from "../orgs/orgs.js";
import { DATA_CATEGORIES } from "./models.js";
import { parsePatch } from "../lib/patch.js";

/**
 * Dataset inventory, access auditing and deletion requests (docs/MODEL_DATA_GOVERNANCE.md).
 *
 * A dataset can be tied to the gateway resource that fronts it. Its access audit is then derived
 * from facts AEGIS holds: which agents hold permissions on that resource, and which requests reached
 * it, decided how. Storage location and region are what the organization declares; AEGIS does not
 * verify them.
 *
 * Deletion requests are a two-person workflow. AEGIS records the request, the decision and the
 * completion attestation; the deletion itself happens in the customer's system. The subject reference
 * is never stored: only a keyed hash (to spot duplicates) and its last four characters.
 */

export const datasetInputSchema = z.object({
  key: slugSchema,
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000).default(""),
  ownerId: z.string().uuid().nullable().optional(),
  classification: z.enum(["public", "internal", "confidential", "restricted"]).default("internal"),
  categories: z.array(z.enum(DATA_CATEGORIES)).max(DATA_CATEGORIES.length).default([]),
  resourceId: z.string().uuid().nullable().optional(),
  storageLocation: z.string().trim().max(200).default(""),
  region: z.string().trim().max(80).default(""),
  retentionDays: z.number().int().min(1).max(36_500).nullable().optional(),
  lawfulBasis: z.string().trim().max(500).default(""),
});

export const deletionRequestSchema = z.object({
  datasetId: z.string().uuid(),
  /** The customer's reference for the data subject. Hashed on arrival; never stored or logged. */
  subjectRef: z.string().trim().min(4).max(200),
  reason: z.string().trim().min(5).max(1000),
  dueInDays: z.number().int().min(1).max(90).default(30),
});
export const deletionDecisionSchema = z.object({ approve: z.boolean(), note: z.string().trim().min(3).max(1000) });
export const deletionCompletionSchema = z.object({ reference: z.string().trim().min(3, "Give the reference of the deletion in your system").max(200) });

function requirePerson(ctx: OrgContext, what: string): string {
  if (ctx.actor.type !== "user" || !ctx.actor.id) throw forbidden(`Only a person can ${what}`);
  return ctx.actor.id;
}

/** Keyed hash of a subject reference, scoped to the organization. */
export function subjectRefHash(orgId: string, subjectRef: string): string {
  const key = sha256Hex(`aegis-deletion-subject:${env().AEGIS_MASTER_KEY}`);
  return hmacHex(key, `${orgId}:${subjectRef.trim().toLowerCase()}`);
}

async function loadDataset(db: TenantDb, ctx: OrgContext, id: string) {
  const d = await db.dataset.findUnique({ where: { id } });
  if (!d || d.orgId !== ctx.orgId) throw notFound("Dataset");
  return d;
}

export async function registerDataset(db: TenantDb, ctx: OrgContext, raw: z.input<typeof datasetInputSchema>) {
  assertPermission(ctx, "security:write");
  const input = datasetInputSchema.parse(raw);
  const dup = await db.dataset.findUnique({ where: { orgId_key: { orgId: ctx.orgId, key: input.key } } });
  if (dup) throw conflict("A dataset with this key already exists");
  if (input.resourceId) {
    const r = await db.resource.findUnique({ where: { id: input.resourceId } });
    if (!r || r.orgId !== ctx.orgId) throw notFound("Resource");
  }
  const now = ctx.now ?? new Date();
  const ds = await db.dataset.create({ data: { orgId: ctx.orgId, ...input, ownerId: input.ownerId ?? null, resourceId: input.resourceId ?? null, retentionDays: input.retentionDays ?? null, createdBy: ctx.actor.type === "user" ? ctx.actor.id : null, createdAt: now, updatedAt: now } });
  await appendEvidence(db, ctx, { type: "dataset.registered", subjectType: "dataset", subjectId: ds.id, payload: { key: ds.key, classification: ds.classification, categories: ds.categories, region: ds.region, retentionDays: ds.retentionDays, resourceId: ds.resourceId } });
  return ds;
}

export async function updateDataset(db: TenantDb, ctx: OrgContext, id: string, raw: Partial<z.input<typeof datasetInputSchema>>) {
  assertPermission(ctx, "security:write");
  await loadDataset(db, ctx, id);
  const { key: _key, ...patch } = parsePatch(datasetInputSchema, raw);
  const ds = await db.dataset.update({ where: { id }, data: patch });
  await appendEvidence(db, ctx, { type: "dataset.updated", subjectType: "dataset", subjectId: id, payload: { fields: Object.keys(patch) } });
  return ds;
}

/** Gaps the inventory flags for a dataset. */
export function datasetFindings(ds: { ownerId: string | null; retentionDays: number | null; lawfulBasis: string; categories: string[]; region: string; resourceId: string | null; classification: string }): string[] {
  const out: string[] = [];
  if (!ds.ownerId) out.push("No owner");
  if (ds.retentionDays === null) out.push("No retention period");
  if (ds.categories.includes("personal") && !ds.lawfulBasis) out.push("Personal data without a recorded lawful basis");
  if (!ds.region) out.push("No storage region recorded");
  if (!ds.resourceId) out.push("Not tied to a gateway resource, so agent access cannot be audited");
  return out;
}

export async function listDatasets(db: TenantDb, ctx: OrgContext) {
  assertPermission(ctx, "security:read");
  const now = ctx.now ?? new Date();
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const datasets = await db.dataset.findMany({ where: { orgId: ctx.orgId }, orderBy: { name: "asc" } });
  const resourceIds = datasets.map((d) => d.resourceId).filter((x): x is string => !!x);
  const [resources, perms, pending] = await Promise.all([
    db.resource.findMany({ where: { id: { in: resourceIds } }, select: { id: true, key: true, name: true } }),
    db.permission.findMany({ where: { resourceId: { in: resourceIds }, revokedAt: null, agent: { isLab: false, status: { in: ["active", "suspended", "registered"] } } }, select: { resourceId: true, agentId: true } }),
    db.dataDeletionRequest.groupBy({ by: ["datasetId"], where: { orgId: ctx.orgId, status: { in: ["requested", "approved"] } }, _count: { _all: true } }),
  ]);
  const resById = new Map(resources.map((r) => [r.id, r]));
  const requests = resources.length ? await db.actionRequest.groupBy({ by: ["resourceKey"], where: { orgId: ctx.orgId, resourceKey: { in: resources.map((r) => r.key) }, createdAt: { gte: since }, agent: { isLab: false } }, _count: { _all: true } }) : [];
  const reqByKey = new Map(requests.map((r) => [r.resourceKey, r._count._all]));
  const pendingBy = new Map(pending.map((p) => [p.datasetId, p._count._all]));
  return datasets.map((d) => {
    const res = d.resourceId ? (resById.get(d.resourceId) ?? null) : null;
    return { ...d, resource: res, agentsWithAccess: perms.filter((p) => p.resourceId === d.resourceId).length, requests30d: res ? (reqByKey.get(res.key) ?? 0) : 0, openDeletionRequests: pendingBy.get(d.id) ?? 0, findings: datasetFindings(d) };
  });
}

/** Who can reach the dataset through AEGIS and what reached it, from permissions and gateway requests. */
export async function datasetAccessAudit(db: TenantDb, ctx: OrgContext, id: string, days = 30) {
  assertPermission(ctx, "security:read");
  const ds = await loadDataset(db, ctx, id);
  const now = ctx.now ?? new Date();
  const since = new Date(now.getTime() - days * 86_400_000);
  const resource = ds.resourceId ? await db.resource.findUnique({ where: { id: ds.resourceId } }) : null;
  if (!resource) return { dataset: ds, resource: null, findings: datasetFindings(ds), access: [], requests: [], byOutcome: {}, deletionRequests: await db.dataDeletionRequest.findMany({ where: { datasetId: id }, orderBy: { createdAt: "desc" } }) };
  const [perms, requests, deletionRequests] = await Promise.all([
    db.permission.findMany({ where: { resourceId: resource.id, revokedAt: null, agent: { isLab: false } }, include: { agent: { select: { id: true, slug: true, name: true, status: true, dataClassificationLimit: true } } } }),
    db.actionRequest.findMany({ where: { orgId: ctx.orgId, resourceKey: resource.key, createdAt: { gte: since }, agent: { isLab: false } }, orderBy: { createdAt: "desc" }, take: 200, select: { id: true, toolKey: true, action: true, status: true, createdAt: true, agent: { select: { slug: true, name: true } } } }),
    db.dataDeletionRequest.findMany({ where: { datasetId: id }, orderBy: { createdAt: "desc" } }),
  ]);
  const byOutcome: Record<string, number> = {};
  for (const r of requests) byOutcome[r.status] = (byOutcome[r.status] ?? 0) + 1;
  const RANKS = ["public", "internal", "confidential", "restricted"];
  const access = perms.map((p) => ({ agent: p.agent, actions: p.actions, expiresAt: p.expiresAt, aboveClearance: RANKS.indexOf(ds.classification) > RANKS.indexOf(p.agent.dataClassificationLimit) }));
  return { dataset: ds, resource, findings: datasetFindings(ds), access, requests, byOutcome, deletionRequests };
}

export async function requestDeletion(db: TenantDb, ctx: OrgContext, raw: z.input<typeof deletionRequestSchema>) {
  assertPermission(ctx, "security:write");
  const by = requirePerson(ctx, "request a data deletion");
  const input = deletionRequestSchema.parse(raw);
  const ds = await loadDataset(db, ctx, input.datasetId);
  const hash = subjectRefHash(ctx.orgId, input.subjectRef);
  const open = await db.dataDeletionRequest.findFirst({ where: { datasetId: ds.id, subjectRefHash: hash, status: { in: ["requested", "approved"] } } });
  if (open) throw conflict("An open deletion request already exists for this subject in this dataset");
  const now = ctx.now ?? new Date();
  const req = await db.dataDeletionRequest.create({ data: { orgId: ctx.orgId, datasetId: ds.id, subjectRefHash: hash, subjectHint: input.subjectRef.trim().slice(-4), reason: input.reason, dueAt: new Date(now.getTime() + input.dueInDays * 86_400_000), requestedBy: by, createdAt: now, updatedAt: now } });
  await appendEvidence(db, ctx, { type: "data.deletion_requested", subjectType: "data_deletion_request", subjectId: req.id, payload: { datasetId: ds.id, dataset: ds.key, dueAt: req.dueAt, subjectRefHash: hash } });
  return req;
}

async function loadRequest(db: TenantDb, ctx: OrgContext, id: string) {
  const r = await db.dataDeletionRequest.findUnique({ where: { id } });
  if (!r || r.orgId !== ctx.orgId) throw notFound("Deletion request");
  return r;
}

export async function decideDeletion(db: TenantDb, ctx: OrgContext, id: string, raw: z.input<typeof deletionDecisionSchema>) {
  assertPermission(ctx, "security:write");
  const by = requirePerson(ctx, "decide a data deletion");
  const input = deletionDecisionSchema.parse(raw);
  const r = await loadRequest(db, ctx, id);
  if (r.status !== "requested") throw validation(`The request is already ${r.status}`);
  if (r.requestedBy === by) throw forbidden("The person who requested the deletion cannot decide it");
  const now = ctx.now ?? new Date();
  const updated = await db.dataDeletionRequest.update({ where: { id }, data: { status: input.approve ? "approved" : "rejected", decidedBy: by, decidedAt: now, decisionNote: input.note, updatedAt: now } });
  await appendEvidence(db, ctx, { type: input.approve ? "data.deletion_approved" : "data.deletion_rejected", subjectType: "data_deletion_request", subjectId: id, payload: { note: input.note } });
  return updated;
}

/** Records that the deletion was carried out in the customer's system. AEGIS does not perform or verify it. */
export async function completeDeletion(db: TenantDb, ctx: OrgContext, id: string, raw: z.input<typeof deletionCompletionSchema>) {
  assertPermission(ctx, "security:write");
  const by = requirePerson(ctx, "record a completed deletion");
  const input = deletionCompletionSchema.parse(raw);
  const r = await loadRequest(db, ctx, id);
  if (r.status !== "approved") throw validation("Only an approved request can be completed");
  const now = ctx.now ?? new Date();
  const updated = await db.dataDeletionRequest.update({ where: { id }, data: { status: "completed", completedBy: by, completedAt: now, completionReference: input.reference, updatedAt: now } });
  await appendEvidence(db, ctx, { type: "data.deletion_completed", subjectType: "data_deletion_request", subjectId: id, payload: { reference: input.reference, attestedBy: by, overdue: now > r.dueAt } });
  return updated;
}

export function deletionOverdue(r: { status: string; dueAt: Date }, now: Date): boolean {
  return (r.status === "requested" || r.status === "approved") && r.dueAt < now;
}

export type DatasetRow = Awaited<ReturnType<typeof listDatasets>>[number];
