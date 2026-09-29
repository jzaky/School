import { getTranslations } from "next-intl/server";
import { ChevronRight, ClipboardCheck, Inbox } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDate } from "@/lib/format";
import { Link } from "@/i18n/navigation";
import { Panel, PanelHeader } from "@/components/app/panel";
import { EmptyState } from "@/components/app/empty-state";
import { canonicalSourceType } from "@/server/catalog-pipeline/sources";
import { Pill } from "@/components/app/badges";
import { Button } from "@/components/ui/button";
import { programLabels } from "@/server/catalog-pipeline/page-data";
import { lineCount, type DraftSet } from "@/server/catalog-pipeline/types";

export default async function CatalogQueuePage() {
  const ctx = await getCtx();
  const t = await getTranslations("catalog");
  const prefs = await formatPrefs(ctx);
  const [pending, decided] = await Promise.all([
    ctx.db.requirementExtraction.findMany({ where: { status: "PENDING_REVIEW" }, include: { source: true }, orderBy: { createdAt: "desc" }, take: 100 }),
    ctx.db.requirementExtraction.findMany({ where: { status: { not: "PENDING_REVIEW" } }, include: { source: true }, orderBy: [{ reviewedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }], take: 10 }),
  ]);
  const labels = await programLabels(ctx, [...pending, ...decided].map((e) => e.source.programId ?? ""));
  const uniIds = [...new Set([...pending, ...decided].filter((e) => !e.source.programId).map((e) => e.source.universityId))];
  const unis = uniIds.length ? await ctx.db.university.findMany({ where: { id: { in: uniIds } }, select: { id: true, nameEn: true, nameAr: true } }) : [];
  const uniName = new Map(unis.map((u) => [u.id, ctx.locale === "ar" ? u.nameAr || u.nameEn : u.nameEn]));
  const title = (e: (typeof pending)[number]) => {
    const l = e.source.programId ? labels.get(e.source.programId) : null;
    return l ? { main: l.program, sub: l.university } : { main: uniName.get(e.source.universityId) ?? e.source.url, sub: t("sources.universityLevel") };
  };

  return (
    <div className="space-y-6">
      <Panel>
        <PanelHeader title={t("queue.pendingTitle")} description={t("queue.pendingDesc")} icon={<ClipboardCheck className="size-4" />} />
        {pending.length === 0 ? (
          <EmptyState icon={<Inbox className="size-5" />} title={t("queue.emptyTitle")} body={t("queue.emptyBody")} />
        ) : (
          <ul className="grid gap-3" data-testid="review-queue">
            {pending.map((e) => {
              const d = e.normalizedJson as unknown as DraftSet;
              const n = (d.groups ?? []).reduce((s, g) => s + lineCount(g), 0);
              const head = title(e);
              return (
                <li key={e.id} className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="truncate font-medium">{head.main}</div>
                    <div className="truncate text-sm text-muted-foreground">{head.sub}</div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Pill tone="info">{t(`sources.sourceType.${canonicalSourceType(e.source.sourceType)}`)}</Pill>
                      <Pill tone={e.confidence >= 0.7 ? "success" : e.confidence >= 0.5 ? "warning" : "danger"}>{t("queue.confidence", { value: Math.round(e.confidence * 100) })}</Pill>
                      <Pill>{t("queue.lines", { n })}</Pill>
                      {(d.rejected?.length ?? 0) > 0 && <Pill tone="warning">{t("queue.rejectedLines", { n: d.rejected.length })}</Pill>}
                      {d.meta?.example && <Pill tone="gold">{t("exampleShort")}</Pill>}
                      <span className="text-xs text-muted-foreground">{t("queue.extractedOn", { date: fmtDate(prefs, e.createdAt) })}</span>
                    </div>
                  </div>
                  <Button asChild size="sm">
                    <Link href={`/career/catalog/review/${e.id}`} data-testid="open-review">
                      {t("queue.review")}
                      <ChevronRight className="size-4 rtl:rotate-180" />
                    </Link>
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {decided.length > 0 && (
        <Panel>
          <PanelHeader title={t("queue.decidedTitle")} />
          <ul className="divide-y rounded-lg border" data-testid="decided-list">
            {decided.map((e) => {
              const head = title(e);
              return (
                <li key={e.id} className="flex flex-col gap-1.5 px-3 py-2.5 text-sm sm:flex-row sm:items-center sm:gap-3">
                  <Link href={`/career/catalog/review/${e.id}`} className="min-w-0 flex-1 truncate font-medium hover:text-brand">
                    {head.main} <span className="font-normal text-muted-foreground">· {head.sub}</span>
                  </Link>
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill tone={e.status === "APPROVED" ? "success" : "danger"}>{t(`queue.status.${e.status}`)}</Pill>
                    {e.reviewedAt && <span className="text-xs text-muted-foreground">{t("queue.decidedOn", { date: fmtDate(prefs, e.reviewedAt) })}</span>}
                  </div>
                  {e.reviewNote && <p className="text-xs text-muted-foreground sm:max-w-sm sm:truncate">{t("review.reviewerNote", { note: e.reviewNote })}</p>}
                </li>
              );
            })}
          </ul>
        </Panel>
      )}
    </div>
  );
}
