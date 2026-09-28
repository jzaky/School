"use server";

import { revalidatePath } from "next/cache";
import { getCtx, type Ctx } from "@/server/context";
import { audit } from "@/server/audit/audit";
import { generateAi, reviewAi } from "@/server/ai/provider";
import { tenantTx } from "@/lib/tenant-db";
import { NODE_TYPES, type WorkflowGraph } from "@/server/workflows/graph";
import { parseGraph, validateGraph, type ValidationIssue } from "@/server/workflows/validate";
import { layoutGraph } from "@/server/workflows/layout";
import { draftWorkflowFromText } from "@/server/workflows/draft";
import { isSafeguardingWorkflow } from "./workflows";

type Fail = { ok: false; error: string; issues?: ValidationIssue[] };

async function manager(): Promise<Ctx | null> {
  const ctx = await getCtx();
  return ctx.isStaff && ctx.can("workflows.manage") ? ctx : null;
}


function slug(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

export async function createWorkflowAction(input: { nameEn: string; nameAr: string; descEn?: string; descAr?: string }): Promise<{ ok: true; id: string } | Fail> {
  const ctx = await manager();
  if (!ctx) return { ok: false, error: "FORBIDDEN" };
  const nameEn = input.nameEn.trim().slice(0, 120);
  const nameAr = input.nameAr.trim().slice(0, 120);
  if (!nameEn || !nameAr) return { ok: false, error: "NAME" };
  const graph: WorkflowGraph = layoutGraph({
    nodes: [
      { id: "start", type: "start", position: { x: 0, y: 0 }, data: { label: { en: "Request submitted", ar: "تم تقديم الطلب" } } },
      { id: "end", type: "end", position: { x: 0, y: 0 }, data: { label: { en: "Completed", ar: "مكتمل" }, outcome: "COMPLETED" } },
    ],
    edges: [{ id: "e1", source: "start", target: "end", sourceHandle: null }],
  });
  const base = slug(nameEn) || "workflow";
  const taken = await ctx.db.workflow.count({ where: { orgId: ctx.orgId, key: { startsWith: base } } });
  const key = taken ? `${base}_${taken + 1}` : base;
  const wf = await ctx.db.workflow.create({
    data: {
      orgId: ctx.orgId,
      key,
      nameEn,
      nameAr,
      descEn: input.descEn?.trim() || null,
      descAr: input.descAr?.trim() || null,
      status: "DRAFT",
      draftGraph: graph as never,
      createdById: ctx.membershipId,
    },
  });
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "workflow.create", entityType: "Workflow", entityId: wf.id });
  revalidatePath("/[locale]/admin/workflows", "page");
  return { ok: true, id: wf.id };
}

export async function saveWorkflowDraftAction(input: { workflowId: string; graph: unknown; aiInteractionId?: string | null }): Promise<{ ok: true } | Fail> {
  const ctx = await manager();
  if (!ctx) return { ok: false, error: "FORBIDDEN" };
  const graph = parseGraph(input.graph);
  if (!graph) return { ok: false, error: "BAD_GRAPH" };
  const wf = await ctx.db.workflow.findUnique({ where: { id: input.workflowId } });
  if (!wf) return { ok: false, error: "NOT_FOUND" };
  await ctx.db.workflow.update({ where: { id: wf.id }, data: { draftGraph: graph as never } });
  if (input.aiInteractionId) await reviewAi(ctx, input.aiInteractionId, true);
  await audit(ctx.db, ctx.orgId, {
    actorId: ctx.membershipId,
    actorUserId: ctx.user.id,
    action: "workflow.draft_save",
    entityType: "Workflow",
    entityId: wf.id,
    meta: { nodes: graph.nodes.length, edges: graph.edges.length, fromAi: Boolean(input.aiInteractionId) },
  });
  revalidatePath("/[locale]/admin/workflows", "page");
  return { ok: true };
}

export async function publishWorkflowAction(input: { workflowId: string; graph: unknown; aiInteractionId?: string | null }): Promise<{ ok: true; version: number } | Fail> {
  const ctx = await manager();
  if (!ctx) return { ok: false, error: "FORBIDDEN" };
  const graph = parseGraph(input.graph);
  if (!graph) return { ok: false, error: "BAD_GRAPH" };
  const wf = await ctx.db.workflow.findUnique({ where: { id: input.workflowId } });
  if (!wf) return { ok: false, error: "NOT_FOUND" };
  const safeguarding = await isSafeguardingWorkflow(ctx, wf.id);
  const issues = validateGraph(graph, { safeguarding });
  if (issues.length) return { ok: false, error: "INVALID", issues };
  if (input.aiInteractionId) await reviewAi(ctx, input.aiInteractionId, true);

  // Publishing appends an immutable version. Runs already in flight keep the version they started on.
  const version = await tenantTx(ctx.orgId, async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Workflow" WHERE id = ${wf.id} FOR UPDATE`;
    const last = await tx.workflowVersion.findFirst({ where: { workflowId: wf.id }, orderBy: { version: "desc" } });
    const next = (last?.version ?? 0) + 1;
    const v = await tx.workflowVersion.create({ data: { orgId: ctx.orgId, workflowId: wf.id, version: next, graph: graph as never, publishedById: ctx.membershipId } });
    await tx.workflow.update({ where: { id: wf.id }, data: { publishedVersionId: v.id, status: "PUBLISHED", draftGraph: graph as never } });
    await audit(tx, ctx.orgId, {
      actorId: ctx.membershipId,
      actorUserId: ctx.user.id,
      action: "workflow.publish",
      entityType: "Workflow",
      entityId: wf.id,
      sensitivity: safeguarding ? "SAFEGUARDING" : "STANDARD",
      meta: { version: next, versionId: v.id, nodes: graph.nodes.length },
    });
    return next;
  });
  revalidatePath("/[locale]/admin/workflows", "page");
  revalidatePath("/[locale]/services/[key]", "page");
  return { ok: true, version };
}

export async function discardWorkflowDraftAction(input: { workflowId: string }): Promise<{ ok: true } | Fail> {
  const ctx = await manager();
  if (!ctx) return { ok: false, error: "FORBIDDEN" };
  const wf = await ctx.db.workflow.findUnique({ where: { id: input.workflowId } });
  if (!wf?.publishedVersionId) return { ok: false, error: "NOT_FOUND" };
  const v = await ctx.db.workflowVersion.findUnique({ where: { id: wf.publishedVersionId } });
  if (!v) return { ok: false, error: "NOT_FOUND" };
  await ctx.db.workflow.update({ where: { id: wf.id }, data: { draftGraph: v.graph as never } });
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "workflow.draft_discard", entityType: "Workflow", entityId: wf.id, meta: { version: v.version } });
  revalidatePath("/[locale]/admin/workflows", "page");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Draft with AI
// ---------------------------------------------------------------------------

type AiDraft = { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> };

export async function draftWorkflowWithAiAction(input: { workflowId: string; prompt: string }): Promise<
  { ok: true; graph: WorkflowGraph; interactionId: string; provider: string } | Fail
> {
  const ctx = await manager();
  if (!ctx) return { ok: false, error: "FORBIDDEN" };
  const prompt = input.prompt.trim().slice(0, 2000);
  if (prompt.length < 8) return { ok: false, error: "PROMPT" };
  const wf = await ctx.db.workflow.findUnique({ where: { id: input.workflowId } });
  if (!wf) return { ok: false, error: "NOT_FOUND" };
  const safeguarding = await isSafeguardingWorkflow(ctx, wf.id);
  const [roles, docTemplates, apptTypes, msgTemplates] = await Promise.all([
    ctx.db.role.findMany({ where: { orgId: ctx.orgId }, select: { key: true } }),
    ctx.db.documentTemplate.findMany({ where: { orgId: ctx.orgId }, select: { key: true, nameEn: true }, orderBy: { nameEn: "asc" } }),
    ctx.db.appointmentType.findMany({ where: { orgId: ctx.orgId }, select: { key: true, nameEn: true }, orderBy: { nameEn: "asc" } }),
    ctx.db.messageTemplate.findMany({ where: { orgId: ctx.orgId }, select: { key: true }, distinct: ["key"] }),
  ]);
  const lower = prompt.toLowerCase();
  const docKey = docTemplates.find((d) => lower.includes(d.nameEn.toLowerCase().split(" ")[0]))?.key ?? docTemplates[0]?.key ?? null;
  const meetingKey = apptTypes.find((a) => a.key.includes("parent"))?.key ?? apptTypes[0]?.key ?? null;
  const isValid = (v: unknown): v is AiDraft => {
    const g = parseGraph(v);
    return Boolean(g) && validateGraph(g!, { safeguarding }).length === 0;
  };
  const res = await generateAi<AiDraft>(ctx, {
    feature: "workflow_draft",
    sensitive: false,
    subjectType: "Workflow",
    subjectId: wf.id,
    instructions:
      "Design a school workflow graph from the administrator's description. Use only the node types, roles and template keys listed in the facts. " +
      "Exactly one start node and at least one end node. Approval nodes need approvers and two outgoing edges with sourceHandle 'approved' and 'rejected'. " +
      "Condition nodes need a condition and two outgoing edges with sourceHandle 'true' and 'false'. Other edges have sourceHandle null. No loops. " +
      "Every node label needs both English (en) and Modern Standard Arabic (ar). Keep it to at most 10 nodes." +
      (safeguarding
        ? " This workflow serves safeguarding concerns: it must open a create_case node with caseType and sensitivity SAFEGUARDING assigned to role dsl, route every approval, task and assign step to role dsl, role deputy_dsl or case_assignee, and never notify the student or guardians."
        : ""),
    facts: {
      description: prompt,
      nodeTypes: NODE_TYPES,
      assigneeKinds: ["role", "requester", "student", "guardians", "class_teacher", "department_head", "case_assignee"],
      roles: roles.map((r) => r.key),
      messageTemplates: msgTemplates.map((m) => m.key),
      documentTemplates: docTemplates.map((d) => d.key),
      appointmentTypes: apptTypes.map((a) => a.key),
      requestStatuses: ["IN_REVIEW", "IN_PROGRESS", "COMPLETED"],
    },
    outputShape:
      '{"nodes":[{"id":"start","type":"start","data":{"label":{"en":"...","ar":"..."}}},{"id":"a1","type":"approval","data":{"label":{...},"mode":"SEQUENTIAL|PARALLEL_ALL|PARALLEL_ANY","approvers":[{"assignee":{"kind":"role","role":"principal"},"label":{...}}],"dueInHours":48}},' +
      '{"id":"t1","type":"task","data":{"label":{...},"assignee":{...},"title":{...},"dueInHours":48,"blocking":true}},{"id":"n1","type":"notify","data":{"label":{...},"recipients":[{"kind":"requester"}],"template":"request_completed","channels":["IN_APP","EMAIL"]}},' +
      '{"id":"end","type":"end","data":{"label":{...},"outcome":"COMPLETED|REJECTED"}}],"edges":[{"id":"e1","source":"start","target":"a1","sourceHandle":null}]}',
    fallback: () => draftWorkflowFromText(prompt, { documentTemplateKey: docKey, appointmentTypeKey: meetingKey }) as unknown as AiDraft,
    validate: isValid,
  });
  if (res.status === "blocked") return { ok: false, error: res.reason === "disabled" ? "AI_DISABLED" : "AI_BLOCKED" };
  const parsed = parseGraph(res.output)!;
  return { ok: true, graph: layoutGraph(parsed), interactionId: res.interactionId, provider: res.provider };
}
