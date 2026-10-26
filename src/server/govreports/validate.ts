// Checks run on a return before it is sent. Each problem names the record to fix; none ever carries an Emirates
// ID (only whether one is on file). The pure rules are unit-tested; the loader gathers what they need.
import type { TenantDb } from "@/lib/tenant-db";
import { decryptField } from "@/lib/crypto";
import { ageFlag, eidDigits, nameDobKey } from "@/server/admissions/rules";
import { eidHash } from "@/server/admissions/secure";
import type { Problem, ProblemRule } from "./kinds";
import { RULE_SEVERITY } from "./kinds";
import type { RollStudent } from "./roll";

const problem = (rule: ProblemRule, key: string, extra: Omit<Problem, "key" | "rule" | "severity"> = {}): Problem => ({ key: `${rule}:${key}`, rule, severity: RULE_SEVERITY[rule], ...extra });

export type StudentCheckInput = {
  students: Array<Pick<RollStudent, "id" | "firstNameEn" | "lastNameEn" | "grade" | "dateOfBirth" | "gender" | "nationalityEn" | "nationalityAr" | "hasEid">>;
  /** Year of entry and age cut-off from the admissions settings (src/server/admissions/rules.ts). */
  entryYear: number;
  cutoff: { month: number; day: number };
  /** Students with a registration reference from the authority. */
  withReference: ReadonlySet<string>;
  /** Keyed hash of each student's Emirates ID digits (never the digits), for duplicate detection. */
  eidHashes: ReadonlyMap<string, string>;
};

/** Identity, age, registration and duplicate checks over a set of students. Order: by student, then rule. */
export function studentProblems(input: StudentCheckInput): Problem[] {
  const out: Problem[] = [];
  for (const s of input.students) {
    if (!s.hasEid) out.push(problem("missing_eid", s.id, { studentId: s.id }));
    if (!(s.nationalityEn ?? "").trim() && !(s.nationalityAr ?? "").trim()) out.push(problem("missing_nationality", s.id, { studentId: s.id }));
    if (!s.dateOfBirth) out.push(problem("missing_dob", s.id, { studentId: s.id }));
    if (!(s.gender ?? "").trim()) out.push(problem("missing_gender", s.id, { studentId: s.id }));
    if (s.dateOfBirth) {
      const a = ageFlag(s.dateOfBirth, s.grade, input.entryYear, input.cutoff);
      if (a.flag) out.push(problem("age_grade", s.id, { studentId: s.id, values: { age: a.age ?? 0, expected: a.expected, direction: a.flag === "UNDER" ? "under" : "over" } }));
    }
    if (!input.withReference.has(s.id)) out.push(problem("no_reference", s.id, { studentId: s.id }));
  }
  // Duplicates: the same Emirates ID, or the same name and date of birth, on two records. One problem per pair.
  const byEid = new Map<string, string[]>();
  const byName = new Map<string, string[]>();
  for (const s of input.students) {
    const h = input.eidHashes.get(s.id);
    if (h) byEid.set(h, [...(byEid.get(h) ?? []), s.id]);
    const k = nameDobKey(s.firstNameEn, s.lastNameEn, s.dateOfBirth);
    if (k) byName.set(k, [...(byName.get(k) ?? []), s.id]);
  }
  const pairs = new Set<string>();
  for (const [rule, groups] of [["duplicate_eid", byEid], ["duplicate_name_dob", byName]] as const) {
    for (const ids of groups.values()) {
      for (let i = 1; i < ids.length; i++) {
        const [a, b] = [ids[0], ids[i]].sort();
        if (pairs.has(`${a}|${b}`)) continue;
        pairs.add(`${a}|${b}`);
        out.push(problem(rule, `${a}:${b}`, { studentId: a, otherStudentId: b }));
      }
    }
  }
  return out;
}

/** Students (of the given ids) with a registration reference from the authority, on any enrollment registration. */
export async function referencedStudents(db: TenantDb, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await db.govRegistration.findMany({ where: { kind: "ENROLLMENT", studentId: { in: ids }, reference: { not: null } }, select: { studentId: true, reference: true } });
  return new Set(rows.filter((r) => (r.reference ?? "").trim()).map((r) => r.studentId));
}

/**
 * Keyed hashes of the students' Emirates IDs, for duplicate detection only. The digits are decrypted in memory,
 * hashed at once and dropped; neither is returned, logged or stored.
 */
export async function eidHashesFor(db: TenantDb, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const rows = await db.student.findMany({ where: { id: { in: ids }, emiratesIdEnc: { not: null } }, select: { id: true, emiratesIdEnc: true } });
  for (const r of rows) {
    try {
      const d = eidDigits(decryptField(r.emiratesIdEnc!));
      if (d) out.set(r.id, eidHash(d));
    } catch {
      // A value that cannot be read is treated as present but not comparable.
    }
  }
  return out;
}

/** Problem counts that matter for the export warning (notes are explanations, not problems). */
export function problemCount(problems: Problem[]): number {
  return problems.filter((p) => p.severity !== "note").length;
}
