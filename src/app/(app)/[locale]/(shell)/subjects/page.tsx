import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BookOpen, CalendarClock, Lock } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDateTime } from "@/lib/format";
import { personName, pick, userName } from "@/lib/i18n-data";
import { cn } from "@/lib/utils";
import { tenantTx } from "@/lib/tenant-db";
import { Link } from "@/i18n/navigation";
import { currentYear, getWindow, offeringsFor, priorSubjectCodes } from "@/server/registration/service";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Pill } from "@/components/app/badges";
import { SubjectPicker, type PickerOffering } from "@/components/registration/subject-picker";

export async function generateMetadata() {
  const t = await getTranslations("registration");
  return { title: t("subjectsTitle") };
}

export default async function SubjectsPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ student?: string }> }) {
  const { locale: routeLocale } = await params;
  const sp = await searchParams;
  const ctx = await getCtx();
  const t = await getTranslations("registration");
  const prefs = await formatPrefs(ctx);
  const { db, locale, orgId } = ctx;
  const staff = ctx.isStaff && ctx.can("registration.manage");
  if (!staff && !ctx.can("registration.submit")) notFound();

  let studentId: string | null = null;
  const children = ctx.isParent ? (ctx.membership.guardian?.links.map((l) => l.student) ?? []) : [];
  if (ctx.isStudent) studentId = ctx.membership.student?.id ?? null;
  else if (ctx.isParent) studentId = children.find((c) => c.id === sp.student)?.id ?? [...children].sort((a, b) => b.gradeLevel - a.gradeLevel)[0]?.id ?? null;
  else if (staff) {
    if (!sp.student) redirect(`/${routeLocale}/admin/registration`);
    studentId = sp.student;
  } else notFound();

  const student = studentId ? await db.student.findUnique({ where: { id: studentId } }) : null;
  if (!student) {
    if (staff) notFound();
    return (
      <PageBody>
        <PageHeader title={t("subjectsTitle")} />
        <EmptyState icon={<BookOpen className="size-5" />} title={t("noStudent")} />
      </PageBody>
    );
  }

  const data = await tenantTx(orgId, async (tx) => {
    const year = await currentYear(tx, orgId);
    const win = await getWindow(tx, orgId);
    if (!year) return { year: null, win, offerings: [], regs: [], prior: new Set<string>() };
    const [offerings, regs, prior] = await Promise.all([
      offeringsFor(tx, orgId, year.id, student.gradeLevel),
      tx.subjectRegistration.findMany({ where: { orgId, academicYearId: year.id, studentId: student.id, status: { in: ["REQUESTED", "ALLOCATED", "WAITLISTED"] } } }),
      priorSubjectCodes(tx, orgId, student.id, year),
    ]);
    return { year, win, offerings, regs, prior };
  });
  const { win, offerings, regs } = data;
  const classIds = regs.map((r) => r.classId).filter(Boolean) as string[];
  const classes = classIds.length ? await db.schoolClass.findMany({ where: { id: { in: classIds } } }) : [];
  const teacherIds = classes.map((c) => c.teacherMembershipId).filter(Boolean) as string[];
  const teachers = teacherIds.length ? await db.membership.findMany({ where: { id: { in: teacherIds } }, include: { user: true } }) : [];
  const subjects = await db.subject.findMany({ select: { code: true, nameEn: true, nameAr: true } });
  const codeNames = Object.fromEntries(subjects.map((s) => [s.code, pick(locale, s.nameEn, s.nameAr)]));

  const pickerOfferings: PickerOffering[] = offerings.map((o) => {
    const reg = regs.find((r) => r.subjectId === o.subjectId);
    const cls = reg?.classId ? classes.find((c) => c.id === reg.classId) : null;
    const teacher = cls?.teacherMembershipId ? teachers.find((m) => m.id === cls.teacherMembershipId) : null;
    return {
      subjectId: o.subjectId,
      code: o.code,
      kind: o.kind,
      optionBlock: o.optionBlock,
      prerequisites: o.prerequisites,
      name: pick(locale, o.nameEn, o.nameAr),
      notes: pick(locale, o.notesEn, o.notesAr) || null,
      periods: o.periodsPerWeek,
      placement: cls ? pick(locale, cls.nameEn, cls.nameAr) : null,
      teacher: cls ? (teacher ? userName(teacher.user, locale) : t("teacherTbc")) : null,
    };
  });
  const canEdit = staff || win.open;
  const name = personName(student, locale);
  const title = ctx.isStudent ? t("subjectsTitle") : t("subjectsFor", { name });

  return (
    <PageBody>
      <PageHeader title={title} description={t("subjectsSubtitle", { grade: student.gradeLevel, year: data.year ? pick(locale, data.year.nameEn, data.year.nameAr) : "" })} />
      {children.length > 1 && (
        <div className="flex flex-wrap gap-1.5" data-testid="child-switcher">
          {children.map((c) => (
            <Link key={c.id} href={`/subjects?student=${c.id}`} className={cn("rounded-full border px-3 py-1 text-xs font-medium", c.id === student.id ? "border-brand bg-brand-soft text-brand" : "bg-card text-muted-foreground hover:text-foreground")}>
              {personName(c, locale)}
            </Link>
          ))}
        </div>
      )}
      <div className={cn("flex flex-col gap-2 rounded-xl border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between", win.open ? "border-success/30 bg-success-soft/40" : "bg-muted/30")} data-testid="window-banner">
        <div className="flex items-start gap-2">
          {win.open ? <CalendarClock className="mt-0.5 size-4 shrink-0 text-success" /> : <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
          <span>
            {win.open && win.deadline ? t("bannerOpen", { date: fmtDateTime(prefs, win.deadline) }) : win.deadline ? t("bannerClosed", { date: fmtDateTime(prefs, win.deadline) }) : t("bannerNotOpen")}
            {staff && !win.open && <span className="text-muted-foreground"> {t("staffCanEdit")}</span>}
          </span>
        </div>
        {!win.open && !staff && (
          <Link href="/services/subject_change" className="shrink-0 text-sm font-medium text-brand hover:underline">
            {t("requestChange")}
          </Link>
        )}
        {staff && <Pill tone="info">{t("onBehalf")}</Pill>}
      </div>
      {offerings.length === 0 ? (
        <EmptyState icon={<BookOpen className="size-5" />} title={t("noOfferingsForGrade")} body={t("noOfferingsForGradeBody")} />
      ) : (
        <SubjectPicker
          key={student.id}
          studentId={student.id}
          offerings={pickerOfferings}
          initial={regs.map((r) => r.subjectId)}
          priorCodes={[...data.prior]}
          codeNames={codeNames}
          canEdit={canEdit}
        />
      )}
    </PageBody>
  );
}
