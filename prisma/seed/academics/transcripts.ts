// Demo data for transcript import and the counselor dashboard. Runs after seedPathwayEngine and is safe to
// re-run: each import is found by its file name and skipped when it already exists.
// - A committed import of the Grade 11 British student's IGCSE results and A-level predictions (one line, Global Perspectives,
//   has no catalog course and waits for mapping review).
// - A transfer student from a CBSE school with their Class X marksheet uploaded and waiting for review:
//   three lines match automatically, two need a person (English and Information Technology).
// - Cached match results for every student with a plan or course record, so the dashboard has data.
// Everything goes through the module's own service functions, so the data is exactly what the app makes.
import type { PrismaClient } from "@prisma/client";
import { tenantDb } from "@/lib/tenant-db";
import type { EngineActor } from "@/server/pathway-engine/access";
import { commitImport, createImport } from "@/server/transcripts/service";
import { recomputeCaseload } from "@/server/transcripts/dashboard";
import type { ParsedRow } from "@/server/transcripts/types";
import type { SeedWorld } from "../demo";

const DAY = 86_400_000;
export const IGCSE_FILE = "igcse-results-and-predictions.csv";
export const CBSE_FILE = "cbse-class-x-marksheet.pdf";

export async function seedTranscripts(w: SeedWorld) {
  await seedTranscriptsFor(w.db, w.orgId, w.now, w.log);
}

const row = (name: string, gradeLevel: number, schoolYear: string, status: ParsedRow["status"], finalGrade: string | null, predictedGrade: string | null = null, code: string | null = null, gradeScale: string | null = null): ParsedRow => ({
  name,
  code,
  curriculum: null,
  gradeLevel,
  schoolYear,
  status,
  finalGrade,
  predictedGrade,
  gradeScale,
});

export async function seedTranscriptsFor(db: PrismaClient, orgId: string, now = new Date(), log: (m: string) => void = () => {}) {
  const personas = await db.demoPersona.findMany({ where: { orgId, key: { in: ["counselor", "career_advisor", "student"] } } });
  const pm = new Map(personas.map((p) => [p.key, p.membershipId]));
  const counselor = pm.get("counselor") ?? pm.get("career_advisor");
  if (!counselor) return;
  const actor: EngineActor = { db: tenantDb(orgId), orgId, membershipId: counselor, isStudent: false, isParent: false, isStaff: true, can: () => true, visibleStudentIds: null };
  const y = now.getUTCMonth() >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  const year = (back: number) => `${y - back}-${y - back + 1}`;
  let imports = 0;

  // 1. Grade 11 British student: IGCSE results and A-level predictions imported and committed.
  const withGrade10 = (await db.studentCourse.findMany({ where: { orgId, gradeLevel: 10 }, select: { studentId: true }, distinct: ["studentId"] })).map((s) => s.studentId);
  const med = await db.student.findFirst({ where: { orgId, gradeLevel: 11, curriculum: "BRITISH", status: "ACTIVE", id: { in: withGrade10 } }, orderBy: { studentNo: "desc" }, select: { id: true } });
  if (med && !(await db.transcriptImport.findFirst({ where: { orgId, fileName: IGCSE_FILE } }))) {
    const old = await db.studentCourse.findMany({ where: { orgId, studentId: med.id, gradeLevel: { in: [10, 11] }, source: { not: "IMPORT" } }, orderBy: [{ gradeLevel: "asc" }, { createdAt: "asc" }] });
    const courses = await db.curriculumCourse.findMany({ where: { id: { in: old.map((o) => o.courseId).filter((x): x is string => !!x) } }, select: { id: true, code: true, nameEn: true, gradeScale: true } });
    const byId = new Map(courses.map((c) => [c.id, c]));
    const rows: ParsedRow[] = old
      .filter((o) => o.courseId && byId.has(o.courseId))
      .map((o) => {
        const c = byId.get(o.courseId!)!;
        return row(c.nameEn, o.gradeLevel, o.gradeLevel === 10 ? year(1) : year(0), o.status, o.finalGrade, o.predictedGrade, null, c.gradeScale);
      });
    rows.push(row("IGCSE Global Perspectives", 10, year(1), "COMPLETED", "A", null, null, "IGCSE_LETTER"));
    // The school record rows become the imported rows (same courses and grades).
    await db.studentCourse.deleteMany({ where: { id: { in: old.filter((o) => o.courseId && byId.has(o.courseId)).map((o) => o.id) } } });
    const imp = await createImport(actor, { studentId: med.id, fileName: IGCSE_FILE, kind: "CSV", curriculum: "BRITISH", defaultGradeLevel: 10, rows, problems: [] });
    await commitImport(actor, imp.id);
    const when = new Date(now.getTime() - 21 * DAY);
    await db.transcriptImport.update({ where: { id: imp.id }, data: { createdAt: when } });
    await db.studentCourse.updateMany({ where: { orgId, importId: imp.id }, data: { createdAt: when } });
    imports++;
  }

  // 2. A transfer student from a CBSE school: Class X marksheet uploaded two days ago, waiting for review.
  if (!(await db.transcriptImport.findFirst({ where: { orgId, fileName: CBSE_FILE } }))) {
    const busy = new Set([
      ...(await db.studentCourse.findMany({ where: { orgId }, select: { studentId: true }, distinct: ["studentId"] })).map((s) => s.studentId),
      ...(await db.studentSubjectResult.findMany({ where: { orgId }, select: { studentId: true }, distinct: ["studentId"] })).map((s) => s.studentId),
      ...(await db.studentCoursePlan.findMany({ where: { orgId }, select: { studentId: true }, distinct: ["studentId"] })).map((s) => s.studentId),
    ]);
    const candidates = await db.student.findMany({ where: { orgId, gradeLevel: 11, status: "ACTIVE" }, orderBy: { studentNo: "asc" }, select: { id: true } });
    const transfer = candidates.find((c) => !busy.has(c.id));
    if (transfer) {
      await db.student.update({ where: { id: transfer.id }, data: { curriculum: "BRITISH" } });
      // Their A-levels at Horizon this year.
      const al = await db.curriculumCourse.findMany({ where: { orgId: null, code: { in: ["AL_MATH", "AL_PHYS", "AL_CS"] } }, select: { id: true, code: true, nameEn: true } });
      const predicted: Record<string, string> = { AL_MATH: "A", AL_PHYS: "B", AL_CS: "A" };
      await db.studentCourse.createMany({
        data: al.map((c) => ({ orgId, studentId: transfer.id, courseId: c.id, localName: c.nameEn, gradeLevel: 11, schoolYear: year(0), status: "IN_PROGRESS" as const, predictedGrade: predicted[c.code], gradeScale: "A_LEVEL", source: "SCHOOL_RECORD", mappingStatus: "CONFIRMED" as const, createdAt: new Date(now.getTime() - 30 * DAY) })),
      });
      const rows: ParsedRow[] = [
        row("ENGLISH LNG & LIT.", 10, year(1), "COMPLETED", "88", null, null, "PERCENT"),
        row("MATHEMATICS STANDARD", 10, year(1), "COMPLETED", "95", null, null, "PERCENT"),
        row("SCIENCE", 10, year(1), "COMPLETED", "91", null, null, "PERCENT"),
        row("SOCIAL SCIENCE", 10, year(1), "COMPLETED", "86", null, null, "PERCENT"),
        row("INFORMATION TECHNOLOGY", 10, year(1), "COMPLETED", "97", null, null, "PERCENT"),
      ];
      const imp = await createImport(actor, { studentId: transfer.id, fileName: CBSE_FILE, kind: "PDF", curriculum: "CBSE", defaultGradeLevel: 10, rows, problems: [] });
      await db.transcriptImport.update({ where: { id: imp.id }, data: { createdAt: new Date(now.getTime() - 2 * DAY) } });
      imports++;
    }
  }

  // 3. Cached results for the dashboard.
  const { evaluated } = await recomputeCaseload(actor, {});
  log(`transcripts: ${imports} imports, ${evaluated} students evaluated`);
}
