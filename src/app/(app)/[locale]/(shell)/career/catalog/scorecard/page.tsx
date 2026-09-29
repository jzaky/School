import { getTranslations } from "next-intl/server";
import { Database, Landmark, Clock, BarChart3 } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDateTime, fmtNumber } from "@/lib/format";
import { Panel, PanelHeader } from "@/components/app/panel";
import { StatCard } from "@/components/app/stat-card";
import { Pill } from "@/components/app/badges";
import { ScorecardRunButton } from "@/components/catalog/catalog-client";
import { catalogUiState } from "@/server/catalog-pipeline/access";
import { CATALOG_QUEUE, SCORECARD_JOB } from "@/server/catalog-pipeline/jobs";

export default async function CatalogScorecardPage() {
  const ctx = await getCtx();
  const t = await getTranslations("catalog");
  const prefs = await formatPrefs(ctx);
  const ui = catalogUiState(ctx);
  const [usCount, withStats, runs, latest] = await Promise.all([
    ctx.db.university.count({ where: { orgId: null, countryCode: "US" } }),
    ctx.db.university.count({ where: { orgId: null, countryCode: "US", scorecardId: { not: null }, stats: { path: ["source"], equals: "college_scorecard" } } }),
    ctx.db.jobRun.findMany({ where: { queue: CATALOG_QUEUE, name: SCORECARD_JOB }, orderBy: { createdAt: "desc" }, take: 5 }),
    ctx.db.university.findFirst({ where: { orgId: null, scorecardId: { not: null }, stats: { path: ["source"], equals: "college_scorecard" } }, select: { stats: true }, orderBy: { id: "desc" } }),
  ]);
  const lastRun = runs.find((r) => r.status === "COMPLETED");
  const lastFetched = (latest?.stats as { fetchedAt?: string } | null)?.fetchedAt ?? null;
  const lastImport = lastRun?.finishedAt ?? (lastFetched ? new Date(lastFetched) : null);

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label={t("scorecard.usUniversities")} value={fmtNumber(prefs, usCount)} icon={<Landmark className="size-4" />} />
        <StatCard label={t("scorecard.withStats")} value={fmtNumber(prefs, withStats)} icon={<BarChart3 className="size-4" />} tone="info" />
        <StatCard label={t("scorecard.lastImport")} value={lastImport ? fmtDateTime(prefs, lastImport) : t("scorecard.never")} icon={<Clock className="size-4" />} />
      </div>
      <Panel>
        <PanelHeader title={t("scorecard.title")} description={t("scorecard.desc")} icon={<Database className="size-4" />} action={<ScorecardRunButton denial={ui.scorecardDenial} />} />
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>{t("scorecard.keyHelp")}</p>
          <p>{t("scorecard.retryHelp")}</p>
        </div>
        <h3 className="mt-5 mb-2 text-sm font-semibold">{t("scorecard.runs")}</h3>
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("scorecard.noRuns")}</p>
        ) : (
          <ul className="divide-y rounded-lg border text-sm" data-testid="scorecard-runs">
            {runs.map((r) => {
              const res = (r.result ?? {}) as { created?: number; updated?: number; linked?: number; error?: string };
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <span className="flex-1 text-muted-foreground">{fmtDateTime(prefs, r.createdAt)}</span>
                  {r.status === "COMPLETED" ? (
                    <Pill tone="success">{t("scorecard.runDone", { created: res.created ?? 0, updated: res.updated ?? 0, linked: res.linked ?? 0 })}</Pill>
                  ) : r.status === "FAILED" ? (
                    <Pill tone="danger">{t("scorecard.runFailed", { error: t.has(`scorecard.errorCode.${res.error}`) ? t(`scorecard.errorCode.${res.error}`) : (res.error ?? "") })}</Pill>
                  ) : (
                    <Pill tone="info">{t("scorecard.running")}</Pill>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
