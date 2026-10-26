// Subject registration and class allocation against the database.
// Every function takes a transaction client that is already scoped to one organization
// (tenantTx in request code, the owner client in seeds) plus that organization's id.
import type { Prisma, RegistrationSource, SchoolCurriculum } from "@prisma/client";
import { checkChoices, type ChoiceError, type OfferingLite } from "@/lib/registration";
import { allocateGroup, DEFAULT_CAPACITY, type AllocRequest } from "./allocate";

type Tx = Prisma.TransactionClient;

const ACTIVE = new Set(["REQUESTED", "ALLOCATED", "WAITLISTED"]);

/** The current academic year, or the most recent one. */
export async function currentYear(tx: Tx, orgId: string) {
  return (
    (await tx.academicYear.findFirst({ where: { orgId, isCurrent: true }, orderBy: { startsOn: "desc" } })) ??
    (await tx.academicYear.findFirst({ where: { orgId }, orderBy: { startsOn: "desc" } }))
  );
}

/**
 * The year after the current one, when the school has set it up: course selection for next year
 * happens there (a Grade 9 student chooses Grade 10 courses). Null when there is none.
 */
export async function selectionYear(tx: Tx, orgId: string) {
  const current = await currentYear(tx, orgId);
  if (!current) return null;
  return tx.academicYear.findFirst({ where: { orgId, id: { not: current.id }, startsOn: { gt: current.startsOn } }, orderBy: { startsOn: "asc" } });
}

/** The year a registration is for: the current year (default) or the next one. Null when neither. */
export async function registrationYear(tx: Tx, orgId: string, yearId?: string | null) {
  const current = await currentYear(tx, orgId);
  if (!current) return null;
  if (!yearId || yearId === current.id) return { year: current, next: false, gradeOffset: 0 };
  const next = await selectionYear(tx, orgId);
  return next && next.id === yearId ? { year: next, next: true, gradeOffset: 1 } : null;
}

export type OfferingRow = OfferingLite & {
  id: string;
  gradeLevel: number;
  periodsPerWeek: number;
  nameEn: string;
  nameAr: string;
  notesEn: string | null;
  notesAr: string | null;
  curriculum: SchoolCurriculum | null;
  courseId: string | null;
  isAP: boolean;
};

/**
 * Offerings for a grade in a year, core first, then by block and subject name. With a curriculum,
 * only offerings for that track and for every track.
 */
export async function offeringsFor(tx: Tx, orgId: string, academicYearId: string, gradeLevel?: number, curriculum?: SchoolCurriculum | null): Promise<OfferingRow[]> {
  const rows = await tx.subjectOffering.findMany({
    where: { orgId, academicYearId, ...(gradeLevel !== undefined ? { gradeLevel } : {}), ...(curriculum ? { OR: [{ curriculum: null }, { curriculum }] } : {}) },
  });
  const subjects = await tx.subject.findMany({ where: { orgId, id: { in: rows.map((r) => r.subjectId) } } });
  const sub = new Map(subjects.map((s) => [s.id, s]));
  return rows
    .filter((r) => sub.has(r.subjectId))
    .map((r) => {
      const s = sub.get(r.subjectId)!;
      return {
        id: r.id,
        subjectId: r.subjectId,
        code: s.code,
        nameEn: s.nameEn,
        nameAr: s.nameAr,
        kind: r.kind,
        optionBlock: r.kind === "OPTION" ? (r.optionBlock ?? "A").toUpperCase() : null,
        prerequisites: r.prerequisites,
        gradeLevel: r.gradeLevel,
        periodsPerWeek: r.periodsPerWeek,
        notesEn: r.notesEn,
        notesAr: r.notesAr,
        curriculum: r.curriculum,
        courseId: r.courseId,
        isAP: r.isAP,
      };
    })
    .sort((a, b) => a.gradeLevel - b.gradeLevel || (a.kind === b.kind ? 0 : a.kind === "CORE" ? -1 : 1) || (a.optionBlock ?? "").localeCompare(b.optionBlock ?? "") || a.nameEn.localeCompare(b.nameEn));
}

/** Subject codes a student took in earlier academic years (for prerequisites). */
export async function priorSubjectCodes(tx: Tx, orgId: string, studentId: string, year: { id: string; startsOn: Date }) {
  const rows = await tx.enrollment.findMany({
    where: { orgId, studentId, class: { isHomeroom: false, subjectId: { not: null }, academicYearId: { not: year.id }, academicYear: { startsOn: { lt: year.startsOn } } } },
    select: { class: { select: { subject: { select: { code: true } } } } },
  });
  return new Set(rows.map((r) => r.class.subject?.code.toUpperCase()).filter(Boolean) as string[]);
}

export type AllocationSummary = { groups: number; placed: number; moved: number; removed: number; sectionsCreated: number; registrationsUpdated: number };

/**
 * Place registrations into class sections. Scope to some students (their subject groups are
 * allocated as a whole, which only ever touches unplaced students) or run for the whole year.
 * Idempotent: a second run with nothing new returns all zeros.
 */
export async function runAllocation(tx: Tx, orgId: string, academicYearId: string, scope: { studentIds?: string[] } = {}): Promise<AllocationSummary> {
  const summary: AllocationSummary = { groups: 0, placed: 0, moved: 0, removed: 0, sectionsCreated: 0, registrationsUpdated: 0 };
  let subjectIds: string[] | undefined;
  if (scope.studentIds) {
    if (scope.studentIds.length === 0) return summary;
    const mine = await tx.subjectRegistration.findMany({ where: { orgId, academicYearId, studentId: { in: scope.studentIds } }, select: { subjectId: true } });
    subjectIds = [...new Set(mine.map((r) => r.subjectId))];
    if (subjectIds.length === 0) return summary;
  }
  const regs = await tx.subjectRegistration.findMany({
    where: { orgId, academicYearId, ...(subjectIds ? { subjectId: { in: subjectIds } } : {}) },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (regs.length === 0) return summary;
  const students = await tx.student.findMany({ where: { orgId, id: { in: [...new Set(regs.map((r) => r.studentId))] } }, select: { id: true, gradeLevel: true } });
  const gradeOf = new Map(students.map((s) => [s.id, s.gradeLevel]));

  // Group registrations by subject and the student's grade.
  const groups = new Map<string, { subjectId: string; gradeLevel: number; regs: typeof regs }>();
  const onlyGrades = scope.studentIds ? new Set(scope.studentIds.map((id) => gradeOf.get(id)).filter((g) => g !== undefined)) : null;
  for (const r of regs) {
    const g = gradeOf.get(r.studentId);
    if (g === undefined) continue;
    if (onlyGrades && !onlyGrades.has(g)) continue;
    const key = `${r.subjectId}:${g}`;
    if (!groups.has(key)) groups.set(key, { subjectId: r.subjectId, gradeLevel: g, regs: [] });
    groups.get(key)!.regs.push(r);
  }
  if (scope.studentIds) {
    const wanted = new Set(scope.studentIds);
    for (const [key, grp] of groups) if (!grp.regs.some((r) => wanted.has(r.studentId))) groups.delete(key);
  }
  if (groups.size === 0) return summary;

  const groupSubjectIds = [...new Set([...groups.values()].map((g) => g.subjectId))];
  const [classes, subjects, offerings] = await Promise.all([
    tx.schoolClass.findMany({
      where: { orgId, academicYearId, isHomeroom: false, subjectId: { in: groupSubjectIds } },
      include: { enrollments: { select: { studentId: true } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    tx.subject.findMany({ where: { orgId, id: { in: groupSubjectIds } } }),
    tx.subjectOffering.findMany({ where: { orgId, academicYearId, subjectId: { in: groupSubjectIds } } }),
  ]);
  const subjectById = new Map(subjects.map((s) => [s.id, s]));

  for (const grp of groups.values()) {
    summary.groups++;
    const sections = classes.filter((c) => c.subjectId === grp.subjectId && c.gradeLevel === grp.gradeLevel);
    const requests: AllocRequest[] = grp.regs.map((r) => ({ registrationId: r.id, studentId: r.studentId, classId: r.classId, active: ACTIVE.has(r.status), status: r.status }));
    const result = allocateGroup({
      sections: sections.map((c) => ({ id: c.id, section: c.section, capacity: c.capacity, members: c.enrollments.map((e) => e.studentId) })),
      requests,
      defaultCapacity: DEFAULT_CAPACITY,
    });

    // Open new sections first so enrollments can point at them.
    const realId = new Map<string, string>();
    if (result.newSections.length) {
      const subject = subjectById.get(grp.subjectId);
      const offering = offerings.find((o) => o.subjectId === grp.subjectId && o.gradeLevel === grp.gradeLevel);
      const sibling = sections[0];
      // A single existing section without a letter becomes section A once a second one opens.
      if (sections.length === 1 && !sibling.section) await tx.schoolClass.update({ where: { id: sibling.id }, data: { section: "A" } });
      for (const ns of result.newSections) {
        const created = await tx.schoolClass.create({
          data: {
            orgId,
            academicYearId,
            campusId: sibling?.campusId ?? null,
            subjectId: grp.subjectId,
            teacherMembershipId: null,
            nameEn: `Grade ${grp.gradeLevel} ${subject?.nameEn ?? ""} ${ns.section}`.replace(/\s+/g, " ").trim(),
            nameAr: `${subject?.nameAr ?? ""} للصف ${grp.gradeLevel} ${ns.section}`.replace(/\s+/g, " ").trim(),
            gradeLevel: grp.gradeLevel,
            section: ns.section,
            isHomeroom: false,
            optionBlock: offering?.kind === "OPTION" ? offering.optionBlock : null,
          },
        });
        realId.set(ns.id, created.id);
        summary.sectionsCreated++;
      }
    }
    const idOf = (id: string) => realId.get(id) ?? id;

    for (const u of result.unenroll) {
      await tx.enrollment.deleteMany({ where: { orgId, studentId: u.studentId, classId: u.classId } });
    }
    if (result.enroll.length) {
      await tx.enrollment.createMany({ data: result.enroll.map((e) => ({ orgId, studentId: e.studentId, classId: idOf(e.classId), status: "ACTIVE" as const })), skipDuplicates: true });
    }
    for (const u of result.updates) {
      await tx.subjectRegistration.update({ where: { id: u.registrationId }, data: { classId: u.classId ? idOf(u.classId) : null, status: u.status } });
    }
    const enrolledStudents = new Set(result.enroll.map((e) => e.studentId));
    const leftStudents = new Set(result.unenroll.map((e) => e.studentId));
    summary.placed += [...enrolledStudents].filter((s) => !leftStudents.has(s)).length;
    summary.moved += [...enrolledStudents].filter((s) => leftStudents.has(s)).length;
    summary.removed += [...leftStudents].filter((s) => !enrolledStudents.has(s)).length;
    summary.registrationsUpdated += result.updates.length;
  }
  return summary;
}

export type SaveResult = { ok: true; summary: AllocationSummary; changed: number } | { ok: false; error: "NO_YEAR" | "NOT_FOUND" | "NO_OFFERINGS" | "INVALID"; errors?: ChoiceError[] };

/**
 * Register a student: core subjects automatically, plus one option per block.
 * Options no longer chosen are dropped. Then allocation runs for this student.
 * With academicYearId set to next year, this is course selection: the student chooses next
 * year's grade, and no classes are allocated until that year is set up.
 */
export async function saveRegistration(
  tx: Tx,
  orgId: string,
  input: { studentId: string; optionSubjectIds: string[]; source: RegistrationSource; actorId: string | null; requireAllBlocks?: boolean; skipAllocation?: boolean; academicYearId?: string | null; now?: Date },
): Promise<SaveResult> {
  const target = await registrationYear(tx, orgId, input.academicYearId);
  if (!target) return { ok: false, error: "NO_YEAR" };
  const { year } = target;
  const student = await tx.student.findFirst({ where: { orgId, id: input.studentId }, select: { id: true, gradeLevel: true, curriculum: true } });
  if (!student) return { ok: false, error: "NOT_FOUND" };
  const offerings = await offeringsFor(tx, orgId, year.id, student.gradeLevel + target.gradeOffset, student.curriculum);
  if (offerings.length === 0) return { ok: false, error: "NO_OFFERINGS" };
  const prior = await priorSubjectCodes(tx, orgId, student.id, year);
  const errors = checkChoices(offerings, input.optionSubjectIds, prior, { requireAllBlocks: input.requireAllBlocks });
  if (errors.length) return { ok: false, error: "INVALID", errors };

  const existing = await tx.subjectRegistration.findMany({ where: { orgId, academicYearId: year.id, studentId: student.id } });
  const bySubject = new Map(existing.map((r) => [r.subjectId, r]));
  const chosen = new Set(input.optionSubjectIds);
  let changed = 0;
  for (const o of offerings) {
    const want = o.kind === "CORE" || chosen.has(o.subjectId);
    const row = bySubject.get(o.subjectId);
    if (want) {
      if (!row) {
        await tx.subjectRegistration.create({ data: { orgId, academicYearId: year.id, studentId: student.id, subjectId: o.subjectId, status: "REQUESTED", source: input.source, createdById: input.actorId, chosenAt: input.now ?? new Date() } });
        changed++;
      } else if (!ACTIVE.has(row.status)) {
        await tx.subjectRegistration.update({ where: { id: row.id }, data: { status: "REQUESTED", classId: null, source: input.source, createdById: input.actorId, chosenAt: input.now ?? new Date() } });
        changed++;
      }
    } else if (row && ACTIVE.has(row.status)) {
      await tx.subjectRegistration.update({ where: { id: row.id }, data: { status: "DROPPED" } });
      changed++;
    }
  }
  const summary = input.skipAllocation || target.next
    ? { groups: 0, placed: 0, moved: 0, removed: 0, sectionsCreated: 0, registrationsUpdated: 0 }
    : await runAllocation(tx, orgId, year.id, { studentIds: [student.id] });
  return { ok: true, summary, changed };
}

async function subjectByRef(tx: Tx, orgId: string, ref: unknown) {
  if (!ref || typeof ref !== "string") return null;
  return tx.subject.findFirst({ where: { orgId, OR: [{ id: ref }, { code: ref.toUpperCase() }] }, select: { id: true, code: true } });
}

/**
 * A completed subject change request: drop the old subject, register the new one and re-run
 * allocation, so the student leaves the old class and joins a section of the new subject.
 * Safe to call twice. Returns null when there is nothing to change.
 */
export async function applySubjectChange(tx: Tx, orgId: string, input: { studentId: string; fromSubject: unknown; toSubject: unknown; actorId?: string | null }) {
  const year = await currentYear(tx, orgId);
  if (!year) return null;
  const [from, to] = await Promise.all([subjectByRef(tx, orgId, input.fromSubject), subjectByRef(tx, orgId, input.toSubject)]);
  if (!to || (from && from.id === to.id)) return null;
  const student = await tx.student.findFirst({ where: { orgId, id: input.studentId }, select: { id: true } });
  if (!student) return null;
  if (from) {
    await tx.subjectRegistration.upsert({
      where: { academicYearId_studentId_subjectId: { academicYearId: year.id, studentId: student.id, subjectId: from.id } },
      create: { orgId, academicYearId: year.id, studentId: student.id, subjectId: from.id, status: "DROPPED", source: "SUBJECT_CHANGE", createdById: input.actorId ?? null },
      update: { status: "DROPPED" },
    });
  }
  const current = await tx.subjectRegistration.findUnique({ where: { academicYearId_studentId_subjectId: { academicYearId: year.id, studentId: student.id, subjectId: to.id } } });
  if (!current) {
    await tx.subjectRegistration.create({ data: { orgId, academicYearId: year.id, studentId: student.id, subjectId: to.id, status: "REQUESTED", source: "SUBJECT_CHANGE", createdById: input.actorId ?? null } });
  } else if (!ACTIVE.has(current.status)) {
    await tx.subjectRegistration.update({ where: { id: current.id }, data: { status: "REQUESTED", classId: null, source: "SUBJECT_CHANGE" } });
  }
  return runAllocation(tx, orgId, year.id, { studentIds: [student.id] });
}

export type MoveError = "NOT_FOUND" | "SAME" | "WRONG_CLASS" | "FULL";

/** Move one allocated student to another section of the same subject and grade. */
export async function moveStudent(tx: Tx, orgId: string, input: { registrationId: string; classId: string }): Promise<{ ok: true; fromClassId: string | null } | { ok: false; error: MoveError }> {
  const reg = await tx.subjectRegistration.findFirst({ where: { orgId, id: input.registrationId } });
  if (!reg || !ACTIVE.has(reg.status)) return { ok: false, error: "NOT_FOUND" };
  if (reg.classId === input.classId) return { ok: false, error: "SAME" };
  const [student, target] = await Promise.all([
    tx.student.findFirst({ where: { orgId, id: reg.studentId }, select: { gradeLevel: true } }),
    tx.schoolClass.findFirst({ where: { orgId, id: input.classId }, include: { _count: { select: { enrollments: true } } } }),
  ]);
  if (!student || !target || target.isHomeroom || target.subjectId !== reg.subjectId || target.gradeLevel !== student.gradeLevel || target.academicYearId !== reg.academicYearId) return { ok: false, error: "WRONG_CLASS" };
  if (target._count.enrollments >= (target.capacity ?? DEFAULT_CAPACITY)) return { ok: false, error: "FULL" };
  const siblings = await tx.schoolClass.findMany({ where: { orgId, academicYearId: reg.academicYearId, subjectId: reg.subjectId, gradeLevel: target.gradeLevel, isHomeroom: false }, select: { id: true } });
  await tx.enrollment.deleteMany({ where: { orgId, studentId: reg.studentId, classId: { in: siblings.map((s) => s.id).filter((id) => id !== target.id) } } });
  await tx.enrollment.createMany({ data: [{ orgId, studentId: reg.studentId, classId: target.id, status: "ACTIVE" }], skipDuplicates: true });
  await tx.subjectRegistration.update({ where: { id: reg.id }, data: { classId: target.id, status: "ALLOCATED" } });
  return { ok: true, fromClassId: reg.classId };
}
