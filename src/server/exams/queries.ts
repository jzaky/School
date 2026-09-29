import type { Ctx } from "@/server/context";
import { addDays, dayKey, type HolidaySpan } from "./schedule";

/** The current academic year, its terms and holidays (for clash checks and scheduling). */
export async function examContext(ctx: Ctx) {
  const year = (await ctx.db.academicYear.findFirst({ where: { isCurrent: true } })) ?? (await ctx.db.academicYear.findFirst({ orderBy: { startsOn: "desc" } }));
  const [terms, holidayRows] = await Promise.all([
    year ? ctx.db.term.findMany({ where: { academicYearId: year.id }, orderBy: { startsOn: "asc" } }) : Promise.resolve([]),
    ctx.db.calendarEvent.findMany({ where: { kind: "HOLIDAY", published: true, ...(year ? { endsAt: { gt: year.startsOn }, startsAt: { lt: new Date(year.endsOn.getTime() + 86400_000) } } : {}) }, orderBy: { startsAt: "asc" } }),
  ]);
  const holidays: HolidaySpan[] = holidayRows.map((h) => ({ start: h.startsAt, end: h.endsAt, title: ctx.locale === "ar" ? h.titleAr : h.titleEn }));
  const holidayKeys: string[] = [];
  for (const h of holidayRows) {
    const last = dayKey(new Date(h.endsAt.getTime() - 1));
    for (let k = dayKey(h.startsAt); k <= last; k = addDays(k, 1)) holidayKeys.push(k);
  }
  return { year, terms, holidays, holidayKeys };
}

/**
 * The students whose exam timetable the member may see, with their grades. Students see themselves,
 * parents their children. Staff pick a grade instead (null).
 */
export function timetableStudents(ctx: Ctx) {
  if (ctx.isStudent) return ctx.membership.student ? [ctx.membership.student] : [];
  if (ctx.isParent) return ctx.membership.guardian?.links.map((l) => l.student) ?? [];
  return null;
}

/** Published sittings for one grade, upcoming first unless `all`. */
export async function publishedSittings(ctx: Ctx, gradeLevel: number, opts: { from?: Date } = {}) {
  return ctx.db.examSitting.findMany({ where: { gradeLevel, status: "PUBLISHED", ...(opts.from ? { endsAt: { gt: opts.from } } : {}) }, orderBy: { startsAt: "asc" } });
}

/** The child to show by default: the one asked for, else the first whose grade has upcoming published exams. */
export async function defaultTimetableStudent<T extends { id: string; gradeLevel: number }>(ctx: Ctx, students: T[], wanted?: string | null): Promise<T | null> {
  const asked = students.find((s) => s.id === wanted);
  if (asked) return asked;
  const rows = await ctx.db.examSitting.findMany({ where: { status: "PUBLISHED", endsAt: { gt: new Date() }, gradeLevel: { in: students.map((s) => s.gradeLevel) } }, select: { gradeLevel: true }, distinct: ["gradeLevel"] });
  return students.find((s) => rows.some((r) => r.gradeLevel === s.gradeLevel)) ?? students[0] ?? null;
}
