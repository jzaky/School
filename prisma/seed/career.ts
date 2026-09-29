// Career guidance history: completed assessments, recommendations (approved and draft), chosen paths and shortlists.
import { DIMENSIONS, type CareerWeights, type Dimension } from "@/server/career/dimensions";
import { matchCareers, reasoning, scoreAssessment, suggestCategory } from "@/server/career/scoring";
import { at, rng } from "./lib";
import type { SeedWorld } from "./demo";

const PROFILES: Dimension[][] = [
  ["analytical", "investigative", "technical"],
  ["social", "verbal", "organized"],
  ["creative", "spatial", "technical"],
  ["enterprising", "verbal", "social"],
  ["investigative", "social", "organized"],
  ["analytical", "enterprising", "organized"],
  ["creative", "verbal", "social"],
  ["investigative", "analytical", "organized"],
];

export async function seedCareer(w: SeedWorld) {
  const { db, orgId, now } = w;
  const r = rng(777);
  const layla = w.staff.get("layla_hassan")!.membershipId;
  const questions = await db.aptitudeQuestion.findMany({ where: { orgId } });
  const careers = await db.career.findMany({ where: { orgId } });
  // Global catalog universities with curated programme lists (not the full US import).
  const unis = await db.university.findMany({ where: { orgId: null, programsEn: { isEmpty: false } }, orderBy: { key: "asc" } });
  const pool = w.students.filter((s) => s.grade >= 10 && s !== w.adam && s !== w.yara);
  const chosenStudents = r.shuffle(pool).slice(0, 14);
  for (const [i, s] of chosenStudents.entries()) {
    const strong = PROFILES[i % PROFILES.length];
    const answers = Object.fromEntries(questions.map((q) => {
      const likes = strong.includes(q.dimension as Dimension);
      const v = Math.min(5, Math.max(1, (likes ? 4 : 2) + (r.chance(0.4) ? 1 : 0) - (r.chance(0.2) ? 1 : 0)));
      return [q.id, q.reverse ? 6 - v : v];
    }));
    const scores = scoreAssessment(questions, answers);
    const completedAt = at(-(5 + i * 6), 11, 0, now);
    const assessment = await db.aptitudeAssessment.create({ data: { orgId, studentId: s.id, answers, scores, completedAt, createdAt: completedAt } });
    const matches = matchCareers(scores, careers.map((c) => ({ id: c.id, key: c.key, weights: c.weights as CareerWeights, subjects: c.subjects })), s.subjects).slice(0, 8);
    const reviewed = i % 4 !== 0;
    await db.careerRecommendation.createMany({
      data: matches.map((m, rank) => {
        const career = careers.find((c) => c.id === m.careerId)!;
        const text = reasoning(m, { en: career.titleEn, ar: career.titleAr });
        return { orgId, studentId: s.id, assessmentId: assessment.id, careerId: career.id, rank: rank + 1, matchScore: m.matchScore, reasoningEn: text.en, reasoningAr: text.ar, status: reviewed ? "APPROVED" : "DRAFT", approvedById: reviewed ? layla : null, approvedAt: reviewed ? at(-(3 + i * 6), 13, 0, now) : null, chosen: reviewed && rank === 0, createdAt: completedAt };
      }),
    });
    await db.careerProfile.create({
      data: { orgId, studentId: s.id, interestsEn: strong.map(String), interestsAr: [], favoriteSubjects: s.subjects, preferredCountries: ["AE", "GB"], chosenCareerId: reviewed ? matches[0].careerId : null, advisorId: layla },
    });
    if (s.grade >= 11) {
      const picks = r.shuffle(unis).slice(0, 3 + (i % 3));
      for (const [j, u] of picks.entries()) {
        const month = u.deadlineMonth ?? 1;
        const year = now.getUTCMonth() + 1 > month ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
        const deadline = new Date(Date.UTC(year, month - 1, 15, 8));
        const entry = await db.shortlistEntry.create({
          data: { orgId, studentId: s.id, universityId: u.id, programEn: u.programsEn[0] ?? "", category: suggestCategory(u.acceptanceRate), status: j === 0 && s.grade === 12 ? "SUBMITTED" : j === 1 ? "PREPARING" : "RESEARCHING", deadline, createdAt: completedAt },
        });
        await db.shortlistRequirement.createMany({
          data: [
            ["Personal statement drafted", "إعداد المقال الشخصي", 8],
            ["Predicted grades requested", "طلب الدرجات المتوقعة", 6],
            ["Reference letter requested", "طلب خطاب التوصية", 6],
            ["English test (IELTS or TOEFL) booked", "حجز اختبار اللغة الإنجليزية (IELTS أو TOEFL)", 10],
            ["Application form submitted", "تقديم طلب الالتحاق", 0],
          ].map(([en, ar, weeks], k) => ({ orgId, entryId: entry.id, labelEn: en as string, labelAr: ar as string, done: j === 0 && s.grade === 12 ? true : k < (i % 3), dueAt: new Date(deadline.getTime() - (weeks as number) * 7 * 86400_000) })),
        });
      }
    }
  }
  void DIMENSIONS;
}
