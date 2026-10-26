// One roster preview or sync: progress while it runs, then counts per kind, the problems found (with what to
// do about each) and a sample of the changes, and "Apply" for a preview (or for a sync stopped by the removal
// limit, after confirming).
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AlertTriangle, ArrowLeft, ListChecks, TriangleAlert } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDateTime, fmtNumber } from "@/lib/format";
import { userName } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { PLAN_KINDS, type Change, type Counts, type Issue } from "@/server/rostering/plan";
import { PREVIEW_TTL_MS } from "@/server/rostering/run";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { Pill } from "@/components/app/badges";
import { RUN_TONE } from "@/components/rostering/tones";
import { ApplyRunButton, RunProgress } from "@/components/rostering/run-controls";

export async function generateMetadata() {
  const t = await getTranslations("roster");
  return { title: t("runTitle") };
}

const ACTIVE = ["QUEUED", "FETCHING", "PLANNING", "APPLYING"];
const COLS = ["create", "update", "unchanged", "remove", "skipped"] as const;

export default async function RosterRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getCtx();
  if (!ctx.can("roster.manage")) notFound();
  const t = await getTranslations("roster");
  const prefs = await formatPrefs(ctx);
  const run = await ctx.db.rosterRun.findUnique({ where: { id } });
  if (!run) notFound();
  const connection = run.connectionId ? await ctx.db.rosterConnection.findUnique({ where: { id: run.connectionId }, select: { name: true } }) : null;
  const actor = run.actorId ? await ctx.db.membership.findUnique({ where: { id: run.actorId }, select: { user: { select: { nameEn: true, nameAr: true } } } }) : null;
  const counts = (run.counts as Counts | null) ?? null;
  const issues = (Array.isArray(run.issues) ? run.issues : []) as unknown as Issue[];
  const changes = (Array.isArray(run.changes) ? run.changes : []) as unknown as Change[];
  const n = (x: number) => fmtNumber(prefs, x);
  const active = ACTIVE.includes(run.status);
  const expired = run.status === "PREVIEWED" && Date.now() - (run.finishedAt ?? run.startedAt).getTime() > PREVIEW_TTL_MS;
  const blocked = run.status === "BLOCKED" || (run.status === "PREVIEWED" && (counts?.removalBlocked?.length ?? 0) > 0);
  const removals = counts ? PLAN_KINDS.reduce((s, k) => s + (counts[k]?.remove ?? 0), 0) : 0;
  const totalChanges = counts ? PLAN_KINDS.reduce((s, k) => s + (counts[k]?.create ?? 0) + (counts[k]?.update ?? 0) + (counts[k]?.remove ?? 0), 0) : 0;
  const byCode = new Map<string, Issue[]>();
  for (const i of issues) byCode.set(`${i.kind}:${i.code}`, [...(byCode.get(`${i.kind}:${i.code}`) ?? []), i]);

  return (
    <PageBody className="max-w-5xl">
      <Link href="/admin/rostering" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4 rtl:rotate-180" />
        {t("back")}
      </Link>
      <PageHeader
        title={run.dryRun ? t("kind.preview") : t("kind.sync")}
        description={`${connection?.name ?? t("upload")} · ${t(`source.${run.source}`)} · ${t(`mode.${run.mode}`)} · ${fmtDateTime(prefs, run.startedAt)} · ${run.trigger === "SCHEDULE" ? t("trigger.SCHEDULE") : t("trigger.byPerson", { name: userName(actor?.user, ctx.locale) || t("someone") })}`}
        actions={
          <Pill tone={RUN_TONE[run.status] ?? "neutral"} dot>
            {t(`status.${expired ? "EXPIRED" : run.status}`)}
          </Pill>
        }
      />

      {active && (
        <Panel>
          <RunProgress runId={run.id} initial={{ status: run.status, done: run.progressDone, total: run.progressTotal, phase: run.phase }} />
          <p className="mt-3 text-xs text-muted-foreground">{t("progressNote")}</p>
        </Panel>
      )}

      {run.status === "FAILED" && (
        <div className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger" role="alert" data-testid="run-failed">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{t.has(`errors.${run.errorCode}`) ? t(`errors.${run.errorCode}`) : t("errors.generic")}</span>
        </div>
      )}

      {blocked && !active && (
        <div className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning-soft p-4 text-sm" role="alert" data-testid="run-blocked">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-[oklch(0.55_0.14_65)]" />
          <span>{t("blockedBody", { kinds: (counts?.removalBlocked ?? []).map((k) => t(`kinds.${k}`)).join(ctx.locale === "ar" ? "، " : ", ") })}</span>
        </div>
      )}

      {counts && !active && run.status !== "FAILED" && (
        <Panel padded={false}>
          <div className="border-b px-5 py-3">
            <h2 className="text-sm font-semibold">{run.dryRun ? t("wouldChange") : t("changed")}</h2>
            <p className="text-xs text-muted-foreground">{run.dryRun ? t("wouldChangeBody") : t("changedBody")}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm" data-testid="run-counts">
              <thead>
                <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
                  <th className="px-5 py-2 text-start font-medium">{t("kindCol")}</th>
                  {COLS.map((c) => (
                    <th key={c} className="px-3 py-2 text-end font-medium">
                      {t(`cols.${c}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {PLAN_KINDS.map((k) => (
                  <tr key={k}>
                    <td className="px-5 py-2.5 font-medium">{t(`kinds.${k}`)}</td>
                    {COLS.map((c) => (
                      <td key={c} className={`px-3 py-2.5 text-end tabular-nums ${c === "remove" && counts[k][c] > 0 ? "text-danger" : c === "create" && counts[k][c] > 0 ? "text-success" : ""}`}>
                        {n(counts[k]?.[c] ?? 0)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(run.status === "PREVIEWED" || run.status === "BLOCKED") && !expired && (
            <div className="flex flex-col gap-3 border-t px-5 py-4 sm:flex-row sm:items-end sm:justify-between">
              <p className="max-w-xl text-xs text-muted-foreground">{totalChanges === 0 ? t("nothingToApply") : t("applyNote")}</p>
              {totalChanges > 0 && <ApplyRunButton runId={run.id} blocked={blocked} removals={removals} />}
            </div>
          )}
          {expired && <p className="border-t px-5 py-4 text-xs text-muted-foreground">{t("expiredNote")}</p>}
        </Panel>
      )}

      {issues.length > 0 && !active && (
        <Panel>
          <PanelHeader title={t("issuesTitle", { count: issues.length })} description={t("issuesBody")} icon={<TriangleAlert className="size-4" />} />
          <ul className="space-y-3" data-testid="run-issues">
            {[...byCode.entries()].map(([key, list]) => {
              const [kind, code] = key.split(":");
              return (
                <li key={key} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    <Pill tone="warning">{t(`kinds.${kind}`)}</Pill>
                    {t.has(`issues.${code}.title`) ? t(`issues.${code}.title`) : code}
                    <span className="text-xs font-normal text-muted-foreground">{n(list.length)}</span>
                  </div>
                  {t.has(`issues.${code}.fix`) && <p className="mt-1 text-xs text-muted-foreground">{t(`issues.${code}.fix`)}</p>}
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {list.slice(0, 12).map((i) => (
                      <li key={i.ext} className="rounded-md bg-muted px-2 py-0.5 text-xs">
                        {i.label}
                        {i.detail ? (
                          <span className="ms-1 font-mono text-muted-foreground" dir="ltr">
                            {i.detail}
                          </span>
                        ) : null}
                      </li>
                    ))}
                    {list.length > 12 && <li className="px-1 text-xs text-muted-foreground">{t("andMore", { count: list.length - 12 })}</li>}
                  </ul>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}

      {changes.length > 0 && !active && (
        <Panel padded={false}>
          <div className="border-b px-5 py-3">
            <PanelHeader title={t("sampleTitle")} description={t("sampleBody", { shown: n(changes.length) })} icon={<ListChecks className="size-4" />} />
          </div>
          <ul className="divide-y" data-testid="run-changes">
            {changes.slice(0, 120).map((c, i) => (
              <li key={`${c.kind}-${c.ext}-${i}`} className="flex flex-wrap items-center gap-2 px-5 py-2 text-sm">
                <Pill tone={c.action === "create" ? "success" : c.action === "remove" ? "danger" : "info"}>{t(`actions.${c.action}`)}</Pill>
                <span className="text-xs text-muted-foreground">{t(`kinds.${c.kind}`)}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{c.label}</span>
                {c.fields && c.fields.length > 0 && <span className="text-xs text-muted-foreground">{c.fields.map((f) => (t.has(`fields.${f}`) ? t(`fields.${f}`) : f)).join(ctx.locale === "ar" ? "، " : ", ")}</span>}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </PageBody>
  );
}
