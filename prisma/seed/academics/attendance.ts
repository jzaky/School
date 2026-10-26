// Demo data for attendance and grade publishing, all relative to now:
// - settings (Horizon is the register, follow-up at 09:30, heads of year, the regulator absence limit switched on
//   with the Sharjah preset so the Al Durrah team can see it), the default code list;
// - daily and lesson marks for every school day of the term so far, with believable patterns: a few students often
//   late, a bus delay one morning, a school visit for one grade, illness explained by the office, two students below
//   the 90% threshold (one of them near the regulator limit);
// - yesterday's follow-ups (explained after a call, recorded as unauthorised, one held for staff contact);
// - today's registers partly taken: Daniel Carter's homeroom 9A and his lessons are left for the live demo, one
//   more homeroom is not taken yet, four students are absent without a report (one with an open wellbeing or
//   safeguarding case, so no automatic message will go out);
// - grade publishing by a publisher, with assessments waiting in the queue and three report cards to release.
// Safe to re-run: it does nothing when the school already has registers.
import type { AttendanceStatus, Prisma, PrismaClient } from "@prisma/client";
import type { SeedWorld } from "../demo";
import { at, dateOnly, isSchoolDay, rng } from "../lib";
import { execCtx, type Tx } from "@/server/db";
import { tenantDb } from "@/lib/tenant-db";
import { notify } from "@/server/notify/notify";
import { DEFAULT_CODES, statusOf } from "@/server/attendance/codes";
import { ensureFollowUpTemplates } from "@/server/attendance/followup";
import { runAttendanceAlerts } from "@/server/attendance/alerts";
import { generateReportCard } from "@/server/grades/report-card";

type World = Pick<SeedWorld, "db" | "orgId" | "now" | "staff" | "students" | "personas"> & Partial<Pick<SeedWorld, "log">>;

const DAY = 86_400_000;
const code = (c: string) => DEFAULT_CODES.find((x) => x.code === c)!;
const keyOf = (d: Date) => d.toISOString().slice(0, 10);

export async function seedAttendance(w: World) {
  const { db, orgId, now } = w;
  const log = w.log ?? (() => undefined);
  if ((await db.attendanceRegister.count({ where: { orgId } })) > 0) return;
  const year = await db.academicYear.findFirst({ where: { orgId, isCurrent: true }, include: { terms: { orderBy: { startsOn: "asc" } } } });
  if (!year) return;
  const r = rng(20261026);
  const staffId = (k: string) => w.staff.get(k)?.membershipId ?? null;
  const registrar = staffId("registrar_main") ?? w.personas.admin;
  const daniel = w.personas.teacher;

  // --- Settings ---------------------------------------------------------------------------------------------
  const heads: Record<string, string[]> = {};
  for (const g of [9, 10, 11, 12]) if (staffId("deputy_dsl_main")) heads[String(g)] = [staffId("deputy_dsl_main")!];
  for (const g of [6, 7, 8]) if (staffId("hod_humanities")) heads[String(g)] = [staffId("hod_humanities")!];
  await db.attendanceSettings.upsert({
    where: { orgId },
    create: { orgId, headsOfYear: heads, limitEnabled: true, limitConsecutive: 10, limitTotal: 15, limitWarnPct: 70, updatedById: w.personas.admin },
    update: { headsOfYear: heads, limitEnabled: true, limitConsecutive: 10, limitTotal: 15, limitWarnPct: 70 },
  });

  // --- Calendar: school days of the term so far (weekends and holidays left out) -----------------------------
  const term = year.terms.find((t) => t.startsOn.getTime() <= now.getTime() && now.getTime() <= t.endsOn.getTime() + DAY) ?? year.terms[0];
  const from = (term ?? year).startsOn;
  const holidays = new Set<string>();
  for (const e of await db.calendarEvent.findMany({ where: { orgId, kind: "HOLIDAY" }, select: { startsAt: true, endsAt: true } })) {
    for (let t = e.startsAt.getTime() + 4 * 3600_000; t < e.endsAt.getTime() + 4 * 3600_000; t += DAY) holidays.add(new Date(t).toISOString().slice(0, 10));
  }
  const pastDays: Array<{ offset: number; date: Date; key: string }> = [];
  for (let off = -1; off > -200; off--) {
    const date = dateOnly(off, now);
    if (date < from) break;
    if (!isSchoolDay(off, now) || holidays.has(keyOf(date))) continue;
    pastDays.unshift({ offset: off, date, key: keyOf(date) });
  }
  const todayDate = dateOnly(0, now);
  const todayIsSchool = isSchoolDay(0, now) && !holidays.has(keyOf(todayDate));
  if (!pastDays.length && !todayIsSchool) return;

  // --- Classes, enrollments, timetable ---------------------------------------------------------------------
  const classes = await db.schoolClass.findMany({ where: { orgId, academicYearId: year.id }, select: { id: true, nameEn: true, isHomeroom: true, gradeLevel: true, section: true, teacherMembershipId: true } });
  const enrollments = await db.enrollment.findMany({ where: { orgId, status: "ACTIVE", class: { academicYearId: year.id } }, select: { classId: true, studentId: true } });
  const slots = await db.timetableSlot.findMany({ where: { orgId, academicYearId: year.id }, select: { id: true, classId: true, teacherMembershipId: true, dayOfWeek: true, periodNo: true } });
  const bell = await db.bellPeriod.findMany({ where: { orgId, academicYearId: year.id }, select: { dayOfWeek: true, periodNo: true, startTime: true } });
  const covers = await db.coverAssignment.findMany({ where: { orgId, status: { in: ["ASSIGNED", "DONE"] } }, select: { id: true, slotId: true, date: true, substituteId: true } });
  const homerooms = classes.filter((c) => c.isHomeroom);
  const homeroomOf = new Map<string, (typeof classes)[number]>();
  for (const e of enrollments) {
    const c = homerooms.find((h) => h.id === e.classId);
    if (c) homeroomOf.set(e.studentId, c);
  }
  const studentsOf = (classId: string) => enrollments.filter((e) => e.classId === classId).map((e) => e.studentId);
  const startOf = (wd: number, p: number) => bell.find((b) => b.dayOfWeek === wd && b.periodNo === p)?.startTime ?? "07:30";
  const instant = (offset: number, hhmm: string, plusMin = 0) => {
    const [h, m] = hhmm.split(":").map(Number);
    return at(offset, h, m + plusMin, now);
  };

  // --- Who is who in the story -------------------------------------------------------------------------------
  const students = await db.student.findMany({ where: { orgId, status: "ACTIVE" }, select: { id: true, gradeLevel: true, section: true, studentNo: true, membershipId: true, firstNameEn: true, lastNameEn: true, firstNameAr: true, lastNameAr: true }, orderBy: { studentNo: "asc" } });
  const sensitive = new Set((await db.case.findMany({ where: { orgId, sensitivity: { in: ["WELLBEING", "SAFEGUARDING"] }, status: { notIn: ["RESOLVED", "CLOSED"] } }, select: { studentId: true } })).map((c) => c.studentId));
  const adam = w.students.find((s) => s.familyIndex === 0 && s.grade === 9)?.id;
  const yara = w.students.find((s) => s.familyIndex === 0 && s.grade === 6)?.id;
  const nineA = homerooms.find((h) => h.gradeLevel === 9 && h.section === "A");
  const inNineA = new Set(nineA ? studentsOf(nineA.id) : []);
  const ordinary = students.filter((s) => s.id !== adam && s.id !== yara && !sensitive.has(s.id) && !inNineA.has(s.id));
  const pick = (g: number, skip: Set<string>) => ordinary.find((s) => s.gradeLevel === g && !skip.has(s.id));
  const used = new Set<string>();
  const take = (s: (typeof students)[number] | undefined) => (s ? (used.add(s.id), s) : undefined);
  const persistent = take(pick(10, used)); // near the regulator limit, 70s percent
  const persistent2 = take(pick(12, used)); // just under 90 percent, mostly authorised
  const lateLovers = [take(pick(7, used)), take(pick(11, used)), take(pick(8, used))].filter(Boolean) as typeof students;
  const often = [take(pick(6, used)), take(pick(9, used)), take(pick(12, used)), take(pick(10, used))].filter(Boolean) as typeof students;
  const heldToday = students.find((s) => sensitive.has(s.id) && !inNineA.has(s.id) && s.id !== adam);
  const heldYesterday = students.find((s) => sensitive.has(s.id) && s.id !== heldToday?.id && !inNineA.has(s.id) && s.id !== adam);
  const absentToday = [persistent, take(pick(11, used)), heldToday, take(pick(6, used))].filter(Boolean) as typeof students;
  const yesterdayIll = take(pick(8, used));
  const yesterdayTruant = take(pick(11, used));

  // Existing marks (absence reports approved in the history) are kept as they are.
  const existing = new Set((await db.attendanceRecord.findMany({ where: { orgId }, select: { studentId: true, date: true } })).map((x) => `${x.studentId}|${keyOf(x.date)}`));

  // --- Daily marks for the past school days ------------------------------------------------------------------
  type Mark = { code: string; minutesLate: number | null; source: "REGISTER" | "OFFICE"; markedById: string | null };
  const daily = new Map<string, Mark>(); // studentId|dayKey
  const busDay = pastDays[Math.max(0, pastDays.length - 12)]?.key;
  const tripDay = pastDays[Math.max(0, pastDays.length - 16)]?.key;
  const busKids = new Set(ordinary.filter((s) => s.gradeLevel <= 8).slice(0, 6).map((s) => s.id));
  const persistentDays = new Set<string>();
  if (persistent) {
    // Eleven unexcused school days, the longest run three, plus one illness: about 72% this term.
    const picks = [3, 4, 5, 9, 14, 15, 21, 26, 30, 31, 37].map((i) => pastDays[Math.min(pastDays.length - 1, i)]?.key).filter(Boolean) as string[];
    for (const k of picks) persistentDays.add(k);
  }
  const persistent2Days = new Map([2, 11, 19, 27, 33].map((i, j) => [pastDays[Math.min(pastDays.length - 1, i)]?.key, ["I", "M", "I", "U", "E"][j]]));
  for (const day of pastDays) {
    for (const s of students) {
      const k = `${s.id}|${day.key}`;
      if (existing.has(k)) continue;
      const tutor = homeroomOf.get(s.id)?.teacherMembershipId ?? null;
      const roll = r.next();
      let c = "P";
      let minutes: number | null = null;
      let source: Mark["source"] = "REGISTER";
      let by = tutor;
      if (s.id === persistent?.id && persistentDays.has(day.key)) c = "U";
      else if (s.id === persistent?.id && day.key === pastDays[Math.min(pastDays.length - 1, 18)]?.key) c = "I";
      else if (s.id === persistent2?.id && persistent2Days.has(day.key)) c = persistent2Days.get(day.key)!;
      else if (lateLovers.some((x) => x.id === s.id) && roll < 0.22) c = "L";
      else if (often.some((x) => x.id === s.id) && roll < 0.06) c = "I";
      else if (day.key === busDay && busKids.has(s.id)) c = "LB";
      else if (day.key === tripDay && s.gradeLevel === 11) c = "SA";
      else if (roll < 0.022) c = "L";
      else if (roll < 0.03) c = "I";
      else if (roll < 0.034) c = "M";
      else if (roll < 0.036) c = "E";
      else if (roll < 0.0375 && s.id !== adam) c = "U";
      if (s.id === adam && c !== "P" && c !== "L") c = "P";
      if (yesterdayIll && s.id === yesterdayIll.id && day === pastDays[pastDays.length - 1]) c = "I";
      if (yesterdayTruant && s.id === yesterdayTruant.id && day === pastDays[pastDays.length - 1]) c = "U";
      if (heldYesterday && s.id === heldYesterday.id && day === pastDays[pastDays.length - 1]) c = "A";
      if (c === "L") minutes = r.int(4, 22);
      // Absences the teacher marked "A" are explained later by the office.
      if (["I", "M", "U", "F"].includes(c)) {
        source = "OFFICE";
        by = registrar;
      }
      daily.set(k, { code: c, minutesLate: minutes, source, markedById: by });
    }
  }
  const recordRows: Prisma.AttendanceRecordCreateManyInput[] = [];
  for (const [k, m] of daily) {
    const [studentId, dk] = k.split("|");
    recordRows.push({ orgId, studentId, date: new Date(`${dk}T00:00:00Z`), status: statusOf(code(m.code)), code: m.code, minutesLate: m.minutesLate, source: m.source, markedById: m.markedById });
  }
  for (let i = 0; i < recordRows.length; i += 4000) await db.attendanceRecord.createMany({ data: recordRows.slice(i, i + 4000), skipDuplicates: true });
  // The marks from approved absence reports get the plain excused code.
  await db.attendanceRecord.updateMany({ where: { orgId, code: null, status: "EXCUSED" }, data: { code: "E" } });
  await db.attendanceRecord.updateMany({ where: { orgId, code: null, status: "PRESENT" }, data: { code: "P" } });

  // Daily registers (one per homeroom and day), taken by the homeroom teacher a few minutes after registration.
  const regRows: Prisma.AttendanceRegisterCreateManyInput[] = [];
  for (const day of pastDays) {
    for (const h of homerooms) regRows.push({ orgId, kind: "DAILY", classId: h.id, date: day.date, periodNo: 0, takenById: h.teacherMembershipId, takenAt: instant(day.offset, "07:30", 3 + r.int(0, 9)) });
  }

  // --- Lesson marks for the past school days -----------------------------------------------------------------
  const allMarks = new Map<string, { code: string; status: AttendanceStatus }>();
  for (const rec of await db.attendanceRecord.findMany({ where: { orgId, date: { gte: from } }, select: { studentId: true, date: true, code: true, status: true } })) allMarks.set(`${rec.studentId}|${keyOf(rec.date)}`, { code: rec.code ?? (rec.status === "EXCUSED" ? "E" : "P"), status: rec.status });
  const lessonGrades = new Set(classes.filter((c) => c.gradeLevel > 0).map((c) => c.id));
  const lessonRegs: Array<{ id: string; row: Prisma.AttendanceRegisterCreateManyInput; marks: Prisma.AttendanceLessonMarkCreateManyInput[] }> = [];
  const lessonFor = (day: { offset: number; date: Date; key: string }, slot: (typeof slots)[number]) => {
    const cover = covers.find((c) => c.slotId === slot.id && keyOf(c.date) === day.key);
    const teacher = cover?.substituteId ?? slot.teacherMembershipId;
    const id = `alr${(lessonRegs.length + 1).toString(36)}${r.int(100000, 999999).toString(36)}`.slice(0, 25);
    const marks: Prisma.AttendanceLessonMarkCreateManyInput[] = [];
    for (const sid of studentsOf(slot.classId)) {
      const d = allMarks.get(`${sid}|${day.key}`);
      let c = d && (code(d.code)?.countsAs !== "PRESENT" || d.code === "SA") ? d.code : "P";
      let minutes: number | null = null;
      const roll = r.next();
      if (c === "P" && roll < 0.008) {
        c = "L";
        minutes = r.int(2, 8);
      }
      const def = code(c) ?? code("P");
      marks.push({ orgId, registerId: id, studentId: sid, date: day.date, code: def.code, status: statusOf(def), minutesLate: minutes, source: "REGISTER", markedById: teacher });
    }
    return { id, row: { id, orgId, kind: "LESSON" as const, classId: slot.classId, date: day.date, periodNo: slot.periodNo, slotId: slot.id, coverId: cover?.id ?? null, takenById: teacher, takenAt: instant(day.offset, startOf(day.date.getUTCDay(), slot.periodNo), 2 + r.int(0, 5)) }, marks };
  };
  for (const day of pastDays) {
    const wd = day.date.getUTCDay();
    for (const s of slots.filter((x) => x.dayOfWeek === wd && lessonGrades.has(x.classId))) lessonRegs.push(lessonFor(day, s));
  }

  // --- Today ------------------------------------------------------------------------------------------------
  const todayRecords: Prisma.AttendanceRecordCreateManyInput[] = [];
  const todayKey = keyOf(todayDate);
  const notTaken = new Set([nineA?.id, homerooms.find((h) => h.gradeLevel === 7 && h.section === "B")?.id].filter(Boolean) as string[]);
  if (todayIsSchool) {
    for (const h of homerooms) {
      if (notTaken.has(h.id)) continue;
      const takenAt = new Date(Math.min(now.getTime(), instant(0, "07:30", 4 + r.int(0, 8)).getTime()));
      regRows.push({ orgId, kind: "DAILY", classId: h.id, date: todayDate, periodNo: 0, takenById: h.teacherMembershipId, takenAt });
      for (const sid of studentsOf(h.id)) {
        if (existing.has(`${sid}|${todayKey}`)) continue;
        const roll = r.next();
        let c = absentToday.some((x) => x.id === sid) ? "A" : lateLovers.some((x) => x.id === sid) && roll < 0.5 ? "L" : roll < 0.03 ? "L" : "P";
        if (sid === adam) c = "P";
        todayRecords.push({ orgId, studentId: sid, date: todayDate, status: statusOf(code(c)), code: c, minutesLate: c === "L" ? r.int(3, 18) : null, markedById: h.teacherMembershipId });
        allMarks.set(`${sid}|${todayKey}`, { code: c, status: statusOf(code(c)) });
      }
    }
    // Lessons that have started by mid-morning, except Daniel Carter's (left for the live demo).
    const wd = todayDate.getUTCDay();
    const today = { offset: 0, date: todayDate, key: todayKey };
    for (const s of slots.filter((x) => x.dayOfWeek === wd && lessonGrades.has(x.classId) && x.teacherMembershipId !== daniel && startOf(wd, x.periodNo) <= "10:00")) {
      const cover = covers.find((c) => c.slotId === s.id && keyOf(c.date) === todayKey);
      if (cover?.substituteId === daniel) continue;
      lessonRegs.push(lessonFor(today, s));
    }
  }
  await db.attendanceRecord.createMany({ data: todayRecords, skipDuplicates: true });
  await db.attendanceRegister.createMany({ data: regRows, skipDuplicates: true });
  for (let i = 0; i < lessonRegs.length; i += 1000) await db.attendanceRegister.createMany({ data: lessonRegs.slice(i, i + 1000).map((x) => x.row), skipDuplicates: true });
  const markRows = lessonRegs.flatMap((x) => x.marks);
  for (let i = 0; i < markRows.length; i += 5000) await db.attendanceLessonMark.createMany({ data: markRows.slice(i, i + 5000), skipDuplicates: true });
  log(`attendance: ${pastDays.length} school days, ${recordRows.length + todayRecords.length} daily marks, ${lessonRegs.length} lesson registers, ${markRows.length} lesson marks`);

  // --- Follow-up: yesterday's story and today's open absences -------------------------------------------------
  const tx = db as unknown as Tx;
  await ensureFollowUpTemplates(tx, orgId);
  const yesterday = pastDays[pastDays.length - 1];
  const nameOf = (s: (typeof students)[number]) => ({ en: `${s.firstNameEn} ${s.lastNameEn}`, ar: `${s.firstNameAr} ${s.lastNameAr}` });
  const guardiansOf = async (sid: string) => (await db.guardianLink.findMany({ where: { orgId, studentId: sid, receivesUpdates: true }, select: { guardian: { select: { membershipId: true } } } })).map((g) => g.guardian.membershipId).filter(Boolean) as string[];
  const office = (await db.membership.findMany({ where: { orgId, status: "ACTIVE", roles: { some: { role: { permissions: { has: "attendance.manage" } } } } }, select: { id: true } })).map((m) => m.id);
  const dateText = (k: string) => ({
    en: new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${k}T00:00:00Z`)),
    ar: new Intl.DateTimeFormat("ar-AE-u-nu-latn", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${k}T00:00:00Z`)),
  });
  const autoMessage = async (s: (typeof students)[number], day: { offset: number; key: string }, followUpId: string) => {
    const when = instant(day.offset, "09:30", 1);
    await notify(execCtx(tx, orgId, { now: when, quiet: true }), { recipients: await guardiansOf(s.id), templateKey: "attendance_unexplained", kind: "attendance_unexplained", vars: { student: nameOf(s), date: dateText(day.key) }, href: `/children/${s.id}`, idempotencyBase: `att-unexplained:${s.id}:${day.key}` });
    await db.attendanceContact.create({ data: { orgId, followUpId, kind: "AUTO_MESSAGE", createdAt: when } });
  };
  if (yesterday) {
    if (yesterdayIll) {
      const f = await db.attendanceFollowUp.create({ data: { orgId, studentId: yesterdayIll.id, date: yesterday.date, status: "EXPLAINED", notifiedAt: instant(yesterday.offset, "09:30", 1), explainedCode: "I", explainedById: registrar, explainedAt: instant(yesterday.offset, "09:52"), createdAt: instant(yesterday.offset, "07:36") } });
      await autoMessage(yesterdayIll, yesterday, f.id);
      await db.attendanceContact.create({ data: { orgId, followUpId: f.id, kind: "CALL", outcome: "REACHED", note: "Mother called back: fever since last night, staying home today.", byId: registrar, createdAt: instant(yesterday.offset, "09:50") } });
    }
    if (yesterdayTruant) {
      const f = await db.attendanceFollowUp.create({ data: { orgId, studentId: yesterdayTruant.id, date: yesterday.date, status: "EXPLAINED", notifiedAt: instant(yesterday.offset, "09:30", 1), explainedCode: "U", explainedById: registrar, explainedAt: instant(yesterday.offset, "11:20"), createdAt: instant(yesterday.offset, "07:38") } });
      await autoMessage(yesterdayTruant, yesterday, f.id);
      await db.attendanceContact.create({ data: { orgId, followUpId: f.id, kind: "CALL", outcome: "NO_ANSWER", byId: registrar, createdAt: instant(yesterday.offset, "10:05") } });
      await db.attendanceContact.create({ data: { orgId, followUpId: f.id, kind: "CALL", outcome: "REACHED", note: "Father: the family stayed an extra day after a weekend trip. No leave was requested, so it is recorded as unauthorised.", byId: registrar, createdAt: instant(yesterday.offset, "11:15") } });
    }
    if (heldYesterday) {
      const f = await db.attendanceFollowUp.create({ data: { orgId, studentId: heldYesterday.id, date: yesterday.date, status: "CONTACTED", heldReason: "HELD", createdAt: instant(yesterday.offset, "07:40") } });
      await notify(execCtx(tx, orgId, { now: instant(yesterday.offset, "09:30", 1), quiet: true }), { recipients: office, templateKey: "attendance_contact_by_hand", kind: "attendance_contact_by_hand", vars: { student: nameOf(heldYesterday) }, href: `/attendance/office?date=${yesterday.key}`, channels: ["IN_APP"], idempotencyBase: `att-held:${heldYesterday.id}:${yesterday.key}` });
      await db.attendanceContact.create({
        data: { orgId, followUpId: f.id, kind: "MESSAGE", note: "Good morning. We noticed your child is not in school today. Please let the attendance office know if everything is all right.", reason: "Checked with the student's support lead first: a short message from the office is appropriate.", byId: registrar, createdAt: instant(yesterday.offset, "10:10") },
      });
    }
  }
  if (todayIsSchool) {
    await db.attendanceFollowUp.createMany({ data: absentToday.map((s) => ({ orgId, studentId: s.id, date: todayDate, createdAt: new Date(Math.min(now.getTime(), instant(0, "07:40").getTime())) })), skipDuplicates: true });
    const called = absentToday[1];
    if (called) {
      const f = await db.attendanceFollowUp.findFirst({ where: { orgId, studentId: called.id, date: todayDate } });
      if (f) {
        await db.attendanceFollowUp.update({ where: { id: f.id }, data: { status: "CONTACTED" } });
        await db.attendanceContact.create({ data: { orgId, followUpId: f.id, kind: "CALL", outcome: "NO_ANSWER", byId: registrar, createdAt: new Date(Math.min(now.getTime(), instant(0, "08:40").getTime())) } });
      }
    }
  }

  // --- Staff alerts (persistent absence, regulator limit), recorded without sending -------------------------
  try {
    await runAttendanceAlerts(orgId, { now, quiet: true, flush: async () => undefined });
  } catch {
    // The tenant connection is not available in every seed context; the hourly job raises the alerts instead.
  }

  await seedPublishing(w, db, year.id);
}

/** Grades: the demo school releases grades through a publisher (the Head of IT). */
async function seedPublishing(w: World, db: PrismaClient, yearId: string) {
  const { orgId, now } = w;
  await db.gradeSettings.upsert({ where: { orgId }, create: { orgId, publishMode: "PUBLISHER", updatedById: w.personas.admin }, update: { publishMode: "PUBLISHER" } });
  const daniel = w.personas.teacher;
  const classes = await db.schoolClass.findMany({ where: { orgId, academicYearId: yearId, isHomeroom: false }, select: { id: true, teacherMembershipId: true, gradeLevel: true } });
  // The latest assessment in a handful of classes (different teachers) has not gone out yet: it waits for release.
  const byTeacher = new Map<string, string>();
  // One class per grade where possible, each with a different teacher, so the queue shows the whole school.
  for (const grade of [9, 10, 11, 12, 8, 7, 6]) {
    const c = classes.find((x) => x.gradeLevel === grade && x.teacherMembershipId && x.teacherMembershipId !== daniel && !byTeacher.has(x.teacherMembershipId));
    if (c && byTeacher.size < 6) byTeacher.set(c.teacherMembershipId!, c.id);
  }
  let ready = 0;
  for (const [teacher, classId] of byTeacher) {
    const a = await db.assessment.findFirst({ where: { orgId, classId, publishedAt: { not: null } }, orderBy: { publishedAt: "desc" } });
    if (!a) continue;
    await db.assessment.update({ where: { id: a.id }, data: { publishedAt: null, publishedById: null, readyAt: new Date(now.getTime() - (1 + ready) * 5 * 3600_000), readyById: teacher } });
    await db.notification.deleteMany({ where: { orgId, kind: "grade_published", href: { contains: `assessment=${a.id}` } } });
    ready++;
  }
  // Earlier releases were made by the publisher.
  const it = w.personas.head_of_it ?? null;
  if (it) await db.assessment.updateMany({ where: { orgId, publishedAt: { not: null }, publishedById: null }, data: { publishedById: it } });

  // Three interim report cards made by Daniel for his homeroom, waiting for release.
  try {
    const termId = (await db.term.findFirst({ where: { orgId, academicYearId: yearId, startsOn: { lte: now } }, orderBy: { startsOn: "desc" }, select: { id: true } }))?.id;
    const physics = classes.find((c) => c.teacherMembershipId === daniel);
    if (termId && physics) {
      const ids = (await db.enrollment.findMany({ where: { orgId, classId: physics.id, status: "ACTIVE" }, select: { studentId: true }, take: 3, orderBy: { studentId: "asc" } })).map((e) => e.studentId);
      const v = { db: tenantDb(orgId), orgId, membershipId: daniel, roles: ["teacher"], isStudent: false, isParent: false, can: (p: string) => p === "grades.enter", familyStudentIds: [] };
      for (const sid of ids) await generateReportCard(v as never, sid, termId);
    }
  } catch {
    // Without the tenant connection the report cards are left out; the queue then shows assessments only.
  }
}
