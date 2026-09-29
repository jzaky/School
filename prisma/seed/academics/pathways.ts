// Demo data for the pathways module. Runs after the core demo seed and is safe to re-run.
// Universities and programmes come from the global catalog (prisma/seed/catalog, orgId null);
// this seed only adds student results, scores and shortlists, and only when the student has none yet.
// Uses only db, orgId and now.
import type { PrismaClient, SchoolCurriculum } from "@prisma/client";
import { tenantDb } from "@/lib/tenant-db";
import { addProgramToShortlist } from "@/server/pathways/shortlist";
import { CONFIRM_RESULT, CONFIRM_SCORE, RESULT_ENTITY, SCORE_ENTITY } from "@/server/pathways/profile";
import type { SeedWorld } from "../demo";

const DAY = 86400_000;

export async function seedPathways(w: SeedWorld) {
  await seedPathwaysFor(w.db, w.orgId, w.now, w.log);
}

type Res = { code: string; level: string | null; predicted?: string; achieved?: string; confirmed?: boolean };
type Score = { kind: string; score: number; daysAgo: number; confirmed?: boolean };

export async function seedPathwaysFor(db: PrismaClient, orgId: string, now = new Date(), log: (m: string) => void = () => {}) {
  // 1. Older versions of this seed copied universities and programmes into each school. Those copies
  // are replaced by the global catalog; remove any that no shortlist still points to.
  const globalKeys = (await db.university.findMany({ where: { orgId: null }, select: { key: true } })).map((u) => u.key);
  const stale = await db.university.findMany({ where: { orgId, key: { in: globalKeys }, entries: { none: {} } }, select: { id: true } });
  if (stale.length) {
    await db.universityProgram.deleteMany({ where: { orgId, universityId: { in: stale.map((u) => u.id) } } });
    await db.university.deleteMany({ where: { id: { in: stale.map((u) => u.id) } } });
  }
  const programs = await db.universityProgram.count({ where: { orgId: null } });

  // 2. Students: Adam (American track) and a few seniors on other curricula.
  const personas = await db.demoPersona.findMany({ where: { orgId, key: { in: ["student", "counselor", "career_advisor"] } } });
  const pm = new Map(personas.map((p) => [p.key, p.membershipId]));
  const counselor = pm.get("counselor") ?? null;
  const advisor = pm.get("career_advisor") ?? null;
  const adam = pm.get("student") ? await db.student.findFirst({ where: { orgId, membershipId: pm.get("student") } }) : null;

  const addResults = async (studentId: string, curriculum: SchoolCurriculum, results: Res[], scores: Score[], createdBy: string | null) => {
    if ((await db.studentSubjectResult.count({ where: { orgId, studentId } })) > 0) return false;
    await db.student.update({ where: { id: studentId }, data: { curriculum } });
    for (const r of results) {
      const row = await db.studentSubjectResult.create({ data: { orgId, studentId, subjectCode: r.code, curriculum, level: r.level, predicted: r.predicted ?? null, achieved: r.achieved ?? null, updatedById: createdBy } });
      if (r.confirmed !== false && counselor) {
        await db.auditEvent.create({ data: { orgId, actorId: counselor, action: CONFIRM_RESULT, entityType: RESULT_ENTITY, entityId: row.id, createdAt: new Date(), meta: { studentId } } });
      }
    }
    for (const s of scores) {
      const row = await db.studentTestScore.create({ data: { orgId, studentId, kind: s.kind, score: s.score, takenAt: new Date(now.getTime() - s.daysAgo * DAY), createdAt: new Date(now.getTime() - (s.daysAgo - 5) * DAY) } });
      if (s.confirmed !== false && counselor) {
        await db.auditEvent.create({ data: { orgId, actorId: counselor, action: CONFIRM_SCORE, entityType: SCORE_ENTITY, entityId: row.id, createdAt: new Date(now.getTime() - (s.daysAgo - 8) * DAY), meta: { studentId } } });
      }
    }
    return true;
  };

  let adamSeeded = false;
  if (adam) {
    // Early A-level forecasts from his subject teachers, and a first IELTS attempt.
    // Adam is on the American track: a current GPA from his teachers and a first IELTS attempt.
    adamSeeded = await addResults(adam.id, "AMERICAN", [{ code: "OVERALL", level: "GPA", predicted: "3.9" }], [{ kind: "IELTS", score: 7, daysAgo: 45 }], adam.membershipId);
    const hasShortlist = await db.shortlistEntry.count({ where: { orgId, studentId: adam.id } });
    if (!hasShortlist) {
      const keys: Array<[string, number]> = [
        ["ucl-computer-science-bsc", 40],
        ["imperial-computing-beng", 32],
        ["uoft-computer-science-bsc", 21],
        ["lse-economics-bsc", 12],
      ];
      for (const [key, daysAgo] of keys) {
        const p = await db.universityProgram.findFirst({ where: { orgId: null, key } });
        if (!p) continue;
        const res = await addProgramToShortlist(tenantDb(orgId), orgId, { studentId: adam.id, programId: p.id, actorId: advisor, now });
        if (res.ok) {
          await db.shortlistEntry.update({ where: { id: res.entryId }, data: { createdAt: new Date(now.getTime() - daysAgo * DAY), status: daysAgo > 30 ? "PREPARING" : "RESEARCHING" } });
          const reqs = await db.shortlistRequirement.findMany({ where: { entryId: res.entryId }, orderBy: { dueAt: "asc" } });
          if (daysAgo > 30) await db.shortlistRequirement.updateMany({ where: { id: { in: reqs.slice(0, 2).map((r) => r.id) } }, data: { done: true } });
        }
      }
    }
  }

  const seniors = await db.student.findMany({ where: { orgId, gradeLevel: { in: [11, 12] }, status: "ACTIVE" }, orderBy: { studentNo: "asc" }, take: 6 });
  const plans: Array<{ curriculum: SchoolCurriculum; results: Res[]; scores: Score[] }> = [
    {
      curriculum: "IB",
      results: [
        { code: "OVERALL", level: null, predicted: "38" },
        { code: "MATH", level: "HL", predicted: "7" },
        { code: "PHYS", level: "HL", predicted: "6" },
        { code: "CHEM", level: "HL", predicted: "6" },
        { code: "ENG", level: "SL", predicted: "6" },
      ],
      scores: [{ kind: "IELTS", score: 7.5, daysAgo: 80 }],
    },
    {
      curriculum: "AMERICAN",
      results: [
        { code: "OVERALL", level: "GPA", predicted: "3.8" },
        { code: "MATH", level: "AP", achieved: "5" },
        { code: "CS", level: "AP", achieved: "4" },
      ],
      scores: [
        { kind: "SAT", score: 1480, daysAgo: 120 },
        { kind: "TOEFL", score: 104, daysAgo: 60, confirmed: false },
      ],
    },
    {
      curriculum: "UAE_MOE",
      results: [{ code: "OVERALL", level: "ADVANCED", predicted: "94" }],
      scores: [
        { kind: "EMSAT_ENGLISH", score: 1450, daysAgo: 70 },
        { kind: "EMSAT_MATH", score: 975, daysAgo: 70 },
        { kind: "EMSAT_PHYSICS", score: 850, daysAgo: 70, confirmed: false },
      ],
    },
    {
      curriculum: "JORDAN_TAWJIHI",
      results: [{ code: "OVERALL", level: "SCIENTIFIC", predicted: "91.4" }],
      scores: [{ kind: "IELTS", score: 6.0, daysAgo: 30 }],
    },
    {
      curriculum: "BRITISH",
      results: [
        { code: "MATH", level: "A_LEVEL", predicted: "A", achieved: "A" },
        { code: "BIO", level: "A_LEVEL", predicted: "A*" },
        { code: "CHEM", level: "A_LEVEL", predicted: "A" },
      ],
      scores: [
        { kind: "IELTS", score: 7.0, daysAgo: 100 },
        { kind: "UCAT", score: 2750, daysAgo: 50 },
      ],
    },
  ];
  let students = 0;
  for (const [i, plan] of plans.entries()) {
    const s = seniors[i];
    if (!s) break;
    if (await addResults(s.id, plan.curriculum, plan.results, plan.scores, counselor)) students++;
  }
  log(`pathways: ${programs} catalog programmes, ${students + (adamSeeded ? 1 : 0)} students given results`);
}
