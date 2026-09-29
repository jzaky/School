// Timetable data services: load solver inputs from the database, run teacher assignment and generation,
// and write the results. Every function takes a transaction already scoped to one organization
// (tenantTx in the app, the owner client in seeds) and always writes orgId explicitly.
import type { Tx } from "@/server/db";
import { assignTeachers, type AssignResult } from "./assign";
import { solveTimetable, type SolveResult, type SolverClass } from "./solver";
import type { BellRow } from "./bell";

export const DEFAULT_PERIODS = 4;

export async function currentYear(tx: Tx, orgId: string) {
  return (
    (await tx.academicYear.findFirst({ where: { orgId, isCurrent: true } })) ??
    (await tx.academicYear.findFirst({ where: { orgId }, orderBy: { startsOn: "desc" } }))
  );
}

export async function bellRows(tx: Tx, orgId: string, yearId: string): Promise<BellRow[]> {
  const rows = await tx.bellPeriod.findMany({ where: { orgId, academicYearId: yearId }, orderBy: [{ dayOfWeek: "asc" }, { periodNo: "asc" }] });
  return rows.map((r) => ({ dayOfWeek: r.dayOfWeek, periodNo: r.periodNo, startTime: r.startTime, endTime: r.endTime, kind: r.kind }));
}

/** Timetabled sections: every class with a subject that is not a homeroom. Periods come from the subject offering. */
export async function loadSections(tx: Tx, orgId: string, yearId: string) {
  const [classes, offerings] = await Promise.all([
    tx.schoolClass.findMany({ where: { orgId, academicYearId: yearId, isHomeroom: false, subjectId: { not: null } }, orderBy: [{ gradeLevel: "asc" }, { nameEn: "asc" }] }),
    tx.subjectOffering.findMany({ where: { orgId, academicYearId: yearId } }),
  ]);
  const offeringFor = (subjectId: string | null, grade: number) => offerings.find((o) => o.subjectId === subjectId && o.gradeLevel === grade);
  // A section's option block is its own, or else its subject offering's block for that grade.
  return classes.map((c) => {
    const o = offeringFor(c.subjectId, c.gradeLevel);
    return { ...c, periods: o?.periodsPerWeek ?? DEFAULT_PERIODS, optionBlock: c.optionBlock ?? (o?.kind === "OPTION" ? o.optionBlock : null) };
  });
}

export async function loadQualifications(tx: Tx, orgId: string) {
  const rows = await tx.teacherSubject.findMany({ where: { orgId }, orderBy: { createdAt: "asc" } });
  return rows.map((r) => ({ teacherId: r.membershipId, subjectId: r.subjectId, gradeLevels: r.gradeLevels, maxPeriodsPerWeek: r.maxPeriodsPerWeek }));
}

/** Run automatic teacher assignment and save it. Returns the pure result for the report. */
export async function runAssignment(tx: Tx, orgId: string, opts: { overwrite?: boolean; actorId?: string | null } = {}): Promise<AssignResult & { yearId: string | null; changed: number }> {
  const year = await currentYear(tx, orgId);
  if (!year) return { assignments: [], unassigned: [], load: {}, capacity: {}, yearId: null, changed: 0 };
  const sections = await loadSections(tx, orgId, year.id);
  const quals = await loadQualifications(tx, orgId);
  const res = assignTeachers({
    sections: sections.map((s) => ({ id: s.id, subjectId: s.subjectId, gradeLevel: s.gradeLevel, teacherId: s.teacherMembershipId, periods: s.periods, optionBlock: s.optionBlock })),
    qualifications: quals,
    overwrite: opts.overwrite,
  });
  let changed = 0;
  for (const a of res.assignments) {
    if (a.teacherId === a.previousTeacherId) continue;
    changed++;
    await tx.schoolClass.update({ where: { id: a.sectionId }, data: { teacherMembershipId: a.teacherId } });
    // Unlocked lessons follow the class teacher.
    await tx.timetableSlot.updateMany({ where: { orgId, classId: a.sectionId, locked: false }, data: { teacherMembershipId: a.teacherId } });
  }
  await tx.auditEvent.create({
    data: { orgId, actorId: opts.actorId ?? null, action: "timetable.assign", entityType: "AcademicYear", entityId: year.id, meta: { overwrite: Boolean(opts.overwrite), changed, unassigned: res.unassigned } as never },
  });
  return { ...res, yearId: year.id, changed };
}

/** Load everything the solver needs for the current year. */
export async function loadSolverInput(tx: Tx, orgId: string, yearId: string) {
  const [sections, bell, slots] = await Promise.all([
    loadSections(tx, orgId, yearId),
    bellRows(tx, orgId, yearId),
    tx.timetableSlot.findMany({ where: { orgId, academicYearId: yearId } }),
  ]);
  const enrollments = await tx.enrollment.findMany({ where: { orgId, status: "ACTIVE", classId: { in: sections.map((s) => s.id) } }, select: { classId: true, studentId: true } });
  const studentsOf = new Map<string, string[]>();
  for (const e of enrollments) (studentsOf.get(e.classId) ?? studentsOf.set(e.classId, []).get(e.classId)!).push(e.studentId);
  const classes: SolverClass[] = sections.map((s) => ({
    id: s.id,
    teacherId: s.teacherMembershipId,
    gradeLevel: s.gradeLevel,
    optionBlock: s.optionBlock,
    periods: s.periods,
    room: s.room,
    studentIds: studentsOf.get(s.id) ?? [],
  }));
  const periods = bell.filter((b) => b.kind === "LESSON").map((b) => ({ day: b.dayOfWeek, period: b.periodNo }));
  return { sections, bell, slots, classes, periods };
}

export type GenerateReport = {
  unplaced: SolveResult["unplaced"];
  warnings: SolveResult["warnings"];
  stats: SolveResult["stats"];
};

/** Regenerate every unlocked lesson for the current year. Locked lessons stay where they are. */
export async function runGenerate(tx: Tx, orgId: string, opts: { actorId?: string | null; maxTeacherPerDay?: number } = {}): Promise<GenerateReport | null> {
  const year = await currentYear(tx, orgId);
  if (!year) return null;
  const input = await loadSolverInput(tx, orgId, year.id);
  const known = new Set(input.classes.map((c) => c.id));
  const locked = input.slots.filter((s) => s.locked && known.has(s.classId));
  const res = solveTimetable({
    periods: input.periods,
    classes: input.classes,
    locks: locked.map((l) => ({ classId: l.classId, day: l.dayOfWeek, period: l.periodNo })),
    options: { maxTeacherPerDay: opts.maxTeacherPerDay },
  });
  const byId = new Map(input.sections.map((s) => [s.id, s]));
  await tx.timetableSlot.deleteMany({ where: { orgId, academicYearId: year.id, locked: false } });
  // Slots of classes that are no longer timetabled (for example turned into a homeroom) go too.
  await tx.timetableSlot.deleteMany({ where: { orgId, academicYearId: year.id, classId: { notIn: [...known] } } });
  const rows = res.placements
    .filter((p) => !p.locked)
    .map((p) => {
      const c = byId.get(p.classId)!;
      return { orgId, academicYearId: year.id, classId: p.classId, teacherMembershipId: c.teacherMembershipId, dayOfWeek: p.day, periodNo: p.period, room: c.room, locked: false };
    });
  if (rows.length) await tx.timetableSlot.createMany({ data: rows, skipDuplicates: true });
  const report: GenerateReport = { unplaced: res.unplaced, warnings: res.warnings, stats: res.stats };
  await tx.auditEvent.create({ data: { orgId, actorId: opts.actorId ?? null, action: "timetable.generate", entityType: "AcademicYear", entityId: year.id, meta: report as never } });
  return report;
}

/** A lesson's clash check for moving it to another period: who else would be there. */
export async function clashesForMove(tx: Tx, orgId: string, slotId: string) {
  const slot = await tx.timetableSlot.findFirst({ where: { orgId, id: slotId } });
  if (!slot) return null;
  const input = await loadSolverInput(tx, orgId, slot.academicYearId);
  const cls = input.classes.find((c) => c.id === slot.classId);
  const blockOf = (c: SolverClass) => (c.optionBlock ? `${c.gradeLevel}|${c.optionBlock}` : null);
  const byId = new Map(input.classes.map((c) => [c.id, c]));
  const teacherId = slot.teacherMembershipId ?? cls?.teacherId ?? null;
  const students = new Set(cls?.studentIds ?? []);
  const out: Array<{ day: number; period: number; clashes: Array<{ kind: "TEACHER" | "STUDENT" | "ROOM" | "SAME_CLASS"; classId: string }> }> = [];
  for (const p of input.periods) {
    const here = input.slots.filter((s) => s.dayOfWeek === p.day && s.periodNo === p.period && s.id !== slot.id);
    const clashes: (typeof out)[number]["clashes"] = [];
    for (const o of here) {
      if (o.classId === slot.classId) {
        clashes.push({ kind: "SAME_CLASS", classId: o.classId });
        continue;
      }
      const oc = byId.get(o.classId);
      const oTeacher = o.teacherMembershipId ?? oc?.teacherId ?? null;
      if (teacherId && oTeacher === teacherId) clashes.push({ kind: "TEACHER", classId: o.classId });
      if (slot.room && o.room === slot.room) clashes.push({ kind: "ROOM", classId: o.classId });
      if (oc && cls && !(blockOf(cls) && blockOf(cls) === blockOf(oc)) && oc.studentIds.some((s) => students.has(s))) clashes.push({ kind: "STUDENT", classId: o.classId });
    }
    out.push({ day: p.day, period: p.period, clashes });
  }
  return { slot, options: out };
}

/** Prefill qualifications from current classes and department subjects. */
export async function prefillQualifications(tx: Tx, orgId: string) {
  const year = await currentYear(tx, orgId);
  const [classes, profiles, subjects, existing] = await Promise.all([
    year ? tx.schoolClass.findMany({ where: { orgId, academicYearId: year.id, isHomeroom: false, subjectId: { not: null }, teacherMembershipId: { not: null } } }) : Promise.resolve([]),
    tx.staffProfile.findMany({ where: { orgId, departmentId: { not: null }, membership: { status: "ACTIVE", roles: { some: { role: { key: { in: ["teacher", "department_head"] } } } } } } }),
    tx.subject.findMany({ where: { orgId } }),
    tx.teacherSubject.findMany({ where: { orgId } }),
  ]);
  const want = new Map<string, Set<number>>(); // membership|subject -> grades
  const add = (m: string, s: string, grades: number[]) => {
    const k = `${m}|${s}`;
    const set = want.get(k) ?? new Set<number>();
    for (const g of grades) set.add(g);
    want.set(k, set);
  };
  for (const c of classes) add(c.teacherMembershipId!, c.subjectId!, [c.gradeLevel]);
  const taught = new Set(classes.map((c) => c.teacherMembershipId));
  for (const p of profiles) {
    // Department subjects only for teachers who have no classes yet: a new colleague can be assigned straight away.
    if (taught.has(p.membershipId)) continue;
    const grades = p.gradeLevels.length ? p.gradeLevels : [6, 7, 8, 9, 10, 11, 12];
    for (const s of subjects.filter((x) => x.departmentId === p.departmentId)) add(p.membershipId, s.id, grades);
  }
  let created = 0;
  let updated = 0;
  for (const [k, grades] of want) {
    const [membershipId, subjectId] = k.split("|");
    const cur = existing.find((e) => e.membershipId === membershipId && e.subjectId === subjectId);
    const merged = [...new Set([...(cur?.gradeLevels ?? []), ...grades])].sort((a, b) => a - b);
    if (!cur) {
      await tx.teacherSubject.create({ data: { orgId, membershipId, subjectId, gradeLevels: merged, maxPeriodsPerWeek: 24 } });
      created++;
    } else if (merged.length !== cur.gradeLevels.length) {
      await tx.teacherSubject.update({ where: { id: cur.id }, data: { gradeLevels: merged } });
      updated++;
    }
  }
  return { created, updated };
}

