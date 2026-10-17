import type { Prisma, RegulatoryChangeStatus, TenantDb } from "@aegis/db";
import { z } from "zod";
import { appendEvidence } from "../evidence/ledger.js";
import type { OrgContext } from "../lib/context.js";
import { notFound, validation } from "../lib/errors.js";
import { assertPermission } from "../orgs/orgs.js";
import { tokenize } from "../audit/retrieval.js";
import { createTask } from "../audit/remediation.js";

/**
 * Regulatory change register (docs/MODEL_DATA_GOVERNANCE.md).
 *
 * People record a change (a new law, guidance, a standard revision), assess its impact on the
 * organization's controls, policies, agents, models and datasets, and turn it into remediation tasks.
 * AEGIS does not monitor regulators or interpret law: every entry and every assessment is a person's.
 * The impact suggestion is a lexical match against the linked framework's controls and the
 * organization's inventory, labelled as such.
 */

export const REGULATORY_STATUSES: RegulatoryChangeStatus[] = ["new", "assessing", "action_required", "implemented", "not_applicable"];

export const regulatoryChangeSchema = z.object({
  title: z.string().trim().min(5).max(200),
  source: z.string().trim().min(2).max(200),
  reference: z.string().trim().max(500).default(""),
  jurisdiction: z.string().trim().max(80).default(""),
  frameworkId: z.string().uuid().nullable().optional(),
  publishedAt: z.coerce.date().nullable().optional(),
  effectiveAt: z.coerce.date().nullable().optional(),
  summary: z.string().trim().max(5000).default(""),
  ownerId: z.string().uuid().nullable().optional(),
});

const ids = z.array(z.string().uuid()).max(200).default([]);
export const impactSchema = z.object({ controls: ids, policies: ids, agents: ids, models: ids, datasets: ids, notes: z.string().trim().max(5000).default("") });
export type Impact = z.infer<typeof impactSchema>;

export const assessmentSchema = z.object({
  status: z.enum(["assessing", "action_required", "not_applicable"]),
  impact: impactSchema,
  note: z.string().trim().min(5, "Explain the assessment in at least 5 characters").max(5000),
});

export const regulatoryActionSchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(5000).default(""),
  ownerId: z.string().uuid().nullable().optional(),
  dueAt: z.coerce.date().nullable().optional(),
});

async function loadChange(db: TenantDb, ctx: OrgContext, id: string) {
  const c = await db.regulatoryChange.findUnique({ where: { id } });
  if (!c || c.orgId !== ctx.orgId) throw notFound("Regulatory change");
  return c;
}

export async function createRegulatoryChange(db: TenantDb, ctx: OrgContext, raw: z.input<typeof regulatoryChangeSchema>) {
  assertPermission(ctx, "audit:write");
  const input = regulatoryChangeSchema.parse(raw);
  if (input.frameworkId) {
    const f = await db.framework.findUnique({ where: { id: input.frameworkId } });
    if (!f || (f.orgId !== null && f.orgId !== ctx.orgId)) throw notFound("Framework");
  }
  const now = ctx.now ?? new Date();
  const c = await db.regulatoryChange.create({ data: { orgId: ctx.orgId, ...input, frameworkId: input.frameworkId ?? null, publishedAt: input.publishedAt ?? null, effectiveAt: input.effectiveAt ?? null, ownerId: input.ownerId ?? null, impact: impactSchema.parse({}) as Prisma.InputJsonValue, createdBy: ctx.actor.type === "user" ? ctx.actor.id : null, createdAt: now, updatedAt: now } });
  await appendEvidence(db, ctx, { type: "regulatory.change_recorded", subjectType: "regulatory_change", subjectId: c.id, payload: { title: c.title, source: c.source, jurisdiction: c.jurisdiction, effectiveAt: c.effectiveAt } });
  return c;
}

/** Ids in the impact must belong to this organization (or, for controls, to a framework it can see). */
async function validateImpact(db: TenantDb, ctx: OrgContext, impact: Impact) {
  const check = async (label: string, wanted: string[], found: number) => {
    if (found !== new Set(wanted).size) throw validation(`Unknown ${label} in the impact assessment`);
  };
  if (impact.controls.length) await check("control", impact.controls, await db.control.count({ where: { id: { in: impact.controls }, framework: { OR: [{ orgId: null }, { orgId: ctx.orgId }] } } }));
  if (impact.policies.length) await check("policy", impact.policies, await db.policy.count({ where: { id: { in: impact.policies } } }));
  if (impact.agents.length) await check("agent", impact.agents, await db.agent.count({ where: { id: { in: impact.agents }, isLab: false } }));
  if (impact.models.length) await check("model", impact.models, await db.aiModel.count({ where: { id: { in: impact.models } } }));
  if (impact.datasets.length) await check("dataset", impact.datasets, await db.dataset.count({ where: { id: { in: impact.datasets } } }));
}

/**
 * A lexical suggestion of what a change touches: controls of the linked framework whose title,
 * summary or keywords share terms with the change, and inventory items named in it or matching its
 * data categories. A starting point for a person's assessment, never the assessment itself.
 */
export async function suggestImpact(db: TenantDb, ctx: OrgContext, id: string) {
  assertPermission(ctx, "audit:read");
  const c = await loadChange(db, ctx, id);
  const terms = new Set(tokenize(`${c.title} ${c.summary}`));
  const score = (text: string) => tokenize(text).filter((t) => terms.has(t)).length;
  const controls = c.frameworkId
    ? (await db.control.findMany({ where: { frameworkId: c.frameworkId }, select: { id: true, code: true, title: true, summary: true, keywords: true } }))
        .map((k) => ({ id: k.id, label: `${k.code} ${k.title}`, score: score(`${k.title} ${k.summary} ${k.keywords.join(" ")}`) }))
        .filter((k) => k.score >= 2)
        .sort((a, b) => b.score - a.score)
        .slice(0, 15)
    : [];
  const text = `${c.title} ${c.summary}`.toLowerCase();
  const [policies, models, datasets, agents] = await Promise.all([
    db.policy.findMany({ select: { id: true, key: true, name: true, description: true } }),
    db.aiModel.findMany({ where: { stage: { not: "retired" } }, select: { id: true, key: true, name: true, dataCategories: true, riskTier: true } }),
    db.dataset.findMany({ select: { id: true, key: true, name: true, categories: true } }),
    db.agent.findMany({ where: { isLab: false, status: { notIn: ["revoked", "archived"] } }, select: { id: true, slug: true, name: true, riskTier: true } }),
  ]);
  const mentionsCategory = (cats: string[]) => cats.some((cat) => text.includes(cat));
  const mentionsAi = /\b(ai|artificial intelligence|model|models|automated decision|machine learning)\b/.test(text);
  return {
    basis: "lexical" as const,
    controls,
    policies: policies.map((p) => ({ id: p.id, label: p.name, score: score(`${p.name} ${p.description}`) })).filter((p) => p.score >= 2).sort((a, b) => b.score - a.score).slice(0, 10),
    models: models.filter((m) => text.includes(m.key) || text.includes(m.name.toLowerCase()) || mentionsCategory(m.dataCategories) || (mentionsAi && (m.riskTier === "high" || m.riskTier === "critical"))).map((m) => ({ id: m.id, label: m.name })),
    datasets: datasets.filter((d) => text.includes(d.key) || text.includes(d.name.toLowerCase()) || mentionsCategory(d.categories)).map((d) => ({ id: d.id, label: d.name })),
    agents: agents.filter((a) => text.includes(a.slug) || text.includes(a.name.toLowerCase()) || (mentionsAi && (a.riskTier === "high" || a.riskTier === "critical"))).map((a) => ({ id: a.id, label: a.name })),
  };
}

export async function assessRegulatoryChange(db: TenantDb, ctx: OrgContext, id: string, raw: z.input<typeof assessmentSchema>) {
  assertPermission(ctx, "audit:write");
  const input = assessmentSchema.parse(raw);
  const c = await loadChange(db, ctx, id);
  if (c.status === "implemented") throw validation("An implemented change is closed; record a new change to reopen it");
  await validateImpact(db, ctx, input.impact);
  const now = ctx.now ?? new Date();
  const updated = await db.regulatoryChange.update({ where: { id }, data: { status: input.status, impact: input.impact as Prisma.InputJsonValue, decisionNote: input.note, assessedBy: ctx.actor.type === "user" ? ctx.actor.id : null, assessedAt: now, updatedAt: now } });
  await appendEvidence(db, ctx, { type: "regulatory.change_assessed", subjectType: "regulatory_change", subjectId: id, payload: { status: input.status, impact: { controls: input.impact.controls.length, policies: input.impact.policies.length, agents: input.impact.agents.length, models: input.impact.models.length, datasets: input.impact.datasets.length }, note: input.note } });
  return updated;
}

/** Turns part of a change into a remediation task, tracked with the change. */
export async function addRegulatoryAction(db: TenantDb, ctx: OrgContext, id: string, raw: z.input<typeof regulatoryActionSchema>) {
  assertPermission(ctx, "audit:write");
  const input = regulatoryActionSchema.parse(raw);
  const c = await loadChange(db, ctx, id);
  if (c.status === "implemented" || c.status === "not_applicable") throw validation(`The change is ${c.status.replace("_", " ")}; no new actions`);
  const task = await createTask(db, ctx, { title: input.title, description: `${input.description}\n\nFrom regulatory change: ${c.title}`.trim(), ownerId: input.ownerId ?? undefined, dueAt: input.dueAt ?? c.effectiveAt ?? undefined });
  const now = ctx.now ?? new Date();
  await db.regulatoryChange.update({ where: { id }, data: { remediationTaskIds: [...c.remediationTaskIds, task.id], status: "action_required", updatedAt: now } });
  await appendEvidence(db, ctx, { type: "regulatory.action_added", subjectType: "regulatory_change", subjectId: id, payload: { remediationTaskId: task.id, title: task.title } });
  return task;
}

/** Closes a change once every linked task is resolved. */
export async function markRegulatoryImplemented(db: TenantDb, ctx: OrgContext, id: string, note: string) {
  assertPermission(ctx, "audit:write");
  const c = await loadChange(db, ctx, id);
  if (c.status !== "action_required") throw validation("Only a change with actions can be marked implemented");
  const open = await db.remediationTask.count({ where: { id: { in: c.remediationTaskIds }, status: { not: "resolved" } } });
  if (open > 0) throw validation(`${open} linked task${open === 1 ? " is" : "s are"} not resolved yet`);
  if (note.trim().length < 5) throw validation("Describe how the change was implemented");
  const now = ctx.now ?? new Date();
  const updated = await db.regulatoryChange.update({ where: { id }, data: { status: "implemented", decisionNote: note.trim(), updatedAt: now } });
  await appendEvidence(db, ctx, { type: "regulatory.change_implemented", subjectType: "regulatory_change", subjectId: id, payload: { note: note.trim(), tasks: c.remediationTaskIds.length } });
  return updated;
}

export async function listRegulatoryChanges(db: TenantDb, ctx: OrgContext) {
  assertPermission(ctx, "audit:read");
  const now = ctx.now ?? new Date();
  const soon = new Date(now.getTime() + 90 * 86_400_000);
  const changes = await db.regulatoryChange.findMany({ where: { orgId: ctx.orgId }, orderBy: [{ effectiveAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }] });
  const taskIds = changes.flatMap((c) => c.remediationTaskIds);
  const tasks = taskIds.length ? await db.remediationTask.findMany({ where: { id: { in: taskIds } }, select: { id: true, status: true } }) : [];
  const status = new Map(tasks.map((t) => [t.id, t.status]));
  return changes.map((c) => {
    const open = c.status !== "implemented" && c.status !== "not_applicable";
    return {
      ...c,
      tasksTotal: c.remediationTaskIds.length,
      tasksResolved: c.remediationTaskIds.filter((t) => status.get(t) === "resolved").length,
      effectiveSoon: open && !!c.effectiveAt && c.effectiveAt >= now && c.effectiveAt <= soon,
      effectivePassedOpen: open && !!c.effectiveAt && c.effectiveAt < now,
    };
  });
}

export async function getRegulatoryChange(db: TenantDb, ctx: OrgContext, id: string) {
  assertPermission(ctx, "audit:read");
  const c = await loadChange(db, ctx, id);
  const impact = impactSchema.parse(c.impact ?? {});
  const [framework, controls, policies, agents, models, datasets, tasks] = await Promise.all([
    c.frameworkId ? db.framework.findUnique({ where: { id: c.frameworkId }, select: { id: true, key: true, name: true } }) : null,
    impact.controls.length ? db.control.findMany({ where: { id: { in: impact.controls } }, select: { id: true, code: true, title: true } }) : [],
    impact.policies.length ? db.policy.findMany({ where: { id: { in: impact.policies } }, select: { id: true, key: true, name: true } }) : [],
    impact.agents.length ? db.agent.findMany({ where: { id: { in: impact.agents } }, select: { id: true, slug: true, name: true } }) : [],
    impact.models.length ? db.aiModel.findMany({ where: { id: { in: impact.models } }, select: { id: true, key: true, name: true, stage: true } }) : [],
    impact.datasets.length ? db.dataset.findMany({ where: { id: { in: impact.datasets } }, select: { id: true, key: true, name: true } }) : [],
    c.remediationTaskIds.length ? db.remediationTask.findMany({ where: { id: { in: c.remediationTaskIds } }, select: { id: true, title: true, status: true, dueAt: true, ownerId: true } }) : [],
  ]);
  return { change: c, framework, impact: { controls, policies, agents, models, datasets, notes: impact.notes }, tasks };
}
