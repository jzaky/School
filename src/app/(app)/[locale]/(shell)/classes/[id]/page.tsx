import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, CalendarDays, ClipboardList, Users } from "lucide-react";
import { getCtx } from "@/server/context";
import { personName, pick, userName } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { DEFAULT_CAPACITY } from "@/server/registration/allocate";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Pill } from "@/components/app/badges";
import { Button } from "@/components/ui/button";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getCtx();
  const c = await ctx.db.schoolClass.findUnique({ where: { id }, select: { nameEn: true, nameAr: true } });
  const t = await getTranslations("registration");
  return { title: c ? pick(ctx.locale, c.nameEn, c.nameAr) : t("classesTitle") };
}

const SOURCE_TONE = { STUDENT: "info", PARENT: "gold", STAFF: "neutral", IMPORT: "violet", SUBJECT_CHANGE: "brand" } as const;

export default async function ClassRosterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getCtx();
  if (!ctx.isStaff) notFound();
  const { db, locale } = ctx;
  const t = await getTranslations("registration");
  const cls = await db.schoolClass.findUnique({ where: { id }, include: { subject: true, enrollments: { include: { student: true } } } });
  if (!cls) notFound();
  const seesAll = ctx.can("registration.manage");
  if (!seesAll && cls.teacherMembershipId !== ctx.membershipId) notFound();
  const [teacher, regs] = await Promise.all([
    cls.teacherMembershipId ? db.membership.findUnique({ where: { id: cls.teacherMembershipId }, include: { user: true } }) : null,
    cls.subjectId ? db.subjectRegistration.findMany({ where: { classId: cls.id }, select: { studentId: true, source: true } }) : [],
  ]);
  const sourceOf = new Map(regs.map((r) => [r.studentId, r.source]));
  const students = [...cls.enrollments].sort((a, b) => (a.student.section ?? "").localeCompare(b.student.section ?? "") || personName(a.student, locale).localeCompare(personName(b.student, locale), locale));
  const cap = cls.capacity ?? DEFAULT_CAPACITY;
  const canOpenStudent = ctx.can("people.view");

  return (
    <PageBody>
      <Button asChild variant="ghost" size="sm" className="-ms-2 w-fit">
        <Link href="/classes">
          <ArrowLeft className="size-4 rtl:rotate-180" />
          {t("backToClasses")}
        </Link>
      </Button>
      <PageHeader
        title={pick(locale, cls.nameEn, cls.nameAr)}
        description={[cls.isHomeroom ? t("homeroom") : cls.subject ? pick(locale, cls.subject.nameEn, cls.subject.nameAr) : "", t("gradeN", { grade: cls.gradeLevel }), cls.room ? t("roomN", { room: cls.room }) : ""].filter(Boolean).join(" · ")}
        actions={
          <>
            {!cls.isHomeroom && (
              <Button asChild variant="outline">
                <Link href={`/grades?class=${cls.id}`}>
                  <ClipboardList className="size-4" />
                  {t("gradebook")}
                </Link>
              </Button>
            )}
            <Button asChild variant="outline">
              <Link href="/timetable">
                <CalendarDays className="size-4" />
                {t("timetable")}
              </Link>
            </Button>
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Pill tone="neutral">
          <Users className="size-3" />
          {cls.isHomeroom ? t("studentsN", { count: students.length }) : t("seats", { count: students.length, capacity: cap })}
        </Pill>
        {teacher ? <Pill tone="brand">{userName(teacher.user, locale)}</Pill> : <Pill tone="warning">{t("teacherTbc")}</Pill>}
        {cls.optionBlock && <Pill tone="info">{t("blockN", { block: cls.optionBlock })}</Pill>}
      </div>
      {students.length === 0 ? (
        <EmptyState icon={<Users className="size-5" />} title={t("rosterEmpty")} body={t("rosterEmptyBody")} />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card shadow-xs" data-testid="roster">
          <div className="hidden grid-cols-[40px_minmax(0,1.5fr)_120px_100px_minmax(0,1fr)] gap-3 border-b bg-muted/30 px-5 py-2.5 text-xs font-medium text-muted-foreground md:grid">
            <span>#</span>
            <span>{t("colStudent")}</span>
            <span>{t("colStudentNo")}</span>
            <span>{t("colHomeroom")}</span>
            <span>{t("colRegisteredBy")}</span>
          </div>
          <ul className="divide-y">
            {students.map((e, i) => {
              const src = sourceOf.get(e.studentId);
              return (
                <li key={e.id} className="grid grid-cols-[32px_minmax(0,1fr)] gap-x-3 gap-y-1 px-4 py-2.5 text-sm md:grid-cols-[40px_minmax(0,1.5fr)_120px_100px_minmax(0,1fr)] md:px-5" data-testid="roster-row">
                  <span className="tabular-nums text-muted-foreground">{i + 1}</span>
                  <div className="min-w-0">
                    {canOpenStudent ? (
                      <Link href={`/students/${e.studentId}`} className="block truncate font-medium hover:text-brand">
                        {personName(e.student, locale)}
                      </Link>
                    ) : (
                      <span className="block truncate font-medium">{personName(e.student, locale)}</span>
                    )}
                  </div>
                  <span className="col-start-2 text-xs text-muted-foreground md:col-start-auto md:text-sm">
                    <span dir="ltr">{e.student.studentNo}</span>
                  </span>
                  <span className="col-start-2 text-xs md:col-start-auto md:text-sm">{t("homeroomN", { grade: e.student.gradeLevel, section: e.student.section ?? "" })}</span>
                  <span className="col-start-2 md:col-start-auto">{src ? <Pill tone={SOURCE_TONE[src]}>{t(`source.${src}`)}</Pill> : <span className="text-xs text-muted-foreground">{cls.isHomeroom ? t("homeroomMember") : t("sourceNone")}</span>}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </PageBody>
  );
}
