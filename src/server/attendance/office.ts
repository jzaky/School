// Read models for the attendance office (attendance.manage): which registers are not taken yet today, persistent
// absence alerts for the current term and the regulator absence limit. Counts and names only, never reasons.
import { dateKey, keyToDate } from "@/server/timetable/cover";
import { limitStanding } from "./alerts";
import { canManage, RegisterError, type AttViewer } from "./registers";
import { loadSettings, localClock, toMin } from "./settings";

export async function registerProgress(v: AttViewer, day: string, now = new Date()) {
  if (!canManage(v)) throw new RegisterError("forbidden");
  const year = await v.db.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } });
  if (!year) return { homerooms: [], lessons: { started: 0, taken: 0 } };
  const date = keyToDate(day);
  const weekday = date.getUTCDay();
  const settings = await loadSettings(v.db);
  const clock = localClock(now, v.timezone);
  const minute = day === clock.dateKey ? clock.minute : day < clock.dateKey ? 24 * 60 : -1;
  const [homerooms, enrollments, records, registers, slots, bell] = await Promise.all([
    v.db.schoolClass.findMany({ where: { academicYearId: year.id, isHomeroom: true }, select: { id: true, nameEn: true, nameAr: true, gradeLevel: true, teacherMembershipId: true }, orderBy: [{ gradeLevel: "asc" }, { nameEn: "asc" }] }),
    v.db.enrollment.findMany({ where: { status: "ACTIVE", class: { academicYearId: year.id, isHomeroom: true }, student: { status: "ACTIVE" } }, select: { classId: true, studentId: true } }),
    v.db.attendanceRecord.findMany({ where: { date }, select: { studentId: true } }),
    v.db.attendanceRegister.findMany({ where: { date }, select: { classId: true, periodNo: true, takenAt: true, closedAt: true } }),
    v.db.timetableSlot.findMany({ where: { academicYearId: year.id, dayOfWeek: weekday }, select: { classId: true, periodNo: true } }),
    v.db.bellPeriod.findMany({ where: { academicYearId: year.id, dayOfWeek: weekday }, select: { periodNo: true, startTime: true } }),
  ]);
  const marked = new Set(records.map((r) => r.studentId));
  const teacherIds = [...new Set(homerooms.map((h) => h.teacherMembershipId).filter(Boolean) as string[])];
  const teachers = teacherIds.length ? await v.db.membership.findMany({ where: { id: { in: teacherIds } }, select: { id: true, user: { select: { nameEn: true, nameAr: true } } } }) : [];
  const rows = homerooms.map((h) => {
    const ids = enrollments.filter((e) => e.classId === h.id).map((e) => e.studentId);
    const reg = registers.find((r) => r.classId === h.id && r.periodNo === 0);
    const tm = teachers.find((x) => x.id === h.teacherMembershipId);
    return { id: h.id, en: h.nameEn, ar: h.nameAr, gradeLevel: h.gradeLevel, students: ids.length, marked: ids.filter((id) => marked.has(id)).length, closedAt: reg?.closedAt ?? null, teacher: tm ? { en: tm.user.nameEn, ar: tm.user.nameAr ?? tm.user.nameEn } : null };
  });
  // Lessons: only those that have started, in grades that take lesson registers.
  const classGrades = new Map((await v.db.schoolClass.findMany({ where: { id: { in: [...new Set(slots.map((s) => s.classId))] } }, select: { id: true, gradeLevel: true } })).map((c) => [c.id, c.gradeLevel]));
  const started = slots.filter((s) => {
    const b = bell.find((x) => x.periodNo === s.periodNo);
    return b && toMin(b.startTime) <= minute && !settings.dailyOnlyGrades.includes(classGrades.get(s.classId) ?? 99);
  });
  const taken = started.filter((s) => registers.some((r) => r.classId === s.classId && r.periodNo === s.periodNo && r.takenAt)).length;
  return { homerooms: rows, lessons: { started: started.length, taken }, dailyStarted: minute >= toMin(settings.dailyStart) };
}

/** Persistent absence alerts of the current term and students near or at the regulator limit. */
export async function officeAlerts(v: AttViewer, now = new Date()) {
  if (!canManage(v)) throw new RegisterError("forbidden");
  const settings = await loadSettings(v.db);
  const today = localClock(now, v.timezone).dateKey;
  const year = await v.db.academicYear.findFirst({ where: { isCurrent: true }, include: { terms: true } });
  const term = year?.terms.find((t) => dateKey(t.startsOn) <= today && today <= dateKey(t.endsOn));
  const [persistent, limit] = await Promise.all([
    term ? v.db.attendanceAlert.findMany({ where: { periodId: term.id, kind: "PERSISTENT", resolvedAt: null }, orderBy: { percent: "asc" }, take: 100 }) : Promise.resolve([]),
    limitStanding(v.db, settings, { timeZone: v.timezone, weekDays: v.weekDays, today }),
  ]);
  const ids = [...new Set([...persistent.map((p) => p.studentId), ...limit.rows.map((r) => r.studentId)])];
  const students = ids.length ? await v.db.student.findMany({ where: { id: { in: ids } }, select: { id: true, firstNameEn: true, lastNameEn: true, firstNameAr: true, lastNameAr: true, studentNo: true, gradeLevel: true, section: true } }) : [];
  const persistentTotal = term ? await v.db.attendanceAlert.count({ where: { periodId: term.id, kind: "PERSISTENT", resolvedAt: null } }) : 0;
  return {
    settings,
    term: term ? { en: term.nameEn, ar: term.nameAr } : null,
    persistent: persistent.map((p) => ({ ...p, student: students.find((s) => s.id === p.studentId) ?? null })).filter((p) => p.student),
    persistentTotal,
    limit: limit.rows.map((r) => ({ ...r, student: students.find((s) => s.id === r.studentId) ?? null })).filter((r) => r.student),
  };
}
