import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AlertTriangle, ArrowLeft, CheckCircle2, ExternalLink, FileText, Info, ShieldCheck, ShieldAlert } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { gradeLevelValues } from "@/lib/grade-levels";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { Pill, type Tone } from "@/components/app/badges";
import { canExportIds, canFixStudent, canPrepare, canRecordReference, canSignOff, canView } from "@/server/govreports/access";
import { authorityFor, returnPageData, type ProblemView } from "@/server/govreports/queries";
import { canCarryIds, type ProblemRule } from "@/server/govreports/kinds";
import { nationalityOptions } from "@/server/govreports/nationality";
import { cellValue, type Table } from "@/server/govreports/table";
import { signerOf } from "@/server/govreports/signer";
import { ExportMenu } from "@/components/government/export-menu";
import { DeleteReturnButton, FixStudentButton, ReferenceButton, SignOffButton, SubmissionButton } from "@/components/government/dialogs";

export async function generateMetadata() {
  const t = await getTranslations("govReports");
  return { title: t("title") };
}

const STATUS_TONE: Record<string, Tone> = { DRAFT: "neutral", SIGNED_OFF: "brand", SUBMITTED: "success" };
const SEVERITY_TONE: Record<string, Tone> = { error: "danger", warning: "warning", note: "info" };
const SHOW = 25;

export default async function GovernmentReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getCtx();
  if (!canView(ctx)) notFound();
  const page = /^[a-z0-9]{8,40}$/i.test(id) ? await returnPageData(ctx, id) : null;
  if (!page) notFound();
  const t = await getTranslations("govReports");
  const tg = await getTranslations("gradeLevel");
  const prefs = await formatPrefs(ctx);
  const authority = await authorityFor(ctx);
  const loc = ctx.locale === "ar" ? "ar" : "en";
  const prepare = canPrepare(ctx);
  const fixStudents = prepare && canFixStudent(ctx);
  const recordRefs = prepare && canRecordReference(ctx);
  const signer = canSignOff(ctx) ? await signerOf(ctx.db, ctx.membershipId) : null;
  const { ret, data } = page;
  const problems = page.problems.filter((p) => p.severity !== "note");
  const notes = page.problems.filter((p) => p.severity === "note");
  const byRule = new Map<ProblemRule, ProblemView[]>();
  for (const p of problems) byRule.set(p.rule, [...(byRule.get(p.rule) ?? []), p]);
  const nationalities = nationalityOptions().map((n) => ({ code: n.code, label: loc === "ar" ? n.ar : n.en }));
  const grade = (g: number) => tg("label", gradeLevelValues(g));
  const presence = { present: t("present"), missing: t("missing") };
  const fileLabel = (e: { version: number; format: string; locale: string; createdAt: Date }) => t("submit.fileOption", { version: e.version, format: `${e.format}${e.format === "PDF" ? ` ${e.locale.toUpperCase()}` : ""}`, when: fmtDateTime(prefs, e.createdAt) });
  const detail = (p: ProblemView) => {
    if (p.rule === "age_grade") return t(`ruleDetail.age_grade_${p.values?.direction === "under" ? "under" : "over"}`, { age: p.values?.age ?? 0, expected: p.values?.expected ?? 0 });
    if ((p.rule === "duplicate_eid" || p.rule === "duplicate_name_dob") && p.other) return t("ruleDetail.duplicate", { other: `${p.other.name} (${p.other.studentNo})` });
    if (p.rule.startsWith("staff_")) return t("ruleDetail.staff");
    if (p.rule === "unexplained_absences" || p.rule === "unpublished_results") return t(`ruleDetail.${p.rule}`, { n: p.count ?? 0 });
    if (p.rule === "limit_off") return t("ruleDetail.limit_off");
    return null;
  };

  return (
    <PageBody className="max-w-6xl">
      <Link href="/admin/government" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4 rtl:rotate-180" />
        {t("detail.back")}
      </Link>
      <PageHeader
        title={page.title}
        description={page.period}
        actions={
          <>
            <ExportMenu returnId={ret.id} problems={problems.length} canPrepare={prepare} canIds={canExportIds(ctx)} idsPossible={canCarryIds(page.kind)} />
            {signer && ret.status !== "SUBMITTED" && <SignOffButton returnId={ret.id} signer={signer.title ? `${loc === "ar" ? signer.name.ar : signer.name.en}, ${loc === "ar" ? signer.title.ar : signer.title.en}` : loc === "ar" ? signer.name.ar : signer.name.en} problems={problems.length} signed={Boolean(ret.signedOffAt) && !page.signedStale} />}
            {prepare && <SubmissionButton returnId={ret.id} files={page.exports.map((e) => ({ id: e.id, label: fileLabel(e), sheet: e.format !== "PDF" }))} authority={authority.short} signed={Boolean(ret.signedOffAt) && !page.signedStale} />}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="gov-status">
        <Pill tone={STATUS_TONE[ret.status] ?? "neutral"} dot>
          {t(`status.${ret.status}`)}
        </Pill>
        <Pill tone="neutral">{t(`kind.${page.kind}`)}</Pill>
        <Pill tone="neutral">{t("detail.nextVersion", { version: page.nextVersion })}</Pill>
        {ret.signedOffAt ? (
          <span className={cn("inline-flex items-center gap-1.5 text-xs", page.signedStale ? "text-danger" : "text-success")} data-testid="gov-signed">
            {page.signedStale ? <ShieldAlert className="size-4" /> : <ShieldCheck className="size-4" />}
            {page.signedStale ? t("detail.signedStale") : t("detail.signedOff", { name: page.signedName ?? ret.signedOffName ?? "", date: fmtDate(prefs, ret.signedOffAt) })}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">{t("detail.notSigned")}</span>
        )}
        {prepare && ret.status === "DRAFT" && page.exports.length === 0 && (
          <span className="ms-auto">
            <DeleteReturnButton returnId={ret.id} />
          </span>
        )}
      </div>

      {page.submittedChanged && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          {t("detail.submittedChanged", { version: page.nextVersion })}
        </div>
      )}

      <div className="flex items-start gap-2 rounded-lg border bg-info-soft/40 px-3 py-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0 text-info" />
        {t("pdf.formatNotice", { authority: authority.short })}
      </div>

      <Panel>
        <PanelHeader
          title={t("detail.checks")}
          description={t("detail.checksBody")}
          icon={problems.length ? <AlertTriangle className="size-4 text-warning" /> : <CheckCircle2 className="size-4 text-success" />}
          action={problems.length ? <Pill tone="warning" dot>{t("detail.problemCount", { count: problems.length })}</Pill> : undefined}
        />
        {problems.length === 0 ? (
          <p className="flex items-center gap-2 rounded-lg bg-success-soft px-3 py-2 text-sm text-success" data-testid="gov-no-problems">
            <CheckCircle2 className="size-4" />
            {t("detail.noProblems")}
          </p>
        ) : (
          <div className="space-y-4" data-testid="gov-problems">
            {[...byRule.entries()].map(([rule, list]) => (
              <section key={rule} data-testid={`gov-rule-${rule}`}>
                <h3 className="mb-1.5 flex items-center gap-2 text-sm font-medium">
                  <Pill tone={SEVERITY_TONE[list[0].severity]}>{list.length}</Pill>
                  {t(`rule.${rule}`)}
                </h3>
                <ul className="divide-y rounded-lg border">
                  {list.slice(0, SHOW).map((p) => (
                    <li key={p.key} className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center" data-testid="gov-problem">
                      <div className="min-w-0 flex-1 text-sm">
                        {p.student ? (
                          <>
                            <span className="font-medium">{p.student.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {" · "}
                              <bdi>
                                {grade(p.student.grade)}
                                {p.student.section ? ` ${p.student.section}` : ""}
                              </bdi>
                              {" · "}
                              <bdi>{p.student.studentNo}</bdi>
                            </span>
                          </>
                        ) : p.member ? (
                          <span className="font-medium">{p.member.name}</span>
                        ) : null}
                        {detail(p) && <div className="text-xs text-muted-foreground">{detail(p)}</div>}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {p.student && (p.missing?.length ?? 0) > 0 && ["missing_eid", "missing_nationality", "missing_dob", "missing_gender"].includes(p.rule) && fixStudents ? <FixStudentButton studentId={p.student.id} name={p.student.name} missing={p.missing ?? []} nationalities={nationalities} /> : null}
                        {p.student && p.rule === "no_reference" && recordRefs ? <ReferenceButton studentId={p.student.id} name={p.student.name} authority={authority.short} /> : null}
                        {p.student && (
                          <Link href={`/students/${p.student.id}`} className="inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-sm font-medium text-brand hover:bg-brand-soft/50" data-testid="gov-open-record">
                            {t("detail.openRecord")}
                            <ExternalLink className="size-3.5" />
                          </Link>
                        )}
                        {p.other && (
                          <Link href={`/students/${p.other.id}`} className="inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-sm font-medium text-brand hover:bg-brand-soft/50">
                            {p.other.studentNo}
                            <ExternalLink className="size-3.5" />
                          </Link>
                        )}
                        {p.member && ctx.can("people.manage") && (
                          <Link href={`/admin/people?tab=staff&q=${encodeURIComponent(p.member.name)}`} className="inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-sm font-medium text-brand hover:bg-brand-soft/50">
                            {t("detail.openRecord")}
                            <ExternalLink className="size-3.5" />
                          </Link>
                        )}
                        {(p.rule === "unexplained_absences" || p.rule === "limit_off") && ctx.can("attendance.manage") && (
                          <Link href={p.rule === "limit_off" ? "/attendance/settings" : "/attendance/office"} className="inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-sm font-medium text-brand hover:bg-brand-soft/50">
                            {t("detail.openRecord")}
                            <ExternalLink className="size-3.5" />
                          </Link>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
                {list.length > SHOW && <p className="mt-1 text-xs text-muted-foreground">{t("detail.more", { n: list.length - SHOW })}</p>}
              </section>
            ))}
          </div>
        )}
        {notes.length > 0 && (
          <div className="mt-4 space-y-1.5">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("detail.notes")}</h3>
            {aggregateNotes(notes).map((n) => (
              <p key={n.rule} className="flex items-start gap-2 rounded-lg bg-info-soft/50 px-3 py-2 text-sm">
                <Info className="mt-0.5 size-4 shrink-0 text-info" />
                <span>
                  <span className="font-medium">{t(`rule.${n.rule}`)}</span>
                  {n.count > 1 ? ` (${n.count})` : ""}
                  {n.sample && detail(n.sample) ? <span className="block text-xs text-muted-foreground">{detail(n.sample)}</span> : null}
                </span>
              </p>
            ))}
          </div>
        )}
      </Panel>

      <Panel>
        <PanelHeader title={t("detail.data")} description={t("detail.dataBody")} icon={<FileText className="size-4" />} />
        <div className="space-y-6">
          {data.tables.map((tb) => (
            <DataTable key={tb.key} tb={tb} loc={loc} presence={presence} empty={t("pdf.noRows")} />
          ))}
        </div>
      </Panel>

      <Panel>
        <PanelHeader title={t("detail.files")} description={t("detail.filesBody")} />
        {page.exports.length === 0 && page.submissions.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="gov-no-files">
            {t("detail.noFiles")}
          </p>
        ) : (
          <div className="space-y-4">
            {page.submissions.length > 0 && (
              <ul className="space-y-2" data-testid="gov-submissions">
                {page.submissions.map((s) => (
                  <li key={s.id} className="rounded-lg border border-success/30 bg-success-soft/50 px-3 py-2 text-sm">
                    <div className="font-medium">{t("detail.submission", { date: fmtDate(prefs, s.submittedOn), ref: s.reference })}</div>
                    <div className="text-xs text-muted-foreground">
                      {t("detail.submissionBy", { name: s.by, version: s.file?.version ?? "" })}
                      {s.note ? ` · ${s.note}` : ""}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {page.exports.length > 0 && (
              <ul className="divide-y rounded-lg border" data-testid="gov-files">
                {page.exports.map((e) => (
                  <li key={e.id} className="flex flex-col gap-1 px-3 py-2 text-sm sm:flex-row sm:items-center sm:gap-3">
                    <Pill tone="brand">{t("detail.version", { version: e.version })}</Pill>
                    <span className="font-medium">{t("detail.file", { format: e.format, lang: t(`detail.lang.${e.locale === "ar" ? "ar" : "en"}`) })}</span>
                    <span className="text-xs text-muted-foreground">{t("detail.by", { name: e.by, when: fmtDateTime(prefs, e.createdAt) })}</span>
                    <span className="font-mono text-xs text-muted-foreground sm:ms-auto">{t("detail.checksum", { sum: e.fileSha256.slice(0, 16) })}</span>
                    {e.withIds && <Pill tone="danger">{t("detail.withIds")}</Pill>}
                    {e.problemCount > 0 && <Pill tone="warning">{t("detail.withProblems", { n: e.problemCount })}</Pill>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Panel>
    </PageBody>
  );
}

function aggregateNotes(notes: ProblemView[]) {
  const m = new Map<string, { rule: ProblemRule; count: number; sample: ProblemView }>();
  for (const n of notes) {
    const e = m.get(n.rule);
    if (e) e.count++;
    else m.set(n.rule, { rule: n.rule, count: 1, sample: n });
  }
  return [...m.values()];
}

function DataTable({ tb, loc, presence, empty }: { tb: Table; loc: "en" | "ar"; presence: { present: string; missing: string }; empty: string }) {
  // Headline figures read best as tiles; downloads keep them as a table.
  if (tb.key === "summary")
    return (
      <section data-testid="gov-table-summary">
        <h3 className="mb-2 text-sm font-semibold">{loc === "ar" ? tb.title.ar : tb.title.en}</h3>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {tb.rows.map((r, i) => {
            const v = cellValue(r[1], loc, undefined, presence);
            return (
              <div key={i} className="rounded-lg border bg-muted/30 px-3 py-2">
                <dt className="truncate text-xs text-muted-foreground">{cellValue(r[0], loc)}</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums">{typeof v === "number" ? (Number.isInteger(v) ? v : v.toFixed(1)) : v}</dd>
              </div>
            );
          })}
        </dl>
      </section>
    );
  return (
    <section data-testid={`gov-table-${tb.key}`}>
      <h3 className="mb-2 text-sm font-semibold">{loc === "ar" ? tb.title.ar : tb.title.en}</h3>
      <div className="max-h-[480px] overflow-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted text-xs text-muted-foreground">
            <tr>
              {tb.columns.map((c) => (
                <th key={c.key} className={cn("whitespace-nowrap px-3 py-2 font-medium", c.num ? "text-end" : "text-start")}>
                  {loc === "ar" ? c.label.ar : c.label.en}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {tb.rows.length === 0 ? (
              <tr>
                <td colSpan={tb.columns.length} className="px-3 py-3 text-center text-sm text-muted-foreground">
                  {empty}
                </td>
              </tr>
            ) : (
              tb.rows.map((r, i) => (
                <tr key={i} className={cn(tb.totalRow && i === tb.rows.length - 1 && "bg-muted/50 font-semibold")}>
                  {r.map((c, j) => {
                    const v = cellValue(c, loc, undefined, presence);
                    return (
                      <td key={j} className={cn("whitespace-nowrap px-3 py-1.5", tb.columns[j]?.num ? "text-end tabular-nums" : "text-start")}>
                        {typeof v === "number" ? (Number.isInteger(v) ? v : v.toFixed(1)) : v}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {tb.note && <p className="mt-1.5 text-xs text-muted-foreground">{loc === "ar" ? tb.note.ar : tb.note.en}</p>}
    </section>
  );
}
