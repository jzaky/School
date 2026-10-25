import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BookOpen, CalendarClock, Eye, Lock } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDateTime } from "@/lib/format";
import { personName, pick, userName } from "@/lib/i18n-data";
import { cn } from "@/lib/utils";
import { tenantTx } from "@/lib/tenant-db";
import { Link } from "@/i18n/navigation";
import { canSeeStudent } from "@/server/access/student-access";
import { currentYear, getWindow, offeringsFor, priorSubjectCodes, selectionYear } from "@/server/registration/service";
import { actorFromCtx, EngineAccessError } from "@/server/pathway-engine/access";
import { electiveImpactFor, type ElectiveImpact } from "@/server/pathway-engine/levels-service";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Pill } from "@/components/app/badges";
import { SubjectPicker, type PickerOffering } from "@/components/registration/subject-picker";

export async function generateMetadata() {
  const t = await getTranslations("registration");
  return { title: t("subjectsTitle") };
}

export default async function SubjectsPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ student?: string; year?: string }> }) {
  const { locale: routeLocale } = await params;
  const sp = await searchParams;
  const ctx = await getCtx();
  const t = await getTranslations("registration");
  const prefs = await formatPrefs(ctx);
  const { db, locale, orgId } = ctx;
  const staffEdit = ctx.isStaff && ctx.can("registration.manage");
  // Advising staff (counselors, career advisors) can look at a student's choices without changing them.
  const staffView = ctx.isStaff && (staffEdit || ctx.can("pathways.manage") || ctx.can("planner.approve"));
  if (!staffView && !ctx.can("registration.submit")) notFound();

  let studentId: string | null = null;
  const children = ctx.isParent ? (ctx.membership.guardian?.links.map((l) => l.student) ?? []) : [];
  if (ctx.isStudent) studentId = ctx.membership.student?.id ?? null;
  else if (ctx.isParent) studentId = children.find((c) => c.id === sp.student)?.id ?? [...children].sort((a, b) => b.gradeLevel - a.gradeLevel)[0]?.id ?? null;
  else if (staffView) {
    if (!sp.student) redirect(staffEdit ? `/${routeLocale}/admin/registration` : `/${routeLocale}/career/pathways`);
    if (!(await canSeeStudent(ctx, sp.student))) notFound();
    studentId = sp.student;
  } else notFound();

  const student = studentId ? await db.student.findUnique({ where: { id: studentId } }) : null;
  if (!student) {
    if (ctx.isStaff) notFound();
    return (
      <PageBody>
        <PageHeader title={t("subjectsTitle")} />
        <EmptyState icon={<BookOpen className="size-5" />} title={t("noStudent")} />
      </PageBody>
    );
  }

  // This year and, when the school has published it, next year's course selection.
  const years = await tenantTx(orgId, async (tx) => {
    const year = await currentYear(tx, orgId);
    if (!year) return null;
    const next = await selectionYear(tx, orgId);
    const nextOfferings = next ? await offeringsFor(tx, orgId, next.id, student.gradeLevel + 1, student.curriculum) : [];
    const nextWin = next ? await getWindow(tx, orgId, new Date(), { yearId: next.id, next: true }) : null;
    return { year, next: next && nextOfferings.length ? next : null, nextWin };
  });
  const nextYear = years?.next ?? null;
  const which: "current" | "next" = nextYear && (sp.year === "next" || (sp.year !== "current" && years?.nextWin?.open)) ? "next" : "current";
  const target = which === "next" && nextYear ? nextYear : (years?.year ?? null);
  const grade = which === "next" ? student.gradeLevel + 1 : student.gradeLevel;

  const data = await tenantTx(orgId, async (tx) => {
    if (!target) return { win: { eventId: null, deadline: null, open: false }, offerings: [], regs: [], prior: new Set<string>() };
    const win = await getWindow(tx, orgId, new Date(), { yearId: target.id, next: which === "next" });
    const [offerings, regs, prior] = await Promise.all([
      offeringsFor(tx, orgId, target.id, grade, student.curriculum),
      tx.subjectRegistration.findMany({ where: { orgId, academicYearId: target.id, studentId: student.id, status: { in: ["REQUESTED", "ALLOCATED", "WAITLISTED"] } } }),
      priorSubjectCodes(tx, orgId, student.id, target),
    ]);
    return { win, offerings, regs, prior };
  });
  const { win, offerings, regs } = data;
  const classIds = regs.map((r) => r.classId).filter(Boolean) as string[];
  const classes = classIds.length ? await db.schoolClass.findMany({ where: { id: { in: classIds } } }) : [];
  const teacherIds = classes.map((c) => c.teacherMembershipId).filter(Boolean) as string[];
  const teachers = teacherIds.length ? await db.membership.findMany({ where: { id: { in: teacherIds } }, include: { user: true } }) : [];
  const subjects = await db.subject.findMany({ select: { code: true, nameEn: true, nameAr: true } });
  const codeNames = Object.fromEntries(subjects.map((s) => [s.code, pick(locale, s.nameEn, s.nameAr)]));

  // University impact of each option (only options linked to a curriculum course have one).
  let impact: ElectiveImpact | null = null;
  if (target && offerings.some((o) => o.kind === "OPTION" && o.courseId)) {
    try {
      impact = await electiveImpactFor(await actorFromCtx(ctx), student.id, { yearId: target.id, chosen: regs.map((r) => r.subjectId) });
    } catch (e) {
      if (!(e instanceof EngineAccessError)) throw e;
    }
  }

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
      isAP: o.isAP,
      linked: !!o.courseId,
    };
  });
  const canEdit = staffEdit || (!ctx.isStaff && win.open);
  const name = personName(student, locale);
  const title = ctx.isStudent ? t("subjectsTitle") : t("subjectsFor", { name });
  const yearName = target ? pick(locale, target.nameEn, target.nameAr) : "";
  const href = (y: "current" | "next") => `/subjects?${new URLSearchParams({ ...(ctx.isStudent ? {} : { student: student.id }), year: y }).toString()}`;
  const levelsHref = ctx.isStudent ? "/career/pathways#levels" : ctx.isParent ? `/career/pathways?student=${student.id}#levels` : `/career/pathways/${student.id}#levels`;

  return (
    <PageBody>
      <PageHeader
        title={title}
        description={which === "next" ? t("next.subtitle", { grade, year: yearName }) : t("subjectsSubtitle", { grade, year: yearName })}
      />
      {children.length > 1 && (
        <div className="flex flex-wrap gap-1.5" data-testid="child-switcher">
          {children.map((c) => (
            <Link key={c.id} href={`/subjects?student=${c.id}`} className={cn("rounded-full border px-3 py-1 text-xs font-medium", c.id === student.id ? "border-brand bg-brand-soft text-brand" : "bg-card text-muted-foreground hover:text-foreground")}>
              {personName(c, locale)}
            </Link>
          ))}
        </div>
      )}
      {nextYear && years && (
        <nav className="flex gap-1 overflow-x-auto border-b" aria-label={t("next.tabsLabel")} data-testid="year-tabs">
          {(["next", "current"] as const).map((y) => (
            <Link
              key={y}
              href={href(y)}
              className={cn("-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium", which === y ? "border-brand text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
              data-testid={`year-tab-${y}`}
            >
              {y === "next"
                ? t("next.tabNext", { grade: student.gradeLevel + 1, year: pick(locale, nextYear.nameEn, nextYear.nameAr) })
                : t("next.tabCurrent", { grade: student.gradeLevel, year: pick(locale, years.year.nameEn, years.year.nameAr) })}
            </Link>
          ))}
        </nav>
      )}
      <div className={cn("flex flex-col gap-2 rounded-xl border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between", win.open ? "border-success/30 bg-success-soft/40" : "bg-muted/30")} data-testid="window-banner">
        <div className="flex items-start gap-2">
          {win.open ? <CalendarClock className="mt-0.5 size-4 shrink-0 text-success" /> : <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
          <span>
            {which === "next"
              ? win.open && win.deadline
                ? t("next.bannerOpen", { year: yearName, date: fmtDateTime(prefs, win.deadline) })
                : win.deadline
                  ? t("next.bannerClosed", { year: yearName, date: fmtDateTime(prefs, win.deadline) })
                  : t("next.bannerNotOpen", { year: yearName })
              : win.open && win.deadline
                ? t("bannerOpen", { date: fmtDateTime(prefs, win.deadline) })
                : win.deadline
                  ? t("bannerClosed", { date: fmtDateTime(prefs, win.deadline) })
                  : t("bannerNotOpen")}
            {staffEdit && !win.open && <span className="text-muted-foreground"> {t("staffCanEdit")}</span>}
          </span>
        </div>
        {!win.open && !ctx.isStaff && which === "current" && (
          <Link href="/services/subject_change" className="shrink-0 text-sm font-medium text-brand hover:underline">
            {t("requestChange")}
          </Link>
        )}
        {staffEdit && <Pill tone="info">{t("onBehalf")}</Pill>}
        {ctx.isStaff && !staffEdit && (
          <Pill tone="neutral">
            <Eye className="size-3" />
            {t("viewOnly")}
          </Pill>
        )}
      </div>
      {offerings.length === 0 ? (
        <EmptyState icon={<BookOpen className="size-5" />} title={t("noOfferingsForGrade")} body={t("noOfferingsForGradeBody")} />
      ) : (
        <SubjectPicker
          key={`${student.id}:${target?.id ?? ""}`}
          studentId={student.id}
          yearId={target?.id ?? null}
          nextYear={which === "next"}
          offerings={pickerOfferings}
          initial={regs.map((r) => r.subjectId)}
          priorCodes={[...data.prior]}
          codeNames={codeNames}
          canEdit={canEdit}
          impact={impact}
          self={ctx.isStudent}
          levelsHref={levelsHref}
        />
      )}
    </PageBody>
  );
}
