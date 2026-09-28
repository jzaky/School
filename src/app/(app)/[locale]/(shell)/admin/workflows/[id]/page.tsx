import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDate } from "@/lib/format";
import { pick, userName } from "@/lib/i18n-data";
import { isSafeguardingWorkflow } from "@/server/admin/workflows";
import { parseGraph } from "@/server/workflows/validate";
import { layoutGraph } from "@/server/workflows/layout";
import { WorkflowBuilder } from "@/components/workflows/builder";
import type { BuilderOptions } from "@/components/workflows/types";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getCtx();
  const t = await getTranslations("adminWorkflows");
  const wf = ctx.can("workflows.manage") ? await ctx.db.workflow.findUnique({ where: { id } }) : null;
  return { title: wf ? pick(ctx.locale, wf.nameEn, wf.nameAr) : t("title") };
}

export default async function WorkflowBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getCtx();
  if (!ctx.isStaff || !ctx.can("workflows.manage")) notFound();
  const { db, orgId, locale } = ctx;
  const wf = await db.workflow.findUnique({
    where: { id },
    include: {
      versions: { orderBy: { version: "desc" }, select: { id: true, version: true, publishedAt: true, publishedById: true } },
      services: { select: { id: true, nameEn: true, nameAr: true, sensitivity: true }, orderBy: { sortOrder: "asc" } },
    },
  });
  if (!wf) notFound();
  const prefs = await formatPrefs(ctx);
  const safeguarding = await isSafeguardingWorkflow(ctx, wf.id);

  const [published, roles, staff, departments, templates, docTemplates, apptTypes, activeRuns] = await Promise.all([
    wf.publishedVersionId ? db.workflowVersion.findUnique({ where: { id: wf.publishedVersionId } }) : Promise.resolve(null),
    db.role.findMany({ where: { orgId, key: { notIn: ["student", "parent"] } }, orderBy: { nameEn: "asc" } }),
    db.membership.findMany({
      where: { orgId, status: "ACTIVE", staffProfile: { isNot: null } },
      include: { user: true },
      orderBy: { user: { nameEn: "asc" } },
      take: 300,
    }),
    db.department.findMany({ where: { orgId }, orderBy: { nameEn: "asc" } }),
    db.messageTemplate.findMany({ where: { orgId }, orderBy: [{ key: "asc" }, { channel: "asc" }] }),
    db.documentTemplate.findMany({ where: { orgId }, orderBy: { nameEn: "asc" } }),
    db.appointmentType.findMany({ where: { orgId }, orderBy: { nameEn: "asc" } }),
    db.workflowRun.groupBy({ by: ["workflowVersionId"], where: { orgId, status: { in: ["RUNNING", "WAITING"] }, version: { workflowId: wf.id } }, _count: { _all: true } }),
  ]);
  const publishers = await db.membership.findMany({ where: { id: { in: wf.versions.map((v) => v.publishedById).filter(Boolean) as string[] } }, include: { user: true } });

  const tplByKey = new Map<string, (typeof templates)[number]>();
  for (const m of templates) if (!tplByKey.has(m.key) || m.channel === "IN_APP") tplByKey.set(m.key, m);

  const options: BuilderOptions = {
    roles: roles.map((r) => ({ key: r.key, name: pick(locale, r.nameEn, r.nameAr) })),
    staff: staff.map((m) => ({ id: m.id, name: userName(m.user, locale), hint: pick(locale, m.titleEn, m.titleAr) })),
    departments: departments.map((d) => ({ key: d.key, name: pick(locale, d.nameEn, d.nameAr) })),
    messageTemplates: [...tplByKey.values()].map((m) => ({ key: m.key, name: (pick(locale, m.subjectEn, m.subjectAr) || m.key).replace(/\{\{\s*\w+\s*\}\}/g, "…") })),
    documentTemplates: docTemplates.map((d) => ({ key: d.key, name: pick(locale, d.nameEn, d.nameAr) })),
    appointmentTypes: apptTypes.map((a) => ({ key: a.key, name: pick(locale, a.nameEn, a.nameAr) })),
  };

  const draft = parseGraph(wf.draftGraph) ?? parseGraph(published?.graph);
  const publishedGraph = parseGraph(published?.graph);
  const initial = layoutGraph(draft ?? { nodes: [], edges: [] });
  const activeByVersion = new Map(activeRuns.map((r) => [r.workflowVersionId, r._count._all]));

  return (
    <WorkflowBuilder
      workflow={{
        id: wf.id,
        name: pick(locale, wf.nameEn, wf.nameAr),
        description: pick(locale, wf.descEn, wf.descAr),
        status: wf.status,
        publishedVersion: published?.version ?? null,
        publishedAt: published ? fmtDate(prefs, published.publishedAt) : null,
        services: wf.services.map((s) => pick(locale, s.nameEn, s.nameAr)),
        safeguarding,
      }}
      versions={wf.versions.map((v) => ({
        version: v.version,
        publishedAt: fmtDate(prefs, v.publishedAt),
        by: userName(publishers.find((p) => p.id === v.publishedById)?.user, locale),
        activeRuns: activeByVersion.get(v.id) ?? 0,
        current: v.id === wf.publishedVersionId,
      }))}
      initialGraph={initial}
      publishedGraph={publishedGraph}
      options={options}
      aiEnabled={ctx.org.aiEnabled}
    />
  );
}
