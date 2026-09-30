// Import of the subject sheet (students by subjects): preview with per-row checks, then import.
// Each row saves in its own transaction so one bad row never blocks the others; allocation runs once
// at the end for every imported student.
import type { Prisma } from "@prisma/client";
import { tenantTx } from "@/lib/tenant-db";
import { checkChoices } from "@/lib/registration";
import { MAX_REG_IMPORT_ROWS, headerParts, isMarked, norm, regRowNumber, studentNoOf, subjectHeaders, type RegRowError } from "@/lib/registration-csv";
import { audit } from "@/server/audit/audit";
import { currentYear, offeringsFor, runAllocation, saveRegistration, type AllocationSummary, type OfferingRow } from "./service";

type Tx = Prisma.TransactionClient;
export type RegImportActor = { membershipId: string; userId: string };

export type PreviewRow = {
  row: number;
  studentNo: string;
  studentId: string | null;
  name: { en: string; ar: string } | null;
  grade: number | null;
  options: Array<{ subjectId: string; code: string; nameEn: string; nameAr: string; block: string }>;
  errors: RegRowError[];
};

export type Preview = { unknownHeaders: string[]; rows: PreviewRow[]; valid: number; total: number };

export class RegImportTooLargeError extends Error {
  constructor() {
    super("TOO_MANY_ROWS");
  }
}

export async function previewRegistrationRows(tx: Tx, orgId: string, rows: Array<Record<string, unknown>>, rowNumbers?: number[]): Promise<Preview> {
  if (rows.length > MAX_REG_IMPORT_ROWS) throw new RegImportTooLargeError();
  const headers = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const year = await currentYear(tx, orgId);
  const subjects = await tx.subject.findMany({ where: { orgId } });
  const subjectByKey = new Map<string, (typeof subjects)[number]>();
  for (const s of subjects) for (const k of [s.code, s.nameEn, s.nameAr]) subjectByKey.set(norm(k), s);
  const columns = subjectHeaders(headers).map((h) => ({ header: h, subject: headerParts(h).map((p) => subjectByKey.get(p)).find(Boolean) ?? null }));
  const unknownHeaders = columns.filter((c) => !c.subject).map((c) => c.header);

  const numbers = [...new Set(rows.map(studentNoOf).filter(Boolean))];
  const students = numbers.length
    ? await tx.student.findMany({ where: { orgId, OR: [{ studentNo: { in: numbers } }, { studentNo: { in: numbers.map((n) => n.toUpperCase()) } }] }, select: { id: true, studentNo: true, gradeLevel: true, firstNameEn: true, lastNameEn: true, firstNameAr: true, lastNameAr: true } })
    : [];
  const studentByNo = new Map(students.map((s) => [s.studentNo.toUpperCase(), s]));
  const allOfferings = year ? await offeringsFor(tx, orgId, year.id) : [];
  const offeringsByGrade = new Map<number, OfferingRow[]>();
  for (const o of allOfferings) offeringsByGrade.set(o.gradeLevel, [...(offeringsByGrade.get(o.gradeLevel) ?? []), o]);
  const prior = new Map<string, Set<string>>();
  if (year && students.length) {
    const past = await tx.enrollment.findMany({
      where: { orgId, studentId: { in: students.map((s) => s.id) }, class: { isHomeroom: false, academicYear: { startsOn: { lt: year.startsOn } } } },
      select: { studentId: true, class: { select: { subject: { select: { code: true } } } } },
    });
    for (const p of past) if (p.class.subject) prior.set(p.studentId, new Set([...(prior.get(p.studentId) ?? []), p.class.subject.code.toUpperCase()]));
  }

  const seen = new Set<string>();
  const out: PreviewRow[] = rows.map((raw, i) => {
    const row = rowNumbers?.[i] ?? regRowNumber(i);
    const studentNo = studentNoOf(raw);
    const errors: RegRowError[] = [];
    const base: PreviewRow = { row, studentNo, studentId: null, name: null, grade: null, options: [], errors };
    if (!studentNo) {
      errors.push({ row, field: "student_no", code: "required" });
      return base;
    }
    if (seen.has(studentNo.toUpperCase())) errors.push({ row, field: "student_no", code: "duplicate" });
    seen.add(studentNo.toUpperCase());
    const s = studentByNo.get(studentNo.toUpperCase());
    if (!s) {
      errors.push({ row, field: "student_no", code: "student" });
      return base;
    }
    base.studentId = s.id;
    base.name = { en: `${s.firstNameEn} ${s.lastNameEn}`, ar: `${s.firstNameAr} ${s.lastNameAr}` };
    base.grade = s.gradeLevel;
    const offerings = offeringsByGrade.get(s.gradeLevel) ?? [];
    if (offerings.length === 0) {
      errors.push({ row, field: "grade", code: "noOfferings" });
      return base;
    }
    const chosen: string[] = [];
    for (const c of columns) {
      if (!c.subject || !isMarked(raw[c.header])) continue;
      const o = offerings.find((x) => x.subjectId === c.subject!.id);
      if (!o) errors.push({ row, field: c.header, code: "notOffered" });
      else if (o.kind === "OPTION") {
        chosen.push(o.subjectId);
        base.options.push({ subjectId: o.subjectId, code: o.code, nameEn: o.nameEn, nameAr: o.nameAr, block: o.optionBlock ?? "A" });
      }
    }
    for (const e of checkChoices(offerings, chosen, prior.get(s.id) ?? new Set())) {
      if (e.code === "missingBlock" || e.code === "sameBlock") errors.push({ row, field: e.block, code: e.code });
      else if (e.code === "prerequisite") errors.push({ row, field: `${offerings.find((o) => o.subjectId === e.subjectId)?.code ?? ""}: ${e.missing.join(", ")}`, code: "prerequisite" });
    }
    base.options.sort((a, b) => a.block.localeCompare(b.block));
    return base;
  });
  return { unknownHeaders, rows: out, valid: out.filter((r) => r.errors.length === 0).length, total: out.length };
}

export type RegImportResult = { importId: string; total: number; succeeded: number; failed: number; errors: RegRowError[]; allocation: AllocationSummary };

export async function importRegistrationRows(orgId: string, actor: RegImportActor, fileName: string, rows: Array<Record<string, unknown>>, rowNumbers?: number[]): Promise<RegImportResult> {
  const preview = await tenantTx(orgId, (tx) => previewRegistrationRows(tx, orgId, rows, rowNumbers), { timeout: 60_000 });
  const errors: RegRowError[] = preview.rows.flatMap((r) => r.errors);
  const done: string[] = [];
  for (const r of preview.rows) {
    if (r.errors.length || !r.studentId) continue;
    try {
      const res = await tenantTx(orgId, (tx) =>
        saveRegistration(tx, orgId, { studentId: r.studentId!, optionSubjectIds: r.options.map((o) => o.subjectId), source: "IMPORT", actorId: actor.membershipId, skipAllocation: true }),
      );
      if (res.ok) done.push(r.studentId);
      else errors.push({ row: r.row, field: "student_no", code: "failed" });
    } catch {
      errors.push({ row: r.row, field: "student_no", code: "failed" });
    }
  }
  const allocation = await tenantTx(
    orgId,
    async (tx) => {
      const year = await currentYear(tx, orgId);
      return year ? runAllocation(tx, orgId, year.id, { studentIds: done }) : { groups: 0, placed: 0, moved: 0, removed: 0, sectionsCreated: 0, registrationsUpdated: 0 };
    },
    { timeout: 120_000 },
  );
  const total = preview.total;
  const succeeded = done.length;
  const failed = total - succeeded;
  const record = await tenantTx(orgId, async (tx) => {
    const rec = await tx.csvImport.create({
      data: { orgId, entity: "registrations", fileName: fileName.slice(0, 200) || "subjects.csv", status: total > 0 && succeeded === 0 ? "FAILED" : "COMPLETED", total, succeeded, failed, errors: errors.slice(0, 500) as never, createdById: actor.membershipId },
    });
    await audit(tx, orgId, { actorId: actor.membershipId, actorUserId: actor.userId, action: "registration.import", entityType: "CsvImport", entityId: rec.id, meta: { total, succeeded, failed, ...allocation } });
    return rec;
  });
  return { importId: record.id, total, succeeded, failed, errors, allocation };
}
