// Demo data for the pathway engine: Horizon's course catalog for both tracks, course records for a
// few students and their Grade 9 to 12 plans (draft, proposed and approved). Safe to re-run: the
// catalog is upserted and students who already have course records or a plan are left alone.
// Needs the global catalog (seedGlobalCatalog) and, for goals, the career keys in data/careers.ts.
import type { PrismaClient, SchoolCurriculum, StudentCourseStatus } from "@prisma/client";
import { tenantDb } from "@/lib/tenant-db";
import type { EngineActor } from "@/server/pathway-engine/access";
import { generatePlan } from "@/server/pathway-engine/service";
import type { SeedWorld } from "../demo";

const DAY = 86400_000;
const ALL = [9, 10, 11, 12];

/** Horizon's courses: global CurriculumCourse code, grades offered, local Subject code. */
const AMERICAN_CATALOG: Array<[string, number[], string | null]> = [
  ["US_ENG9", [9], "ENG"],
  ["US_ENG10", [10], "ENG"],
  ["US_ENG11", [11], "ENG"],
  ["US_ENG12", [12], "ENG"],
  ["AP_ENG_LANG", [11, 12], "ENG"],
  ["US_ALG1", [9], "MATH"],
  ["US_ALG1_H", [9], "MATH"],
  ["US_GEOM", [9, 10], "MATH"],
  ["US_GEOM_H", [9, 10], "MATH"],
  ["US_ALG2", [10, 11], "MATH"],
  ["US_ALG2_H", [10, 11], "MATH"],
  ["US_PRECALC", [11, 12], "MATH"],
  ["US_PRECALC_H", [11, 12], "MATH"],
  ["AP_CALC_AB", [11, 12], "MATH"],
  ["AP_CALC_BC", [12], "MATH"],
  ["AP_STATS", [11, 12], "MATH"],
  ["US_BIO", [9], "BIO"],
  ["US_CHEM_H", [10, 11], "CHEM"],
  ["US_PHYS_H", [10, 11], "PHYS"],
  ["AP_PHYS_1", [11, 12], "PHYS"],
  ["AP_PHYS_C_MECH", [12], "PHYS"],
  ["AP_CHEM", [11, 12], "CHEM"],
  ["AP_BIO", [11, 12], "BIO"],
  ["US_INTRO_CS", [9, 10], "CS"],
  ["AP_CSP", [10, 11], "CS"],
  ["AP_CSA", [11, 12], "CS"],
  ["US_ARABIC", ALL, "ARAB"],
  ["US_ISLAMIC", ALL, "ISL"],
  ["US_UAE_SS", [9, 10], "SOC"],
  ["US_WORLD_HIST", [10], "HIST"],
  ["US_ECON", [12], "ECON"],
  ["AP_MACRO", [11, 12], "ECON"],
  ["AP_PSYCH", [11, 12], "PSY"],
  ["US_BUSINESS", [10, 11, 12], "BUS"],
  ["US_ART", ALL, "ART"],
  ["US_ROBOTICS", ALL, "DT"],
  ["US_FRENCH", ALL, "FR"],
  ["US_PE", ALL, "PE"],
];
const BRITISH_CATALOG: Array<[string, number[], string | null]> = [
  ...["ENG", "MATH", "ADD_MATH", "PHYS", "CHEM", "BIO", "CS", "ECON", "BUS", "GEO", "HIST", "ARABIC", "FRENCH", "ART", "DT"].map(
    (c): [string, number[], string | null] => [`IGCSE_${c}`, [9, 10], ({ ADD_MATH: "MATH", ARABIC: "ARAB", FRENCH: "FR" } as Record<string, string>)[c] ?? c],
  ),
  ...["MATH", "FURTHER_MATH", "PHYS", "CHEM", "BIO", "CS", "ECON", "BUS", "PSYCH", "ENG_LIT", "HIST", "GEO", "ARABIC", "ART"].map(
    (c): [string, number[], string | null] => [`AL_${c}`, [11, 12], ({ FURTHER_MATH: "MATH", PSYCH: "PSY", ENG_LIT: "ENG", ARABIC: "ARAB" } as Record<string, string>)[c] ?? c],
  ),
];

type CourseRow = { code: string; grade: number; status: StudentCourseStatus; final?: string; predicted?: string };

export async function seedPathwayEngine(w: SeedWorld) {
  await seedPathwayEngineFor(w.db, w.orgId, w.now, w.log);
}

export async function seedPathwayEngineFor(db: PrismaClient, orgId: string, now = new Date(), log: (m: string) => void = () => {}) {
  // 1. School catalog.
  const global = await db.curriculumCourse.findMany({ where: { orgId: null, curriculum: { in: ["AMERICAN", "BRITISH"] } }, select: { id: true, code: true, curriculum: true } });
  const byCode = new Map(global.map((c) => [c.code, c]));
  const subjects = new Map((await db.subject.findMany({ where: { orgId }, select: { id: true, code: true } })).map((s) => [s.code, s.id]));
  let catalog = 0;
  for (const [code, grades, subject] of [...AMERICAN_CATALOG, ...BRITISH_CATALOG]) {
    const c = byCode.get(code);
    if (!c) continue;
    await db.schoolCourse.upsert({
      where: { orgId_courseId: { orgId, courseId: c.id } },
      create: { orgId, courseId: c.id, subjectId: subject ? (subjects.get(subject) ?? null) : null, gradeLevels: grades, createdAt: new Date(now.getTime() - 200 * DAY) },
      update: { gradeLevels: grades, active: true },
    });
    catalog++;
  }

  // 2. People.
  const personas = await db.demoPersona.findMany({ where: { orgId, key: { in: ["student", "counselor", "career_advisor"] } } });
  const pm = new Map(personas.map((p) => [p.key, p.membershipId]));
  const counselor = pm.get("counselor") ?? null;
  const advisor = pm.get("career_advisor") ?? null;
  const adam = pm.get("student") ? await db.student.findFirst({ where: { orgId, membershipId: pm.get("student") } }) : null;
  const courseId = (code: string) => {
    const id = byCode.get(code)?.id ?? null;
    return id;
  };
  const allCodes = await db.curriculumCourse.findMany({ where: { orgId: null }, select: { id: true, code: true, gradeScale: true } });
  const anyCourse = new Map(allCodes.map((c) => [c.code, c]));
  const schoolYear = (grade: number, current: number) => {
    const y = now.getUTCMonth() >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
    const start = y - (current - grade);
    return `${start}-${start + 1}`;
  };

  const addCourses = async (studentId: string, currentGrade: number, rows: CourseRow[]) => {
    if ((await db.studentCourse.count({ where: { orgId, studentId } })) > 0) return false;
    await db.studentCourse.createMany({
      data: rows.map((r) => {
        const c = anyCourse.get(r.code)!;
        return {
          orgId,
          studentId,
          courseId: c.id,
          localName: r.code,
          gradeLevel: r.grade,
          schoolYear: schoolYear(r.grade, currentGrade),
          status: r.status,
          finalGrade: r.final ?? null,
          predictedGrade: r.predicted ?? null,
          gradeScale: c.gradeScale,
          source: "SCHOOL_RECORD",
          mappingStatus: "CONFIRMED" as const,
          createdAt: new Date(now.getTime() - (r.status === "COMPLETED" ? 120 : 30) * DAY),
        };
      }),
    });
    return true;
  };

  const actorFor = (membershipId: string): EngineActor => ({
    db: tenantDb(orgId),
    orgId,
    membershipId,
    isStudent: false,
    isParent: false,
    isStaff: true,
    can: () => true,
    visibleStudentIds: null,
  });
  const hasPlan = async (studentId: string) => (await db.studentCoursePlan.count({ where: { orgId, studentId } })) > 0;
  const dated = async (planId: string, daysAgo: number) => db.studentCoursePlan.update({ where: { id: planId }, data: { createdAt: new Date(now.getTime() - daysAgo * DAY) } });

  let students = 0;
  // 3. Adam: American track, Grade 9 in progress, a draft plan he built for AI engineering.
  if (adam) {
    await db.student.update({ where: { id: adam.id }, data: { curriculum: "AMERICAN" } });
    const added = await addCourses(adam.id, 9, [
      { code: "US_ALG1_H", grade: 9, status: "IN_PROGRESS", predicted: "A" },
      { code: "US_BIO", grade: 9, status: "IN_PROGRESS", predicted: "A-" },
      { code: "US_ENG9", grade: 9, status: "IN_PROGRESS", predicted: "A-" },
      { code: "US_ARABIC", grade: 9, status: "IN_PROGRESS", predicted: "B+" },
      { code: "US_INTRO_CS", grade: 9, status: "IN_PROGRESS", predicted: "A" },
    ]);
    if (added) students++;
    if (!(await hasPlan(adam.id)) && adam.membershipId) {
      const { planId } = await generatePlan(actorFor(adam.membershipId), adam.id, { careerKey: "ai_engineer", countries: ["GB", "US", "CA", "AE"] });
      await db.studentCoursePlan.update({ where: { id: planId }, data: { name: "My plan for AI engineering", status: "DRAFT", createdAt: new Date(now.getTime() - 6 * DAY) } });
    }
  }

  // Students without pathway records yet, so this seed never mixes curricula with the pathways seed.
  const taken = new Set((await db.studentSubjectResult.findMany({ where: { orgId }, select: { studentId: true }, distinct: ["studentId"] })).map((r) => r.studentId));
  const pickStudent = async (grade: number, skip: string[]) => {
    const rows = await db.student.findMany({ where: { orgId, gradeLevel: grade, status: "ACTIVE", id: { notIn: [...skip, ...(adam ? [adam.id] : [])] } }, orderBy: { studentNo: "desc" }, take: 20 });
    return rows.find((s) => !taken.has(s.id)) ?? null;
  };
  const used: string[] = [];
  const setCurriculum = async (id: string, curriculum: SchoolCurriculum) => db.student.update({ where: { id }, data: { curriculum } });

  // 4. Grade 11, British track, aiming for Medicine in the UK. Approved plan.
  const med = await pickStudent(11, used);
  if (med) {
    used.push(med.id);
    await setCurriculum(med.id, "BRITISH");
    const added = await addCourses(med.id, 11, [
      { code: "IGCSE_MATH", grade: 10, status: "COMPLETED", final: "A*" },
      { code: "IGCSE_BIO", grade: 10, status: "COMPLETED", final: "A*" },
      { code: "IGCSE_CHEM", grade: 10, status: "COMPLETED", final: "A" },
      { code: "IGCSE_PHYS", grade: 10, status: "COMPLETED", final: "A" },
      { code: "IGCSE_ENG", grade: 10, status: "COMPLETED", final: "A" },
      { code: "IGCSE_ARABIC", grade: 10, status: "COMPLETED", final: "A*" },
      { code: "AL_BIO", grade: 11, status: "IN_PROGRESS", predicted: "A*" },
      { code: "AL_CHEM", grade: 11, status: "IN_PROGRESS", predicted: "A" },
      { code: "AL_MATH", grade: 11, status: "IN_PROGRESS", predicted: "A" },
    ]);
    if (added) {
      students++;
      await db.studentTestScore.create({ data: { orgId, studentId: med.id, kind: "IELTS", score: 7.5, takenAt: new Date(now.getTime() - 70 * DAY), createdAt: new Date(now.getTime() - 65 * DAY) } });
    }
    if (!(await hasPlan(med.id)) && counselor) {
      const { planId } = await generatePlan(actorFor(counselor), med.id, { careerKey: "doctor", countries: ["GB", "IE", "AE"] });
      await db.studentCoursePlan.update({
        where: { id: planId },
        data: { name: "Medicine pathway", status: "APPROVED", proposedById: counselor, approvedById: counselor, approvedAt: new Date(now.getTime() - 18 * DAY), counselorNote: "Strong sciences. Book the UCAT for the summer and plan hospital volunteering before Grade 12.", createdAt: new Date(now.getTime() - 40 * DAY) },
      });
      await db.auditEvent.create({ data: { orgId, actorId: counselor, action: "pathways.plan.approve", entityType: "StudentCoursePlan", entityId: planId, meta: { studentId: med.id, withNote: true }, createdAt: new Date(now.getTime() - 18 * DAY) } });
    }
  }

  // 5. Grade 12, IB Diploma (joined from another school), aiming for Computer Science. Proposed plan.
  const ib = await pickStudent(12, used);
  if (ib) {
    used.push(ib.id);
    await setCurriculum(ib.id, "IB");
    const rows: CourseRow[] = [
      { code: "IB_MATH_AA_HL", grade: 12, status: "IN_PROGRESS", predicted: "7" },
      { code: "IB_CS_HL", grade: 12, status: "IN_PROGRESS", predicted: "7" },
      { code: "IB_PHYS_HL", grade: 12, status: "IN_PROGRESS", predicted: "6" },
      { code: "IB_ENG_LL_SL", grade: 12, status: "IN_PROGRESS", predicted: "6" },
      { code: "IB_ARABIC_A_SL", grade: 12, status: "IN_PROGRESS", predicted: "6" },
      { code: "IB_ECON_SL", grade: 12, status: "IN_PROGRESS", predicted: "6" },
    ];
    if (await addCourses(ib.id, 12, rows)) {
      students++;
      await db.studentTestScore.createMany({ data: [
        { orgId, studentId: ib.id, kind: "IELTS", score: 8, takenAt: new Date(now.getTime() - 120 * DAY), createdAt: new Date(now.getTime() - 115 * DAY) },
        { orgId, studentId: ib.id, kind: "SAT", score: 1490, takenAt: new Date(now.getTime() - 50 * DAY), createdAt: new Date(now.getTime() - 45 * DAY) },
      ] });
    }
    if (!(await hasPlan(ib.id)) && advisor) {
      const plan = await db.studentCoursePlan.create({
        data: { orgId, studentId: ib.id, name: "Computer Science applications", status: "PROPOSED", goalCareerKey: "software_developer", goalFieldKeys: ["computer_science"], targetCountries: ["GB", "US", "CA", "NL"], proposedById: advisor, createdAt: new Date(now.getTime() - 12 * DAY) },
      });
      await db.studentCoursePlanItem.createMany({
        data: rows.map((r) => ({ orgId, planId: plan.id, gradeLevel: 12, courseId: courseId(r.code) ?? anyCourse.get(r.code)?.id ?? null, reasonEn: "Diploma subject in progress.", reasonAr: "مادة من مواد الدبلوم قيد الدراسة.", locked: true })),
      });
      await db.auditEvent.create({ data: { orgId, actorId: advisor, action: "pathways.plan.submit", entityType: "StudentCoursePlan", entityId: plan.id, meta: { studentId: ib.id }, createdAt: new Date(now.getTime() - 12 * DAY) } });
    }
  }

  // 6. Grade 10, UAE MoE Advanced stream, aiming for engineering at a UAE university. Proposed plan.
  const moe = await pickStudent(10, used);
  if (moe) {
    used.push(moe.id);
    await setCurriculum(moe.id, "UAE_MOE");
    if (await addCourses(moe.id, 10, [
      { code: "MOE_ADV_MATH", grade: 10, status: "IN_PROGRESS", predicted: "92" },
      { code: "MOE_ADV_PHYS", grade: 10, status: "IN_PROGRESS", predicted: "88" },
      { code: "MOE_ENG", grade: 10, status: "IN_PROGRESS", predicted: "85" },
      { code: "MOE_ARABIC", grade: 10, status: "IN_PROGRESS", predicted: "90" },
    ])) {
      students++;
      await db.studentSubjectResult.create({ data: { orgId, studentId: moe.id, subjectCode: "OVERALL", curriculum: "UAE_MOE", level: "ADVANCED", predicted: "91" } });
    }
    if (!(await hasPlan(moe.id)) && moe.membershipId) {
      const plan = await db.studentCoursePlan.create({
        data: { orgId, studentId: moe.id, name: "Engineering in the UAE", status: "PROPOSED", goalCareerKey: "mechanical_engineer", goalFieldKeys: [], targetCountries: ["AE"], proposedById: moe.membershipId, createdAt: new Date(now.getTime() - 4 * DAY) },
      });
      const items: Array<[number, string]> = [
        [11, "MOE_ADV_CHEM"],
        [11, "MOE_CDI"],
        [12, "MOE_ADV_BIO"],
      ];
      await db.studentCoursePlanItem.createMany({ data: items.map(([g, code]) => ({ orgId, planId: plan.id, gradeLevel: g, courseId: anyCourse.get(code)?.id ?? null, reasonEn: "Keeps the Advanced stream options open for engineering.", reasonAr: "تُبقي خيارات المسار المتقدم مفتوحة للهندسة.", locked: false })) });
    }
  }

  // 7. Grade 10, American track, aiming for software engineering. Proposed plan waiting for approval.
  const us = await pickStudent(10, used);
  if (us) {
    used.push(us.id);
    await setCurriculum(us.id, "AMERICAN");
    if (await addCourses(us.id, 10, [
      { code: "US_ALG1_H", grade: 9, status: "COMPLETED", final: "A" },
      { code: "US_BIO", grade: 9, status: "COMPLETED", final: "A-" },
      { code: "US_ENG9", grade: 9, status: "COMPLETED", final: "B+" },
      { code: "US_INTRO_CS", grade: 9, status: "COMPLETED", final: "A" },
      { code: "US_ARABIC", grade: 9, status: "COMPLETED", final: "A-" },
      { code: "US_GEOM_H", grade: 10, status: "IN_PROGRESS", predicted: "A-" },
      { code: "US_ALG2_H", grade: 10, status: "IN_PROGRESS", predicted: "A" },
      { code: "US_CHEM_H", grade: 10, status: "IN_PROGRESS", predicted: "B+" },
      { code: "US_ENG10", grade: 10, status: "IN_PROGRESS", predicted: "A-" },
      { code: "AP_CSP", grade: 10, status: "IN_PROGRESS", predicted: "5" },
    ])) {
      students++;
      await db.studentSubjectResult.create({ data: { orgId, studentId: us.id, subjectCode: "OVERALL", curriculum: "AMERICAN", level: "GPA", predicted: "3.8" } });
    }
    if (!(await hasPlan(us.id)) && us.membershipId) {
      const { planId } = await generatePlan(actorFor(us.membershipId), us.id, { careerKey: "software_developer", countries: ["US", "CA", "AE"] });
      await db.studentCoursePlan.update({ where: { id: planId }, data: { name: "Software engineering plan", status: "PROPOSED", proposedById: us.membershipId } });
      await dated(planId, 3);
    }
  }
  log(`pathway engine: ${catalog} school courses, ${students} students with course records`);
}
