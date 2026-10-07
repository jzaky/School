// Shared configuration: a group admin copies a template from one member school to others.
//
// The copy is the target school's own row afterwards (it can edit or delete it); nothing stays linked.
// Order of checks: the caller is a group ADMIN (userScope), the source and every target are member schools
// of that group (RLS-filtered list), then the source item is read through tenantDb(source) and each copy is
// written in its own tenantTx(target) with an AuditEvent in the target school. The push is also kept in
// GroupTemplatePush for the group's history.
//
// Kinds:
// - service: the service with its form and workflow (published versions). Arrives switched off, under a free
//   key, so the school reviews it before families see it.
// - letter: a letter template. "copy" adds it under a free key; "replace" overwrites the school's letter with the same key.
// - notification: a message template, matched by event key and channel, so it always replaces (or adds) that one.
import type { Prisma } from "@prisma/client";
import { tenantDb, tenantTx, userScope, type TenantTx } from "@/lib/tenant-db";
import { audit } from "@/server/audit/audit";
import type { WorkflowGraph, Assignee } from "@/server/workflows/graph";
import { groupSchoolLinks, requireGroupRole } from "./access";

export const PUSH_KINDS = ["service", "letter", "notification"] as const;
export type PushKind = (typeof PUSH_KINDS)[number];
export type PushMode = "copy" | "replace";

export type PushWarning = "member_assignee" | "missing_letter" | "missing_meeting_type" | "missing_appointment_type";
export type PushResult = { orgId: string; status: "created" | "replaced" | "failed"; key?: string; entityId?: string; warnings: PushWarning[] };

export class PushError extends Error {
  constructor(public code: "invalid" | "not_in_group" | "not_found") {
    super(`group-push:${code}`);
  }
}

export type PushItem = { id: string; key: string; nameEn: string; nameAr: string; hint?: string | null };

/** Items of one kind in a member school, for the picker. */
export async function listPushItems(userId: string, groupId: string, sourceOrgId: string, kind: PushKind): Promise<PushItem[]> {
  await requireGroupRole(userId, groupId, { admin: true });
  await assertMembers(userId, groupId, [sourceOrgId]);
  const db = tenantDb(sourceOrgId);
  if (kind === "service") {
    const rows = await db.serviceDefinition.findMany({ where: { orgId: sourceOrgId }, orderBy: [{ sortOrder: "asc" }, { nameEn: "asc" }], select: { id: true, key: true, nameEn: true, nameAr: true } });
    return rows;
  }
  if (kind === "letter") {
    return db.documentTemplate.findMany({ where: { orgId: sourceOrgId }, orderBy: { nameEn: "asc" }, select: { id: true, key: true, nameEn: true, nameAr: true } });
  }
  const rows = await db.messageTemplate.findMany({ where: { orgId: sourceOrgId }, orderBy: [{ key: "asc" }, { channel: "asc" }], select: { id: true, key: true, channel: true, subjectEn: true, subjectAr: true } });
  return rows.map((r) => ({ id: r.id, key: r.key, nameEn: r.subjectEn || r.key, nameAr: r.subjectAr || r.key, hint: r.channel }));
}

async function assertMembers(userId: string, groupId: string, orgIds: string[]) {
  const links = await groupSchoolLinks(userId, groupId);
  const ids = new Set(links.map((l) => l.orgId));
  if (orgIds.some((o) => !ids.has(o))) throw new PushError("not_in_group");
}

/** A key not used yet in the target: base, then base_2, base_3 ... */
export function freeKey(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const k = `${base}_${i}`;
    if (!used.has(k)) return k;
  }
  return `${base}_${Date.now().toString(36)}`;
}

/** Steps aimed at one person in the source school cannot work elsewhere: they go to the school administrator role. */
export function portableGraph(graph: WorkflowGraph): { graph: WorkflowGraph; replaced: number } {
  let replaced = 0;
  const fix = (a: Assignee | undefined): Assignee | undefined => {
    if (a && a.kind === "member") {
      replaced++;
      return { kind: "role", role: "school_admin" };
    }
    return a;
  };
  const nodes = graph.nodes.map((n) => {
    const d = { ...n.data };
    if (d.assignee) d.assignee = fix(d.assignee);
    if (d.recipients) d.recipients = d.recipients.map((r) => fix(r)!);
    if (d.approvers) d.approvers = d.approvers.map((ap) => ({ ...ap, assignee: fix(ap.assignee)! }));
    return { ...n, data: d };
  });
  return { graph: { nodes, edges: graph.edges }, replaced };
}

type ServiceSource = NonNullable<Awaited<ReturnType<typeof loadService>>>;

async function loadService(sourceOrgId: string, id: string) {
  const db = tenantDb(sourceOrgId);
  const svc = await db.serviceDefinition.findFirst({ where: { id, orgId: sourceOrgId }, include: { category: true, form: true, workflow: true } });
  if (!svc) return null;
  const [formVersion, workflowVersion, apptType] = await Promise.all([
    svc.form?.publishedVersionId ? db.formVersion.findUnique({ where: { id: svc.form.publishedVersionId } }) : null,
    svc.workflow?.publishedVersionId ? db.workflowVersion.findUnique({ where: { id: svc.workflow.publishedVersionId } }) : null,
    svc.appointmentTypeId ? db.appointmentType.findUnique({ where: { id: svc.appointmentTypeId }, select: { key: true } }) : null,
  ]);
  return { svc, formSchema: (formVersion?.schema ?? svc.form?.draftSchema ?? null) as Prisma.JsonValue | null, graph: (workflowVersion?.graph ?? svc.workflow?.draftGraph ?? null) as unknown as WorkflowGraph | null, apptKey: apptType?.key ?? null };
}

async function copyService(tx: TenantTx, orgId: string, src: ServiceSource): Promise<PushResult> {
  const { svc } = src;
  const warnings: PushWarning[] = [];
  let category = await tx.serviceCategory.findFirst({ where: { orgId, key: svc.category.key } });
  if (!category) category = await tx.serviceCategory.create({ data: { orgId, key: svc.category.key, nameEn: svc.category.nameEn, nameAr: svc.category.nameAr, icon: svc.category.icon, sortOrder: svc.category.sortOrder } });

  let formId: string | null = null;
  if (svc.form && src.formSchema) {
    const taken = (await tx.form.findMany({ where: { orgId, key: { startsWith: svc.form.key } }, select: { key: true } })).map((f) => f.key);
    const form = await tx.form.create({
      data: { orgId, key: freeKey(svc.form.key, taken), nameEn: svc.form.nameEn, nameAr: svc.form.nameAr, descEn: svc.form.descEn, descAr: svc.form.descAr, categoryEn: svc.form.categoryEn, categoryAr: svc.form.categoryAr, status: "PUBLISHED", draftSchema: src.formSchema as Prisma.InputJsonValue, createdById: null },
    });
    const v = await tx.formVersion.create({ data: { orgId, formId: form.id, version: 1, schema: src.formSchema as Prisma.InputJsonValue } });
    await tx.form.update({ where: { id: form.id }, data: { publishedVersionId: v.id } });
    formId = form.id;
  }

  let workflowId: string | null = null;
  if (svc.workflow && src.graph) {
    const { graph, replaced } = portableGraph(src.graph);
    if (replaced) warnings.push("member_assignee");
    const letterKeys = graph.nodes.map((n) => n.data.templateKey).filter((k): k is string => !!k);
    const meetingKeys = graph.nodes.map((n) => n.data.appointmentTypeKey).filter((k): k is string => !!k);
    if (letterKeys.length && (await tx.documentTemplate.count({ where: { orgId, key: { in: letterKeys } } })) < new Set(letterKeys).size) warnings.push("missing_letter");
    if (meetingKeys.length && (await tx.appointmentType.count({ where: { orgId, key: { in: meetingKeys } } })) < new Set(meetingKeys).size) warnings.push("missing_meeting_type");
    const taken = (await tx.workflow.findMany({ where: { orgId, key: { startsWith: svc.workflow.key } }, select: { key: true } })).map((w) => w.key);
    const wf = await tx.workflow.create({
      data: { orgId, key: freeKey(svc.workflow.key, taken), nameEn: svc.workflow.nameEn, nameAr: svc.workflow.nameAr, descEn: svc.workflow.descEn, descAr: svc.workflow.descAr, status: "PUBLISHED", draftGraph: graph as unknown as Prisma.InputJsonValue, createdById: null },
    });
    const v = await tx.workflowVersion.create({ data: { orgId, workflowId: wf.id, version: 1, graph: graph as unknown as Prisma.InputJsonValue } });
    await tx.workflow.update({ where: { id: wf.id }, data: { publishedVersionId: v.id } });
    workflowId = wf.id;
  }

  let appointmentTypeId: string | null = null;
  if (src.apptKey) {
    appointmentTypeId = (await tx.appointmentType.findFirst({ where: { orgId, key: src.apptKey }, select: { id: true } }))?.id ?? null;
    if (!appointmentTypeId) warnings.push("missing_appointment_type");
  }

  const taken = (await tx.serviceDefinition.findMany({ where: { orgId, key: { startsWith: svc.key } }, select: { key: true } })).map((s) => s.key);
  const last = await tx.serviceDefinition.findFirst({ where: { orgId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
  const key = freeKey(svc.key, taken);
  const created = await tx.serviceDefinition.create({
    data: {
      orgId,
      key,
      categoryId: category.id,
      nameEn: svc.nameEn,
      nameAr: svc.nameAr,
      descEn: svc.descEn,
      descAr: svc.descAr,
      icon: svc.icon,
      audience: svc.audience,
      formId,
      workflowId,
      appointmentTypeId,
      slaHours: svc.slaHours,
      sensitivity: svc.sensitivity,
      requestPrefix: svc.requestPrefix,
      requiresStudent: svc.requiresStudent,
      createsCase: svc.createsCase,
      caseType: svc.caseType,
      isActive: false,
      isFeatured: false,
      sortOrder: (last?.sortOrder ?? 0) + 1,
    },
  });
  return { orgId, status: "created", key, entityId: created.id, warnings };
}

export type PushInput = { userId: string; groupId: string; sourceOrgId: string; kind: PushKind; sourceId: string; targetOrgIds: string[]; mode?: PushMode };

export async function pushTemplate(input: PushInput, now = new Date()): Promise<{ pushId: string; results: PushResult[] }> {
  const { userId, groupId, sourceOrgId, kind, sourceId } = input;
  if (!PUSH_KINDS.includes(kind)) throw new PushError("invalid");
  const targets = [...new Set(input.targetOrgIds)].filter((t) => t !== sourceOrgId);
  if (!targets.length || targets.length > 50) throw new PushError("invalid");
  await requireGroupRole(userId, groupId, { admin: true });
  await assertMembers(userId, groupId, [sourceOrgId, ...targets]);
  const mode: PushMode = kind === "notification" ? "replace" : kind === "letter" && input.mode === "replace" ? "replace" : "copy";
  const src = tenantDb(sourceOrgId);

  let label: { en: string; ar: string; key: string };
  let run: (tx: TenantTx, orgId: string) => Promise<PushResult>;
  if (kind === "service") {
    const s = await loadService(sourceOrgId, sourceId);
    if (!s) throw new PushError("not_found");
    label = { en: s.svc.nameEn, ar: s.svc.nameAr, key: s.svc.key };
    run = (tx, orgId) => copyService(tx, orgId, s);
  } else if (kind === "letter") {
    const t = await src.documentTemplate.findFirst({ where: { id: sourceId, orgId: sourceOrgId } });
    if (!t) throw new PushError("not_found");
    label = { en: t.nameEn, ar: t.nameAr, key: t.key };
    const fields = { nameEn: t.nameEn, nameAr: t.nameAr, descEn: t.descEn, descAr: t.descAr, bodyEn: t.bodyEn, bodyAr: t.bodyAr, output: t.output, mergeFields: t.mergeFields, signatoryEn: t.signatoryEn, signatoryAr: t.signatoryAr };
    run = async (tx, orgId) => {
      const existing = await tx.documentTemplate.findFirst({ where: { orgId, key: t.key } });
      if (existing && mode === "replace") {
        await tx.documentTemplate.update({ where: { id: existing.id }, data: fields });
        return { orgId, status: "replaced", key: t.key, entityId: existing.id, warnings: [] };
      }
      const taken = (await tx.documentTemplate.findMany({ where: { orgId, key: { startsWith: t.key } }, select: { key: true } })).map((x) => x.key);
      const key = freeKey(t.key, taken);
      const created = await tx.documentTemplate.create({ data: { orgId, key, ...fields } });
      return { orgId, status: "created", key, entityId: created.id, warnings: [] };
    };
  } else {
    const m = await src.messageTemplate.findFirst({ where: { id: sourceId, orgId: sourceOrgId } });
    if (!m) throw new PushError("not_found");
    label = { en: m.subjectEn || m.key, ar: m.subjectAr || m.key, key: m.key };
    run = async (tx, orgId) => {
      const existing = await tx.messageTemplate.findFirst({ where: { orgId, key: m.key, channel: m.channel } });
      const data = { subjectEn: m.subjectEn, subjectAr: m.subjectAr, bodyEn: m.bodyEn, bodyAr: m.bodyAr };
      if (existing) {
        await tx.messageTemplate.update({ where: { id: existing.id }, data });
        return { orgId, status: "replaced", key: m.key, entityId: existing.id, warnings: [] };
      }
      const created = await tx.messageTemplate.create({ data: { orgId, key: m.key, channel: m.channel, ...data } });
      return { orgId, status: "created", key: m.key, entityId: created.id, warnings: [] };
    };
  }

  const entityType = kind === "service" ? "ServiceDefinition" : kind === "letter" ? "DocumentTemplate" : "MessageTemplate";
  const results: PushResult[] = [];
  for (const orgId of targets) {
    try {
      const res = await tenantTx(orgId, async (tx) => {
        const r = await run(tx, orgId);
        await audit(tx, orgId, {
          actorUserId: userId,
          action: "group.template_pushed",
          entityType,
          entityId: r.entityId ?? null,
          meta: { groupId, sourceOrgId, kind, sourceKey: label.key, key: r.key ?? null, mode, status: r.status, warnings: r.warnings, at: now.toISOString() },
        });
        return r;
      }, { timeout: 30000 });
      results.push(res);
    } catch {
      results.push({ orgId, status: "failed", warnings: [] });
    }
  }
  const row = await userScope(userId, (tx) =>
    tx.groupTemplatePush.create({
      data: { groupId, sourceOrgId, kind, sourceId, labelEn: label.en, labelAr: label.ar, targetOrgIds: targets, results: results as unknown as Prisma.InputJsonValue, pushedById: userId, createdAt: now },
    }),
  );
  return { pushId: row.id, results };
}

/** The group's push history (RLS: group members only). */
export async function listPushes(userId: string, groupId: string) {
  await requireGroupRole(userId, groupId);
  return userScope(userId, (tx) => tx.groupTemplatePush.findMany({ where: { groupId }, orderBy: { createdAt: "desc" }, take: 30 }));
}
