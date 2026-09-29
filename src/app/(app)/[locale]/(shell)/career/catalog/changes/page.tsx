import { getTranslations } from "next-intl/server";
import type { Prisma } from "@prisma/client";
import { Activity, History } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDate } from "@/lib/format";
import { Link } from "@/i18n/navigation";
import { Panel, PanelHeader } from "@/components/app/panel";
import { EmptyState } from "@/components/app/empty-state";
import { FilterBar } from "@/components/app/filter-bar";
import { Pill, type Tone } from "@/components/app/badges";
import { ChangeActions } from "@/components/catalog/catalog-client";
import { catalogUiState } from "@/server/catalog-pipeline/access";
import { programLabels } from "@/server/catalog-pipeline/page-data";
import { SEVERITIES, type ChangeDiff } from "@/server/catalog-pipeline/types";

const SEV_TONE: Record<string, Tone> = { WATCH: "neutral", NOTABLE: "warning", MAJOR: "danger" };
type SP = { status?: string; severity?: string; change?: string };

export default async function CatalogChangesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  const t = await getTranslations("catalog");
  const tp = await getTranslations("pathways");
  const prefs = await formatPrefs(ctx);
  const ui = catalogUiState(ctx);
  const tab = sp.status === "reviewed" || sp.status === "all" ? sp.status : "needs";
  const severity = (SEVERITIES as readonly string[]).includes(sp.severity ?? "") ? sp.severity! : null;
  const where: Prisma.RequirementChangeWhereInput = {
    ...(tab === "needs" ? { status: "NEEDS_REVIEW" } : tab === "reviewed" ? { status: "ACKNOWLEDGED" } : {}),
    ...(severity ? { diff: { path: ["severity"], equals: severity } } : {}),
  };
  const [changes, needsCount] = await Promise.all([
    ctx.db.requirementChange.findMany({ where, orderBy: { detectedAt: "desc" }, take: 100 }),
    ctx.db.requirementChange.count({ where: { status: "NEEDS_REVIEW" } }),
  ]);
  const labels = await programLabels(ctx, changes.map((c) => c.programId));

  return (
    <Panel>
      <PanelHeader title={t("changes.title")} description={t("changes.desc")} icon={<Activity className="size-4" />} />
      <div className="mb-4">
        <FilterBar
          tabParam="status"
          chipParam="severity"
          tabs={[
            { value: "needs", label: t("changes.needsReview"), count: needsCount },
            { value: "reviewed", label: t("changes.reviewedTab") },
            { value: "all", label: t("changes.all") },
          ]}
          chips={[{ value: "", label: t("changes.allSeverities") }, ...SEVERITIES.map((s) => ({ value: s, label: t(`changes.severity.${s}`) }))]}
        />
      </div>
      {changes.length === 0 ? (
        <EmptyState icon={<Activity className="size-5" />} title={t("changes.emptyTitle")} body={t("changes.emptyBody")} />
      ) : (
        <ul className="space-y-3" data-testid="changes-list">
          {changes.map((c) => {
            const d = (c.diff ?? {}) as unknown as ChangeDiff;
            const l = labels.get(c.programId);
            const summary = ctx.locale === "ar" ? d.summaryAr || c.summaryEn : c.summaryEn;
            const initial = !c.fromVersionId;
            return (
              <li key={c.id} id={`change-${c.id}`} className={`rounded-lg border p-4 ${sp.change === c.id ? "ring-2 ring-brand" : ""}`} data-testid="change-item">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Pill tone={SEV_TONE[d.severity] ?? "neutral"} dot>
                        {t(`changes.severity.${d.severity ?? "WATCH"}`)}
                      </Pill>
                      <Pill>{d.curriculum ? tp(`curriculum.${d.curriculum}`) : t("review.general")}</Pill>
                      {d.example && <Pill tone="gold">{t("exampleShort")}</Pill>}
                      {d.review && <Pill tone={d.review.outcome === "REVIEWED" ? "success" : "neutral"}>{t("changes.reviewedOn", { outcome: t(`changes.outcome.${d.review.outcome}`), date: fmtDate(prefs, d.review.at) })}</Pill>}
                      {initial && <Pill tone="info">{t("changes.firstVersion")}</Pill>}
                    </div>
                    <div className="font-medium">{l?.program ?? ""}</div>
                    <div className="text-sm text-muted-foreground">{l?.university}</div>
                    <p className="text-sm">{initial ? t("changes.firstVersion") : summary}</p>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span>{t("changes.detected", { date: fmtDate(prefs, c.detectedAt) })}</span>
                      <Link href={`/career/catalog/programs/${c.programId}`} className="inline-flex items-center gap-1 text-brand hover:underline" data-testid="program-history-link">
                        <History className="size-3.5" />
                        {t("changes.history")}
                      </Link>
                    </div>
                  </div>
                  {c.status === "NEEDS_REVIEW" && <ChangeActions changeId={c.id} denial={ui.writeDenial} />}
                </div>
                {(d.entries?.length ?? 0) > 0 && !initial && (
                  <details className="mt-3 rounded-md bg-muted/40 p-3" open={sp.change === c.id || c.status === "NEEDS_REVIEW"}>
                    <summary className="cursor-pointer text-sm font-medium">{t("changes.details")}</summary>
                    <ul className="mt-2 space-y-2 text-sm" data-testid="change-diff">
                      {d.entries.map((e, i) => (
                        <li key={i} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
                          <div className="flex items-center gap-1.5">
                            <Pill tone={SEV_TONE[e.severity] ?? "neutral"}>{t(`changes.type.${e.type}`)}</Pill>
                          </div>
                          <span>{ctx.locale === "ar" ? e.summaryAr : e.summaryEn}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
