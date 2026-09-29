// Read models for the timetable pages. Request code: uses ctx.db (tenant scoped).
import type { Prisma } from "@prisma/client";
import type { Ctx } from "@/server/context";
import { pick } from "@/lib/i18n-data";
import { lessonNumbers, type BellRow } from "./bell";
import { addDays, dateKey, keyToDate, weekdayOfKey } from "./cover";
import { dubaiDateKey } from "@/server/appointments/slots";

export type GridPeriod = { day: number; periodNo: number; start: string; end: string; kind: BellRow["kind"]; lessonNo: number | null };
export type GridLesson = {
  id: string;
  slotId: string | null;
  coverId: string | null;
  day: number;
  periodNo: number;
  title: string;
  subtitle: string;
  room: string | null;
  tone: "lesson" | "cover" | "absent" | "locked";
  coveredBy?: string | null;
  uncovered?: boolean;
  locked?: boolean;
  canDecline?: boolean;
};
export type GridData = { days: number[]; periods: GridPeriod[]; lessons: GridLesson[]; dates?: Record<number, string> };

export async function yearOf(ctx: Ctx) {
  return (await ctx.db.academicYear.findFirst({ where: { isCurrent: true } })) ?? (await ctx.db.academicYear.findFirst({ orderBy: { startsOn: "desc" } }));
}

export async function periodsOf(ctx: Ctx, yearId: string): Promise<GridPeriod[]> {
  const rows = await ctx.db.bellPeriod.findMany({ where: { academicYearId: yearId }, orderBy: [{ dayOfWeek: "asc" }, { periodNo: "asc" }] });
  const bell: BellRow[] = rows.map((r) => ({ dayOfWeek: r.dayOfWeek, periodNo: r.periodNo, startTime: r.startTime, endTime: r.endTime, kind: r.kind }));
  const nums = new Map<number, Map<number, number>>();
  for (const d of new Set(bell.map((b) => b.dayOfWeek))) nums.set(d, lessonNumbers(bell, d));
  return bell.map((b) => ({ day: b.dayOfWeek, periodNo: b.periodNo, start: b.startTime, end: b.endTime, kind: b.kind, lessonNo: nums.get(b.dayOfWeek)?.get(b.periodNo) ?? null }));
}

export async function names(ctx: Ctx, ids: Array<string | null | undefined>) {
  const clean = [...new Set(ids.filter(Boolean) as string[])];
  if (!clean.length) return new Map<string, string>();
  const rows = await ctx.db.membership.findMany({ where: { id: { in: clean } }, select: { id: true, user: { select: { nameEn: true, nameAr: true } } } });
  return new Map(rows.map((r) => [r.id, pick(ctx.locale, r.user.nameEn, r.user.nameAr)]));
}

/** Lessons matching a slot filter, labelled for the viewer. `show` picks what the subtitle names. */
export async function slotLessons(ctx: Ctx, yearId: string, where: Prisma.TimetableSlotWhereInput, show: "teacher" | "class" | "both"): Promise<GridLesson[]> {
  const slots = await ctx.db.timetableSlot.findMany({ where: { academicYearId: yearId, ...where }, orderBy: [{ dayOfWeek: "asc" }, { periodNo: "asc" }] });
  const classes = await ctx.db.schoolClass.findMany({ where: { id: { in: [...new Set(slots.map((s) => s.classId))] } }, include: { subject: true } });
  const who = await names(ctx, slots.map((s) => s.teacherMembershipId));
  return slots.map((s) => {
    const c = classes.find((x) => x.id === s.classId);
    const subj = c?.subject ? pick(ctx.locale, c.subject.nameEn, c.subject.nameAr) : c ? pick(ctx.locale, c.nameEn, c.nameAr) : "";
    const cname = c ? pick(ctx.locale, c.nameEn, c.nameAr) : "";
    const teacher = s.teacherMembershipId ? (who.get(s.teacherMembershipId) ?? "") : "";
    return {
      id: s.id,
      slotId: s.id,
      coverId: null,
      day: s.dayOfWeek,
      periodNo: s.periodNo,
      title: show === "teacher" ? subj : cname,
      subtitle: show === "class" ? "" : teacher,
      room: s.room,
      tone: s.locked ? "locked" : "lesson",
      locked: s.locked,
    } satisfies GridLesson;
  });
}

/** Monday-based week for a date key, with the date of each school day. */
export function weekOf(anchor: string, days: number[]) {
  const monday = addDays(anchor, -((weekdayOfKey(anchor) + 6) % 7));
  const dates: Record<number, string> = {};
  for (let i = 0; i < 7; i++) {
    const k = addDays(monday, i);
    if (days.includes(weekdayOfKey(k))) dates[weekdayOfKey(k)] = k;
  }
  return { monday, dates };
}

/**
 * A teacher's week: their lessons, marked when they are away and someone covers, plus the cover
 * they have been given that week.
 */
export async function teacherWeek(ctx: Ctx, yearId: string, membershipId: string, dates: Record<number, string>): Promise<GridLesson[]> {
  const own = await slotLessons(ctx, yearId, { teacherMembershipId: membershipId }, "class");
  const keys = Object.values(dates);
  if (!keys.length) return own;
  const range = { gte: keyToDate(keys[0]), lte: keyToDate(keys[keys.length - 1]) };
  const [mine, given] = await Promise.all([
    ctx.db.coverAssignment.findMany({ where: { originalTeacherId: membershipId, date: range } }),
    ctx.db.coverAssignment.findMany({ where: { substituteId: membershipId, date: range, status: { in: ["ASSIGNED", "DONE"] } } }),
  ]);
  const who = await names(ctx, [...mine.map((c) => c.substituteId), ...given.map((c) => c.originalTeacherId)]);
  for (const l of own) {
    const c = mine.find((x) => x.slotId === l.slotId && dateKey(x.date) === dates[l.day]);
    if (!c) continue;
    l.tone = "absent";
    if (c.status === "ASSIGNED" || c.status === "DONE") l.coveredBy = who.get(c.substituteId ?? "") ?? "";
    else l.uncovered = true;
  }
  const slots = await ctx.db.timetableSlot.findMany({ where: { id: { in: given.map((g) => g.slotId) } } });
  const classes = await ctx.db.schoolClass.findMany({ where: { id: { in: given.map((g) => g.classId) } } });
  const today = dubaiDateKey(new Date());
  for (const g of given) {
    const c = classes.find((x) => x.id === g.classId);
    const s = slots.find((x) => x.id === g.slotId);
    own.push({
      id: `cover-${g.id}`,
      slotId: null,
      coverId: g.id,
      day: keyToDate(dateKey(g.date)).getUTCDay(),
      periodNo: g.periodNo,
      title: c ? pick(ctx.locale, c.nameEn, c.nameAr) : "",
      subtitle: who.get(g.originalTeacherId) ?? "",
      room: s?.room ?? c?.room ?? null,
      tone: "cover",
      canDecline: g.status === "ASSIGNED" && dateKey(g.date) >= today,
    });
  }
  return own;
}

/** Students' classes for the timetable: every class they are enrolled in. */
export async function studentClassIds(ctx: Ctx, studentId: string) {
  const rows = await ctx.db.enrollment.findMany({ where: { studentId, status: "ACTIVE" }, select: { classId: true } });
  return rows.map((r) => r.classId);
}
