import { notFound } from "next/navigation";
import { LIVE_MODULES } from "@/lib/modules";
import { getTranslations } from "next-intl/server";
import { CalendarDays, ClipboardList, School, Users } from "lucide-react";
import { getCtx } from "@/server/context";
import { pick, userName } from "@/lib/i18n-data";
import { cn } from "@/lib/utils";
import { tenantTx } from "@/lib/tenant-db";
import { Link } from "@/i18n/navigation";
import { currentYear } from "@/server/registration/service";
import { DEFAULT_CAPACITY } from "@/server/registration/allocate";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Pill } from "@/components/app/badges";

export async function generateMetadata() {
  const t = await getTranslations("registration");
  return { title: t("classesTitle") };
}

export default async function ClassesPage({ searchParams }: { searchParams: Promise<{ grade?: string }> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  if (!ctx.isStaff || !(ctx.can("grades.enter") || ctx.can("registration.manage"))) notFound();
  const t = await getTranslations("registration");
  const { db, locale, orgId } = ctx;
  const seesAll = ctx.can("registration.manage");
  const year = await tenantTx(orgId, (tx) => currentYear(tx, orgId));
  const grade = sp.grade && /^\d{1,2}$/.test(sp.grade) ? Number(sp.grade) : null;
  const where = {
    ...(year ? { academicYearId: year.id } : {}),
    ...(seesAll ? {} : { teacherMembershipId: ctx.membershipId }),
    ...(seesAll && grade !== null ? { gradeLevel: grade } : {}),
  };
  const [classes, gradeRows] = await Promise.all([
    db.schoolClass.findMany({ where, include: { subject: true, _count: { select: { enrollments: true } } }, orderBy: [{ isHomeroom: "desc" }, { gradeLevel: "asc" }, { nameEn: "asc" }] }),
    seesAll ? db.schoolClass.groupBy({ by: ["gradeLevel"], where: year ? { academicYearId: year.id } : {}, orderBy: { gradeLevel: "asc" } }) : Promise.resolve([]),
  ]);
  const teacherIds = [...new Set(classes.map((c) => c.teacherMembershipId).filter(Boolean) as string[])];
  const teachers = seesAll && teacherIds.length ? await db.membership.findMany({ where: { id: { in: teacherIds } }, include: { user: true } }) : [];

  return (
    <PageBody>
      <PageHeader title={seesAll ? t("classesTitleAll") : t("classesTitle")} description={seesAll ? t("classesSubtitleAll") : t("classesSubtitle")} />
      {seesAll && (
        <div className="flex flex-wrap gap-1.5">
          <Link href="/classes" className={cn("rounded-full border px-3 py-1 text-xs font-medium", grade === null ? "border-brand bg-brand-soft text-brand" : "bg-card text-muted-foreground hover:text-foreground")}>
            {t("allGrades")}
          </Link>
          {gradeRows.map((g) => (
            <Link key={g.gradeLevel} href={`/classes?grade=${g.gradeLevel}`} className={cn("rounded-full border px-3 py-1 text-xs font-medium", g.gradeLevel === grade ? "border-brand bg-brand-soft text-brand" : "bg-card text-muted-foreground hover:text-foreground")}>
              {t("gradeN", { grade: g.gradeLevel })}
            </Link>
          ))}
        </div>
      )}
      {classes.length === 0 ? (
        <EmptyState icon={<School className="size-5" />} title={t("noClasses")} body={seesAll ? t("noClassesAllBody") : t("noClassesBody")} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="class-list">
          {classes.map((c) => {
            const cap = c.capacity ?? DEFAULT_CAPACITY;
            const teacher = teachers.find((m) => m.id === c.teacherMembershipId);
            return (
              <li key={c.id} className="flex flex-col rounded-xl border bg-card p-4 shadow-xs" data-testid="class-card">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link href={`/classes/${c.id}`} className="block truncate text-sm font-semibold hover:text-brand">
                      {pick(locale, c.nameEn, c.nameAr)}
                    </Link>
                    <div className="truncate text-xs text-muted-foreground">
                      {c.isHomeroom ? t("homeroom") : c.subject ? pick(locale, c.subject.nameEn, c.subject.nameAr) : ""} · {t("gradeN", { grade: c.gradeLevel })}
                      {c.room ? ` · ${t("roomN", { room: c.room })}` : ""}
                    </div>
                    {seesAll && <div className="mt-0.5 truncate text-xs text-muted-foreground">{teacher ? userName(teacher.user, locale) : <Pill tone="warning">{t("teacherTbc")}</Pill>}</div>}
                  </div>
                  {c.optionBlock && <Pill tone="brand">{t("blockN", { block: c.optionBlock })}</Pill>}
                </div>
                <div className="mt-3 flex items-center gap-1.5 text-sm">
                  <Users className="size-4 text-muted-foreground" />
                  <span className="tabular-nums">{c.isHomeroom ? t("studentsN", { count: c._count.enrollments }) : t("seats", { count: c._count.enrollments, capacity: cap })}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t pt-3 text-xs font-medium">
                  <Link href={`/classes/${c.id}`} className="text-brand hover:underline">
                    {t("roster")}
                  </Link>
                  {LIVE_MODULES.grades && !c.isHomeroom && (
                    <Link href={`/grades?class=${c.id}`} className="inline-flex items-center gap-1 text-brand hover:underline">
                      <ClipboardList className="size-3.5" />
                      {t("gradebook")}
                    </Link>
                  )}
                  {LIVE_MODULES.timetable && (
                    <Link href="/timetable" className="inline-flex items-center gap-1 text-brand hover:underline">
                      <CalendarDays className="size-3.5" />
                      {t("timetable")}
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </PageBody>
  );
}
