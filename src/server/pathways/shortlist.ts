// Adding a programme to a student's university shortlist. The entry keeps the programme name so the
// shortlist can find the programme again and run the requirements checker on it.
import type { ShortlistCategory } from "@prisma/client";
import type { TenantDb } from "@/lib/tenant-db";

type Db = TenantDb;
import { audit } from "@/server/audit/audit";
import { suggestCategory } from "@/server/career/scoring";
import { checkProgram, loadStudentPathway, programDeadline } from "./profile";
import type { CheckResult, ProgramRequirements } from "./types";

const CHECKLIST: Array<{ en: string; ar: string; weeksBefore: number }> = [
  { en: "Personal statement drafted", ar: "إعداد المقال الشخصي", weeksBefore: 8 },
  { en: "Predicted grades requested", ar: "طلب الدرجات المتوقعة", weeksBefore: 6 },
  { en: "Reference letter requested", ar: "طلب خطاب التوصية", weeksBefore: 6 },
  { en: "English test (IELTS or TOEFL) booked", ar: "حجز اختبار اللغة الإنجليزية (IELTS أو TOEFL)", weeksBefore: 10 },
  { en: "Entry requirements confirmed with the university", ar: "تأكيد شروط القبول مع الجامعة", weeksBefore: 12 },
  { en: "Application form submitted", ar: "تقديم طلب الالتحاق", weeksBefore: 0 },
];

/** Reach when a listed requirement is not met, target when something is still unknown, otherwise by admission rate. */
export function categoryFor(check: CheckResult, acceptanceRate: number | null): ShortlistCategory {
  if (check.summary.notMet > 0) return "REACH";
  if (check.summary.unknown > 0) return "TARGET";
  return suggestCategory(acceptanceRate);
}

export type AddResult = { ok: true; entryId: string; created: boolean } | { ok: false; error: "not_found" };

export async function addProgramToShortlist(db: Db, orgId: string, input: { studentId: string; programId: string; actorId: string | null; category?: ShortlistCategory; now?: Date }): Promise<AddResult> {
  const program = await db.universityProgram.findFirst({ where: { id: input.programId, orgId } });
  if (!program) return { ok: false, error: "not_found" };
  const [uni, data] = await Promise.all([db.university.findFirst({ where: { id: program.universityId, orgId } }), loadStudentPathway(db, orgId, input.studentId)]);
  if (!uni || !data) return { ok: false, error: "not_found" };
  const existing = await db.shortlistEntry.findFirst({ where: { studentId: input.studentId, universityId: uni.id, programEn: program.nameEn } });
  if (existing) return { ok: true, entryId: existing.id, created: false };
  const check = checkProgram(program, data);
  const req = (program.requirements ?? {}) as ProgramRequirements;
  const deadline = programDeadline(req, uni.deadlineMonth, input.now);
  const tasks = [...CHECKLIST];
  for (const test of req.admissionsTests ?? []) tasks.splice(1, 0, { en: `Register for the ${test} admissions test`, ar: `التسجيل في اختبار القبول ${test}`, weeksBefore: 16 });
  const entry = await db.shortlistEntry.create({
    data: {
      orgId,
      studentId: input.studentId,
      universityId: uni.id,
      programEn: program.nameEn,
      programAr: program.nameAr,
      category: input.category ?? categoryFor(check, uni.acceptanceRate),
      status: "RESEARCHING",
      deadline,
      requirements: {
        create: tasks.map((r) => ({ orgId, labelEn: r.en, labelAr: r.ar, dueAt: deadline ? new Date(deadline.getTime() - r.weeksBefore * 7 * 86400_000) : null })),
      },
    },
  });
  await audit(db, orgId, { actorId: input.actorId, action: "pathways.shortlist.add", entityType: "ShortlistEntry", entityId: entry.id, meta: { programId: program.id, studentId: input.studentId } });
  return { ok: true, entryId: entry.id, created: true };
}

/** Programmes matching shortlist entries (same university and programme name). */
export async function programsForEntries(db: Db, entries: Array<{ universityId: string; programEn: string }>) {
  const rows = !entries.length ? [] : await db.universityProgram.findMany({ where: { universityId: { in: [...new Set(entries.map((e) => e.universityId))] } } });
  const map = new Map<string, (typeof rows)[number]>();
  for (const e of entries) {
    const p = rows.find((r) => r.universityId === e.universityId && r.nameEn === e.programEn);
    if (p) map.set(`${e.universityId}|${e.programEn}`, p);
  }
  return map;
}
