import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BookOpen, Eye, HandHelping, Info, ShieldCheck, Sparkles } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDate, fmtDateTime, fmtTime } from "@/lib/format";
import { personName, pick, userName } from "@/lib/i18n-data";
import { cn } from "@/lib/utils";
import { tenantTx } from "@/lib/tenant-db";
import { Link } from "@/i18n/navigation";
import { canSeeStudent } from "@/server/access/student-access";
import { currentYear, offeringsFor, priorSubjectCodes, selectionYear } from "@/server/registration/service";
import { EngineAccessError } from "@/server/pathway-engine/access";
import { electiveImpactFor, type ElectiveImpact } from "@/server/pathway-engine/levels-service";
import { pickerEngineActor, selectionView } from "@/server/registration/selection-view";
import { statusOf } from "@/server/registration/selection";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Pill } from "@/components/app/badges";
import { SubjectPicker, type PickerOffering } from "@/components/registration/subject-picker";
import { SelectionBanner } from "@/components/registration/selection-status";
import { ExceptionButton, HelpersCard, RevokeExceptionButton, SignOffButton, StatusPill } from "@/components/registration/assist-controls";

export async function generateMetadata() {
  const t = await getTranslations("registration");
  return { title: t("subjectsTitle") };
}

export default async function SubjectsPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ student?: string; year?: string }> }) {
  const { locale: routeLocale } = await params;
  const sp = await searchParams;
  const ctx = await getCtx();
  const t = await getTranslations("registration");
  const ts = await getTranslations("selection");
  const prefs = await formatPrefs(ctx);
  const { db, locale, orgId } = ctx;
  const staffEdit = ctx.isStaff && ctx.can("registration.manage");
  // Advising staff (counselors, career advisors) can look at a student's choices without changing them.
  const advising = ctx.isStaff && (ctx.can("pathways.manage") || ctx.can("planner.approve"));
  const assistant = ctx.isStaff && ctx.can("registration.assist");
  const staffView = ctx.isStaff && (staffEdit || advising || assistant);
  if (!staffView && !ctx.can("registration.submit")) notFound();

  let studentId: string | null = null;
  const children = ctx.isParent ? (ctx.membership.guardian?.links.map((l) => l.student) ?? []) : [];
  if (ctx.isStudent) studentId = ctx.membership.student?.id ?? null;
  else if (ctx.isParent) studentId = children.find((c) => c.id === sp.student)?.id ?? [...children].sort((a, b) => b.gradeLevel - a.gradeLevel)[0]?.id ?? null;
  else if (staffView) {
    if (!sp.student) redirect(staffEdit ? `/${routeLocale}/admin/registration` : assistant ? `/${routeLocale}/subjects/help` : `/${routeLocale}/career/pathways`);
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

  // This year and, when the school has published it for the student's next grade, next year's course selection.
  const years = await tenantTx(orgId, async (tx) => {
    const year = await currentYear(tx, orgId);
    if (!year) return null;
    const next = await selectionYear(tx, orgId);
    const nextOfferings = next ? await offeringsFor(tx, orgId, next.id, student.gradeLevel + 1, student.curriculum) : [];
    return { year, next: next && nextOfferings.length ? next : null };
  });
  const nextYear = years?.next ?? null;
  const which: "current" | "next" = nextYear && sp.year !== "current" ? "next" : "current";
  const target = which === "next" && nextYear ? nextYear : (years?.year ?? null);
  const grade = which === "next" ? student.gradeLevel + 1 : student.gradeLevel;
  const view = target ? await selectionView(ctx, student, target) : null;

  // Teachers and other assisting staff see a student's selection only when they help or may assist them.
  if (ctx.isStaff && !staffEdit && !advising && !(view && (view.assist || view.writer.role === "helper"))) notFound();

  const data = await tenantTx(orgId, async (tx) => {
    if (!target) return { offerings: [], regs: [], prior: new Set<string>() };
    const [offerings, regs, prior] = await Promise.all([
      offeringsFor(tx, orgId, target.id, grade, student.curriculum),
      tx.subjectRegistration.findMany({ where: { orgId, academicYearId: target.id, studentId: student.id, status: { in: ["REQUESTED", "ALLOCATED", "WAITLISTED"] } } }),
      priorSubjectCodes(tx, orgId, student.id, target),
    ]);
    return { offerings, regs, prior };
  });
  const { offerings, regs } = data;
  const classIds = regs.map((r) => r.classId).filter(Boolean) as string[];
  const classes = classIds.length ? await db.schoolClass.findMany({ where: { id: { in: classIds } } }) : [];
  const teacherIds = classes.map((c) => c.teacherMembershipId).filter(Boolean) as string[];
  const teachers = teacherIds.length ? await db.membership.findMany({ where: { id: { in: teacherIds } }, include: { user: true } }) : [];
  const subjects = await db.subject.findMany({ select: { code: true, nameEn: true, nameAr: true } });
  const codeNames = Object.fromEntries(subjects.map((s) => [s.code, pick(locale, s.nameEn, s.nameAr)]));

  // University impact of each option (only options linked to a curriculum course have one).
  let impact: ElectiveImpact | null = null;
  if (target && offerings.some((o) => o.kind === "OPTION" && o.courseId)) {
    const engine = await pickerEngineActor(ctx, student.id);
    if (engine) {
      try {
        impact = await electiveImpactFor(engine, student.id, { yearId: target.id, chosen: regs.map((r) => r.subjectId) });
      } catch (e) {
        if (!(e instanceof EngineAccessError)) throw e;
      }
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

  const writerRole = view?.writer.role ?? null;
  const canEdit = staffEdit || (!!view && !!writerRole && writerRole !== "manager" && view.access.open);
  const name = personName(student, locale);
  const first = view?.studentFirst ?? name;
  const title = ctx.isStudent ? t("subjectsTitle") : t("subjectsFor", { name });
  // Year ranges such as 2027-2028 are isolated so they keep their order inside Arabic text.
  const yr = (y: { nameEn: string; nameAr: string }) => `⁦${pick(locale, y.nameEn, y.nameAr)}⁩`;
  const yearName = target ? yr(target) : "";
  const href = (y: "current" | "next") => `/subjects?${new URLSearchParams({ ...(ctx.isStudent ? {} : { student: student.id }), year: y }).toString()}`;
  const helperOnly = writerRole === "helper" && ctx.isStaff && !ctx.can("pathways.view");
  const levelsHref = helperOnly ? null : ctx.isStudent ? "/career/pathways#levels" : ctx.isParent ? `/career/pathways?student=${student.id}#levels` : `/career/pathways/${student.id}#levels`;
  const roleLabel = (r: string) => (ts.has(`role.${r}`) ? ts(`role.${r}`) : r);
  const access = view?.access;
  const w = access?.window ?? null;
  const onBehalf = canEdit && !ctx.isStudent;
  const sub = view?.submission ?? null;
  const optionIds = new Set(offerings.filter((o) => o.kind === "OPTION").map((o) => o.subjectId));
  const blocks = new Set(offerings.filter((o) => o.kind === "OPTION").map((o) => o.optionBlock ?? "A")).size;
  const chosenBlocks = new Set(offerings.filter((o) => o.kind === "OPTION" && regs.some((r) => r.subjectId === o.subjectId)).map((o) => o.optionBlock ?? "A")).size;
  const status = statusOf(sub, chosenBlocks, blocks);
  const chosenBy = Object.fromEntries(
    Object.entries(view?.chosenBy ?? {})
      .filter(([sid]) => optionIds.has(sid))
      .map(([sid, c]) => [sid, ts("chosenBy", { by: c.by, name: first, date: fmtDate(prefs, c.at) })]),
  );
  const grantText = view?.myGrant ? (view.myGrant.byStudent ? ts("behalf.allowedByStudent", { name: first, date: fmtDateTime(prefs, view.myGrant.until) }) : ts("behalf.allowedBy", { by: view.myGrant.grantedBy, date: fmtDateTime(prefs, view.myGrant.until) })) : null;
  const readOnlyNote =
    view?.writer.role === null && view.writer.reason === "PARENT_NOT_ALLOWED"
      ? ts("readOnly.parentNotAllowed", { name: first })
      : view?.writer.role === null && view.writer.reason === "PARENT_SIGN_OFF_ONLY"
        ? ts("readOnly.signOffOnly")
        : access?.state === "upcoming" && w
          ? ts("readOnly.upcoming", { date: fmtDateTime(prefs, w.opensAt) })
          : access?.state === "none"
            ? ts("readOnly.none")
            : undefined;
  const studentCanAsk = ctx.isStudent && !!view && (access?.state === "open" || access?.state === "upcoming" || !!access?.via);

  return (
    <PageBody>
      <PageHeader title={title} description={which === "next" ? t("next.subtitle", { grade, year: yearName }) : t("subjectsSubtitle", { grade, year: yearName })} />
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
              {y === "next" ? t("next.tabNext", { grade: student.gradeLevel + 1, year: yr(nextYear) }) : t("next.tabCurrent", { grade: student.gradeLevel, year: yr(years.year) })}
            </Link>
          ))}
        </nav>
      )}

      {view && access && (
        <SelectionBanner
          state={access.state}
          via={access.via === "window" ? null : access.via}
          opensAt={w?.opensAt.toISOString() ?? null}
          closesAt={w?.closesAt.toISOString() ?? null}
          until={access.until?.toISOString() ?? null}
          serverNow={new Date().toISOString()}
          opensText={w ? fmtDateTime(prefs, w.opensAt) : ""}
          closesText={w ? fmtDateTime(prefs, w.closesAt) : ""}
          untilText={access.until ? fmtDateTime(prefs, access.until) : ""}
          untilTimeText={access.until ? fmtTime(prefs, access.until) : ""}
          round={w ? pick(locale, w.roundEn, w.roundAr) || null : null}
          year={yearName}
          sessionClass={access.session ? pick(locale, access.session.className.en, access.session.className.ar) : null}
          contacts={view.contacts.map((c) => ts("contact", { name: c.name, role: roleLabel(c.role) }))}
          staffCanEdit={staffEdit}
          requestChangeHref={!ctx.isStaff && which === "current" ? "/services/subject_change" : null}
          self={ctx.isStudent}
          studentFirst={first}
        />
      )}

      {onBehalf && (
        <div className="flex flex-col gap-1 rounded-xl border border-brand/30 bg-brand-soft/50 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between" data-testid="behalf-banner">
          <div className="flex items-start gap-2.5">
            <HandHelping className="mt-0.5 size-4 shrink-0 text-brand" />
            <div className="min-w-0">
              <p className="font-semibold">{ts("behalf.title", { name })}</p>
              <p className="text-xs text-muted-foreground">{grantText ?? (writerRole === "manager" ? ts("behalf.staff") : ts("behalf.parent"))}</p>
            </div>
          </div>
          <p className="flex items-center gap-1 text-xs text-muted-foreground sm:max-w-xs sm:text-end">
            <ShieldCheck className="size-3.5 shrink-0" />
            {ts("behalf.recorded")}
          </p>
        </div>
      )}
      {ctx.isStaff && !canEdit && (
        <div className="flex items-center gap-2 rounded-xl border bg-muted/30 px-4 py-2.5 text-sm text-muted-foreground">
          <Eye className="size-4 shrink-0" />
          {view?.assist && !staffEdit ? ts("staffViewAssist", { name: first }) : t("viewOnly")}
        </div>
      )}
      {ctx.isParent && view && !canEdit && (view.writer.role === null) && (view.writer.reason === "PARENT_NOT_ALLOWED" || view.writer.reason === "PARENT_SIGN_OFF_ONLY") && (
        <div className="flex items-start gap-2.5 rounded-xl border bg-card px-4 py-3 text-sm" data-testid="parent-mode-note">
          <Info className="mt-0.5 size-4 shrink-0 text-info" />
          <p>{view.writer.reason === "PARENT_NOT_ALLOWED" ? ts("parentNotAllowed", { name: first }) : ts("parentSignOffOnly", { name: first })}</p>
        </div>
      )}

      {view && target && (status !== "not_started" || sub) && (
        <section className="flex flex-col gap-3 rounded-xl border bg-card px-4 py-3 shadow-xs sm:flex-row sm:items-center sm:justify-between" data-testid="selection-status">
          <div className="min-w-0 space-y-1 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={status} />
              {sub?.afterClose && (
                <Pill tone="warning">
                  <span data-testid="after-close">{ts("afterClose")}</span>
                </Pill>
              )}
            </div>
            {sub?.lastAt && (
              <p className="text-xs text-muted-foreground" data-testid="last-by">
                {sub.onBehalf && sub.lastByName
                  ? ts(sub.status === "DRAFT" ? "savedByFor" : "submittedByFor", { by: sub.lastByName, name: first, date: fmtDateTime(prefs, sub.lastAt) })
                  : ts(sub.status === "DRAFT" ? "savedBy" : "submittedBy", { by: ctx.isStudent ? ts("you") : first, date: fmtDateTime(prefs, sub.lastAt) })}
              </p>
            )}
            {sub?.status === "SIGNED_OFF" && sub.signedOffAt && <p className="text-xs text-muted-foreground">{ts("signedOffBy", { by: sub.signedOffByName, date: fmtDateTime(prefs, sub.signedOffAt) })}</p>}
            {sub?.status === "SUBMITTED" && view.settings.signOffRequired && (
              <p className="text-xs text-muted-foreground">{view.signOff === "SAME_PARENT" ? ts("signOff.sameParent", { name: first }) : view.signOff === true ? ts("signOff.prompt", { name: first }) : ts("signOff.waiting")}</p>
            )}
          </div>
          {view.signOff === true && <SignOffButton studentId={student.id} yearId={target.id} studentName={first} />}
        </section>
      )}

      {view && (ctx.isStudent || (ctx.isStaff && view.assist) || ctx.isParent) && ((ctx.isStudent && studentCanAsk) || view.helpers.length > 0 || (ctx.isStaff && view.assist)) && (
        <HelpersCard
          studentId={student.id}
          studentName={first}
          helpers={view.helpers.map((h) => ({ ...h, role: roleLabel(h.role), untilText: fmtDateTime(prefs, h.until) }))}
          candidates={view.candidates.map((c) => ({ ...c, role: roleLabel(c.role) }))}
          defaultUntil={view.defaultUntil}
          canGrant={(ctx.isStudent && studentCanAsk) || (ctx.isStaff && view.assist)}
          canRevoke={ctx.isStudent || (ctx.isStaff && view.assist)}
          asStaff={!ctx.isStudent}
        />
      )}

      {view && target && ctx.isStaff && view.assist && (
        <section className="rounded-xl border bg-card p-4 shadow-xs" data-testid="exceptions-card">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex min-w-0 items-start gap-2.5">
              <Sparkles className="mt-0.5 size-4 shrink-0 text-info" />
              <div>
                <h2 className="text-sm font-semibold">{ts("exception.cardTitle")}</h2>
                <p className="text-xs text-muted-foreground">{view.exceptions.length ? ts("exception.cardActive", { name: first }) : ts("exception.cardEmpty", { name: first })}</p>
              </div>
            </div>
            <ExceptionButton studentId={student.id} studentName={first} yearId={target.id} />
          </div>
          {view.exceptions.length > 0 && (
            <ul className="mt-3 divide-y rounded-lg border">
              {view.exceptions.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm" data-testid="exception-row">
                  <div className="min-w-0">
                    <div className="font-medium">{ts("exception.until", { date: fmtDateTime(prefs, e.until) })}</div>
                    <div className="text-xs text-muted-foreground">{ts("exception.byReason", { by: e.grantedBy, reason: e.reason })}</div>
                  </div>
                  <RevokeExceptionButton id={e.id} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

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
          explore={ctx.isStaff && !canEdit && advising}
          studentName={first}
          chosenBy={chosenBy}
          canDraft={which === "next" && canEdit}
          readOnlyNote={readOnlyNote}
        />
      )}
    </PageBody>
  );
}
