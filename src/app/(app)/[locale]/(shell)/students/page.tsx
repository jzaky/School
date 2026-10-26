import type { Prisma } from "@prisma/client";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { GraduationCap } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { initials, personName, pick } from "@/lib/i18n-data";
import { gradeLabel } from "@/lib/grade-levels";
import { Link } from "@/i18n/navigation";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { FilterBar } from "@/components/app/filter-bar";
import { EmptyState } from "@/components/app/empty-state";
import { Pill } from "@/components/app/badges";
import { Pager, pageHref } from "@/components/app/pager";
import { listableCaseWhere } from "@/server/access/case-access";
import { pageWindow, searchTerm } from "@/server/common/paging";
import { gradeParam, gradesInUse, studentSearchWhere } from "@/server/students/grade-options";

export async function generateMetadata() {
  const t = await getTranslations("students");
  return { title: t("title") };
}

type SP = { grade?: string; q?: string; class?: string; page?: string };

export default async function StudentsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  if (!ctx.can("people.view")) notFound();
  const t = await getTranslations("students");
  const tg = await getTranslations("gradeLevel");
  const prefs = await formatPrefs(ctx);
  const { db, orgId, locale } = ctx;
  const cls = sp.class ? await db.schoolClass.findUnique({ where: { id: sp.class } }) : null;
  const q = searchTerm(sp.q);
  const grade = gradeParam(sp.grade);
  const where: Prisma.StudentWhereInput = {
    orgId,
    status: "ACTIVE",
    ...(grade !== null ? { gradeLevel: grade } : {}),
    ...(cls ? { enrollments: { some: { classId: cls.id } } } : {}),
    ...(q ? studentSearchWhere(q) : {}),
  };
  // The real total from a count query, then one page of students.
  const [total, grades] = await Promise.all([db.student.count({ where }), gradesInUse(db)]);
  const win = pageWindow(sp.page, total);
  const students = await db.student.findMany({ where, orderBy: [{ gradeLevel: "asc" }, { section: "asc" }, { lastNameEn: "asc" }, { id: "asc" }], skip: win.skip, take: win.take });
  const caseCounts = students.length
    ? await db.case.groupBy({ by: ["studentId"], where: { AND: [listableCaseWhere(ctx, "search"), { studentId: { in: students.map((s) => s.id) }, status: { in: ["NEW", "OPEN", "IN_PROGRESS", "WAITING"] } }] }, _count: { _all: true } })
    : [];
  const keep = { grade: sp.grade, q: sp.q, class: sp.class };
  return (
    <PageBody>
      <PageHeader title={cls ? pick(locale, cls.nameEn, cls.nameAr) : t("title")} description={t("subtitle", { count: total })} />
      <FilterBar chipParam="grade" chips={[{ value: "", label: t("allGrades") }, ...grades.map((g) => ({ value: String(g), label: gradeLabel(tg, g) }))]} searchPlaceholder={t("search")} />
      {students.length === 0 ? (
        <EmptyState icon={<GraduationCap className="size-5" />} title={t("empty")} />
      ) : (
        <>
          <Pager win={win} prefs={prefs} href={(p) => pageHref("/students", keep, p)} />
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {students.map((s) => {
              const open = caseCounts.find((c) => c.studentId === s.id)?._count._all ?? 0;
              return (
                <Link key={s.id} href={`/students/${s.id}`} className="flex items-center gap-3 rounded-xl border bg-card p-3 shadow-xs transition hover:border-brand/30 hover:shadow-sm" data-testid="student-card">
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-soft text-xs font-semibold text-brand">{initials(`${s.firstNameEn} ${s.lastNameEn}`)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{personName(s, locale)}</span>
                    <span className="block truncate text-xs text-muted-foreground">{locale === "ar" ? `${s.firstNameEn} ${s.lastNameEn}` : `${s.firstNameAr} ${s.lastNameAr}`}</span>
                  </span>
                  <span className="flex flex-col items-end gap-1">
                    <span className="whitespace-nowrap text-xs font-medium tabular-nums" data-testid="student-grade">
                      {gradeLabel(tg, s.gradeLevel, s.section, { short: true })}
                    </span>
                    {open > 0 && <Pill tone="brand">{t("openCases", { count: open })}</Pill>}
                    {s.hasSen && <Pill tone="info">{t("sen")}</Pill>}
                  </span>
                </Link>
              );
            })}
          </div>
          <Pager win={win} prefs={prefs} href={(p) => pageHref("/students", keep, p)} />
        </>
      )}
    </PageBody>
  );
}
