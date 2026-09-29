import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ChevronLeft, ExternalLink, GitCompare, Quote, TriangleAlert } from "lucide-react";
import type { SchoolCurriculum } from "@prisma/client";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDate } from "@/lib/format";
import { Link } from "@/i18n/navigation";
import { Panel, PanelHeader } from "@/components/app/panel";
import { canonicalSourceType } from "@/server/catalog-pipeline/sources";
import { Pill } from "@/components/app/badges";
import { ReviewActions } from "@/components/catalog/catalog-client";
import { describeAdditional, describeLanguage, describeOverall, describeSubject, describeTest, type Tr } from "@/components/catalog/describe";
import { catalogUiState } from "@/server/catalog-pipeline/access";
import { programLabels, subjectNames } from "@/server/catalog-pipeline/page-data";
import { groupFromVersion, LINES_INCLUDE, subjectLabels } from "@/server/catalog-pipeline/publish";
import { diffGroups } from "@/server/catalog-pipeline/diff";
import type { DraftGroup, DraftSet } from "@/server/catalog-pipeline/types";

type Row = { id: string; proposed: string; quote: string; current: string | null };

function rows(t: Tr, g: DraftGroup, cur: DraftGroup | null, names: Record<string, string>): Row[] {
  const out: Row[] = [];
  for (const l of g.overall) {
    const c = cur?.overall.find((x) => x.field === l.field);
    out.push({ id: `o:${l.field}`, proposed: describeOverall(t, l), quote: l.evidenceQuote, current: c ? describeOverall(t, c) : null });
  }
  for (const l of g.subjects) {
    const k = [...l.keys].sort().join("|");
    const c = cur?.subjects.find((x) => [...x.keys].sort().join("|") === k);
    out.push({ id: `s:${k}`, proposed: describeSubject(t, l, names), quote: l.evidenceQuote, current: c ? describeSubject(t, c, names) : null });
  }
  for (const l of g.languages) {
    const c = cur?.languages.find((x) => x.test === l.test);
    out.push({ id: `l:${l.test}`, proposed: describeLanguage(t, l), quote: l.evidenceQuote, current: c ? describeLanguage(t, c) : null });
  }
  for (const l of g.tests) {
    const c = cur?.tests.find((x) => x.test === l.test);
    out.push({ id: `t:${l.test}`, proposed: describeTest(t, l), quote: l.evidenceQuote, current: c ? describeTest(t, c) : null });
  }
  for (const l of g.additional) {
    const c = cur?.additional.find((x) => x.kind === l.kind);
    out.push({ id: `a:${l.kind}`, proposed: describeAdditional(t, l), quote: l.evidenceQuote, current: c ? describeAdditional(t, c) : null });
  }
  return out;
}

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getCtx();
  const t = await getTranslations("catalog");
  const tr = t as unknown as Tr;
  const tp = await getTranslations("pathways");
  const prefs = await formatPrefs(ctx);
  const ext = await ctx.db.requirementExtraction.findUnique({ where: { id }, include: { source: true } });
  if (!ext) notFound();
  const draft = ext.normalizedJson as unknown as DraftSet;
  const groups = draft.groups ?? [];
  const [names, labelsForDiff] = await Promise.all([subjectNames(ctx), subjectLabels(ctx.db)]);
  const programId = ext.source.programId;
  const labels = await programLabels(ctx, programId ? [programId] : []);
  const label = programId ? labels.get(programId) : null;
  const currents = programId ? await ctx.db.programRequirement.findMany({ where: { programId, isCurrent: true }, include: LINES_INCLUDE }) : [];
  const currentFor = (c: SchoolCurriculum | null) => currents.find((v) => (v.curriculum ?? null) === c) ?? null;
  const ui = catalogUiState(ctx);
  const pending = ext.status === "PENDING_REVIEW";

  return (
    <div className="space-y-6">
      <Link href="/career/catalog" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4 rtl:rotate-180" />
        {t("review.back")}
      </Link>

      <Panel>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-1.5">
            <h2 className="text-lg font-semibold" data-testid="review-title">
              {label?.program ?? t("sources.universityLevel")}
            </h2>
            {label && <div className="text-sm text-muted-foreground">{label.university}</div>}
            <div className="flex flex-wrap items-center gap-1.5">
              <Pill tone={pending ? "info" : ext.status === "APPROVED" ? "success" : "danger"}>{t(`queue.status.${ext.status}`)}</Pill>
              <Pill tone="info">{t(`sources.sourceType.${canonicalSourceType(ext.source.sourceType)}`)}</Pill>
              <Pill tone={ext.confidence >= 0.7 ? "success" : "warning"}>{t("queue.confidence", { value: Math.round(ext.confidence * 100) })}</Pill>
              {draft.meta?.example && <Pill tone="gold">{t("exampleData")}</Pill>}
              <span className="text-xs text-muted-foreground">{t("queue.extractedOn", { date: fmtDate(prefs, ext.createdAt) })}</span>
              <span className="text-xs text-muted-foreground" dir="ltr">
                {t("review.extractor", { model: ext.model })}
              </span>
            </div>
            <a href={ext.source.url} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1 text-sm text-brand hover:underline">
              <ExternalLink className="size-3.5 shrink-0" />
              <span className="truncate">{t("review.officialPage")}</span>
            </a>
            {!pending && ext.reviewNote && <p className="text-sm text-muted-foreground">{t("review.reviewerNote", { note: ext.reviewNote })}</p>}
          </div>
          {pending && <ReviewActions extractionId={ext.id} groups={groups} names={names} denial={ui.writeDenial ?? (programId ? null : "no_program")} aiAvailable={ui.aiAvailable} />}
        </div>
      </Panel>

      {groups.map((g) => {
        const cur = currentFor(g.curriculum as SchoolCurriculum | null);
        const curGroup = cur ? groupFromVersion(cur) : null;
        const list = rows(tr, g, curGroup, names);
        const preview = diffGroups({ prev: curGroup, next: g, prevSourceId: cur?.sourceId ?? null, nextSourceId: ext.sourceId, labels: labelsForDiff });
        return (
          <Panel key={g.curriculum ?? "general"}>
            <PanelHeader
              title={g.curriculum ? tp(`curriculum.${g.curriculum}`) : t("review.general")}
              description={cur ? t("review.currentVersion", { n: cur.version, confidence: t(`confidence.${cur.confidence}`) }) : t("review.noCurrentVersion")}
            />
            <div className="hidden gap-3 border-b pb-2 text-xs font-medium text-muted-foreground md:grid md:grid-cols-3">
              <div>{t("review.evidence")}</div>
              <div>{t("review.proposed")}</div>
              <div>{t("review.current")}</div>
            </div>
            <ul className="divide-y" data-testid="review-lines">
              {list.map((r) => (
                <li key={r.id} className="grid gap-2 py-3 md:grid-cols-3 md:gap-3">
                  <blockquote className="flex gap-2 rounded-md bg-muted/60 p-2 text-sm" dir="ltr">
                    <Quote className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    <span className="break-words">{r.quote}</span>
                  </blockquote>
                  <div className="text-sm font-medium">
                    <span className="me-1 text-xs font-normal text-muted-foreground md:hidden">{t("review.proposed")}:</span>
                    {r.proposed}
                  </div>
                  <div className={`text-sm ${r.current === null ? "text-muted-foreground" : r.current === r.proposed ? "text-muted-foreground" : "font-medium text-[oklch(0.55_0.14_65)]"}`}>
                    <span className="me-1 text-xs text-muted-foreground md:hidden">{t("review.current")}:</span>
                    {r.current ?? t("review.noCurrent")}
                  </div>
                </li>
              ))}
            </ul>
            {cur && preview.entries.length > 0 && (
              <div className="mt-4 rounded-lg border p-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                  <GitCompare className="size-4" />
                  {t("changes.details")}
                  <Pill tone={preview.severity === "MAJOR" ? "danger" : preview.severity === "NOTABLE" ? "warning" : "neutral"}>{t(`changes.severity.${preview.severity}`)}</Pill>
                </div>
                <ul className="space-y-1 text-sm" data-testid="review-diff">
                  {preview.entries.map((e, i) => (
                    <li key={i} className="flex flex-wrap items-center gap-2">
                      <Pill>{t(`changes.type.${e.type}`)}</Pill>
                      <span>{ctx.locale === "ar" ? e.summaryAr : e.summaryEn}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Panel>
        );
      })}

      {(draft.rejected?.length ?? 0) > 0 && (
        <Panel>
          <PanelHeader title={t("review.rejectedTitle")} description={t("review.rejectedDesc")} icon={<TriangleAlert className="size-4" />} />
          <ul className="divide-y" data-testid="rejected-lines">
            {draft.rejected.map((r, i) => (
              <li key={i} className="flex flex-col gap-1.5 py-2.5 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone="danger">{t.has(`review.reason.${r.reason}`) ? t(`review.reason.${r.reason}`) : r.reason}</Pill>
                  <Pill>{t(`section.${r.section}`)}</Pill>
                  <span className="text-muted-foreground" dir="ltr">
                    {r.summary}
                  </span>
                </div>
                {r.evidenceQuote && (
                  <blockquote className="rounded-md bg-muted/60 p-2 text-xs" dir="ltr">
                    {r.evidenceQuote}
                  </blockquote>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
