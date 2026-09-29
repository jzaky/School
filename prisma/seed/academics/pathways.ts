// Demo data for the pathways module. Runs after the core demo seed and is safe to re-run:
// universities and programmes are upserted, and student results, scores and shortlists are only
// added when the student has none yet. Uses only db, orgId and now.
import type { PrismaClient, SchoolCurriculum } from "@prisma/client";
import { tenantDb } from "@/lib/tenant-db";
import { importInstitutions } from "@/server/pathways/scorecard";
import { snapshotInstitutions, universityStore } from "@/server/pathways/us-data";
import { addProgramToShortlist } from "@/server/pathways/shortlist";
import { CONFIRM_RESULT, CONFIRM_SCORE, RESULT_ENTITY, SCORE_ENTITY } from "@/server/pathways/profile";
import { EXTRA_UNIVERSITIES, PROGRAMS, UNIVERSITY_ROUTES } from "./pathways-data";
import type { SeedWorld } from "../demo";

const DAY = 86400_000;

export async function seedPathways(w: SeedWorld) {
  await seedPathwaysFor(w.db, w.orgId, w.now, w.log);
}

type Res = { code: string; level: string | null; predicted?: string; achieved?: string; confirmed?: boolean };
type Score = { kind: string; score: number; daysAgo: number; confirmed?: boolean };

export async function seedPathwaysFor(db: PrismaClient, orgId: string, now = new Date(), log: (m: string) => void = () => {}) {
  // 1. Universities: Jordan and Australia additions, plus routes for catalogue entries.
  for (const u of EXTRA_UNIVERSITIES) {
    await db.university.upsert({
      where: { orgId_key: { orgId, key: u.key } },
      create: { orgId, key: u.key, nameEn: u.name.en, nameAr: u.name.ar, countryCode: u.countryCode, cityEn: u.city.en, cityAr: u.city.ar, website: u.website, deadlineMonth: u.deadlineMonth, system: u.system, applyVia: u.applyVia, programsEn: u.programs },
      update: {},
    });
  }
  for (const [key, r] of Object.entries(UNIVERSITY_ROUTES)) {
    await db.university.updateMany({ where: { orgId, key, applyVia: null }, data: { system: r.system, applyVia: r.applyVia } });
  }
  const unis = await db.university.findMany({ where: { orgId, key: { in: [...new Set(PROGRAMS.map((p) => p.uni))] } }, select: { id: true, key: true } });
  const uniId = new Map(unis.map((u) => [u.key, u.id]));

  // 2. Programmes: always indicative and unchecked (see pathways-data.ts). Existing rows keep any counselor edits.
  let programs = 0;
  for (const p of PROGRAMS) {
    const universityId = uniId.get(p.uni);
    if (!universityId) continue;
    await db.universityProgram.upsert({
      where: { orgId_key: { orgId, key: p.key } },
      create: {
        orgId,
        universityId,
        key: p.key,
        nameEn: p.name.en,
        nameAr: p.name.ar,
        field: p.field,
        degree: p.degree,
        durationYears: p.years,
        requiredSubjects: p.required,
        recommendedSubjects: p.recommended,
        requirements: p.req as never,
        englishReq: (p.english ?? undefined) as never,
        notesEn: p.notes?.en ?? null,
        notesAr: p.notes?.ar ?? null,
        sourceUrl: p.source,
        indicative: true,
        lastVerifiedAt: null,
        createdAt: new Date(now.getTime() - 120 * DAY),
      },
      update: {},
    });
    programs++;
  }

  // 3. US institutions from the committed College Scorecard snapshot, when one has been generated.
  const us = snapshotInstitutions();
  if (us.length) {
    const c = await importInstitutions(universityStore(db, orgId), us);
    log(`pathways: US institutions from snapshot: ${c.created} created, ${c.linked} linked, ${c.updated} updated`);
  }

  // 4. Students: Adam (British) and a few seniors on other curricula.
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
    adamSeeded = await addResults(
      adam.id,
      "BRITISH",
      [
        { code: "MATH", level: "A_LEVEL", predicted: "A*" },
        { code: "PHYS", level: "A_LEVEL", predicted: "A" },
        { code: "CHEM", level: "A_LEVEL", predicted: "B" },
        { code: "ECON", level: "A_LEVEL", predicted: "A", confirmed: false },
        { code: "MATH", level: "GCSE", achieved: "9" },
      ],
      [{ kind: "IELTS", score: 6.5, daysAgo: 45 }],
      adam.membershipId,
    );
    const hasShortlist = await db.shortlistEntry.count({ where: { orgId, studentId: adam.id } });
    if (!hasShortlist) {
      const keys: Array<[string, number]> = [
        ["ucl-computer-science-bsc", 40],
        ["imperial-computing-beng", 32],
        ["uoft-computer-science-bsc", 21],
        ["lse-economics-bsc", 12],
      ];
      for (const [key, daysAgo] of keys) {
        const p = await db.universityProgram.findFirst({ where: { orgId, key } });
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
  log(`pathways: ${programs} programmes, ${students + (adamSeeded ? 1 : 0)} students given results`);
}
