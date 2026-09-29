// School course catalog admin: which catalog courses the school offers, in which grades.
// The planner, the what-if panel and "classes that open the most doors" only use active rows.
import type { Prisma } from "@prisma/client";
import { audit } from "@/server/audit/audit";
import { catalogScope } from "@/server/pathways/scope";
import { EngineAccessError, type EngineActor } from "@/server/pathway-engine/access";

export const canManageCatalog = (a: EngineActor) => a.isStaff && a.can("pathways.manage");

const assertManage = (a: EngineActor) => {
  if (!canManageCatalog(a)) throw new EngineAccessError("forbidden");
};

export type SchoolCatalogRow = {
  id: string;
  courseId: string;
  code: string;
  nameEn: string;
  nameAr: string;
  curriculum: string;
  qualification: string;
  gradeLevels: number[];
  active: boolean;
  notesEn: string | null;
  notesAr: string | null;
  subjectId: string | null;
  subjectEn: string | null;
  subjectAr: string | null;
  isGlobal: boolean;
};

export async function listSchoolCatalog(a: EngineActor): Promise<SchoolCatalogRow[]> {
  const rows = await a.db.schoolCourse.findMany({ where: { orgId: a.orgId }, orderBy: { createdAt: "asc" } });
  if (!rows.length) return [];
  const [courses, subjects] = await Promise.all([
    a.db.curriculumCourse.findMany({ where: { id: { in: rows.map((r) => r.courseId) }, ...catalogScope(a.orgId) } }),
    a.db.subject.findMany({ where: { orgId: a.orgId }, select: { id: true, nameEn: true, nameAr: true } }),
  ]);
  const c = new Map(courses.map((x) => [x.id, x]));
  const s = new Map(subjects.map((x) => [x.id, x]));
  return rows
    .filter((r) => c.has(r.courseId))
    .map((r) => {
      const course = c.get(r.courseId)!;
      const subject = r.subjectId ? s.get(r.subjectId) : undefined;
      return {
        id: r.id,
        courseId: r.courseId,
        code: course.code,
        nameEn: course.nameEn,
        nameAr: course.nameAr,
        curriculum: course.curriculum,
        qualification: course.qualification,
        gradeLevels: [...r.gradeLevels].sort((x, y) => x - y),
        active: r.active,
        notesEn: r.notesEn,
        notesAr: r.notesAr,
        subjectId: r.subjectId,
        subjectEn: subject?.nameEn ?? null,
        subjectAr: subject?.nameAr ?? null,
        isGlobal: course.orgId === null,
      };
    })
    .sort((x, y) => x.curriculum.localeCompare(y.curriculum) || (x.gradeLevels[0] ?? 99) - (y.gradeLevels[0] ?? 99) || x.nameEn.localeCompare(y.nameEn));
}

export type CatalogInput = { gradeLevels: number[]; subjectId?: string | null; notesEn?: string | null; notesAr?: string | null; active?: boolean };

function cleanGrades(g: number[]) {
  const out = [...new Set(g.filter((x) => Number.isInteger(x) && x >= 6 && x <= 13))].sort((a, b) => a - b);
  if (!out.length) throw new EngineAccessError("invalid");
  return out;
}

async function checkSubject(a: EngineActor, subjectId: string | null | undefined) {
  if (!subjectId) return null;
  const s = await a.db.subject.findFirst({ where: { id: subjectId, orgId: a.orgId }, select: { id: true } });
  if (!s) throw new EngineAccessError("invalid");
  return s.id;
}

const note = (v: string | null | undefined) => (v === undefined ? undefined : v?.trim().slice(0, 500) || null);

/** Offer a catalog course. Adding a course the school already lists reactivates and updates it. */
export async function addSchoolCourse(a: EngineActor, courseId: string, input: CatalogInput) {
  assertManage(a);
  const course = await a.db.curriculumCourse.findFirst({ where: { id: courseId, ...catalogScope(a.orgId) }, select: { id: true } });
  if (!course) throw new EngineAccessError("invalid");
  const data = { gradeLevels: cleanGrades(input.gradeLevels), subjectId: await checkSubject(a, input.subjectId), notesEn: note(input.notesEn) ?? null, notesAr: note(input.notesAr) ?? null, active: true };
  const row = await a.db.schoolCourse.upsert({ where: { orgId_courseId: { orgId: a.orgId, courseId } }, create: { orgId: a.orgId, courseId, ...data }, update: data });
  await audit(a.db, a.orgId, { actorId: a.membershipId, action: "pathways.catalog.add", entityType: "SchoolCourse", entityId: row.id, meta: { courseId, gradeLevels: data.gradeLevels } });
  return row;
}

export async function updateSchoolCourse(a: EngineActor, id: string, input: Partial<CatalogInput>) {
  assertManage(a);
  const row = await a.db.schoolCourse.findFirst({ where: { id, orgId: a.orgId } });
  if (!row) throw new EngineAccessError("not_found");
  const data: Prisma.SchoolCourseUpdateInput = {};
  if (input.gradeLevels) data.gradeLevels = cleanGrades(input.gradeLevels);
  if (input.subjectId !== undefined) data.subjectId = await checkSubject(a, input.subjectId);
  if (input.notesEn !== undefined) data.notesEn = note(input.notesEn);
  if (input.notesAr !== undefined) data.notesAr = note(input.notesAr);
  if (input.active !== undefined) data.active = input.active;
  const updated = await a.db.schoolCourse.update({ where: { id }, data });
  await audit(a.db, a.orgId, { actorId: a.membershipId, action: input.active === false ? "pathways.catalog.deactivate" : input.active === true && !row.active ? "pathways.catalog.activate" : "pathways.catalog.update", entityType: "SchoolCourse", entityId: id, meta: { courseId: row.courseId, fields: Object.keys(data) } });
  return updated;
}
