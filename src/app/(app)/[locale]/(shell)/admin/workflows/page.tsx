import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Activity, GitBranch, PlayCircle, ShieldAlert, Workflow as WorkflowIcon } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDate, fmtNumber } from "@/lib/format";
import { pick } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { StatCard } from "@/components/app/stat-card";
import { Pill } from "@/components/app/badges";
import { NewWorkflowButton } from "@/components/workflows/new-workflow";
import type { WorkflowGraph } from "@/server/workflows/graph";
import { graphSignature, parseGraph } from "@/server/workflows/validate";

export async function generateMetadata() {
  const t = await getTranslations("adminWorkflows");
  return { title: t("title") };
}

const DAY = 86400_000;

export default async function WorkflowsAdminPage() {
  const ctx = await getCtx();
  if (!ctx.isStaff || !ctx.can("workflows.manage")) notFound();
  const t = await getTranslations("adminWorkflows");
  const prefs = await formatPrefs(ctx);
  const { db, locale, orgId } = ctx;
  const since = new Date(Date.now() - 30 * DAY);

  const [workflows, versions, recent, active] = await Promise.all([
    db.workflow.findMany({
      where: { orgId },
      include: { services: { select: { id: true, key: true, nameEn: true, nameAr: true, sensitivity: true, isActive: true }, orderBy: { sortOrder: "asc" } } },
      orderBy: [{ status: "asc" }, { nameEn: "asc" }],
    }),
    db.workflowVersion.findMany({ where: { orgId }, select: { id: true, workflowId: true, version: true, graph: true, publishedAt: true } }),
    db.workflowRun.groupBy({ by: ["workflowVersionId"], where: { orgId, startedAt: { gte: since } }, _count: { _all: true } }),
    db.workflowRun.groupBy({ by: ["workflowVersionId"], where: { orgId, status: { in: ["RUNNING", "WAITING"] } }, _count: { _all: true } }),
  ]);
  const wfOfVersion = new Map(versions.map((v) => [v.id, v.workflowId]));
  const sumBy = (rows: typeof recent) => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const wf = wfOfVersion.get(r.workflowVersionId);
      if (wf) m.set(wf, (m.get(wf) ?? 0) + r._count._all);
    }
    return m;
  };
  const recentBy = sumBy(recent);
  const activeBy = sumBy(active);

  const rows = workflows.map((w) => {
    const published = versions.find((v) => v.id === w.publishedVersionId) ?? null;
    const graph = (published?.graph ?? w.draftGraph ?? null) as WorkflowGraph | null;
    const draftChanged = Boolean(w.draftGraph) && graphSignature(parseGraph(w.draftGraph)) !== graphSignature(parseGraph(published?.graph));
    return {
      w,
      published,
      nodes: graph?.nodes?.length ?? 0,
      runs30: recentBy.get(w.id) ?? 0,
      activeRuns: activeBy.get(w.id) ?? 0,
      draftChanged: published ? draftChanged : true,
      safeguarding: w.services.some((s) => s.sensitivity === "SAFEGUARDING"),
    };
  });
  const totals = {
    count: rows.length,
    runs30: rows.reduce((s, r) => s + r.runs30, 0),
    active: rows.reduce((s, r) => s + r.activeRuns, 0),
    drafts: rows.filter((r) => r.draftChanged).length,
  };

  return (
    <PageBody>
      <PageHeader title={t("title")} description={t("subtitle")} actions={<NewWorkflowButton />} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t("statWorkflows")} value={fmtNumber(prefs, totals.count)} icon={<WorkflowIcon className="size-4" />} />
        <StatCard label={t("statRuns30")} value={fmtNumber(prefs, totals.runs30)} icon={<PlayCircle className="size-4" />} tone="info" />
        <StatCard label={t("statActive")} value={fmtNumber(prefs, totals.active)} icon={<Activity className="size-4" />} tone="success" />
        <StatCard label={t("statDrafts")} value={fmtNumber(prefs, totals.drafts)} icon={<GitBranch className="size-4" />} tone={totals.drafts ? "warning" : "brand"} />
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={<WorkflowIcon className="size-5" />} title={t("empty")} body={t("emptyBody")} action={<NewWorkflowButton />} />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
          <div className="hidden grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_90px_80px_100px_90px] gap-3 border-b bg-muted/30 px-5 py-2.5 text-xs font-medium text-muted-foreground lg:grid">
            <span>{t("colWorkflow")}</span>
            <span>{t("colServices")}</span>
            <span>{t("colVersion")}</span>
            <span className="text-end">{t("colSteps")}</span>
            <span className="text-end">{t("colRuns30")}</span>
            <span className="text-end">{t("colActive")}</span>
          </div>
          <ul className="divide-y">
            {rows.map(({ w, published, nodes, runs30, activeRuns, draftChanged, safeguarding }) => (
              <li key={w.id} data-testid="workflow-row">
                <Link
                  href={`/admin/workflows/${w.id}`}
                  className="grid gap-3 px-4 py-3.5 transition hover:bg-muted/40 sm:px-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_90px_80px_100px_90px] lg:items-center"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span className={safeguarding ? "grid size-9 shrink-0 place-items-center rounded-lg bg-danger-soft text-danger" : "grid size-9 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand"}>
                      {safeguarding ? <ShieldAlert className="size-4" /> : <WorkflowIcon className="size-4" />}
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-sm font-medium">{pick(locale, w.nameEn, w.nameAr)}</span>
                        {!published && <Pill tone="neutral">{t("notPublished")}</Pill>}
                        {published && draftChanged && <Pill tone="warning">{t("unpublishedChanges")}</Pill>}
                        {safeguarding && <Pill tone="danger">{t("dslRouted")}</Pill>}
                      </div>
                      <p className="line-clamp-1 text-xs text-muted-foreground">{pick(locale, w.descEn, w.descAr) || t("noDescription")}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {w.services.length ? (
                      w.services.slice(0, 3).map((s) => (
                        <Pill key={s.id} tone={s.isActive ? "info" : "neutral"}>
                          {pick(locale, s.nameEn, s.nameAr)}
                        </Pill>
                      ))
                    ) : (
                      <span className="text-xs text-muted-foreground">{t("noServices")}</span>
                    )}
                    {w.services.length > 3 && <Pill>{t("moreServices", { count: w.services.length - 3 })}</Pill>}
                  </div>
                  <div className="text-xs">
                    {published ? (
                      <>
                        <div className="font-medium">{t("versionN", { version: published.version })}</div>
                        <div className="text-muted-foreground">{fmtDate(prefs, published.publishedAt, "short")}</div>
                      </>
                    ) : (
                      <span className="text-muted-foreground">{t("draftOnly")}</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between text-sm tabular-nums lg:justify-end">
                    <span className="text-xs text-muted-foreground lg:hidden">{t("colSteps")}</span>
                    {fmtNumber(prefs, nodes)}
                  </div>
                  <div className="flex items-center justify-between text-sm tabular-nums lg:justify-end">
                    <span className="text-xs text-muted-foreground lg:hidden">{t("colRuns30")}</span>
                    {fmtNumber(prefs, runs30)}
                  </div>
                  <div className="flex items-center justify-between text-sm tabular-nums lg:justify-end">
                    <span className="text-xs text-muted-foreground lg:hidden">{t("colActive")}</span>
                    {activeRuns ? <Pill tone="success">{fmtNumber(prefs, activeRuns)}</Pill> : <span className="text-muted-foreground">{fmtNumber(prefs, 0)}</span>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </PageBody>
  );
}
