import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BookOpen, CheckCircle2, ClipboardCheck, FileSpreadsheet, Layers, UserPlus, Users } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDateTime, fmtNumber } from "@/lib/format";
import { personName, pick, userName } from "@/lib/i18n-data";
import { cn } from "@/lib/utils";
import { tenantTx } from "@/lib/tenant-db";
import { Link } from "@/i18n/navigation";
import { blocksOf } from "@/lib/registration";
import { registrationTemplateCsv } from "@/lib/registration-csv";
import { currentYear, getWindow, offeringsFor } from "@/server/registration/service";
import { DEFAULT_CAPACITY } from "@/server/registration/allocate";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { EmptyState } from "@/components/app/empty-state";
import { StatCard } from "@/components/app/stat-card";
import { Pill } from "@/components/app/badges";
import { DeleteOfferingButton, MoveStudent, OfferingDialog, RunAllocationButton, WindowControl } from "@/components/registration/admin-controls";
import { ImportErrorList, RegistrationImporter } from "@/components/registration/registration-import";

export async function generateMetadata() {
  const t = await getTranslations("registration");
  return { title: t("adminTitle") };
}

type Tab = "offerings" | "rosters" | "import";
const TABS: Tab[] = ["offerings", "rosters", "import"];
const ACTIVE = ["REQUESTED", "ALLOCATED", "WAITLISTED"] as const;

export default async function RegistrationAdminPage({ searchParams }: { searchParams: Promise<{ tab?: string; grade?: string; subject?: string }> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  if (!ctx.can("registration.manage")) notFound();
  const t = await getTranslations("registration");
  const prefs = await formatPrefs(ctx);
  const { db, locale, orgId } = ctx;
  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : "offerings";

  const { year, win, gradeLevels } = await tenantTx(orgId, async (tx) => {
    const y = await currentYear(tx, orgId);
    const w = await getWindow(tx, orgId);
    const g = y ? await tx.subjectOffering.groupBy({ by: ["gradeLevel"], where: { orgId, academicYearId: y.id }, orderBy: { gradeLevel: "asc" } }) : [];
    return { year: y, win: w, gradeLevels: g.map((x) => x.gradeLevel) };
  });
  if (!year) {
    return (
      <PageBody>
        <PageHeader title={t("adminTitle")} description={t("adminSubtitle")} />
        <EmptyState icon={<ClipboardCheck className="size-5" />} title={t("noYear")} body={t("noYearBody")} />
      </PageBody>
    );
  }
  const studentGrades = await db.student.groupBy({ by: ["gradeLevel"], where: { status: "ACTIVE" }, orderBy: { gradeLevel: "asc" } });
  const grades = [...new Set([...gradeLevels, ...studentGrades.map((g) => g.gradeLevel)])].sort((a, b) => a - b);
  const requested = sp.grade && /^\d{1,2}$/.test(sp.grade) ? Number(sp.grade) : null;
  const grade = requested !== null && grades.includes(requested) ? requested : (gradeLevels.find((g) => g >= 10) ?? grades[0] ?? 10);

  const [studentCount, regStudents, allocated, waiting, sections] = await Promise.all([
    db.student.count({ where: { status: "ACTIVE" } }),
    db.subjectRegistration.groupBy({ by: ["studentId"], where: { academicYearId: year.id, status: { in: [...ACTIVE] } } }),
    db.subjectRegistration.count({ where: { academicYearId: year.id, status: "ALLOCATED" } }),
    db.subjectRegistration.count({ where: { academicYearId: year.id, status: { in: ["REQUESTED", "WAITLISTED"] } } }),
    db.schoolClass.count({ where: { academicYearId: year.id, isHomeroom: false, subjectId: { not: null } } }),
  ]);

  const tabHref = (tb: Tab, g = grade) => `/admin/registration?${new URLSearchParams({ ...(tb !== "offerings" ? { tab: tb } : {}), ...(tb !== "import" ? { grade: String(g) } : {}) }).toString()}`;

  return (
    <PageBody>
      <PageHeader
        title={t("adminTitle")}
        description={t("adminSubtitle")}
        actions={
          <>
            <WindowControl open={win.open} deadlineDate={win.open && win.deadline ? new Date(win.deadline.getTime() + 4 * 3600_000).toISOString().slice(0, 10) : null} />
            <RunAllocationButton />
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card px-4 py-3 text-sm shadow-xs" data-testid="window-status">
        <Pill tone={win.open ? "success" : "neutral"} dot>
          {win.open ? t("windowOpen") : t("windowClosedPill")}
        </Pill>
        <span className="text-muted-foreground">
          {win.deadline ? (win.open ? t("windowUntil", { date: fmtDateTime(prefs, win.deadline) }) : t("windowClosedOn", { date: fmtDateTime(prefs, win.deadline) })) : t("windowNever")}
        </span>
        <span className="text-muted-foreground">·</span>
        <span className="text-muted-foreground">{pick(locale, year.nameEn, year.nameAr)}</span>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={t("statRegistered")} value={`${fmtNumber(prefs, regStudents.length)} / ${fmtNumber(prefs, studentCount)}`} icon={<Users className="size-4" />} />
        <StatCard label={t("statAllocated")} value={fmtNumber(prefs, allocated)} icon={<CheckCircle2 className="size-4" />} tone="success" />
        <StatCard label={t("statWaiting")} value={fmtNumber(prefs, waiting)} icon={<ClipboardCheck className="size-4" />} tone={waiting ? "warning" : "success"} />
        <StatCard label={t("statSections")} value={fmtNumber(prefs, sections)} icon={<Layers className="size-4" />} tone="info" />
      </div>

      <nav className="flex gap-1 overflow-x-auto border-b" aria-label={t("adminTitle")}>
        {TABS.map((tb) => (
          <Link key={tb} href={tabHref(tb)} className={cn("-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium", tab === tb ? "border-brand text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")} data-testid={`tab-${tb}`}>
            {t(`tab.${tb}`)}
          </Link>
        ))}
      </nav>

      {tab !== "import" && (
        <div className="flex flex-wrap gap-1.5" data-testid="grade-chips">
          {grades.map((g) => (
            <Link key={g} href={tabHref(tab, g)} className={cn("rounded-full border px-3 py-1 text-xs font-medium", g === grade ? "border-brand bg-brand-soft text-brand" : "bg-card text-muted-foreground hover:text-foreground")}>
              {t("gradeN", { grade: g })}
            </Link>
          ))}
        </div>
      )}

      {tab === "offerings" && (await offeringsTab())}
      {tab === "rosters" && (await rostersTab())}
      {tab === "import" && (await importTab())}
    </PageBody>
  );

  async function offeringsTab() {
    const offerings = await tenantTx(orgId, (tx) => offeringsFor(tx, orgId, year!.id, grade));
    const [subjects, students] = await Promise.all([
      db.subject.findMany({ orderBy: { nameEn: "asc" } }),
      db.student.findMany({ where: { gradeLevel: grade, status: "ACTIVE" }, orderBy: [{ section: "asc" }, { lastNameEn: "asc" }] }),
    ]);
    const gradeRegs = await db.subjectRegistration.findMany({ where: { academicYearId: year!.id, status: { in: [...ACTIVE] }, studentId: { in: students.map((s) => s.id) } } });
    const countBySubject = new Map<string, number>();
    for (const r of gradeRegs) countBySubject.set(r.subjectId, (countBySubject.get(r.subjectId) ?? 0) + 1);
    const subjectOptions = subjects.map((s) => ({ id: s.id, code: s.code, label: pick(locale, s.nameEn, s.nameAr) }));
    const nameOfCode = (code: string) => {
      const s = subjects.find((x) => x.code === code);
      return s ? pick(locale, s.nameEn, s.nameAr) : code;
    };
    const blocks = blocksOf(offerings);
    const optionIds = new Set(offerings.filter((o) => o.kind === "OPTION").map((o) => o.subjectId));
    const regsByStudent = new Map<string, Set<string>>();
    for (const r of gradeRegs) regsByStudent.set(r.studentId, new Set([...(regsByStudent.get(r.studentId) ?? []), r.subjectId]));
    const missing = students.filter((s) => {
      const mine = regsByStudent.get(s.id);
      if (!mine) return true;
      const chosen = [...mine].filter((id) => optionIds.has(id)).length;
      return chosen < blocks.length;
    });

    const row = (o: (typeof offerings)[number]) => (
      <li key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5" data-testid="offering-row">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{pick(locale, o.nameEn, o.nameAr)}</div>
          <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <span>{t("periodsN", { count: o.periodsPerWeek })}</span>
            {o.prerequisites.length > 0 && <span>· {t("requires", { subjects: o.prerequisites.map(nameOfCode).join(locale === "ar" ? "، " : ", ") })}</span>}
          </div>
          {(o.notesEn || o.notesAr) && <div className="mt-0.5 text-xs text-muted-foreground">{pick(locale, o.notesEn, o.notesAr)}</div>}
        </div>
        <span className="text-xs tabular-nums text-muted-foreground">{t("studentsN", { count: countBySubject.get(o.subjectId) ?? 0 })}</span>
        <div className="flex items-center">
          <OfferingDialog grade={grade} subjects={subjectOptions} takenSubjectIds={[]} value={{ id: o.id, subjectId: o.subjectId, kind: o.kind, optionBlock: o.optionBlock, prerequisites: o.prerequisites, periodsPerWeek: o.periodsPerWeek }} />
          <DeleteOfferingButton id={o.id} inUse={(countBySubject.get(o.subjectId) ?? 0) > 0} />
        </div>
      </li>
    );

    return (
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">{t("offeringsFor", { grade })}</h2>
            <OfferingDialog grade={grade} subjects={subjectOptions} takenSubjectIds={offerings.map((o) => o.subjectId)} />
          </div>
          {offerings.length === 0 ? (
            <EmptyState icon={<BookOpen className="size-5" />} title={t("noOfferings")} body={t("noOfferingsBody")} />
          ) : (
            <>
              <Panel>
                <PanelHeader title={t("coreTitle")} description={t("coreBody")} />
                <ul className="divide-y">{offerings.filter((o) => o.kind === "CORE").map(row)}</ul>
              </Panel>
              {blocks.map((b) => (
                <Panel key={b.block}>
                  <PanelHeader title={t("blockN", { block: b.block })} description={t("blockBody")} />
                  <ul className="divide-y">{b.options.map((o) => row(offerings.find((x) => x.subjectId === o.subjectId)!))}</ul>
                </Panel>
              ))}
            </>
          )}
        </div>
        <Panel className="h-fit">
          <PanelHeader title={t("progressTitle")} description={t("progressBody", { done: students.length - missing.length, total: students.length })} icon={<UserPlus className="size-4" />} />
          {missing.length === 0 ? (
            <p className="text-sm text-muted-foreground">{students.length ? t("allRegistered") : t("noStudentsInGrade")}</p>
          ) : (
            <ul className="max-h-96 divide-y overflow-y-auto" data-testid="missing-list">
              {missing.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0 truncate">{personName(s, locale)}</span>
                  <Link href={`/subjects?student=${s.id}`} className="shrink-0 text-xs font-medium text-brand hover:underline">
                    {t("registerOnBehalf")}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    );
  }

  async function rostersTab() {
    const classes = await db.schoolClass.findMany({
      where: { academicYearId: year!.id, gradeLevel: grade, isHomeroom: false, subjectId: { not: null } },
      include: { subject: true, enrollments: { include: { student: true } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    if (classes.length === 0) return <EmptyState icon={<Layers className="size-5" />} title={t("noSections")} body={t("noSectionsBody")} />;
    const teacherIds = [...new Set(classes.map((c) => c.teacherMembershipId).filter(Boolean) as string[])];
    const [teachers, regs] = await Promise.all([
      teacherIds.length ? db.membership.findMany({ where: { id: { in: teacherIds } }, include: { user: true } }) : [],
      db.subjectRegistration.findMany({ where: { academicYearId: year!.id, classId: { in: classes.map((c) => c.id) }, status: { in: [...ACTIVE] } }, select: { id: true, studentId: true, classId: true } }),
    ]);
    const regOf = new Map(regs.map((r) => [`${r.studentId}:${r.classId}`, r.id]));
    const bySubject = new Map<string, typeof classes>();
    for (const c of classes) bySubject.set(c.subjectId!, [...(bySubject.get(c.subjectId!) ?? []), c]);
    const groups = [...bySubject.values()].sort((a, b) => pick(locale, a[0].subject!.nameEn, a[0].subject!.nameAr).localeCompare(pick(locale, b[0].subject!.nameEn, b[0].subject!.nameAr), locale));
    return (
      <div className="space-y-3">
        {groups.map((group) => {
          const subject = group[0].subject!;
          const total = group.reduce((n, c) => n + c.enrollments.length, 0);
          const sectionOpts = group.map((c) => ({ id: c.id, label: pick(locale, c.nameEn, c.nameAr), full: c.enrollments.length >= (c.capacity ?? DEFAULT_CAPACITY) }));
          return (
            <details key={subject.id} className="group rounded-xl border bg-card shadow-xs" open={group.length > 1} data-testid="roster-subject">
              <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-5">
                <span className="text-sm font-semibold">{pick(locale, subject.nameEn, subject.nameAr)}</span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  {t("sectionsN", { count: group.length })} · {t("studentsN", { count: total })}
                </span>
              </summary>
              <div className="grid gap-3 border-t p-3 sm:p-4 md:grid-cols-2">
                {group.map((c) => {
                  const cap = c.capacity ?? DEFAULT_CAPACITY;
                  const teacher = teachers.find((m) => m.id === c.teacherMembershipId);
                  const pct = Math.min(100, Math.round((c.enrollments.length / cap) * 100));
                  const students = [...c.enrollments].sort((a, b) => personName(a.student, locale).localeCompare(personName(b.student, locale), locale));
                  return (
                    <div key={c.id} className="rounded-lg border p-3" data-testid="roster-section">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <Link href={`/classes/${c.id}`} className="text-sm font-medium hover:text-brand">
                            {pick(locale, c.nameEn, c.nameAr)}
                          </Link>
                          <div className="text-xs text-muted-foreground">{teacher ? userName(teacher.user, locale) : <Pill tone="warning">{t("teacherTbc")}</Pill>}</div>
                        </div>
                        <span className={cn("text-xs font-medium tabular-nums", c.enrollments.length > cap ? "text-danger" : "text-muted-foreground")}>{t("seats", { count: c.enrollments.length, capacity: cap })}</span>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className={cn("h-full rounded-full", c.enrollments.length > cap ? "bg-danger" : pct >= 90 ? "bg-warning" : "bg-brand")} style={{ width: `${pct}%` }} />
                      </div>
                      {students.length === 0 ? (
                        <p className="mt-3 text-xs text-muted-foreground">{t("sectionEmpty")}</p>
                      ) : (
                        <ul className="mt-2 divide-y">
                          {students.map((e) => {
                            const regId = regOf.get(`${e.studentId}:${c.id}`);
                            return (
                              <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-sm">
                                <span className="min-w-0 truncate">{personName(e.student, locale)}</span>
                                {group.length > 1 && regId && <MoveStudent registrationId={regId} currentClassId={c.id} sections={sectionOpts} studentName={personName(e.student, locale)} />}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            </details>
          );
        })}
      </div>
    );
  }

  async function importTab() {
    const [imports, offerings] = await Promise.all([db.csvImport.findMany({ where: { entity: "registrations" }, orderBy: { createdAt: "desc" }, take: 30 }), tenantTx(orgId, (tx) => offeringsFor(tx, orgId, year!.id))]);
    const codes = [...new Set(offerings.filter((o) => o.kind === "OPTION").map((o) => o.code))];
    const byIds = [...new Set(imports.map((i) => i.createdById))];
    const members = byIds.length ? await db.membership.findMany({ where: { id: { in: byIds } }, include: { user: true } }) : [];
    return (
      <div className="space-y-6">
        <RegistrationImporter template={registrationTemplateCsv(codes)} />
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">{t("importHistory")}</h2>
          {imports.length === 0 ? (
            <EmptyState icon={<FileSpreadsheet className="size-5" />} title={t("emptyImports")} body={t("emptyImportsBody")} />
          ) : (
            <ul className="divide-y rounded-xl border bg-card shadow-xs">
              {imports.map((i) => {
                const by = members.find((m) => m.id === i.createdById);
                const errors = Array.isArray(i.errors) ? (i.errors as Array<{ row: number; field: string; code: string }>) : [];
                return (
                  <li key={i.id} className="space-y-2 px-4 py-3 sm:px-5" data-testid="import-row">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          <span dir="ltr">{i.fileName}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {fmtDateTime(prefs, i.createdAt)}
                          {by ? ` · ${userName(by.user, locale)}` : ""}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground">{t("importCounts", { succeeded: i.succeeded, total: i.total })}</span>
                        <Pill tone={i.status === "COMPLETED" ? (i.failed ? "warning" : "success") : "danger"} dot>
                          {t(`importStatus.${i.status}`)}
                        </Pill>
                      </div>
                    </div>
                    {errors.length > 0 && <ImportErrorList errors={errors} />}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    );
  }
}
