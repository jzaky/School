import type { Sensitivity } from "@prisma/client";
import type { TenantDb, TenantTx } from "@/lib/tenant-db";

export type AuditInput = {
  actorId?: string | null;
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  sensitivity?: Sensitivity;
  reason?: string | null;
  meta?: Record<string, unknown>;
};

/** Append an audit event. Audit rows can never be changed or deleted by the app role. */
export async function audit(db: TenantDb | TenantTx, orgId: string, input: AuditInput) {
  await db.auditEvent.create({
    data: {
      orgId,
      actorId: input.actorId ?? null,
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      sensitivity: input.sensitivity ?? "STANDARD",
      reason: input.reason ?? null,
      meta: (input.meta ?? undefined) as never,
    },
  });
}
