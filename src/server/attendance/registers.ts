// Taking attendance: today's registers for a teacher (the homeroom's daily register and their lessons,
// including lessons they cover), loading one register with its pre-filled marks, and saving marks.
//
// Rules (see docs/guides/attendance.md):
// - The homeroom teacher takes the daily register; a lesson's teacher takes its register; the cover teacher
//   takes it instead when the lesson is covered. Holders of attendance.manage may take or change any register.
// - Teachers may mark late until the late cut-off (minutes after the register starts). Later late marks,
//   closing a register and any change after it closes need attendance.manage, and each such change is audited
//   with the old and the new value.
// - Daily marks are the student's AttendanceRecord for the day (what reports, the API and families read).
//   Lesson marks are AttendanceLessonMark rows.
// - Codes that say why a student is away (private codes) are shown to teachers as a plain excused absence,
//   and a teacher's save never overwrites a private code with the plain one.
// - When the school keeps its register in another system (mode EXTERNAL), registers here are read only.
import type { AttendanceSource, AttendanceStatus } from "@prisma/client";
import { tenantTx, type TenantDb, type TenantTx } from "@/lib/tenant-db";
import type { Permission } from "@/server/identity/permissions";
import { audit } from "@/server/audit/audit";
import { addDays, keyToDate } from "@/server/timetable/cover";
import { isUnexplained, resolveCode, statusOf, visibleCode, type Code } from "./codes";
import { holidayKeys, loadCodes, loadSettings, localClock, registerWindow, toMin, type Settings } from "./settings";

export type AttViewer = {
  db: TenantDb;
  orgId: string;
  membershipId: string;
  isStaff: boolean;
  can: (p: Permission) => boolean;
  timezone: string;
  weekDays: number[];
};

type CtxLike = { db: TenantDb; orgId: string; membershipId: string; isStaff: boolean; can: (p: Permission) => boolean; org: { timezone: string; weekDays: number[] } };

export function attViewer(ctx: CtxLike): AttViewer {
  return { db: ctx.db, orgId: ctx.orgId, membershipId: ctx.membershipId, isStaff: ctx.isStaff, can: ctx.can, timezone: ctx.org.timezone || "Asia/Dubai", weekDays: ctx.org.weekDays.length ? ctx.org.weekDays : [1, 2, 3, 4, 5] };
}

export const canManage = (v: Pick<AttViewer, "isStaff" | "can">) => v.isStaff && v.can("attendance.manage");
export const seesReasons = (v: Pick<AttViewer, "isStaff" | "can">) => v.isStaff && (v.can("attendance.reasons") || v.can("people.medical"));
export const canTakeAny = (v: Pick<AttViewer, "isStaff" | "can">) => v.isStaff && (v.can("attendance.take") || v.can("attendance.manage"));

export class RegisterError extends Error {
  constructor(public code: string) {
    super(`register:${code}`);
  }
}

const isKey = (k: string) => /^\d{4}-\d{2}-\d{2}$/.test(k) && !Number.isNaN(keyToDate(k).getTime());

async function currentYearId(db: TenantDb | TenantTx) {
  const y = (await (db as TenantTx).academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } })) ?? (await (db as TenantTx).academicYear.findFirst({ orderBy: { startsOn: "desc" }, select: { id: true } }));
  return y?.id ?? null;
}

/** A published holiday on the school calendar covers this local date. */
export async function isHoliday(db: TenantDb | TenantTx, dateKey: string, timeZone = "Asia/Dubai") {
  return (await holidayKeys(db, dateKey, dateKey, timeZone)).has(dateKey);
}

// ---------------------------------------------------------------------------
// Today's registers
// ---------------------------------------------------------------------------

export type RegisterItem = {
  kind: "DAILY" | "LESSON";
  classId: string;
  className: { en: string; ar: string };
  subject: { en: string; ar: string } | null;
  gradeLevel: number;
  periodNo: number;
  lessonNo: number | null;
  start: string;
  end: string | null;
  room: string | null;
  /** This lesson is covered by the viewer for an absent colleague. */
  cover: boolean;
  /** The viewer's own lesson is covered by someone else today: they cannot take it. */
  coveredBy: string | null;
  students: number;
  marked: number;
  absent: number;
  late: number;
  takenAt: Date | null;
  closedAt: Date | null;
  window: ReturnType<typeof registerWindow>;
};

/** The viewer's registers for a date: their homerooms' daily registers, their lessons and the lessons they cover. */
export async function myRegisters(v: AttViewer, dateKey: string, now = new Date()): Promise<{ items: RegisterItem[]; holiday: boolean; schoolDay: boolean; settings: Settings }> {
  const settings = await loadSettings(v.db);
  if (!isKey(dateKey)) throw new RegisterError("date");
  const weekday = keyToDate(dateKey).getUTCDay();
  const schoolDay = v.weekDays.includes(weekday);
  const holiday = schoolDay ? await isHoliday(v.db, dateKey, v.timezone) : false;
  const yearId = await currentYearId(v.db);
  if (!yearId || !v.isStaff || !schoolDay || holiday) return { items: [], holiday, schoolDay, settings };
  const clock = localClock(now, v.timezone);
  const me = v.membershipId;
  const date = keyToDate(dateKey);

  const [homerooms, ownSlots, myCoversOut, myCoversIn, bell] = await Promise.all([
    v.db.schoolClass.findMany({ where: { academicYearId: yearId, isHomeroom: true, teacherMembershipId: me }, include: { _count: { select: { enrollments: { where: { status: "ACTIVE" } } } } } }),
    v.db.timetableSlot.findMany({ where: { academicYearId: yearId, teacherMembershipId: me, dayOfWeek: weekday } }),
    v.db.coverAssignment.findMany({ where: { originalTeacherId: me, date, status: { in: ["ASSIGNED", "DONE"] } } }),
    v.db.coverAssignment.findMany({ where: { substituteId: me, date, status: { in: ["ASSIGNED", "DONE"] } } }),
    v.db.bellPeriod.findMany({ where: { academicYearId: yearId, dayOfWeek: weekday } }),
  ]);
  const coverSlots = myCoversIn.length ? await v.db.timetableSlot.findMany({ where: { id: { in: myCoversIn.map((c) => c.slotId) } } }) : [];
  const lessonSlots = [...ownSlots.map((s) => ({ s, cover: false })), ...coverSlots.map((s) => ({ s, cover: true }))];
  const classIds = [...new Set(lessonSlots.map((x) => x.s.classId))];
  const lessonClasses = classIds.length
    ? await v.db.schoolClass.findMany({ where: { id: { in: classIds } }, include: { subject: true, _count: { select: { enrollments: { where: { status: "ACTIVE" } } } } } })
    : [];
  const subNames = myCoversOut.length
    ? new Map((await v.db.membership.findMany({ where: { id: { in: myCoversOut.map((c) => c.substituteId).filter(Boolean) as string[] } }, select: { id: true, user: { select: { nameEn: true } } } })).map((m) => [m.id, m.user.nameEn]))
    : new Map<string, string>();
  const lessonNo = new Map<number, number>();
  let n = 0;
  for (const b of [...bell].sort((a, b2) => a.periodNo - b2.periodNo)) if (b.kind === "LESSON") lessonNo.set(b.periodNo, ++n);

  const allClassIds = [...homerooms.map((h) => h.id), ...classIds];
  const registers = allClassIds.length ? await v.db.attendanceRegister.findMany({ where: { classId: { in: allClassIds }, date } }) : [];
  const regOf = (classId: string, periodNo: number) => registers.find((r) => r.classId === classId && r.periodNo === periodNo) ?? null;

  // Counts: daily marks from AttendanceRecord for the homeroom's students; lesson marks per register.
  const homeroomStudents = homerooms.length ? await v.db.enrollment.findMany({ where: { classId: { in: homerooms.map((h) => h.id) }, status: "ACTIVE", student: { status: "ACTIVE" } }, select: { classId: true, studentId: true } }) : [];
  const dailyGroups = homeroomStudents.length
    ? await v.db.attendanceRecord.groupBy({ by: ["status"], where: { date, studentId: { in: homeroomStudents.map((e) => e.studentId) } }, _count: { _all: true } })
    : [];
  const dailyByClass = new Map<string, { marked: number; absent: number; late: number }>();
  if (homerooms.length === 1) {
    const sum = (s: AttendanceStatus[]) => dailyGroups.filter((g) => s.includes(g.status)).reduce((a, g) => a + g._count._all, 0);
    dailyByClass.set(homerooms[0].id, { marked: sum(["PRESENT", "LATE", "ABSENT", "EXCUSED"]), absent: sum(["ABSENT", "EXCUSED"]), late: sum(["LATE"]) });
  } else if (homerooms.length > 1) {
    const recs = await v.db.attendanceRecord.findMany({ where: { date, studentId: { in: homeroomStudents.map((e) => e.studentId) } }, select: { studentId: true, status: true } });
    for (const h of homerooms) {
      const ids = new Set(homeroomStudents.filter((e) => e.classId === h.id).map((e) => e.studentId));
      const mine = recs.filter((r) => ids.has(r.studentId));
      dailyByClass.set(h.id, { marked: mine.length, absent: mine.filter((r) => r.status === "ABSENT" || r.status === "EXCUSED").length, late: mine.filter((r) => r.status === "LATE").length });
    }
  }
  const lessonCounts = registers.filter((r) => r.periodNo > 0).length
    ? await v.db.attendanceLessonMark.groupBy({ by: ["registerId", "status"], where: { registerId: { in: registers.filter((r) => r.periodNo > 0).map((r) => r.id) } }, _count: { _all: true } })
    : [];

  const items: RegisterItem[] = [];
  for (const h of homerooms) {
    const reg = regOf(h.id, 0);
    const c = dailyByClass.get(h.id) ?? { marked: 0, absent: 0, late: 0 };
    items.push({
      kind: "DAILY",
      classId: h.id,
      className: { en: h.nameEn, ar: h.nameAr },
      subject: null,
      gradeLevel: h.gradeLevel,
      periodNo: 0,
      lessonNo: null,
      start: settings.dailyStart,
      end: null,
      room: h.room,
      cover: false,
      coveredBy: null,
      students: h._count.enrollments,
      ...c,
      takenAt: reg?.takenAt ?? null,
      closedAt: reg?.closedAt ?? null,
      window: registerWindow(settings, { dateKey, startMin: toMin(settings.dailyStart), closedAt: reg?.closedAt ?? null }, clock),
    });
  }
  for (const { s, cover } of lessonSlots) {
    const cls = lessonClasses.find((c) => c.id === s.classId);
    if (!cls || settings.dailyOnlyGrades.includes(cls.gradeLevel)) continue;
    const b = bell.find((x) => x.periodNo === s.periodNo);
    const out = !cover ? myCoversOut.find((c) => c.slotId === s.id) : undefined;
    const reg = regOf(s.classId, s.periodNo);
    const counts = reg ? lessonCounts.filter((x) => x.registerId === reg.id) : [];
    const sum = (st: AttendanceStatus[]) => counts.filter((x) => st.includes(x.status)).reduce((a, x) => a + x._count._all, 0);
    items.push({
      kind: "LESSON",
      classId: s.classId,
      className: { en: cls.nameEn, ar: cls.nameAr },
      subject: cls.subject ? { en: cls.subject.nameEn, ar: cls.subject.nameAr } : null,
      gradeLevel: cls.gradeLevel,
      periodNo: s.periodNo,
      lessonNo: lessonNo.get(s.periodNo) ?? null,
      start: b?.startTime ?? "",
      end: b?.endTime ?? null,
      room: s.room ?? cls.room,
      cover,
      coveredBy: out ? (subNames.get(out.substituteId ?? "") ?? "") : null,
      students: cls._count.enrollments,
      marked: sum(["PRESENT", "LATE", "ABSENT", "EXCUSED"]),
      absent: sum(["ABSENT", "EXCUSED"]),
      late: sum(["LATE"]),
      takenAt: reg?.takenAt ?? null,
      closedAt: reg?.closedAt ?? null,
      window: registerWindow(settings, { dateKey, startMin: b ? toMin(b.startTime) : toMin(settings.dailyStart), closedAt: reg?.closedAt ?? null }, clock),
    });
  }
  items.sort((a, b) => (a.kind === b.kind ? toMin(a.start) - toMin(b.start) || a.periodNo - b.periodNo : a.kind === "DAILY" ? -1 : 1));
  return { items, holiday, schoolDay, settings };
}

// ---------------------------------------------------------------------------
// One register
// ---------------------------------------------------------------------------

export type RegisterRef = { classId: string; date: string; periodNo: number };

type Resolved = {
  cls: { id: string; nameEn: string; nameAr: string; gradeLevel: number; isHomeroom: boolean; teacherMembershipId: string | null; room: string | null; subject: { nameEn: string; nameAr: string } | null };
  kind: "DAILY" | "LESSON";
  slotId: string | null;
  coverId: string | null;
  start: string;
  end: string | null;
  /** Why the viewer may take this register, or null when they may only look. */
  role: "teacher" | "cover" | "manager" | null;
  /** The viewer may look (teacher of the class, cover, or a manager). */
  canView: boolean;
};

/** Find the class, period and the viewer's relationship to the register. Null when it does not exist. */
async function resolve(v: AttViewer, ref: RegisterRef, settings: Settings): Promise<Resolved | null> {
  if (!isKey(ref.date) || !Number.isInteger(ref.periodNo) || ref.periodNo < 0 || ref.periodNo > 30) return null;
  const cls = await v.db.schoolClass.findUnique({ where: { id: ref.classId }, include: { subject: { select: { nameEn: true, nameAr: true } } } });
  if (!cls) return null;
  const manager = canManage(v);
  const viewAll = v.isStaff && (v.can("attendance.view_all") || manager);
  const weekday = keyToDate(ref.date).getUTCDay();
  if (ref.periodNo === 0) {
    if (!cls.isHomeroom) return null;
    const teacher = cls.teacherMembershipId === v.membershipId && canTakeAny(v);
    return { cls, kind: "DAILY", slotId: null, coverId: null, start: settings.dailyStart, end: null, role: manager ? "manager" : teacher ? "teacher" : null, canView: teacher || viewAll || cls.teacherMembershipId === v.membershipId };
  }
  if (settings.dailyOnlyGrades.includes(cls.gradeLevel)) return null;
  const slot = await v.db.timetableSlot.findFirst({ where: { classId: cls.id, dayOfWeek: weekday, periodNo: ref.periodNo, academicYearId: cls.academicYearId } });
  if (!slot) return null;
  const bell = await v.db.bellPeriod.findFirst({ where: { academicYearId: cls.academicYearId, dayOfWeek: weekday, periodNo: ref.periodNo } });
  const cover = await v.db.coverAssignment.findFirst({ where: { slotId: slot.id, date: keyToDate(ref.date), status: { in: ["ASSIGNED", "DONE"] } } });
  const isCover = !!cover && cover.substituteId === v.membershipId;
  const isTeacher = slot.teacherMembershipId === v.membershipId && !(cover && cover.substituteId && cover.substituteId !== v.membershipId);
  const take = canTakeAny(v);
  const role = manager ? "manager" : take && isCover ? "cover" : take && isTeacher ? "teacher" : null;
  return {
    cls,
    kind: "LESSON",
    slotId: slot.id,
    coverId: cover?.id ?? null,
    start: bell?.startTime ?? settings.dailyStart,
    end: bell?.endTime ?? null,
    role,
    canView: role !== null || viewAll || slot.teacherMembershipId === v.membershipId,
  };
}

export type RegisterMark = { code: string; minutesLate: number | null; source: AttendanceSource; fromReport: boolean; masked: boolean };

export type RegisterView = {
  ref: RegisterRef;
  kind: "DAILY" | "LESSON";
  cls: Resolved["cls"];
  start: string;
  end: string | null;
  role: Resolved["role"];
  window: ReturnType<typeof registerWindow>;
  mode: Settings["mode"];
  lateCutoffMin: number;
  closeTime: string;
  holiday: boolean;
  takenAt: Date | null;
  takenById: string | null;
  closedAt: Date | null;
  isCover: boolean;
  codes: Code[];
  students: Array<{
    id: string;
    firstNameEn: string;
    lastNameEn: string;
    firstNameAr: string;
    lastNameAr: string;
    studentNo: string;
    mark: RegisterMark | null;
    /** A suggested mark for an unmarked student: from the daily register (lesson) or an approved absence report. */
    prefill: { code: string; from: "daily" | "report" } | null;
  }>;
};

/** Load one register for the viewer, or null when it does not exist or they may not see it. */
export async function loadRegister(v: AttViewer, ref: RegisterRef, now = new Date()): Promise<RegisterView | null> {
  const settings = await loadSettings(v.db);
  const r = await resolve(v, ref, settings);
  if (!r || !r.canView) return null;
  const { codes } = await loadCodes(v.db);
  const reasons = seesReasons(v);
  const date = keyToDate(ref.date);
  const clock = localClock(now, v.timezone);
  const [enrollments, reg, holiday] = await Promise.all([
    v.db.enrollment.findMany({ where: { classId: r.cls.id, status: "ACTIVE", student: { status: "ACTIVE" } }, include: { student: { select: { id: true, firstNameEn: true, lastNameEn: true, firstNameAr: true, lastNameAr: true, studentNo: true } } } }),
    v.db.attendanceRegister.findUnique({ where: { classId_date_periodNo: { classId: r.cls.id, date, periodNo: ref.periodNo } } }),
    isHoliday(v.db, ref.date, v.timezone),
  ]);
  const ids = enrollments.map((e) => e.studentId);
  const daily = ids.length ? await v.db.attendanceRecord.findMany({ where: { date, studentId: { in: ids } } }) : [];
  const lesson = reg && r.kind === "LESSON" ? await v.db.attendanceLessonMark.findMany({ where: { registerId: reg.id } }) : [];
  const show = (code: string | null, status: AttendanceStatus) => {
    const c = resolveCode(codes, code, status);
    if (!c) return null;
    const vis = visibleCode(codes, c, reasons);
    return { code: vis.code, masked: vis.code !== c.code };
  };
  const students = enrollments
    .map((e) => {
      const d = daily.find((x) => x.studentId === e.studentId);
      const l = lesson.find((x) => x.studentId === e.studentId);
      let mark: RegisterMark | null = null;
      let prefill: RegisterView["students"][number]["prefill"] = null;
      if (r.kind === "DAILY" && d) {
        const s = show(d.code, d.status);
        if (s) mark = { code: s.code, masked: s.masked, minutesLate: d.minutesLate, source: d.source, fromReport: !!d.requestId };
      }
      if (r.kind === "LESSON") {
        if (l) {
          const s = show(l.code, l.status);
          if (s) mark = { code: s.code, masked: s.masked, minutesLate: l.minutesLate, source: l.source, fromReport: !!l.requestId };
        } else if (d) {
          // Absent all day (or excused by a report): suggest the same mark for the lesson.
          const c = resolveCode(codes, d.code, d.status);
          if (c && c.countsAs !== "PRESENT") {
            const s = show(d.code, d.status);
            if (s) prefill = { code: s.code, from: d.requestId ? "report" : "daily" };
          }
        }
      }
      return { ...e.student, mark, prefill };
    })
    .sort((a, b) => a.lastNameEn.localeCompare(b.lastNameEn) || a.firstNameEn.localeCompare(b.firstNameEn));
  return {
    ref,
    kind: r.kind,
    cls: r.cls,
    start: r.start,
    end: r.end,
    role: settings.mode === "EXTERNAL" ? null : r.role,
    window: registerWindow(settings, { dateKey: ref.date, startMin: toMin(r.start), closedAt: reg?.closedAt ?? null }, clock),
    mode: settings.mode,
    lateCutoffMin: settings.lateCutoffMin,
    closeTime: settings.closeTime,
    holiday,
    takenAt: reg?.takenAt ?? null,
    takenById: reg?.takenById ?? null,
    closedAt: reg?.closedAt ?? null,
    isCover: r.role === "cover",
    codes: codes.map((c) => visibleCode(codes, c, reasons)).filter((c, i, all) => all.findIndex((x) => x.code === c.code) === i),
    students,
  };
}

// ---------------------------------------------------------------------------
// Saving marks
// ---------------------------------------------------------------------------

export type MarkInput = { studentId: string; code: string; minutesLate?: number | null };

export type SaveResult = {
  saved: number;
  unchanged: number;
  rejected: Array<{ studentId: string; error: string }>;
  takenAt: Date;
  closedAt: Date | null;
};

type Change = { studentId: string; from: string | null; to: string; fromMin: number | null; toMin: number | null; why: "after_close" | "late_cutoff" | null };

/**
 * Save marks on a register. Only the marks sent are written (the page sends what changed), so a teacher's
 * save never touches marks it did not show. Safe to retry: the same marks again are "unchanged".
 */
export async function saveRegister(v: AttViewer, ref: RegisterRef, marks: MarkInput[], now = new Date()): Promise<SaveResult> {
  if (marks.length > 200) throw new RegisterError("tooMany");
  const settings = await loadSettings(v.db);
  if (settings.mode === "EXTERNAL") throw new RegisterError("external");
  const r = await resolve(v, ref, settings);
  if (!r || !r.role) throw new RegisterError("forbidden");
  const manager = r.role === "manager";
  const reasons = seesReasons(v);
  const { codes } = await loadCodes(v.db);
  const clock = localClock(now, v.timezone);
  const date = keyToDate(ref.date);
  if (await isHoliday(v.db, ref.date, v.timezone)) throw new RegisterError("holiday");

  return tenantTx(
    v.orgId,
    async (tx) => {
      const existing = await tx.attendanceRegister.findUnique({ where: { classId_date_periodNo: { classId: r.cls.id, date, periodNo: ref.periodNo } } });
      const window = registerWindow(settings, { dateKey: ref.date, startMin: toMin(r.start), closedAt: existing?.closedAt ?? null }, clock);
      if (window === "future") throw new RegisterError("future");
      if (window === "closed" && !manager) throw new RegisterError("closed");
      const enrolled = new Set((await tx.enrollment.findMany({ where: { orgId: v.orgId, classId: r.cls.id, status: "ACTIVE" }, select: { studentId: true } })).map((e) => e.studentId));
      const reg =
        existing ??
        (await tx.attendanceRegister.create({
          data: { orgId: v.orgId, kind: r.kind, classId: r.cls.id, date, periodNo: ref.periodNo, slotId: r.slotId, coverId: r.role === "cover" ? r.coverId : null, takenById: v.membershipId, takenAt: now },
        }));
      const ids = marks.map((m) => m.studentId).filter((id) => enrolled.has(id));
      const prev = new Map<string, { code: Code | undefined; minutesLate: number | null; source: AttendanceSource; requestId: string | null; id: string }>();
      if (r.kind === "DAILY") {
        for (const d of await tx.attendanceRecord.findMany({ where: { orgId: v.orgId, date, studentId: { in: ids } } })) prev.set(d.studentId, { code: resolveCode(codes, d.code, d.status), minutesLate: d.minutesLate, source: d.source, requestId: d.requestId, id: d.id });
      } else {
        for (const l of await tx.attendanceLessonMark.findMany({ where: { orgId: v.orgId, registerId: reg.id, studentId: { in: ids } } })) prev.set(l.studentId, { code: resolveCode(codes, l.code, l.status), minutesLate: l.minutesLate, source: l.source, requestId: l.requestId, id: l.id });
      }

      const rejected: SaveResult["rejected"] = [];
      const changes: Change[] = [];
      let unchanged = 0;
      const seen = new Set<string>();
      for (const m of marks) {
        if (!enrolled.has(m.studentId)) {
          rejected.push({ studentId: m.studentId, error: "notInClass" });
          continue;
        }
        if (seen.has(m.studentId)) continue;
        seen.add(m.studentId);
        const code = codes.find((c) => c.code === m.code && c.active);
        if (!code || (code.private && !reasons)) {
          rejected.push({ studentId: m.studentId, error: "code" });
          continue;
        }
        const minutes = code.late ? Math.round(Number(m.minutesLate ?? 0)) : null;
        if (code.late && (!Number.isFinite(minutes) || minutes! < 1 || minutes! > 240)) {
          rejected.push({ studentId: m.studentId, error: "minutes" });
          continue;
        }
        const before = prev.get(m.studentId);
        // A teacher sees a private code as the plain excused code: sending that back is no change.
        const beforeVisible = before?.code ? visibleCode(codes, before.code, reasons) : undefined;
        if (before?.code && (before.code.code === code.code || (beforeVisible && beforeVisible.code === code.code && before.code.private)) && (before.minutesLate ?? null) === (minutes ?? null)) {
          unchanged++;
          continue;
        }
        let why: Change["why"] = null;
        if (window === "closed") why = "after_close";
        else if (window === "late_closed" && code.late && !before?.code?.late) {
          if (!manager) {
            rejected.push({ studentId: m.studentId, error: "lateCutoff" });
            continue;
          }
          why = "late_cutoff";
        }
        changes.push({ studentId: m.studentId, from: before?.code?.code ?? null, to: code.code, fromMin: before?.minutesLate ?? null, toMin: minutes, why });
        const status = statusOf(code);
        // An approved absence report keeps its link while the mark stays an authorised absence.
        const requestId = before?.requestId && code.countsAs === "ABSENT" && code.authorised ? before.requestId : null;
        const source: AttendanceSource = requestId ? before!.source : "REGISTER";
        if (r.kind === "DAILY") {
          await tx.attendanceRecord.upsert({
            where: { studentId_date: { studentId: m.studentId, date } },
            create: { orgId: v.orgId, studentId: m.studentId, date, status, code: code.code, minutesLate: minutes, source, requestId, markedById: v.membershipId },
            update: { status, code: code.code, minutesLate: minutes, source, requestId, markedById: v.membershipId },
          });
        } else {
          await tx.attendanceLessonMark.upsert({
            where: { registerId_studentId: { registerId: reg.id, studentId: m.studentId } },
            create: { orgId: v.orgId, registerId: reg.id, studentId: m.studentId, date, code: code.code, status, minutesLate: minutes, source, requestId, markedById: v.membershipId },
            update: { code: code.code, status, minutesLate: minutes, source, requestId, markedById: v.membershipId },
          });
        }
      }

      if (changes.length) {
        await tx.attendanceRegister.update({ where: { id: reg.id }, data: { takenAt: reg.takenAt ?? now, takenById: reg.takenById ?? v.membershipId } });
        if (r.kind === "DAILY") await syncFollowUps(tx, v.orgId, date, changes, codes, v.membershipId, now);
        const plain = changes.filter((c) => !c.why);
        const guarded = changes.filter((c) => c.why);
        if (plain.length) {
          await audit(tx, v.orgId, {
            actorId: v.membershipId,
            action: "attendance.register_save",
            entityType: "AttendanceRegister",
            entityId: reg.id,
            meta: { classId: r.cls.id, date: ref.date, periodNo: ref.periodNo, role: r.role, marks: plain.length, edits: plain.filter((c) => c.from).length },
          });
        }
        // Late after the cut-off and changes after closing: one audit event per mark, with the old and new value.
        for (const c of guarded) {
          await audit(tx, v.orgId, {
            actorId: v.membershipId,
            action: c.why === "after_close" ? "attendance.mark_edit_after_close" : "attendance.mark_late_after_cutoff",
            entityType: "AttendanceRegister",
            entityId: reg.id,
            meta: { classId: r.cls.id, date: ref.date, periodNo: ref.periodNo, studentId: c.studentId, from: c.from, to: c.to, fromMinutesLate: c.fromMin, toMinutesLate: c.toMin },
          });
        }
      }
      const after = await tx.attendanceRegister.findUniqueOrThrow({ where: { id: reg.id } });
      return { saved: changes.length, unchanged, rejected, takenAt: after.takenAt ?? now, closedAt: after.closedAt };
    },
    { timeout: 30_000 },
  );
}

/**
 * Daily marks feed the attendance office: an "absent, not known" mark opens a follow-up for the day (the
 * guardian message goes out later, from the follow-up time), and a change away from it resolves the follow-up.
 */
async function syncFollowUps(tx: TenantTx, orgId: string, date: Date, changes: Change[], codes: Code[], actorId: string, now: Date) {
  const opened = changes.filter((c) => {
    const to = codes.find((x) => x.code === c.to);
    return to && isUnexplained(to);
  });
  if (opened.length) {
    await tx.attendanceFollowUp.createMany({ data: opened.map((c) => ({ orgId, studentId: c.studentId, date })), skipDuplicates: true });
    // Marked absent again after being explained: the day needs following up again.
    await tx.attendanceFollowUp.updateMany({ where: { orgId, date, studentId: { in: opened.map((c) => c.studentId) }, status: "EXPLAINED" }, data: { status: "OPEN", explainedCode: null, explainedById: null, explainedAt: null } });
  }
  const resolved = changes.filter((c) => {
    const to = codes.find((x) => x.code === c.to);
    return to && !isUnexplained(to);
  });
  if (!resolved.length) return;
  const open = await tx.attendanceFollowUp.findMany({ where: { orgId, date, studentId: { in: resolved.map((c) => c.studentId) }, status: { not: "EXPLAINED" } } });
  for (const f of open) {
    const c = resolved.find((x) => x.studentId === f.studentId)!;
    await tx.attendanceFollowUp.update({ where: { id: f.id }, data: { status: "EXPLAINED", explainedCode: c.to, explainedById: actorId, explainedAt: now } });
  }
}

/** Close or reopen a register (attendance.manage). Audited. */
export async function setRegisterClosed(v: AttViewer, ref: RegisterRef, closed: boolean, now = new Date()) {
  if (!canManage(v)) throw new RegisterError("forbidden");
  const settings = await loadSettings(v.db);
  const r = await resolve(v, ref, settings);
  if (!r) throw new RegisterError("notFound");
  const date = keyToDate(ref.date);
  return tenantTx(v.orgId, async (tx) => {
    const reg = await tx.attendanceRegister.upsert({
      where: { classId_date_periodNo: { classId: r.cls.id, date, periodNo: ref.periodNo } },
      create: { orgId: v.orgId, kind: r.kind, classId: r.cls.id, date, periodNo: ref.periodNo, slotId: r.slotId, closedAt: closed ? now : null, closedById: closed ? v.membershipId : null },
      update: { closedAt: closed ? now : null, closedById: closed ? v.membershipId : null },
    });
    await audit(tx, v.orgId, { actorId: v.membershipId, action: closed ? "attendance.register_close" : "attendance.register_reopen", entityType: "AttendanceRegister", entityId: reg.id, meta: { classId: r.cls.id, date: ref.date, periodNo: ref.periodNo } });
    return reg;
  });
}

/** The previous and next school days around a date key (for the date switcher). */
export function neighbourDays(dateKey: string, weekDays: number[]) {
  const step = (dir: 1 | -1) => {
    let k = dateKey;
    for (let i = 0; i < 10; i++) {
      k = addDays(k, dir);
      if (weekDays.includes(keyToDate(k).getUTCDay())) return k;
    }
    return addDays(dateKey, dir);
  };
  return { prev: step(-1), next: step(1) };
}

