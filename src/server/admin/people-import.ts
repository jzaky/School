// Idempotent import of students with guardians from CSV rows.
// Students are upserted by (orgId, studentNo), guardians are matched by email within the organization,
// and guardian links are unique per guardian and student. Each row runs in its own transaction, so a
// failing row never blocks the others. Errors record only the row number, field name and a code.
import { tenantDb, tenantTx, type TenantTx } from "@/lib/tenant-db";
import { encryptField } from "@/lib/crypto";
import { audit } from "@/server/audit/audit";
import { MAX_IMPORT_ROWS, emiratesIdLast4, normalizeRow, validateRows, type CleanRow, type RowError } from "@/lib/people-csv";

export type ImportActor = { membershipId: string; userId: string };
export type ImportResult = { importId: string; total: number; succeeded: number; failed: number; created: number; updated: number; errors: RowError[] };

export class ImportTooLargeError extends Error {
  constructor() {
    super("TOO_MANY_ROWS");
  }
}

async function importRow(tx: TenantTx, orgId: string, data: CleanRow): Promise<"created" | "updated"> {
  const ids: Record<string, string | null> = {};
  if (data.emiratesId) {
    ids.emiratesIdEnc = encryptField(data.emiratesId);
    ids.emiratesIdLast4 = emiratesIdLast4(data.emiratesId);
  }
  if (data.passportNo) {
    ids.passportEnc = encryptField(data.passportNo);
    ids.passportLast4 = data.passportNo.slice(-4);
  }
  const fields = {
    firstNameEn: data.firstNameEn,
    lastNameEn: data.lastNameEn,
    firstNameAr: data.firstNameAr,
    lastNameAr: data.lastNameAr,
    gradeLevel: data.gradeLevel,
    section: data.section,
    ...(data.dateOfBirth ? { dateOfBirth: new Date(`${data.dateOfBirth}T00:00:00Z`) } : {}),
    ...ids,
  };
  const existing = await tx.student.findUnique({ where: { orgId_studentNo: { orgId, studentNo: data.studentNo } }, select: { id: true } });
  const student = existing
    ? await tx.student.update({ where: { id: existing.id }, data: fields, select: { id: true } })
    : await tx.student.create({ data: { orgId, studentNo: data.studentNo, status: "ACTIVE", enrolledOn: new Date(), ...fields }, select: { id: true } });

  const g = data.guardian;
  if (g) {
    let guardian = await tx.guardian.findFirst({ where: { orgId, email: { equals: g.email, mode: "insensitive" } }, orderBy: { createdAt: "asc" }, select: { id: true, phone: true } });
    if (!guardian) {
      guardian = await tx.guardian.create({
        data: { orgId, firstNameEn: g.firstNameEn, lastNameEn: g.lastNameEn, firstNameAr: g.firstNameAr, lastNameAr: g.lastNameAr, email: g.email, phone: g.phone },
        select: { id: true, phone: true },
      });
    } else if (!guardian.phone && g.phone) {
      await tx.guardian.update({ where: { id: guardian.id }, data: { phone: g.phone } });
    }
    const link = await tx.guardianLink.findUnique({ where: { guardianId_studentId: { guardianId: guardian.id, studentId: student.id } }, select: { id: true } });
    if (link) {
      await tx.guardianLink.update({ where: { id: link.id }, data: { relationshipEn: g.relationship.en, relationshipAr: g.relationship.ar } });
    } else {
      const hasPrimary = await tx.guardianLink.count({ where: { studentId: student.id, isPrimary: true } });
      await tx.guardianLink.create({
        data: { orgId, guardianId: guardian.id, studentId: student.id, relationshipEn: g.relationship.en, relationshipAr: g.relationship.ar, isPrimary: hasPrimary === 0, canApprove: true, receivesUpdates: true },
      });
    }
  }
  return existing ? "updated" : "created";
}

/** Validate and import raw CSV rows (objects keyed by header). Records a CsvImport and an audit event. */
export async function importStudentRows(orgId: string, actor: ImportActor, fileName: string, rawRows: Array<Record<string, unknown>>, rowNumbers?: number[]): Promise<ImportResult> {
  if (rawRows.length > MAX_IMPORT_ROWS) throw new ImportTooLargeError();
  const rows = rawRows.map(normalizeRow);
  const { valid, errors, total } = validateRows(rows, rowNumbers);
  const failedRows = new Set(errors.map((e) => e.row));
  let succeeded = 0;
  let created = 0;
  let updated = 0;
  for (const { row, data } of valid) {
    try {
      const outcome = await tenantTx(orgId, (tx) => importRow(tx, orgId, data));
      succeeded++;
      if (outcome === "created") created++;
      else updated++;
    } catch {
      errors.push({ row, field: "row", code: "failed" });
      failedRows.add(row);
    }
  }
  errors.sort((a, b) => a.row - b.row);
  const failed = failedRows.size;
  const db = tenantDb(orgId);
  const record = await db.csvImport.create({
    data: {
      orgId,
      entity: "students",
      fileName: fileName.slice(0, 200) || "import.csv",
      status: total > 0 && succeeded === 0 ? "FAILED" : "COMPLETED",
      total,
      succeeded,
      failed,
      errors: errors.slice(0, 500) as never,
      createdById: actor.membershipId,
    },
  });
  await audit(db, orgId, {
    actorId: actor.membershipId,
    actorUserId: actor.userId,
    action: "people.import_students",
    entityType: "CsvImport",
    entityId: record.id,
    meta: { total, succeeded, failed, created, updated },
  });
  return { importId: record.id, total, succeeded, failed, created, updated, errors };
}
