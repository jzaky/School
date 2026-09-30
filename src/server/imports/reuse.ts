// The import center reuses the existing importers: students with guardians (src/server/admin/people-import.ts)
// and subject choices (src/server/registration/import.ts). This file adapts them to the shared preview and
// result shapes, with real spreadsheet row numbers.
import { tenantDb, tenantTx } from "@/lib/tenant-db";
import { pick } from "@/lib/i18n-data";
import { csvLine } from "@/lib/imports/headers";
import { excelSerialToIso, type SheetRecord } from "@/lib/imports/table";
import { MAX_ROWS, finishPreview, type ImportPreview, type ImportSummary, type PreviewRow } from "@/lib/imports/types";
import { normalizeRow, validateRows } from "@/lib/people-csv";
import { importStudentRows } from "@/server/admin/people-import";
import { importRegistrationRows, previewRegistrationRows } from "@/server/registration/import";
import { currentYear, offeringsFor } from "@/server/registration/service";
import { importAccess, ImportError, type ImportActor } from "./access";

/** Excel keeps dates as day numbers; turn them back into dates for the student file. */
export function fixXlsxDates(records: SheetRecord[]): SheetRecord[] {
  return records.map((r) => {
    const d = r.values.date_of_birth;
    const iso = d ? excelSerialToIso(d) : null;
    return iso ? { row: r.row, values: { ...r.values, date_of_birth: iso } } : r;
  });
}

function checkStudents(actor: ImportActor, records: SheetRecord[]) {
  if (records.length > MAX_ROWS.students) throw new ImportError("TOO_MANY_ROWS");
  if (!importAccess(actor.perms).center) throw new ImportError("FORBIDDEN");
}

export async function previewStudents(actor: ImportActor, records: SheetRecord[], locale: string): Promise<ImportPreview> {
  checkStudents(actor, records);
  const rows = records.map((r) => normalizeRow(r.values));
  const { errors } = validateRows(rows, records.map((r) => r.row));
  const numbers = [...new Set(rows.map((r) => r.student_no.toUpperCase()).filter(Boolean))];
  const existing = numbers.length ? await tenantDb(actor.orgId).student.findMany({ where: { studentNo: { in: numbers } }, select: { studentNo: true } }) : [];
  const known = new Set(existing.map((s) => s.studentNo.toUpperCase()));
  const out: PreviewRow[] = rows.map((r, i) => {
    const n = records[i].row;
    const rowErrors = errors.filter((e) => e.row === n);
    const en = [r.first_name_en, r.last_name_en].filter(Boolean).join(" ");
    const ar = [r.first_name_ar, r.last_name_ar].filter(Boolean).join(" ");
    const [main, other] = locale === "ar" && ar ? [ar, en] : [en, ar];
    return {
      row: n,
      action: rowErrors.length ? null : known.has(r.student_no.toUpperCase()) ? "update" : "create",
      errors: rowErrors,
      warnings: [],
      cells: [
        { text: r.student_no, ltr: true },
        { text: main, sub: other || undefined },
        { text: [r.grade, r.section].filter(Boolean).join(" "), ltr: true },
        { text: [r.guardian_first_name_en, r.guardian_last_name_en].filter(Boolean).join(" "), sub: r.guardian_email || undefined },
      ],
    };
  });
  return finishPreview("students", out);
}

export async function importStudents(actor: ImportActor, fileName: string, records: SheetRecord[]): Promise<ImportSummary> {
  checkStudents(actor, records);
  const res = await importStudentRows(actor.orgId, actor, fileName, records.map((r) => r.values), records.map((r) => r.row));
  return { importId: res.importId, total: res.total, succeeded: res.succeeded, failed: res.failed, created: res.created, updated: res.updated, unchanged: 0, errors: res.errors, extra: {} };
}

// ---------------------------------------------------------------------------
// Subject choices
// ---------------------------------------------------------------------------

function checkRegistrations(actor: ImportActor, records: SheetRecord[]) {
  if (records.length > MAX_ROWS.registrations) throw new ImportError("TOO_MANY_ROWS");
  if (!importAccess(actor.perms).registrations) throw new ImportError("FORBIDDEN");
}

export async function previewRegistrations(actor: ImportActor, records: SheetRecord[], locale: string): Promise<ImportPreview> {
  checkRegistrations(actor, records);
  const { orgId } = actor;
  const { preview, registered } = await tenantTx(
    orgId,
    async (tx) => {
      const p = await previewRegistrationRows(tx, orgId, records.map((r) => r.values), records.map((r) => r.row));
      const year = await currentYear(tx, orgId);
      const ids = p.rows.map((r) => r.studentId).filter((x): x is string => !!x);
      const regs = year && ids.length ? await tx.subjectRegistration.groupBy({ by: ["studentId"], where: { academicYearId: year.id, studentId: { in: ids } } }) : [];
      return { preview: p, registered: new Set(regs.map((r) => r.studentId)) };
    },
    { timeout: 60_000 },
  );
  const rows: PreviewRow[] = preview.rows.map((r) => ({
    row: r.row,
    action: r.errors.length ? null : r.studentId && registered.has(r.studentId) ? "update" : "create",
    errors: r.errors,
    warnings: [],
    cells: [
      { text: r.studentNo, ltr: true },
      { text: r.name ? pick(locale, r.name.en, r.name.ar) : "" },
      { text: r.grade !== null ? String(r.grade) : "", ltr: true },
      { chips: r.options.map((o) => `${o.block}: ${pick(locale, o.nameEn, o.nameAr)}`) },
    ],
  }));
  return finishPreview("registrations", rows, preview.unknownHeaders);
}

export async function importRegistrations(actor: ImportActor, fileName: string, records: SheetRecord[]): Promise<ImportSummary> {
  checkRegistrations(actor, records);
  const res = await importRegistrationRows(actor.orgId, actor, fileName, records.map((r) => r.values), records.map((r) => r.row));
  return {
    importId: res.importId,
    total: res.total,
    succeeded: res.succeeded,
    failed: res.failed,
    created: res.succeeded,
    updated: 0,
    unchanged: 0,
    errors: res.errors,
    extra: { placed: res.allocation.placed + res.allocation.moved, sections: res.allocation.sectionsCreated },
  };
}

/** Subject choices template: student number, name and grade, then one column per option subject; two example rows. */
export async function registrationTemplate(orgId: string): Promise<{ csv: string; codes: number }> {
  const options = await tenantTx(orgId, async (tx) => {
    const year = await currentYear(tx, orgId);
    const offerings = year ? await offeringsFor(tx, orgId, year.id) : [];
    const seen = new Map<string, { code: string; nameAr: string; block: string; grade: number }>();
    for (const o of offerings) if (o.kind === "OPTION" && !seen.has(o.code)) seen.set(o.code, { code: o.code, nameAr: o.nameAr, block: o.optionBlock ?? "A", grade: o.gradeLevel });
    return [...seen.values()];
  });
  const head = ["Student number / رقم الطالب", "Student name / اسم الطالب", "Grade / الصف", ...options.map((o) => `${o.code} / ${o.nameAr}`)];
  // Example rows pick one option per block, so they pass the same checks as a real file would.
  const pickRow = (skip: number) => {
    const byBlock = new Map<string, string>();
    for (const o of options.slice(skip).concat(options.slice(0, skip))) if (!byBlock.has(o.block)) byBlock.set(o.block, o.code);
    return options.map((o) => ([...byBlock.values()].includes(o.code) ? "x" : ""));
  };
  const grade = String(options[0]?.grade ?? 10);
  const lines = [csvLine(head), csvLine(["S-10001", "Maya Haddad", grade, ...pickRow(0)]), csvLine(["S-10002", "Omar Saleh", grade, ...pickRow(1)])];
  return { csv: `${lines.join("\n")}\n`, codes: options.length };
}
