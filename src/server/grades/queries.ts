// Grades: who may see which classes and grades, and the read models for each view.
// Every query goes through the tenant-scoped client. Family views only ever read published assessments.
import type { Prisma } from "@prisma/client";
import type { TenantDb } from "@/lib/tenant-db";
import type { Permission } from "@/server/identity/permissions";
import { DEFAULT_BANDS, bandFor, mean, runningAverages, sortBands, weightedAverage, type Band } from "./calc";

export type GradeViewer = {
  db: TenantDb;
  orgId: string;
  membershipId: string;
  roles: string[];
  isStudent: boolean;
  isParent: boolean;
  can: (p: Permission) => boolean;
  /** Students this member may see as family (own record, or linked children). */
  familyStudentIds: string[];
};

type CtxLike = {
  db: TenantDb;
  orgId: string;
  membershipId: string;
  roles: string[];
  isStudent: boolean;
  isParent: boolean;
  can: (p: Permission) => boolean;
  membership: { student: { id: string } | null; guardian: { links: Array<{ studentId: string }> } | null };
};

export function viewerFromCtx(ctx: CtxLike): GradeViewer {
  const familyStudentIds = ctx.isStudent ? (ctx.membership.student ? [ctx.membership.student.id] : []) : ctx.isParent ? (ctx.membership.guardian?.links.map((l) => l.studentId) ?? []) : [];
  return { db: ctx.db, orgId: ctx.orgId, membershipId: ctx.membershipId, roles: ctx.roles, isStudent: ctx.isStudent, isParent: ctx.isParent, can: ctx.can, familyStudentIds };
}

const isFamily = (v: GradeViewer) => v.isStudent || v.isParent;

/** Staff who may open the gradebook at all. */
export function canUseGradebook(v: GradeViewer) {
  return !isFamily(v) && (v.can("grades.enter") || v.can("grades.view_all"));
}

/** School-wide reach: administrators, the principal, and other view-all staff who are not scoped to a department. */
function seesAllClasses(v: GradeViewer) {
  if (!v.can("grades.view_all")) return false;
  if (v.roles.includes("school_admin") || v.roles.includes("principal")) return true;
  return !v.roles.includes("department_head");
}

export async function currentYear(db: TenantDb) {
  return db.academicYear.findFirst({ where: { isCurrent: true }, include: { terms: { orderBy: { startsOn: "asc" } } }, orderBy: { startsOn: "desc" } });
}

export function termFor<T extends { id: string; startsOn: Date; endsOn: Date }>(terms: T[], at: Date): T | null {
  const t = at.getTime();
  return terms.find((x) => x.startsOn.getTime() <= t && t <= x.endsOn.getTime() + 86400000) ?? null;
}

/** The current term, or the most recent past term, or the first term. */
export function defaultTerm<T extends { id: string; startsOn: Date; endsOn: Date }>(terms: T[], now = new Date()): T | null {
  return termFor(terms, now) ?? [...terms].reverse().find((t) => t.startsOn <= now) ?? terms[0] ?? null;
}

export async function loadBands(db: TenantDb): Promise<{ bands: Band[]; custom: boolean }> {
  const rows = await db.gradeBand.findMany({ orderBy: [{ minPercent: "desc" }] });
  if (!rows.length) return { bands: DEFAULT_BANDS, custom: false };
  return { bands: sortBands(rows.map((r) => ({ label: r.label, minPercent: r.minPercent }))), custom: true };
}

async function headedDepartments(v: GradeViewer) {
  if (!v.roles.includes("department_head")) return [];
  const rows = await v.db.department.findMany({ where: { headMembershipId: v.membershipId }, select: { id: true } });
  return rows.map((r) => r.id);
}

/** Where clause for the subject classes this staff member may see in the gradebook, or null for none. */
export async function classScope(v: GradeViewer): Promise<{ where: Prisma.SchoolClassWhereInput; departments: string[] } | null> {
  if (!canUseGradebook(v)) return null;
  const base: Prisma.SchoolClassWhereInput = { isHomeroom: false, academicYear: { isCurrent: true } };
  if (seesAllClasses(v)) return { where: base, departments: [] };
  const departments = await headedDepartments(v);
  const or: Prisma.SchoolClassWhereInput[] = [{ teacherMembershipId: v.membershipId }];
  if (departments.length && v.can("grades.view_all")) or.push({ subject: { departmentId: { in: departments } } });
  return { where: { ...base, OR: or }, departments };
}

function canEditClass(v: GradeViewer, c: { teacherMembershipId: string | null; subject: { departmentId: string | null } | null }, departments: string[]) {
  if (!v.can("grades.enter")) return false;
  if (c.teacherMembershipId === v.membershipId) return true;
  return !!c.subject?.departmentId && departments.includes(c.subject.departmentId);
}

async function teacherNames(db: TenantDb, ids: Array<string | null>) {
  const unique = [...new Set(ids.filter(Boolean) as string[])];
  if (!unique.length) return new Map<string, { en: string; ar: string }>();
  const rows = await db.membership.findMany({ where: { id: { in: unique } }, select: { id: true, user: { select: { nameEn: true, nameAr: true } } } });
  return new Map(rows.map((r) => [r.id, { en: r.user.nameEn, ar: r.user.nameAr ?? r.user.nameEn }]));
}

export async function gradebookClasses(v: GradeViewer) {
  const scope = await classScope(v);
  if (!scope) return [];
  const rows = await v.db.schoolClass.findMany({
    where: scope.where,
    include: { subject: { select: { id: true, code: true, nameEn: true, nameAr: true, departmentId: true } }, _count: { select: { enrollments: { where: { status: "ACTIVE" } } } } },
    orderBy: [{ gradeLevel: "asc" }, { nameEn: "asc" }],
  });
  const names = await teacherNames(v.db, rows.map((r) => r.teacherMembershipId));
  return rows.map((c) => ({
    id: c.id,
    nameEn: c.nameEn,
    nameAr: c.nameAr,
    gradeLevel: c.gradeLevel,
    subject: c.subject,
    teacher: c.teacherMembershipId ? (names.get(c.teacherMembershipId) ?? null) : null,
    mine: c.teacherMembershipId === v.membershipId,
    canEdit: canEditClass(v, c, scope.departments),
    students: c._count.enrollments,
  }));
}

/** One class's full gradebook for staff, or null when the class is outside the member's scope. */
export async function loadGradebook(v: GradeViewer, classId: string) {
  const scope = await classScope(v);
  if (!scope) return null;
  const cls = await v.db.schoolClass.findFirst({ where: { AND: [scope.where, { id: classId }] }, include: { subject: true, academicYear: { include: { terms: { orderBy: { startsOn: "asc" } } } } } });
  if (!cls) return null;
  const [enrollments, assessments, bands, names] = await Promise.all([
    v.db.enrollment.findMany({ where: { classId, status: "ACTIVE", student: { status: "ACTIVE" } }, include: { student: true } }),
    v.db.assessment.findMany({ where: { classId }, include: { grades: true }, orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }] }),
    loadBands(v.db),
    teacherNames(v.db, [cls.teacherMembershipId]),
  ]);
  const students = enrollments.map((e) => e.student).sort((a, b) => a.lastNameEn.localeCompare(b.lastNameEn) || a.firstNameEn.localeCompare(b.firstNameEn));
  return {
    cls,
    teacher: cls.teacherMembershipId ? (names.get(cls.teacherMembershipId) ?? null) : null,
    canEdit: canEditClass(v, cls, scope.departments),
    students,
    assessments,
    terms: cls.academicYear.terms,
    bands: bands.bands,
  };
}

/** Whether this member may see a student's grades as family. */
export function canSeeFamilyGrades(v: GradeViewer, studentId: string) {
  return isFamily(v) && v.can("grades.view_own") && v.familyStudentIds.includes(studentId);
}

export type FamilySubject = {
  classId: string;
  subject: { en: string; ar: string };
  teacher: { en: string; ar: string } | null;
  average: number | null;
  band: string | null;
  trend: Array<{ at: Date; avg: number }>;
  assessments: Array<{
    id: string;
    titleEn: string;
    titleAr: string;
    kind: string;
    maxScore: number;
    weight: number;
    dueAt: Date | null;
    publishedAt: Date;
    score: number | null;
    excused: boolean;
    percent: number | null;
    commentEn: string | null;
    commentAr: string | null;
  }>;
};

/**
 * Published grades for one student. Only assessments with publishedAt set are ever read, and only this
 * student's grade rows. Returns null when the member may not see this student.
 */
export async function familyGrades(v: GradeViewer, studentId: string, termId?: string | null) {
  if (!canSeeFamilyGrades(v, studentId)) return null;
  return publishedGradesFor(v.db, studentId, termId);
}

/** Published grades for one student (no access check: callers check first). */
export async function publishedGradesFor(db: TenantDb, studentId: string, termId?: string | null) {
  const now = new Date();
  const [student, year, bandsRes] = await Promise.all([db.student.findUnique({ where: { id: studentId } }), currentYear(db), loadBands(db)]);
  if (!student) return null;
  const bands = bandsRes.bands;
  const terms = year?.terms ?? [];
  const enrollments = await db.enrollment.findMany({
    where: { studentId, status: "ACTIVE", class: { isHomeroom: false, academicYear: { isCurrent: true } } },
    include: { class: { include: { subject: true } } },
  });
  const classIds = enrollments.map((e) => e.classId);
  const published = { publishedAt: { not: null, lte: now } } satisfies Prisma.AssessmentWhereInput;
  const assessments = await db.assessment.findMany({
    where: { classId: { in: classIds }, ...published },
    include: { grades: { where: { studentId } } },
    orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
  });
  const names = await teacherNames(db, enrollments.map((e) => e.class.teacherMembershipId));

  const inTerm = (a: { termId: string | null; dueAt: Date | null; createdAt: Date }, tId: string) => {
    if (a.termId) return a.termId === tId;
    const t = termFor(terms, a.dueAt ?? a.createdAt);
    return t?.id === tId;
  };
  const selectedTerm = termId ? (terms.find((t) => t.id === termId) ?? null) : defaultTermWithData(terms, assessments, inTerm);

  const subjects: FamilySubject[] = enrollments
    .map((e) => {
      const rows = assessments
        .filter((a) => a.classId === e.classId && (!selectedTerm || inTerm(a, selectedTerm.id)))
        .map((a) => {
          const g = a.grades[0];
          const score = g?.score ?? null;
          const excused = g?.excused ?? false;
          return {
            id: a.id,
            titleEn: a.titleEn,
            titleAr: a.titleAr,
            kind: a.kind,
            maxScore: a.maxScore,
            weight: a.weight,
            dueAt: a.dueAt,
            publishedAt: a.publishedAt!,
            score,
            excused,
            percent: score !== null && !excused ? (score / a.maxScore) * 100 : null,
            commentEn: g?.commentEn ?? null,
            commentAr: g?.commentAr ?? null,
          };
        });
      const average = weightedAverage(rows);
      return {
        classId: e.classId,
        subject: { en: e.class.subject?.nameEn ?? e.class.nameEn, ar: e.class.subject?.nameAr ?? e.class.nameAr },
        teacher: e.class.teacherMembershipId ? (names.get(e.class.teacherMembershipId) ?? null) : null,
        average,
        band: bandFor(average, bands),
        trend: runningAverages(rows.map((r) => ({ ...r, at: r.dueAt ?? r.publishedAt }))),
        assessments: rows,
      };
    })
    .sort((a, b) => a.subject.en.localeCompare(b.subject.en));

  const overall = mean(subjects.map((s) => s.average));
  // Overall average per term (published work only), for the term trend.
  const byTerm = terms.map((t) => {
    const perSubject = enrollments.map((e) => weightedAverage(assessments.filter((a) => a.classId === e.classId && inTerm(a, t.id)).map((a) => ({ score: a.grades[0]?.score ?? null, excused: a.grades[0]?.excused ?? false, maxScore: a.maxScore, weight: a.weight }))));
    const avg = mean(perSubject);
    return { termId: t.id, nameEn: t.nameEn, nameAr: t.nameAr, average: avg, band: bandFor(avg, bands) };
  });
  return {
    student,
    terms,
    term: selectedTerm,
    bands,
    subjects,
    overall,
    overallBand: bandFor(overall, bands),
    byTerm,
    publishedCount: subjects.reduce((n, s) => n + s.assessments.length, 0),
  };
}

function defaultTermWithData<T extends { id: string; startsOn: Date; endsOn: Date }>(
  terms: T[],
  assessments: Array<{ termId: string | null; dueAt: Date | null; createdAt: Date }>,
  inTerm: (a: { termId: string | null; dueAt: Date | null; createdAt: Date }, tId: string) => boolean,
): T | null {
  const d = defaultTerm(terms);
  if (!d || assessments.some((a) => inTerm(a, d.id))) return d;
  return [...terms].reverse().find((t) => assessments.some((a) => inTerm(a, t.id))) ?? d;
}

/** Whether a term has any published grades for this student (report cards open to families then). */
export async function termHasPublished(db: TenantDb, studentId: string, termId: string) {
  const term = await db.term.findUnique({ where: { id: termId } });
  if (!term) return false;
  const n = await db.assessment.count({
    where: {
      publishedAt: { not: null, lte: new Date() },
      grades: { some: { studentId } },
      OR: [{ termId }, { termId: null, dueAt: { gte: term.startsOn, lte: new Date(term.endsOn.getTime() + 86400000) } }],
    },
  });
  return n > 0;
}

/**
 * Staff overview: class averages by subject and students below a threshold. Academic data only:
 * nothing from cases, wellbeing or safeguarding is read here.
 */
export async function staffOverview(v: GradeViewer, threshold: number) {
  if (!v.can("grades.view_all") || isFamily(v)) return null;
  const scope = await classScope(v);
  if (!scope) return null;
  const [classes, bandsRes] = await Promise.all([
    v.db.schoolClass.findMany({ where: scope.where, include: { subject: true }, orderBy: [{ gradeLevel: "asc" }, { nameEn: "asc" }] }),
    loadBands(v.db),
  ]);
  const bands = bandsRes.bands;
  const classIds = classes.map((c) => c.id);
  const [assessments, enrollments] = await Promise.all([
    v.db.assessment.findMany({ where: { classId: { in: classIds } }, select: { id: true, classId: true, maxScore: true, weight: true, publishedAt: true, grades: { select: { studentId: true, score: true, excused: true } } } }),
    v.db.enrollment.findMany({ where: { classId: { in: classIds }, status: "ACTIVE", student: { status: "ACTIVE" } }, select: { classId: true, studentId: true } }),
  ]);
  const names = await teacherNames(v.db, classes.map((c) => c.teacherMembershipId));
  const byClass = new Map<string, typeof assessments>();
  for (const a of assessments) byClass.set(a.classId, [...(byClass.get(a.classId) ?? []), a]);

  const below: Array<{ studentId: string; classId: string; average: number; band: string | null }> = [];
  const classRows = classes.map((c) => {
    const list = byClass.get(c.id) ?? [];
    const studentIds = enrollments.filter((e) => e.classId === c.id).map((e) => e.studentId);
    const perStudent = studentIds.map((sid) => {
      const avg = weightedAverage(list.map((a) => {
        const g = a.grades.find((x) => x.studentId === sid);
        return { score: g?.score ?? null, excused: g?.excused ?? false, maxScore: a.maxScore, weight: a.weight };
      }));
      if (avg !== null && avg < threshold) below.push({ studentId: sid, classId: c.id, average: avg, band: bandFor(avg, bands) });
      return avg;
    });
    const average = mean(perStudent);
    return {
      id: c.id,
      nameEn: c.nameEn,
      nameAr: c.nameAr,
      gradeLevel: c.gradeLevel,
      subject: c.subject ? { en: c.subject.nameEn, ar: c.subject.nameAr, code: c.subject.code } : null,
      teacher: c.teacherMembershipId ? (names.get(c.teacherMembershipId) ?? null) : null,
      average,
      band: bandFor(average, bands),
      assessments: list.length,
      drafts: list.filter((a) => !a.publishedAt).length,
      students: studentIds.length,
      below: perStudent.filter((a) => a !== null && a < threshold).length,
    };
  });

  const subjectMap = new Map<string, { en: string; ar: string; classes: typeof classRows }>();
  for (const r of classRows) {
    const key = r.subject?.code ?? r.id;
    const cur = subjectMap.get(key) ?? { en: r.subject?.en ?? r.nameEn, ar: r.subject?.ar ?? r.nameAr, classes: [] };
    cur.classes.push(r);
    subjectMap.set(key, cur);
  }
  const subjects = [...subjectMap.entries()]
    .map(([code, s]) => {
      const average = mean(s.classes.map((c) => c.average));
      return { code, en: s.en, ar: s.ar, average, band: bandFor(average, bands), classes: s.classes };
    })
    .sort((a, b) => a.en.localeCompare(b.en));

  const students = await v.db.student.findMany({ where: { id: { in: [...new Set(below.map((b) => b.studentId))] } } });
  const belowRows = below
    .map((b) => ({ ...b, student: students.find((s) => s.id === b.studentId)!, cls: classRows.find((c) => c.id === b.classId)! }))
    .filter((b) => b.student)
    .sort((a, b) => a.average - b.average);
  return { subjects, classes: classRows, below: belowRows, bands, overall: mean(classRows.map((c) => c.average)) };
}
