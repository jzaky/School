// Per-program requirement version history. A server component that other pages (for example the
// program page) can embed: <RequirementHistory programId={id} />. Read-only by default; pass
// showActions to include "Mark verified" on current versions for catalog reviewers.
import { getTranslations } from "next-intl/server";
import { History } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDate } from "@/lib/format";
import { Panel, PanelHeader } from "@/components/app/panel";
import { Pill } from "@/components/app/badges";
import { catalogUiState } from "@/server/catalog-pipeline/access";
import { subjectNames } from "@/server/catalog-pipeline/page-data";
import type { ChangeDiff } from "@/server/catalog-pipeline/types";
import { DataFreshnessBadge } from "./data-freshness";
import { describeAdditional, describeLanguage, describeOverall, describeSubject, describeTest, type Tr } from "./describe";
import { VerifyButton } from "./catalog-client";

export async function RequirementHistory({ programId, showActions = false, className }: { programId: string; showActions?: boolean; className?: string }) {
  const ctx = await getCtx();
  if (!ctx.can("pathways.view") && !ctx.can("catalog.review")) return null;
  const t = (await getTranslations("catalog")) as unknown as Tr;
  const tp = await getTranslations("pathways");
  const prefs = await formatPrefs(ctx);
  const versions = await ctx.db.programRequirement.findMany({
    where: { programId },
    include: { subjects: true, languages: true, tests: true, additional: true },
    orderBy: [{ curriculum: { sort: "asc", nulls: "first" } }, { version: "desc" }],
  });
  const sourceIds = [...new Set(versions.map((v) => v.sourceId).filter((x): x is string => !!x))];
  const [sources, changes, names] = await Promise.all([
    sourceIds.length ? ctx.db.requirementSource.findMany({ where: { id: { in: sourceIds } }, select: { id: true, url: true } }) : [],
    ctx.db.requirementChange.findMany({ where: { programId }, select: { toVersionId: true, summaryEn: true, diff: true } }),
    subjectNames(ctx),
  ]);
  const sourceUrl = new Map(sources.map((s) => [s.id, s.url]));
  const changeFor = new Map(changes.map((c) => [c.toVersionId, c]));
  const denial = showActions && ctx.can("catalog.review") ? catalogUiState(ctx).writeDenial : null;
  const groups = new Map<string, typeof versions>();
  for (const v of versions) {
    const k = v.curriculum ?? "GENERAL";
    groups.set(k, [...(groups.get(k) ?? []), v]);
  }

  return (
    <Panel className={className}>
      <PanelHeader title={t("history.title")} description={t("history.desc")} icon={<History className="size-4" />} />
      {versions.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="history-empty">
          {t("history.empty")}
        </p>
      ) : (
        <div className="space-y-6" data-testid="requirement-history">
          {[...groups.entries()].map(([k, list]) => (
            <section key={k} className="space-y-3">
              <h3 className="text-sm font-semibold">{k === "GENERAL" ? t("review.general") : tp(`curriculum.${k}`)}</h3>
              <ol className="relative space-y-3 border-s ps-4">
                {list.map((v) => {
                  const change = changeFor.get(v.id);
                  const diff = (change?.diff ?? null) as ChangeDiff | null;
                  const summary = change ? (ctx.locale === "ar" ? diff?.summaryAr || change.summaryEn : change.summaryEn) : null;
                  const lines = [
                    ...(v.gradeProfile ? [describeOverall(t, { field: "gradeProfile", value: v.gradeProfile })] : []),
                    ...(v.minimumPoints !== null ? [describeOverall(t, { field: "minimumPoints", value: v.minimumPoints })] : []),
                    ...(v.minimumGPA !== null ? [describeOverall(t, { field: "minimumGPA", value: v.minimumGPA })] : []),
                    ...(v.minimumPercent !== null ? [describeOverall(t, { field: "minimumPercent", value: v.minimumPercent })] : []),
                    ...v.subjects.map((s) => describeSubject(t, { type: s.type, keys: s.canonicalSubjectKeys, minimumGrade: s.minimumGrade }, names)),
                    ...v.languages.map((l) => describeLanguage(t, l)),
                    ...v.tests.map((x) => describeTest(t, x)),
                    ...v.additional.map((a) => describeAdditional(t, a)),
                  ];
                  return (
                    <li key={v.id} className="relative rounded-lg border bg-card p-3" data-testid={`version-${v.version}`}>
                      <span className={`absolute -start-[1.4rem] top-4 size-3 rounded-full border-2 border-card ${v.isCurrent ? "bg-brand" : "bg-muted-foreground/40"}`} />
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{t("history.version", { n: v.version })}</span>
                        {v.isCurrent && <Pill tone="brand">{t("history.current")}</Pill>}
                        <span className="text-xs text-muted-foreground">
                          {v.effectiveTo ? t("history.period", { from: fmtDate(prefs, v.effectiveFrom ?? v.createdAt), to: fmtDate(prefs, v.effectiveTo) }) : t("history.since", { date: fmtDate(prefs, v.effectiveFrom ?? v.createdAt) })}
                        </span>
                        <span className="text-xs text-muted-foreground">{t("history.intake", { year: v.intakeYear })}</span>
                      </div>
                      <div className="mt-2">
                        <DataFreshnessBadge checkedAt={v.verifiedAt} confidence={v.confidence} sourceUrl={v.sourceId ? sourceUrl.get(v.sourceId) : null} prefs={prefs} />
                      </div>
                      {summary && <p className="mt-2 text-sm">{summary}</p>}
                      {lines.length ? (
                        <ul className="mt-2 list-disc space-y-0.5 ps-5 text-sm text-muted-foreground">
                          {lines.map((l, i) => (
                            <li key={i}>{l}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-2 text-sm text-muted-foreground">{t("history.noLines")}</p>
                      )}
                      {showActions && v.isCurrent && ctx.can("catalog.review") && v.confidence !== "VERIFIED" && (
                        <div className="mt-3">
                          <VerifyButton requirementId={v.id} denial={denial} />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>
      )}
    </Panel>
  );
}
