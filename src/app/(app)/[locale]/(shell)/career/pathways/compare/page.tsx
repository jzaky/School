import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ChevronLeft, Columns3, ExternalLink, X } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDate, fmtNumber } from "@/lib/format";
import { pick } from "@/lib/i18n-data";
import { cn } from "@/lib/utils";
import { Link } from "@/i18n/navigation";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Panel } from "@/components/app/panel";
import { Pill } from "@/components/app/badges";
import { Button } from "@/components/ui/button";
import { StudentPicker } from "@/components/pathways/pathway-client";
import { countryLabel } from "@/components/pathways/pathway-ui";
import { ConfidenceBadge, LineStatusIcon, StatusChip } from "@/components/pathway-engine/ui";
import { lineText, subjectList, testName, type Tr } from "@/components/pathway-engine/labels";
import { CompareSwitcher, ParamSelect } from "@/components/discovery/client";
import { engineFocus } from "@/server/pathway-engine/page-data";
import { subjectNames } from "@/server/pathway-engine/page-data";
import { CURRICULA, type Curriculum, type LineResult } from "@/server/pathway-engine/types";
import { loadComparison, staffStudentOptions, type CompareColumn } from "@/server/discovery/service";
import { SECTION_ORDER, rowDiffers, type CompareRow, type CompareSection } from "@/server/discovery/compare";
import { parseCompareIds, tuitionUsd } from "@/server/discovery/search";
import { CatalogNotice } from "@/components/pathway-engine/catalog-notice";

export async function generateMetadata() {
  const t = await getTranslations("discovery");
  return { title: t("compareTitle") };
}

type SP = { ids?: string; student?: string; curriculum?: string };

export default async function ComparePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  if (!ctx.can("pathways.view")) notFound();
  const t = await getTranslations("discovery");
  const te = await getTranslations("engine");
  const ta = await getTranslations("applications");
  const tr = te as unknown as Tr;
  const prefs = await formatPrefs(ctx);
  const fmt = (n: number) => fmtNumber(prefs, n);
  const { locale } = ctx;
  const focus = await engineFocus(ctx, sp.student);
  const student = focus.student;
  const ids = parseCompareIds(sp.ids);
  const pickedCurriculum = (CURRICULA as readonly string[]).includes(sp.curriculum ?? "") ? (sp.curriculum as Curriculum) : "AMERICAN";
  const curriculum = (student?.curriculum as Curriculum | undefined) ?? pickedCurriculum;
  const [data, names, staffOptions] = await Promise.all([ids.length >= 2 ? loadComparison(ctx, focus, ids, curriculum) : null, subjectNames(ctx), staffStudentOptions(ctx, focus)]);
  const pickerOptions = focus.options.length ? focus.options : staffOptions;
  const studentParam = student && !ctx.isStudent ? student.id : null;
  const withStudent = (href: string) => (studentParam ? `${href}${href.includes("?") ? "&" : "?"}student=${studentParam}` : href);
  const searchHref = withStudent("/career/pathways/search");
  const cols = data?.columns ?? [];

  const header = (
    <>
      <Link href={searchHref} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4 rtl:rotate-180" />
        {t("title")}
      </Link>
      <PageHeader
        eyebrow={student && !ctx.isStudent ? te("studentLine", { name: student.name, grade: student.gradeLevel, curriculum: te(`curriculum.${student.curriculum}`) }) : undefined}
        title={t("compareTitle")}
        description={student ? t("compareSubtitleStudent", { curriculum: te(`curriculum.${curriculum}`) }) : t("compareSubtitle", { curriculum: te(`curriculum.${curriculum}`) })}
        actions={
          <>
            {pickerOptions.length > 0 && <StudentPicker students={pickerOptions} current={student?.id ?? null} />}
            {!student && (
              <ParamSelect param="curriculum" label={t("filter.curriculum")} value={curriculum} options={CURRICULA.filter((c) => c !== "OTHER").map((c) => ({ value: c, label: te(`curriculum.${c}`) }))} className="w-48" testId="compare-curriculum" />
            )}
          </>
        }
      />
    </>
  );

  if (!data || cols.length < 2) {
    return (
      <PageBody>
        {header}
        <EmptyState
          icon={<Columns3 className="size-5" />}
          title={t("compareEmptyTitle")}
          body={t("compareEmptyBody")}
          action={
            <Button asChild>
              <Link href={searchHref}>{t("openSearch")}</Link>
            </Button>
          }
        />
      </PageBody>
    );
  }

  const programHref = (id: string) => withStudent(`/career/pathways/programs/${id}`);
  const removeHref = (id: string) => withStudent(`/career/pathways/compare?ids=${cols.map((c) => c.meta.id).filter((x) => x !== id).join(",")}`);
  const rowLabel = (r: CompareRow): string => {
    if (r.section === "subject") return subjectList(r.keys, names, locale, tr);
    if (r.section === "language") return t("row.language");
    if (r.section === "test") {
      const c = r.cells.find(Boolean)!;
      return (c.alternatives?.length ? c.alternatives : (c.keys ?? [])).map((x) => testName(tr, x)).join(te("line.or"));
    }
    if (r.section === "additional") {
      const c = r.cells.find(Boolean)!;
      return te.has(`additional.${c.type}`) ? te(`additional.${c.type}`) : c.type;
    }
    return t(`row.${r.key.slice(8).split("#")[0]}`);
  };
  const cellText = (l: LineResult, col: CompareColumn): string => {
    if (l.kind === "subject") {
      const parts = [t(`type.${l.type}`)];
      if (l.minimumLevel) parts.push(te(`level.${l.minimumLevel}`));
      if (l.required) parts.push(te("line.minGrade", { grade: String(l.required) }));
      return parts.join(te("line.sep"));
    }
    const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
    if (l.kind === "test") return cap(l.required ? t("testCell", { policy: te(`testPolicy.${l.type}`), min: fmt(Number(l.required)) }) : te(`testPolicy.${l.type}`));
    return lineText(tr, l, names, locale, col.rows);
  };
  const Cell = ({ l, col }: { l: LineResult | null; col: CompareColumn }) =>
    !l ? (
      <span className="text-xs text-muted-foreground">{t("notListed")}</span>
    ) : (
      <div className="flex items-start gap-1.5" data-testid="compare-cell" data-status={student ? l.status : undefined}>
        {student && <LineStatusIcon status={l.status} advisory={l.advisory} className="mt-0.5" />}
        <div className="min-w-0 text-sm">
          <div>{cellText(l, col)}</div>
          {student && !l.advisory && l.status === "not_met" && <div className="text-xs text-danger">{l.have !== null && l.have !== undefined && l.have !== "" ? te("program.have", { have: String(l.have) }) : te("program.missing")}</div>}
          {student && l.status === "unknown" && l.reason && <div className="text-xs text-info">{te(`reason.${l.reason}`)}</div>}
          {student && l.status === "met" && l.satisfiedBy?.length ? <div className="text-xs text-muted-foreground">{te("program.satisfiedBy", { courses: l.satisfiedBy.map((c) => pick(locale, c.nameEn, c.nameAr)).join(te("line.and")) })}</div> : null}
        </div>
      </div>
    );
  const tuition = (c: CompareColumn) => {
    if (c.meta.tuitionPerYear === null || !c.meta.tuitionCurrency) return te("program.tuitionUnknown");
    const usd = tuitionUsd(c.meta.tuitionPerYear, c.meta.tuitionCurrency);
    return `${te("program.tuitionValue", { amount: fmt(c.meta.tuitionPerYear), currency: c.meta.tuitionCurrency })}${usd !== null && c.meta.tuitionCurrency !== "USD" ? ` (${t("usdApprox", { amount: fmt(usd) })})` : ""}`;
  };
  const Deadlines = ({ c }: { c: CompareColumn }) =>
    c.deadlines.length === 0 ? (
      <span className="text-xs text-muted-foreground">{t("noDeadlines")}</span>
    ) : (
      <ul className="space-y-1 text-sm" data-testid="compare-deadlines">
        {c.deadlines.map((d, i) => (
          <li key={i} className={cn(c.primary === d && "font-medium")}>
            {ta.has(`deadlineKind.${d.kind}`) ? ta(`deadlineKind.${d.kind}`) : d.kind}: {fmtDate(prefs, d.date)}
            <div className={cn("text-xs", d.confirm ? "text-[oklch(0.55_0.14_65)]" : "text-muted-foreground")}>{ta(`source.${d.source}`)}</div>
          </li>
        ))}
      </ul>
    );
  const Source = ({ c }: { c: CompareColumn }) => (
    <div className="space-y-1">
      <ConfidenceBadge confidence={c.confidence} />
      <div className="text-xs text-muted-foreground">{c.checkedAt ? te("program.checked", { date: fmtDate(prefs, c.checkedAt) }) : te("program.notChecked")}</div>
      {c.sourceUrl && (
        <a href={c.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-brand hover:underline">
          {te("program.openSource")}
          <ExternalLink className="size-3" />
        </a>
      )}
    </div>
  );
  const facts: Array<{ key: string; label: string; render: (c: CompareColumn) => React.ReactNode }> = [
    { key: "university", label: t("fact.university"), render: (c) => pick(locale, c.meta.university.nameEn, c.meta.university.nameAr) },
    { key: "country", label: t("fact.country"), render: (c) => `${pick(locale, c.meta.university.cityEn, c.meta.university.cityAr)}, ${countryLabel(c.meta.university.countryCode, locale)}` },
    { key: "degree", label: t("fact.degree"), render: (c) => c.meta.degree },
    { key: "duration", label: t("fact.duration"), render: (c) => t("years", { n: fmt(c.meta.durationYears) }) },
    { key: "tuition", label: t("fact.tuition"), render: tuition },
    { key: "language", label: t("fact.language"), render: (c) => (c.meta.teachingLanguage ? te(`language.${c.meta.teachingLanguage}`) : "-") },
    { key: "intake", label: t("fact.intake"), render: (c) => (c.intakes.length ? c.intakes.map((y) => te("program.intake", { year: String(y) })).join(t("listSep")) : te("program.noIntakes")) },
    { key: "route", label: t("fact.route"), render: (c) => (ta.has(`route.${c.route}`) ? ta(`route.${c.route}`) : c.route) },
    { key: "deadlines", label: t("fact.deadlines", { year: String(data.intakeYear) }), render: (c) => <Deadlines c={c} /> },
    ...(student ? [{ key: "status", label: t("fact.status"), render: (c: CompareColumn) => <StatusChip status={c.result.status} /> }] : []),
    { key: "source", label: t("fact.source"), render: (c) => <Source c={c} /> },
  ];
  const sectionRows = (s: CompareSection) => data.aligned.filter((r) => r.section === s);

  return (
    <PageBody>
      {header}
      <CatalogNotice ctx={ctx} />
      {data.missing.length > 0 && <p className="text-sm text-muted-foreground">{t("someMissing", { n: data.missing.length })}</p>}

      {/* Desktop: side by side */}
      <Panel className="hidden md:block" padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] table-fixed border-collapse text-sm" data-testid="compare-table">
            <colgroup>
              <col className="w-48" />
              {cols.map((c) => (
                <col key={c.meta.id} />
              ))}
            </colgroup>
            <thead>
              <tr className="border-b align-top">
                <th scope="col" className="p-3 text-start text-xs font-medium text-muted-foreground">
                  {t("programme")}
                </th>
                {cols.map((c) => (
                  <th key={c.meta.id} scope="col" className="p-3 text-start font-normal" data-testid="compare-column">
                    <div className="flex items-start justify-between gap-2">
                      <Link href={programHref(c.meta.id)} className="font-semibold hover:text-brand">
                        {pick(locale, c.meta.nameEn, c.meta.nameAr)}
                      </Link>
                      <Link href={removeHref(c.meta.id)} aria-label={t("removeFromCompare", { name: pick(locale, c.meta.nameEn, c.meta.nameAr) })} className="text-muted-foreground hover:text-foreground" data-testid="compare-remove">
                        <X className="size-4" />
                      </Link>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {facts.map((f) => (
                <tr key={f.key} className="border-b align-top" data-testid={`fact-${f.key}`}>
                  <th scope="row" className="bg-muted/30 p-3 text-start text-xs font-medium text-muted-foreground">
                    {f.label}
                  </th>
                  {cols.map((c) => (
                    <td key={c.meta.id} className="p-3">
                      {f.render(c)}
                    </td>
                  ))}
                </tr>
              ))}
              {SECTION_ORDER.map((s) => {
                const rows = sectionRows(s);
                if (!rows.length) return null;
                return [
                  <tr key={`h-${s}`} className="border-b bg-muted/50">
                    <th colSpan={cols.length + 1} scope="colgroup" className="p-2 px-3 text-start text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t(`section.${s}`)}
                    </th>
                  </tr>,
                  ...rows.map((r) => (
                    <tr key={r.key} className={cn("border-b align-top", rowDiffers(r) && "bg-brand-soft/20")} data-testid="compare-row" data-row={r.key}>
                      <th scope="row" className="p-3 text-start text-sm font-medium">
                        {rowLabel(r)}
                        {r.advisory && <Pill className="ms-1.5">{te("program.advice")}</Pill>}
                      </th>
                      {cols.map((c, i) => (
                        <td key={c.meta.id} className="p-3">
                          <Cell l={r.cells[i]} col={c} />
                        </td>
                      ))}
                    </tr>
                  )),
                ];
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* Mobile: one programme at a time */}
      <div className="md:hidden" data-testid="compare-mobile">
        <CompareSwitcher
          labels={cols.map((c) => pick(locale, c.meta.nameEn, c.meta.nameAr))}
          panels={cols.map((c, i) => (
            <Panel key={c.meta.id}>
              <div className="mb-3 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link href={programHref(c.meta.id)} className="font-semibold hover:text-brand">
                    {pick(locale, c.meta.nameEn, c.meta.nameAr)}
                  </Link>
                </div>
                <Link href={removeHref(c.meta.id)} aria-label={t("removeFromCompare", { name: pick(locale, c.meta.nameEn, c.meta.nameAr) })} className="text-muted-foreground">
                  <X className="size-4" />
                </Link>
              </div>
              <dl className="divide-y text-sm">
                {facts.map((f) => (
                  <div key={f.key} className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2 py-2">
                    <dt className="text-xs text-muted-foreground">{f.label}</dt>
                    <dd className="min-w-0">{f.render(c)}</dd>
                  </div>
                ))}
              </dl>
              {SECTION_ORDER.map((s) => {
                const rows = sectionRows(s).filter((r) => r.cells[i]);
                if (!rows.length) return null;
                return (
                  <section key={s} className="mt-3 border-t pt-3">
                    <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t(`section.${s}`)}</h3>
                    <ul className="divide-y">
                      {rows.map((r) => (
                        <li key={r.key} className="py-2">
                          <div className="text-sm font-medium">{rowLabel(r)}</div>
                          <Cell l={r.cells[i]} col={c} />
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </Panel>
          ))}
        />
      </div>
      <p className="text-xs text-muted-foreground">{te("program.disclaimer")}</p>
    </PageBody>
  );
}
