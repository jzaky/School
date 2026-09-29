import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AlertTriangle, CheckCircle2, FilePen, GraduationCap } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDate, fmtNumber, fmtTime } from "@/lib/format";
import { pick, userName } from "@/lib/i18n-data";
import { cn } from "@/lib/utils";
import { Link } from "@/i18n/navigation";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { StatCard } from "@/components/app/stat-card";
import { EmptyState } from "@/components/app/empty-state";
import { Pill } from "@/components/app/badges";
import { DeleteSittingButton, PublishExamsButton, SittingDialog, SuggestDialog } from "@/components/exams/exam-admin";
import { examContext } from "@/server/exams/queries";
import { addDays, dayKey, detectClashes, type Clash } from "@/server/exams/schedule";

export async function generateMetadata() {
  const t = await getTranslations("exams");
  return { title: t("adminTitle") };
}

const GRADES = [6, 7, 8, 9, 10, 11, 12];

export default async function AdminExamsPage({ searchParams }: { searchParams: Promise<{ term?: string; grade?: string }> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  if (!ctx.can("calendar.manage")) notFound();
  const t = await getTranslations("exams");
  const prefs = await formatPrefs(ctx);
  const { db, locale } = ctx;
  const ec = await examContext(ctx);
  const today = dayKey(new Date());
  const term = ec.terms.find((x) => x.id === sp.term) ?? ec.terms.find((x) => dayKey(x.startsOn) <= today && dayKey(x.endsOn) >= today) ?? ec.terms[0] ?? null;
  const grade = sp.grade && /^\d{1,2}$/.test(sp.grade) ? Number(sp.grade) : null;

  const [all, subjects, staffRows] = await Promise.all([
    db.examSitting.findMany({ where: { termId: term?.id ?? null }, orderBy: [{ startsAt: "asc" }, { gradeLevel: "asc" }] }),
    db.subject.findMany({ orderBy: { nameEn: "asc" } }),
    db.membership.findMany({ where: { status: "ACTIVE", staffProfile: { isNot: null } }, include: { user: true } }),
  ]);
  const staff = staffRows.map((m) => ({ value: m.id, label: userName(m.user, locale) })).sort((a, b) => a.label.localeCompare(b.label));
  const staffName = new Map(staff.map((s) => [s.value, s.label]));
  const clashes = detectClashes(all, { holidays: ec.holidays, weekDays: ctx.org.weekDays });
  const clashOf = (id: string) => clashes.filter((c) => c.sittingId === id);
  const sittings = all.filter((s) => grade === null || s.gradeLevel === grade);
  const drafts = sittings.filter((s) => s.status === "DRAFT");
  const draftClashes = clashes.filter((c) => drafts.some((d) => d.id === c.sittingId)).length;
  const subjectOptions = subjects.map((s) => ({ value: s.id, label: pick(locale, s.nameEn, s.nameAr) }));
  const byDay = new Map<string, typeof sittings>();
  for (const s of sittings) byDay.set(dayKey(s.startsAt), [...(byDay.get(dayKey(s.startsAt)) ?? []), s]);

  // Default window: the last two weeks of the term, or the next two weeks when the term has ended.
  const termEnd = term ? dayKey(term.endsOn) : addDays(today, 28);
  const winEnd = termEnd > today ? termEnd : addDays(today, 28);
  const winStart = addDays(winEnd, -13) > today ? addDays(winEnd, -13) : addDays(today, 7);
  const qs = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const base = { term: term?.id ?? null, grade: grade === null ? null : String(grade), ...patch };
    for (const [k, v] of Object.entries(base)) if (v) p.set(k, v);
    return `/admin/exams?${p.toString()}`;
  };
  const clashLabel = (c: Clash) => {
    if (c.kind === "holiday") return t("clash.holiday", { name: c.holiday ?? "" });
    if (c.kind === "invigilator") return t("clash.invigilator", { name: staffName.get(c.invigilatorId ?? "") ?? "" });
    return t(`clash.${c.kind}`);
  };

  return (
    <PageBody className="max-w-[1400px]">
      <PageHeader
        title={t("adminTitle")}
        description={t("adminSubtitle")}
        actions={
          <>
            <SuggestDialog termId={term?.id ?? null} grades={GRADES} staff={staff} defaultStart={winStart} defaultEnd={winEnd} />
            <SittingDialog termId={term?.id ?? null} subjects={subjectOptions} staff={staff} grades={GRADES} defaultDate={winStart} />
            <PublishExamsButton termId={term?.id ?? null} gradeLevel={grade} drafts={drafts.length} clashes={draftClashes} />
          </>
        }
      />
      {ec.terms.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {ec.terms.map((x) => (
            <Link key={x.id} href={qs({ term: x.id })} className={cn("rounded-full border px-3 py-1 text-sm font-medium", x.id === term?.id ? "border-brand bg-brand-soft text-brand" : "bg-card text-muted-foreground hover:text-foreground")}>
              {pick(locale, x.nameEn, x.nameAr)}
            </Link>
          ))}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t("statSittings")} value={fmtNumber(prefs, sittings.length)} icon={<GraduationCap className="size-5" />} />
        <StatCard label={t("statPublished")} value={fmtNumber(prefs, sittings.length - drafts.length)} icon={<CheckCircle2 className="size-5" />} tone="success" />
        <StatCard label={t("statDrafts")} value={fmtNumber(prefs, drafts.length)} icon={<FilePen className="size-5" />} tone="info" />
        <StatCard label={t("statClashes")} value={fmtNumber(prefs, new Set(clashes.filter((c) => sittings.some((s) => s.id === c.sittingId)).map((c) => c.sittingId)).size)} icon={<AlertTriangle className="size-5" />} tone="danger" />
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Link href={qs({ grade: null })} className={cn("rounded-full border px-2.5 py-1 text-xs font-medium", grade === null ? "border-brand bg-brand-soft text-brand" : "bg-card text-muted-foreground")}>
          {t("allGrades")}
        </Link>
        {GRADES.map((g) => (
          <Link key={g} href={qs({ grade: String(g) })} className={cn("rounded-full border px-2.5 py-1 text-xs font-medium", grade === g ? "border-brand bg-brand-soft text-brand" : "bg-card text-muted-foreground")} data-testid={`filter-grade-${g}`}>
            {t("gradeN", { grade: g })}
          </Link>
        ))}
      </div>

      {sittings.length === 0 ? (
        <EmptyState icon={<GraduationCap className="size-5" />} title={t("emptyAdmin")} body={t("emptyAdminBody")} />
      ) : (
        <div className="space-y-4" data-testid="exam-days">
          {[...byDay.entries()].map(([k, list]) => (
            <Panel key={k} padded={false} className="overflow-hidden">
              <div className="border-b bg-muted/40 px-4 py-2 text-sm font-semibold">{fmtDate(prefs, list[0].startsAt, "long")}</div>
              <ul className="divide-y">
                {list.map((s) => {
                  const cs = clashOf(s.id);
                  return (
                    <li key={s.id} className={cn("flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center", cs.length && "bg-danger-soft/40")} data-testid="sitting-row">
                      <div className="w-28 shrink-0 text-xs tabular-nums text-muted-foreground">
                        {fmtTime(prefs, s.startsAt)} - {fmtTime(prefs, s.endsAt)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium">{pick(locale, s.titleEn, s.titleAr)}</span>
                          <Pill tone="brand">{t("gradeN", { grade: s.gradeLevel })}</Pill>
                          {s.status === "PUBLISHED" ? <Pill tone="success" dot>{t("statusPublished")}</Pill> : <Pill tone="neutral" dot>{t("statusDraft")}</Pill>}
                          {cs.map((c, i) => (
                            <Pill key={i} tone="danger" className="whitespace-normal">
                              <AlertTriangle className="size-3" />
                              {clashLabel(c)}
                            </Pill>
                          ))}
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {s.room ?? t("noRoom")}
                          {s.invigilatorIds.length > 0 && ` · ${s.invigilatorIds.map((x) => staffName.get(x) ?? "").join(", ")}`}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <SittingDialog
                          termId={term?.id ?? null}
                          subjects={subjectOptions}
                          staff={staff}
                          grades={GRADES}
                          defaultDate={winStart}
                          initial={{
                            id: s.id,
                            termId: s.termId,
                            subjectId: s.subjectId,
                            gradeLevel: s.gradeLevel,
                            date: dayKey(s.startsAt),
                            startTime: new Date(s.startsAt.getTime() + 4 * 3600_000).toISOString().slice(11, 16),
                            endTime: new Date(s.endsAt.getTime() + 4 * 3600_000).toISOString().slice(11, 16),
                            room: s.room ?? "",
                            invigilatorIds: s.invigilatorIds,
                          }}
                        />
                        <DeleteSittingButton id={s.id} label={`${pick(locale, s.titleEn, s.titleAr)} (${s.gradeLevel})`} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          ))}
        </div>
      )}
    </PageBody>
  );
}
