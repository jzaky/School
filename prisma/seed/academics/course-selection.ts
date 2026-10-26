// Demo data for course selection windows, exceptions, class sessions and assisted choosing.
// - School rules: parents choose only when allowed, and a parent signs choices off.
// - Next year's offerings for the British track (Grades 10 to 12) and for every track in Grades 7 to 9,
//   so every student in the windows below has something to choose.
// - Windows: this year's spring registration (closed months ago), Grade 12 add and drop (closed two weeks
//   ago), next year's Round 1 for Grades 9 to 11 (open, closes in 5 days) and Grades 6 to 8 (opens in 10 days).
// - Progress: most Grade 9 to 11 students have chosen; some are still choosing or have not started.
//   Adam has not chosen yet.
// - Adam allowed his mother Rania to help; a Grade 10 student allowed Sarah Ahmed (counselor); Daniel Carter
//   turned on assisted choosing for a Homeroom 9A student without a phone; a Grade 12 student has a
//   late-change exception from Layla Hassan; Homeroom 9A has a class choosing session running now.
// - Notices that went out when the windows opened and when Grade 12 add and drop closed.
// Safe to re-run: rows are looked up first (windows by year and round, grants by student and helper,
// the session by class and day) and notices are claimed in the JobRun ledger.
import type { Prisma, PrismaClient, RegistrationSource } from "@prisma/client";
import type { SeedWorld } from "../demo";
import { at } from "../lib";
import { blocksOf, missingPrerequisites } from "@/lib/registration";
import { execCtx } from "@/server/db";
import { currentYear, offeringsFor, priorSubjectCodes, saveRegistration, selectionYear } from "@/server/registration/service";
import { grantException, grantHelper, saveWindow, type SelectionActor } from "@/server/registration/selection";
import { windowLabels } from "@/server/registration/selection-labels";
import { selectionNoticesTx } from "@/server/registration/selection-notices";
import { ensureSelectionTemplates } from "@/server/registration/selection-templates";
import { upper, type OfferingSpec } from "./registration";

/** Next year's Grades 7 and 8: core subjects, plus a technology or arts block and a language or humanities block. */
const MIDDLE: OfferingSpec[] = [
  { code: "MATH", kind: "CORE", periods: 6 },
  { code: "ENG", kind: "CORE", periods: 5 },
  { code: "ARAB", kind: "CORE", periods: 5 },
  { code: "ISL", kind: "CORE", periods: 2 },
  { code: "SOC", kind: "CORE", periods: 2 },
  { code: "BIO", kind: "CORE", periods: 3 },
  { code: "PE", kind: "CORE", periods: 2 },
  { code: "CS", kind: "OPTION", block: "A", periods: 2, notes: { en: "Block coding first, then Python.", ar: "البرمجة بالكتل أولاً ثم بلغة بايثون." } },
  { code: "DT", kind: "OPTION", block: "A", periods: 2 },
  { code: "MUSIC", kind: "OPTION", block: "A", periods: 2 },
  { code: "FR", kind: "OPTION", block: "B", periods: 2 },
  { code: "ART", kind: "OPTION", block: "B", periods: 2 },
  { code: "GEO", kind: "OPTION", block: "B", periods: 2 },
];

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const staffActor = (membershipId: string): SelectionActor => ({ membershipId, userId: null, isStudent: false, isParent: false, isStaff: true, can: () => true, ownStudentId: null, childIds: [] });

export async function seedCourseSelection(w: SeedWorld) {
  await seedCourseSelectionFor(w.db, w.orgId, w.now, w.log);
}

export async function seedCourseSelectionFor(db: PrismaClient, orgId: string, now: Date, log: (m: string) => void = () => undefined) {
  const tx = db as unknown as Prisma.TransactionClient;
  const current = await currentYear(tx, orgId);
  const next = current ? await selectionYear(tx, orgId) : null;
  if (!current) return;
  const persona = async (key: string) => (await db.demoPersona.findFirst({ where: { orgId, key } }))?.membershipId ?? null;
  const [registrar, teacher, counselor, advisor, adamMember, raniaMember] = await Promise.all(["registrar", "teacher", "counselor", "career_advisor", "student", "parent"].map(persona));
  const office = registrar ?? (await persona("admin"));
  if (!office) return;
  await ensureSelectionTemplates(tx, orgId);

  // 1. School rules (kept when an admin has changed them).
  await db.courseSelectionSettings.upsert({ where: { orgId }, create: { orgId, parentChoice: "WHEN_ALLOWED", signOffRequired: true, parentChoiceSignsOff: true, updatedById: office }, update: {} });

  // 2. Next year's offerings for the British track and for Grades 7 to 9.
  const subjects = new Map((await db.subject.findMany({ where: { orgId } })).map((s) => [s.code, s]));
  if (next) {
    const rows: Prisma.SubjectOfferingCreateManyInput[] = [];
    const add = (grade: number, specs: OfferingSpec[], curriculum: "BRITISH" | null) => {
      for (const o of specs) {
        const s = subjects.get(o.code);
        if (!s) continue;
        rows.push({ orgId, academicYearId: next.id, subjectId: s.id, gradeLevel: grade, kind: o.kind, optionBlock: o.block ?? null, prerequisites: o.prereq ?? [], periodsPerWeek: o.periods, notesEn: o.notes?.en ?? null, notesAr: o.notes?.ar ?? null, curriculum, createdAt: at(-26, 10, 0, now) });
      }
    };
    for (const g of [10, 11, 12]) add(g, upper(g), "BRITISH");
    add(7, MIDDLE, null);
    add(8, MIDDLE, null);
    add(9, upper(9), null);
    await db.subjectOffering.createMany({ data: rows, skipDuplicates: true });
  }

  // 3. Windows, looked up by year and round so a re-run changes nothing.
  const window = async (yearId: string, gradeLevels: number[], roundEn: string, roundAr: string, opensAt: Date, closesAt: Date, createdAt: Date) => {
    const found = await db.courseSelectionWindow.findFirst({ where: { orgId, academicYearId: yearId, roundEn } });
    if (found) return found;
    const res = await saveWindow(tx, orgId, staffActor(office), { academicYearId: yearId, gradeLevels, opensAt, closesAt, roundEn, roundAr }, windowLabels);
    if (!res.ok) throw new Error(`course selection seed: window ${roundEn} ${res.error}`);
    const row = await db.courseSelectionWindow.update({ where: { id: res.id }, data: { createdAt, updatedAt: createdAt } });
    if (row.calendarEventId) await db.calendarEvent.update({ where: { id: row.calendarEventId }, data: { createdAt } });
    await db.auditEvent.updateMany({ where: { orgId, entityId: row.id }, data: { createdAt } });
    return row;
  };
  // Deadline-only windows carried over from before rounds existed are replaced by the ones below.
  await db.courseSelectionWindow.deleteMany({ where: { orgId, roundEn: null } });
  await window(current.id, [6, 7, 8, 9, 10, 11], "Spring registration", "تسجيل الربيع", at(-165, 8, 0, now), at(-120, 15, 0, now), at(-172, 11, 0, now));
  const g12 = await window(current.id, [12], "Grade 12 add and drop", "الإضافة والحذف للصف 12", at(-30, 8, 0, now), at(-14, 15, 0, now), at(-33, 9, 15, now));
  const round1 = next ? await window(next.id, [9, 10, 11], "Round 1", "الجولة الأولى", at(-18, 8, 0, now), at(5, 15, 0, now), at(-25, 10, 30, now)) : null;
  if (next) await window(next.id, [6, 7, 8], "Round 1, Grades 6 to 8", "الجولة الأولى للصفوف 6 إلى 8", at(10, 8, 0, now), at(24, 15, 0, now), at(-3, 13, 0, now));
  // Calendar events left by deadline-only windows (no window points at them any more) are removed.
  const linked = (await db.courseSelectionWindow.findMany({ where: { orgId }, select: { calendarEventId: true } })).map((x) => x.calendarEventId).filter((x): x is string => !!x);
  await db.calendarEvent.deleteMany({ where: { orgId, kind: "DEADLINE", audience: { has: "registration_window" }, id: { notIn: linked } } });

  // 4. Notices that went out at the time (claimed in the ledger, so the worker never repeats them).
  const history = [g12.opensAt, round1?.opensAt, new Date(g12.closesAt.getTime() - 70 * 3_600_000), new Date(g12.closesAt.getTime() - 20 * 3_600_000), g12.closesAt]
    .filter((d): d is Date => !!d)
    .map((d) => new Date(d.getTime() + 5 * 60_000))
    .sort((a, b) => a.getTime() - b.getTime());

  // 5. Next year's choices for Grades 9 to 11 (before the notices, so the open notice reaches everyone).
  let chosen = 0;
  const signOffRequired = true;
  if (next && round1) {
    const students = await db.student.findMany({
      where: { orgId, status: "ACTIVE", gradeLevel: { in: round1.gradeLevels } },
      include: { guardians: { include: { guardian: { select: { membershipId: true } } }, orderBy: { isPrimary: "desc" } } },
      orderBy: { studentNo: "asc" },
    });
    const personaStudents = new Set([adamMember].filter(Boolean));
    for (const s of students) {
      if (s.membershipId && personaStudents.has(s.membershipId)) continue;
      const offerings = await offeringsFor(tx, orgId, next.id, s.gradeLevel + 1, s.curriculum);
      if (!offerings.length) continue;
      const existing = await db.courseSelectionSubmission.findUnique({ where: { academicYearId_studentId: { academicYearId: next.id, studentId: s.id } } });
      if (existing) continue;
      const h = hash(`${s.id}:round1`);
      const guardian = s.guardians.find((l) => l.guardian.membershipId)?.guardian.membershipId ?? null;
      const regs = await db.subjectRegistration.findMany({ where: { orgId, academicYearId: next.id, studentId: s.id, status: { in: ["REQUESTED", "ALLOCATED", "WAITLISTED"] } } });
      const blocks = blocksOf(offerings);
      let when = at(-17 + (h % 16), 15 + (h % 6), (h >> 5) % 60, now);
      let source: RegistrationSource = regs[0]?.source ?? (h % 4 === 0 && guardian ? "PARENT" : "STUDENT");
      let actor = source === "PARENT" ? guardian : s.membershipId;
      let picked = blocks.filter((b) => b.options.some((o) => regs.some((r) => r.subjectId === o.subjectId))).length;
      const bucket = h % 20;
      if (!regs.length) {
        // 3 in 20 have not started; 3 in 20 are part way through.
        if (bucket < 3) continue;
        const partial = bucket < 6;
        const prior = await priorSubjectCodes(tx, orgId, s.id, next);
        const taking = new Set(offerings.filter((o) => o.kind === "CORE").map((o) => o.code.toUpperCase()));
        const picks: string[] = [];
        for (const b of partial ? blocks.slice(0, 1 + (h % 2)) : blocks) {
          const ordered = [...b.options].sort((x, y) => (hash(`${s.id}:${x.code}`) % 97) - (hash(`${s.id}:${y.code}`) % 97));
          const ok = ordered.find((o) => missingPrerequisites(o, taking, prior).length === 0);
          if (ok) {
            picks.push(ok.subjectId);
            taking.add(ok.code.toUpperCase());
          }
        }
        source = h % 4 === 0 && guardian ? "PARENT" : s.membershipId ? "STUDENT" : "STAFF";
        actor = source === "PARENT" ? guardian : source === "STUDENT" ? s.membershipId : office;
        const res = await saveRegistration(tx, orgId, { studentId: s.id, optionSubjectIds: picks, source, actorId: actor, academicYearId: next.id, requireAllBlocks: !partial, now: when });
        if (!res.ok) continue;
        await db.subjectRegistration.updateMany({ where: { orgId, academicYearId: next.id, studentId: s.id }, data: { createdAt: when, updatedAt: when, chosenAt: when } });
        picked = partial ? picks.length : blocks.length;
      } else {
        when = regs.reduce((a, r) => (r.createdAt > a ? r.createdAt : a), regs[0].createdAt);
        actor = regs[0].createdById ?? actor;
        await db.subjectRegistration.updateMany({ where: { orgId, academicYearId: next.id, studentId: s.id, chosenAt: null }, data: { chosenAt: when } });
      }
      const complete = picked >= blocks.length;
      // Of the complete ones, a parent has signed off about two in three; a parent's own choices count as sign-off.
      const signed = complete && signOffRequired && (source === "PARENT" || h % 3 !== 0);
      const signer = source === "PARENT" ? actor : guardian;
      await db.courseSelectionSubmission.create({
        data: {
          orgId,
          studentId: s.id,
          academicYearId: next.id,
          status: !complete ? "DRAFT" : signed && signer ? "SIGNED_OFF" : "SUBMITTED",
          lastById: actor,
          lastSource: source,
          onBehalf: source !== "STUDENT",
          lastAt: when,
          submittedAt: complete ? when : null,
          signedOffAt: signed && signer ? new Date(when.getTime() + (source === "PARENT" ? 0 : (6 + (h % 30)) * 3_600_000)) : null,
          signedOffById: signed && signer ? signer : null,
          createdAt: when,
        },
      });
      chosen++;
    }
  }

  const ec = (d: Date) => execCtx(tx, orgId, { now: d, quiet: true });
  let notices = 0;
  for (const d of history) {
    if (d.getTime() > now.getTime()) continue;
    const c = await selectionNoticesTx(ec(d));
    notices += c.open + c.reminders + c.summaries;
  }

  // 6. Assisted choosing and a late change.
  const grants: string[] = [];
  const adam = adamMember ? await db.student.findFirst({ where: { orgId, membershipId: adamMember } }) : null;
  if (adam && raniaMember && round1 && !(await db.courseSelectionHelper.findFirst({ where: { orgId, studentId: adam.id, helperId: raniaMember } }))) {
    const r = await grantHelper(tx, orgId, { membershipId: adamMember!, userId: null, isStudent: true, isParent: false, isStaff: false, can: () => true, ownStudentId: adam.id, childIds: [] }, { studentId: adam.id, helperId: raniaMember, until: round1.closesAt }, ec(at(-2, 19, 40, now)));
    if (r.ok) grants.push(r.id);
  }
  if (next && round1 && counselor) {
    // A Grade 10 student who has not started asks the counselor to help.
    const g10 = await db.student.findMany({ where: { orgId, status: "ACTIVE", gradeLevel: 10, membershipId: { not: null } }, orderBy: { studentNo: "asc" } });
    const done = new Set((await db.courseSelectionSubmission.findMany({ where: { orgId, academicYearId: next.id }, select: { studentId: true } })).map((x) => x.studentId));
    const pick = g10.find((s) => !done.has(s.id)) ?? null;
    if (pick && !(await db.courseSelectionHelper.findFirst({ where: { orgId, studentId: pick.id, helperId: counselor } }))) {
      const r = await grantHelper(tx, orgId, { membershipId: pick.membershipId!, userId: null, isStudent: true, isParent: false, isStaff: false, can: () => true, ownStudentId: pick.id, childIds: [] }, { studentId: pick.id, helperId: counselor }, ec(at(-1, 13, 5, now)));
      if (r.ok) grants.push(r.id);
    }
  }
  const homeroom9A = teacher ? await db.schoolClass.findFirst({ where: { orgId, academicYearId: current.id, isHomeroom: true, teacherMembershipId: teacher }, orderBy: { section: "asc" } }) : null;
  if (next && teacher && homeroom9A) {
    // Daniel Carter chooses with a 9A student who has no phone at home.
    const roster = await db.enrollment.findMany({ where: { orgId, classId: homeroom9A.id }, include: { student: true }, orderBy: { student: { studentNo: "desc" } } });
    const done = new Set((await db.courseSelectionSubmission.findMany({ where: { orgId, academicYearId: next.id }, select: { studentId: true } })).map((x) => x.studentId));
    const pick = roster.map((r) => r.student).find((s) => s.membershipId !== adamMember && !done.has(s.id)) ?? null;
    if (pick && !(await db.courseSelectionHelper.findFirst({ where: { orgId, studentId: pick.id, helperId: teacher } }))) {
      const r = await grantHelper(tx, orgId, { ...staffActor(teacher), can: (p) => p === "registration.assist" }, { studentId: pick.id, helperId: teacher, reason: "No phone at home. We choose together in homeroom." }, ec(at(-4, 8, 10, now)));
      if (r.ok) grants.push(r.id);
    }
  }
  if (advisor) {
    const g12students = await db.student.findMany({ where: { orgId, status: "ACTIVE", gradeLevel: 12 }, orderBy: { studentNo: "asc" } });
    const pick = g12students[1] ?? g12students[0];
    if (pick && !(await db.courseSelectionException.findFirst({ where: { orgId, studentId: pick.id } }))) {
      const r = await grantException(tx, orgId, staffActor(advisor), { studentId: pick.id, yearId: current.id, until: at(3, 15, 0, now), reason: "Moving from Biology to Economics after university advice. Economics has a place in Round 2." }, ec(at(-1, 10, 20, now)));
      if (r.ok) grants.push(r.id);
    }
  }
  for (const id of grants) {
    const row = (await db.courseSelectionHelper.findFirst({ where: { id } })) ?? (await db.courseSelectionException.findFirst({ where: { id } }));
    if (row) await db.auditEvent.updateMany({ where: { orgId, entityId: id }, data: { createdAt: row.createdAt } });
  }

  // 7. Homeroom 9A is choosing together now, until the end of the school day (at least 45 minutes).
  if (next && teacher && homeroom9A) {
    const today = at(0, 0, 0, now);
    const running = await db.courseSelectionSession.findFirst({ where: { orgId, classId: homeroom9A.id, createdAt: { gte: today } } });
    if (!running) {
      const startsAt = new Date(now.getTime() - 12 * 60_000);
      const endOfDay = at(0, 15, 0, now);
      const endsAt = endOfDay.getTime() - now.getTime() >= 45 * 60_000 ? endOfDay : new Date(now.getTime() + 45 * 60_000);
      const code = `9A${(hash(`${orgId}:${today.toISOString()}`) % 9000) + 1000}`;
      const s = await db.courseSelectionSession.create({ data: { orgId, classId: homeroom9A.id, academicYearId: next.id, code, startsAt, endsAt, startedById: teacher, createdAt: startsAt } });
      await db.auditEvent.create({ data: { orgId, actorId: teacher, action: "registration.session_start", entityType: "CourseSelectionSession", entityId: s.id, meta: { classId: homeroom9A.id, yearId: next.id, endsAt: endsAt.toISOString() }, createdAt: startsAt } });
    }
  }
  log(`course selection: ${chosen} students' choices for next year, ${grants.length} helpers and exceptions, ${notices} notices`);
}
