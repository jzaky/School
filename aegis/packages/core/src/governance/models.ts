import { orgSettings } from "../lib/tx-cache.js";
import type { AiModel, ModelStage, Prisma, TenantDb } from "@aegis/db";
import { z } from "zod";
import { appendEvidence } from "../evidence/ledger.js";
import type { OrgContext } from "../lib/context.js";
import { conflict, forbidden, notFound, validation } from "../lib/errors.js";
import { assertPermission, slugSchema } from "../orgs/orgs.js";

/**
 * Model registry and lifecycle (docs/MODEL_DATA_GOVERNANCE.md).
 *
 * proposed -> evaluating -> approved -> deprecated -> retired, with a rejected review returning to
 * proposed and retirement possible from any stage. Moving to evaluating is a request for approval;
 * a different person with policies:activate approves, and only when evaluations exist and none of
 * the latest per kind failed. Evaluations and stage changes are append-only.
 *
 * An organization setting decides what the gateway does when an agent's model is unregistered, not
 * yet approved or retired: nothing (the default), send to a person, or refuse. It can only make a
 * decision stricter.
 */

export const MODEL_STAGES: ModelStage[] = ["proposed", "evaluating", "approved", "deprecated", "retired"];
export const EVALUATION_KINDS = ["accuracy", "safety", "bias", "security", "privacy", "other"] as const;
export const DATA_CATEGORIES = ["personal", "financial", "health", "biometric", "children", "credentials", "location", "employment", "public"] as const;

export const modelInputSchema = z.object({
  key: slugSchema,
  name: z.string().trim().min(2).max(120),
  provider: z.string().trim().min(1).max(80),
  providerModelId: z.string().trim().min(1).max(120),
  version: z.string().trim().max(60).default(""),
  riskTier: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  intendedUse: z.string().trim().max(2000).default(""),
  limitations: z.string().trim().max(2000).default(""),
  dataCategories: z.array(z.enum(DATA_CATEGORIES)).max(DATA_CATEGORIES.length).default([]),
  hostingRegion: z.string().trim().max(80).default(""),
  ownerId: z.string().uuid().nullable().optional(),
  /** Link every agent that reports this provider and model id. */
  linkMatchingAgents: z.boolean().default(true),
});

export const evaluationInputSchema = z.object({
  kind: z.enum(EVALUATION_KINDS),
  result: z.enum(["pass", "conditional", "fail"]),
  summary: z.string().trim().min(10, "Describe what was evaluated and how, in at least 10 characters").max(4000),
  metrics: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).default({}),
  documentId: z.string().uuid().nullable().optional(),
});

export const modelDecisionSchema = z.object({ approve: z.boolean(), note: z.string().trim().min(3, "Give a reason").max(2000), reviewInDays: z.number().int().min(30).max(730).nullable().default(365) });
export const modelStageSchema = z.object({ to: z.enum(["deprecated", "retired"]), reason: z.string().trim().min(5, "Give a reason of at least 5 characters").max(2000) });
export const MODEL_ENFORCEMENT = ["off", "require_approval", "deny"] as const;
export const modelGovernanceSettingSchema = z.object({ enforcement: z.enum(MODEL_ENFORCEMENT) });
export type ModelGovernanceSetting = z.infer<typeof modelGovernanceSettingSchema>;

function requirePerson(ctx: OrgContext, what: string): string {
  if (ctx.actor.type !== "user" || !ctx.actor.id) throw forbidden(`Only a person can ${what}`);
  return ctx.actor.id;
}

async function recordStage(db: TenantDb, ctx: OrgContext, model: AiModel, to: ModelStage, reason: string, data: Prisma.AiModelUpdateInput = {}) {
  const now = ctx.now ?? new Date();
  const updated = await db.aiModel.update({ where: { id: model.id }, data: { ...data, stage: to, updatedAt: now } });
  await db.modelStageChange.create({ data: { orgId: ctx.orgId, modelId: model.id, fromStage: model.stage, toStage: to, reason, actorId: ctx.actor.type === "user" ? ctx.actor.id : null, createdAt: now } });
  await appendEvidence(db, ctx, { type: `model.${to}`, subjectType: "ai_model", subjectId: model.id, payload: { key: model.key, from: model.stage, to, reason } });
  return updated;
}

async function loadModel(db: TenantDb, ctx: OrgContext, id: string) {
  const m = await db.aiModel.findUnique({ where: { id } });
  if (!m || m.orgId !== ctx.orgId) throw notFound("Model");
  return m;
}

export async function registerModel(db: TenantDb, ctx: OrgContext, raw: z.input<typeof modelInputSchema>) {
  assertPermission(ctx, "agents:write");
  const input = modelInputSchema.parse(raw);
  const dup = await db.aiModel.findUnique({ where: { orgId_key: { orgId: ctx.orgId, key: input.key } } });
  if (dup) throw conflict("A model with this key already exists");
  const { linkMatchingAgents, ...data } = input;
  const now = ctx.now ?? new Date();
  const model = await db.aiModel.create({ data: { orgId: ctx.orgId, ...data, ownerId: data.ownerId ?? null, createdBy: ctx.actor.type === "user" ? ctx.actor.id : null, createdAt: now, updatedAt: now } });
  let linked = 0;
  if (linkMatchingAgents) {
    const r = await db.agent.updateMany({ where: { orgId: ctx.orgId, isLab: false, modelRecordId: null, modelProvider: { equals: input.provider, mode: "insensitive" }, modelId: { equals: input.providerModelId, mode: "insensitive" } }, data: { modelRecordId: model.id } });
    linked = r.count;
  }
  await appendEvidence(db, ctx, { type: "model.registered", subjectType: "ai_model", subjectId: model.id, payload: { key: model.key, provider: model.provider, providerModelId: model.providerModelId, version: model.version, riskTier: model.riskTier, agentsLinked: linked } });
  return { model, agentsLinked: linked };
}

export async function updateModel(db: TenantDb, ctx: OrgContext, id: string, raw: Partial<z.input<typeof modelInputSchema>>) {
  assertPermission(ctx, "agents:write");
  const model = await loadModel(db, ctx, id);
  if (model.stage === "retired") throw validation("A retired model cannot be edited");
  const { key: _key, linkMatchingAgents: _link, ...patch } = modelInputSchema.partial().parse(raw);
  const updated = await db.aiModel.update({ where: { id }, data: patch });
  await appendEvidence(db, ctx, { type: "model.updated", subjectType: "ai_model", subjectId: id, payload: { fields: Object.keys(patch) } });
  return updated;
}

export async function recordEvaluation(db: TenantDb, ctx: OrgContext, modelId: string, raw: z.input<typeof evaluationInputSchema>) {
  assertPermission(ctx, "agents:write");
  const by = requirePerson(ctx, "record a model evaluation");
  const model = await loadModel(db, ctx, modelId);
  if (model.stage === "retired") throw validation("A retired model takes no new evaluations");
  const input = evaluationInputSchema.parse(raw);
  const ev = await db.modelEvaluation.create({ data: { orgId: ctx.orgId, modelId, kind: input.kind, result: input.result, summary: input.summary, metrics: input.metrics as Prisma.InputJsonValue, documentId: input.documentId ?? null, recordedBy: by, createdAt: ctx.now ?? new Date() } });
  await appendEvidence(db, ctx, { type: "model.evaluation_recorded", subjectType: "ai_model", subjectId: modelId, payload: { evaluationId: ev.id, kind: ev.kind, result: ev.result } });
  return ev;
}

/** The latest evaluation of each kind, and whether they allow approval. */
export async function evaluationStanding(db: TenantDb, modelId: string) {
  const evaluations = await db.modelEvaluation.findMany({ where: { modelId }, orderBy: { createdAt: "desc" } });
  const latest = new Map<string, (typeof evaluations)[number]>();
  for (const e of evaluations) if (!latest.has(e.kind)) latest.set(e.kind, e);
  const failing = [...latest.values()].filter((e) => e.result === "fail").map((e) => e.kind);
  const reasons: string[] = [];
  if (evaluations.length === 0) reasons.push("No evaluation has been recorded");
  if (failing.length) reasons.push(`The latest ${failing.join(", ")} evaluation failed`);
  return { evaluations, latest: [...latest.values()], approvable: reasons.length === 0, reasons };
}

export async function requestModelApproval(db: TenantDb, ctx: OrgContext, modelId: string, note: string) {
  assertPermission(ctx, "agents:write");
  const by = requirePerson(ctx, "ask for a model approval");
  const model = await loadModel(db, ctx, modelId);
  if (model.stage !== "proposed") throw validation(`A ${model.stage} model cannot be sent for approval`);
  const standing = await evaluationStanding(db, modelId);
  if (!standing.approvable) throw validation(standing.reasons.join("; "));
  return recordStage(db, ctx, model, "evaluating", note.trim() || "Sent for approval", { approvalRequestedBy: by });
}

export async function decideModelApproval(db: TenantDb, ctx: OrgContext, modelId: string, raw: z.input<typeof modelDecisionSchema>) {
  assertPermission(ctx, "policies:activate");
  const by = requirePerson(ctx, "approve a model");
  const input = modelDecisionSchema.parse(raw);
  const model = await loadModel(db, ctx, modelId);
  if (model.stage !== "evaluating") throw validation("Only a model waiting for approval can be decided");
  if (model.approvalRequestedBy === by) throw forbidden("The person who asked for approval cannot approve the model");
  const now = ctx.now ?? new Date();
  if (!input.approve) return recordStage(db, ctx, model, "proposed", `Rejected: ${input.note}`, { approvalRequestedBy: null });
  const standing = await evaluationStanding(db, modelId);
  if (!standing.approvable) throw validation(standing.reasons.join("; "));
  return recordStage(db, ctx, model, "approved", input.note, { approvedBy: by, approvedAt: now, reviewDueAt: input.reviewInDays ? new Date(now.getTime() + input.reviewInDays * 86_400_000) : null });
}

export async function changeModelStage(db: TenantDb, ctx: OrgContext, modelId: string, raw: z.input<typeof modelStageSchema>) {
  assertPermission(ctx, "policies:activate");
  requirePerson(ctx, "deprecate or retire a model");
  const input = modelStageSchema.parse(raw);
  const model = await loadModel(db, ctx, modelId);
  if (model.stage === "retired") throw validation("The model is already retired");
  if (input.to === "deprecated" && model.stage !== "approved") throw validation("Only an approved model can be deprecated");
  const updated = await recordStage(db, ctx, model, input.to, input.reason);
  const agents = await db.agent.findMany({ where: { modelRecordId: modelId, isLab: false, status: { notIn: ["revoked", "archived"] } }, select: { id: true, slug: true, name: true } });
  return { model: updated, agentsAffected: agents };
}

export async function linkAgentModel(db: TenantDb, ctx: OrgContext, agentId: string, modelId: string | null) {
  assertPermission(ctx, "agents:write");
  const agent = await db.agent.findUnique({ where: { id: agentId } });
  if (!agent || agent.orgId !== ctx.orgId || agent.isLab) throw notFound("Agent");
  if (modelId) await loadModel(db, ctx, modelId);
  await db.agent.update({ where: { id: agentId }, data: { modelRecordId: modelId } });
  await appendEvidence(db, ctx, { type: "agent.model_linked", subjectType: "agent", subjectId: agentId, payload: { from: agent.modelRecordId, to: modelId } });
}

export type ModelGateStatus = "ok" | "unregistered" | "not_approved" | "retired" | "deprecated" | "review_overdue";

/** What the registry says about an agent's model. Enforced statuses: unregistered, not_approved, retired. */
export function modelGateCheck(model: Pick<AiModel, "stage" | "reviewDueAt" | "key"> | null, now: Date): { status: ModelGateStatus; enforce: boolean; reason: string | null } {
  if (!model) return { status: "unregistered", enforce: true, reason: "The agent's model is not in the model registry" };
  if (model.stage === "retired") return { status: "retired", enforce: true, reason: `Model ${model.key} is retired` };
  if (model.stage === "proposed" || model.stage === "evaluating") return { status: "not_approved", enforce: true, reason: `Model ${model.key} is not approved (${model.stage})` };
  if (model.stage === "deprecated") return { status: "deprecated", enforce: false, reason: `Model ${model.key} is deprecated` };
  if (model.reviewDueAt && model.reviewDueAt < now) return { status: "review_overdue", enforce: false, reason: `Model ${model.key} is past its review date` };
  return { status: "ok", enforce: false, reason: null };
}

const RANK: Record<string, number> = { allow: 0, restrict: 1, require_approval: 2, request_more_information: 3, quarantine: 4, deny: 5, error: 5 };

/** The stricter of the current outcome and the configured enforcement, when the check is enforced. Never loosens. */
export function escalateForModel<T extends string>(outcome: T, check: { enforce: boolean }, setting: ModelGovernanceSetting): { outcome: T | "require_approval" | "deny"; escalated: boolean } {
  if (setting.enforcement === "off" || !check.enforce) return { outcome, escalated: false };
  if ((RANK[setting.enforcement] ?? 0) <= (RANK[outcome] ?? 5)) return { outcome, escalated: false };
  return { outcome: setting.enforcement, escalated: true };
}

export function readModelGovernance(settings: unknown): ModelGovernanceSetting {
  const parsed = modelGovernanceSettingSchema.safeParse((settings as { governance?: { models?: unknown } } | null)?.governance?.models);
  return parsed.success ? parsed.data : { enforcement: "off" };
}

export async function getModelGovernance(db: TenantDb, orgId: string): Promise<ModelGovernanceSetting> {
  const org = { settings: await orgSettings(db, orgId) };
  return readModelGovernance(org?.settings);
}

export async function updateModelGovernance(db: TenantDb, ctx: OrgContext, raw: z.input<typeof modelGovernanceSettingSchema>) {
  assertPermission(ctx, "policies:activate");
  requirePerson(ctx, "change model enforcement");
  const data = modelGovernanceSettingSchema.parse(raw);
  const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { settings: true } });
  const settings = (org.settings ?? {}) as Record<string, unknown>;
  const governance = { ...((settings.governance ?? {}) as Record<string, unknown>), models: data };
  await db.organization.update({ where: { id: ctx.orgId }, data: { settings: { ...settings, governance } as Prisma.InputJsonValue } });
  await appendEvidence(db, ctx, { type: "model.enforcement_changed", subjectType: "organization", subjectId: ctx.orgId, payload: { ...data } });
  return data;
}

export async function listModels(db: TenantDb, ctx: OrgContext) {
  assertPermission(ctx, "agents:read");
  const now = ctx.now ?? new Date();
  const [models, agents, evals] = await Promise.all([
    db.aiModel.findMany({ where: { orgId: ctx.orgId }, orderBy: [{ stage: "asc" }, { name: "asc" }] }),
    db.agent.findMany({ where: { orgId: ctx.orgId, isLab: false, status: { not: "archived" } }, select: { id: true, slug: true, name: true, status: true, modelProvider: true, modelId: true, modelRecordId: true } }),
    db.modelEvaluation.groupBy({ by: ["modelId"], where: { orgId: ctx.orgId }, _count: { _all: true } }),
  ]);
  const evalCount = new Map(evals.map((e) => [e.modelId, e._count._all]));
  const rows = models.map((m) => ({ ...m, agents: agents.filter((a) => a.modelRecordId === m.id), evaluations: evalCount.get(m.id) ?? 0, gate: modelGateCheck(m, now) }));
  const unlinkedAgents = agents.filter((a) => !a.modelRecordId);
  return { models: rows, unlinkedAgents };
}

export async function getModel(db: TenantDb, ctx: OrgContext, id: string) {
  assertPermission(ctx, "agents:read");
  const model = await loadModel(db, ctx, id);
  const [standing, stageChanges, agents] = await Promise.all([
    evaluationStanding(db, id),
    db.modelStageChange.findMany({ where: { modelId: id }, orderBy: { createdAt: "desc" } }),
    db.agent.findMany({ where: { modelRecordId: id, isLab: false }, select: { id: true, slug: true, name: true, status: true } }),
  ]);
  return { model, evaluations: standing.evaluations, approvable: standing.approvable, approvalBlockers: standing.reasons, stageChanges, agents, gate: modelGateCheck(model, ctx.now ?? new Date()) };
}
