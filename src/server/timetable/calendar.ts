// Timetable items for the calendar: cover a member of staff has been given, and (off by default) lessons.
import type { Ctx } from "@/server/context";
import type { CalItem } from "@/server/calendar/items";
import { pick } from "@/lib/i18n-data";
import { addDaysKey, dubaiDateKey, dubaiInstant, weekdayOfKey } from "@/server/appointments/slots";
import { toMinutes } from "./bell";

const MAX_LESSON_DAYS = 45;

export async function timetableCalendarItems(ctx: Ctx, from: Date, to: Date, who: { memberIds: string[]; studentIds: string[]; cover: boolean; lessons: boolean }): Promise<CalItem[]> {
  const { db, locale } = ctx;
  if (!who.memberIds.length && !who.studentIds.length) return [];
  const year = (await db.academicYear.findFirst({ where: { isCurrent: true } })) ?? (await db.academicYear.findFirst({ orderBy: { startsOn: "desc" } }));
  if (!year) return [];
  const bell = await db.bellPeriod.findMany({ where: { academicYearId: year.id } });
  const at = (key: string, periodNo: number) => {
    const b = bell.find((x) => x.dayOfWeek === weekdayOfKey(key) && x.periodNo === periodNo);
    if (!b) return null;
    return { start: dubaiInstant(key, toMinutes(b.startTime)).toISOString(), end: dubaiInstant(key, toMinutes(b.endTime)).toISOString() };
  };
  const out: CalItem[] = [];
  const fromKey = dubaiDateKey(from);
  const toKey = dubaiDateKey(new Date(to.getTime() - 1));

  if (who.cover && who.memberIds.length) {
    const covers = await db.coverAssignment.findMany({ where: { substituteId: { in: who.memberIds }, status: { in: ["ASSIGNED", "DONE"] }, date: { gte: new Date(`${fromKey}T00:00:00Z`), lte: new Date(`${toKey}T00:00:00Z`) } } });
    const classes = await db.schoolClass.findMany({ where: { id: { in: covers.map((c) => c.classId) } } });
    for (const c of covers) {
      const key = c.date.toISOString().slice(0, 10);
      const time = at(key, c.periodNo);
      if (!time) continue;
      const cls = classes.find((x) => x.id === c.classId);
      out.push({ id: `cv-${c.id}`, kind: "cover", title: cls ? pick(locale, cls.nameEn, cls.nameAr) : "", subtitle: cls?.room ?? undefined, ...time, allDay: false, href: "/timetable" });
    }
  }

  if (who.lessons) {
    const classIds = who.studentIds.length ? (await db.enrollment.findMany({ where: { studentId: { in: who.studentIds }, status: "ACTIVE" }, select: { classId: true } })).map((e) => e.classId) : [];
    const slots = await db.timetableSlot.findMany({
      where: { academicYearId: year.id, OR: [...(who.memberIds.length ? [{ teacherMembershipId: { in: who.memberIds } }] : []), ...(classIds.length ? [{ classId: { in: classIds } }] : [])] },
    });
    const classes = await db.schoolClass.findMany({ where: { id: { in: [...new Set(slots.map((s) => s.classId))] } } });
    const weekDays = ctx.org.weekDays.length ? ctx.org.weekDays : [1, 2, 3, 4, 5];
    for (let key = fromKey, n = 0; key <= toKey && n < MAX_LESSON_DAYS; key = addDaysKey(key, 1), n++) {
      const wd = weekdayOfKey(key);
      if (!weekDays.includes(wd) || key < year.startsOn.toISOString().slice(0, 10) || key > year.endsOn.toISOString().slice(0, 10)) continue;
      for (const s of slots.filter((x) => x.dayOfWeek === wd)) {
        const time = at(key, s.periodNo);
        if (!time) continue;
        const cls = classes.find((x) => x.id === s.classId);
        out.push({ id: `ls-${s.id}-${key}`, kind: "lesson", title: cls ? pick(locale, cls.nameEn, cls.nameAr) : "", subtitle: s.room ?? undefined, ...time, allDay: false, href: "/timetable" });
      }
    }
  }
  return out;
}
