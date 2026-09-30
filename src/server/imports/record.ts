// The import history: one CsvImport row per import (PENDING while it runs), finished with counts, the row
// errors (row number, column and code only) and a summary audit event.
import { tenantDb } from "@/lib/tenant-db";
import type { ImportKind, ImportSummary, RowIssue } from "@/lib/imports/types";
import { audit } from "@/server/audit/audit";
import type { ImportActor } from "./access";

export async function startRecord(actor: ImportActor, entity: ImportKind, fileName: string, total: number) {
  return tenantDb(actor.orgId).csvImport.create({
    data: { orgId: actor.orgId, entity, fileName: fileName.slice(0, 200) || `${entity}.csv`, status: "PENDING", total, createdById: actor.membershipId },
  });
}

export async function finishRecord(
  actor: ImportActor,
  importId: string,
  action: string,
  input: { total: number; failedRows: Set<number>; errors: RowIssue[]; counts: { created: number; updated: number; unchanged: number }; extra: Record<string, number> },
): Promise<ImportSummary> {
  const errors = [...input.errors].sort((a, b) => a.row - b.row);
  const failed = input.failedRows.size;
  const succeeded = input.counts.created + input.counts.updated + input.counts.unchanged;
  const db = tenantDb(actor.orgId);
  await db.csvImport.update({
    where: { id: importId },
    data: { status: input.total > 0 && succeeded === 0 ? "FAILED" : "COMPLETED", succeeded, failed, errors: errors.slice(0, 500) as never },
  });
  await audit(db, actor.orgId, {
    actorId: actor.membershipId,
    actorUserId: actor.userId,
    action,
    entityType: "CsvImport",
    entityId: importId,
    meta: { total: input.total, succeeded, failed, ...input.counts, ...input.extra },
  });
  return { importId, total: input.total, succeeded, failed, ...input.counts, errors, extra: input.extra };
}
