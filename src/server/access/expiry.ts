// Daily job: removes time-limited role assignments that have ended. Access already stopped at the end date
// (permissions are read per request and ignore ended assignments); this tidies the data, writes one audit
// event per person and tells the safeguarding team when safeguarding or wellbeing access ended.
// Idempotent: each person is handled in its own transaction that deletes only assignments still ended,
// so a retry or a second worker finds nothing left to do and sends nothing twice.
import { tenantDb, tenantTx } from "@/lib/tenant-db";
import { audit } from "@/server/audit/audit";
import { execCtx, type Effect } from "@/server/db";
import { flushEffects as defaultFlush } from "@/server/queue-core";
import { loadSnapshot } from "./snapshot";
import { alertSafeguardingAccess, SYSTEM_ACTOR } from "./access-alerts";

export const ACCESS_EXPIRY_JOB = "access.expiry";

export async function expireRoleAssignments(orgId: string, opts: { now?: Date; flush?: (effects: Effect[]) => Promise<void> } = {}) {
  const now = opts.now ?? new Date();
  const flush = opts.flush ?? defaultFlush;
  const due = await tenantDb(orgId).membershipRole.findMany({ where: { expiresAt: { lte: now } }, select: { membershipId: true } });
  const people = [...new Set(due.map((d) => d.membershipId))];
  let removed = 0;
  for (const membershipId of people) {
    const effects: Effect[] = [];
    removed += await tenantTx(orgId, async (tx) => {
      const rows = await tx.membershipRole.findMany({ where: { membershipId, expiresAt: { lte: now } }, include: { role: { select: { key: true } } } });
      if (rows.length === 0) return 0;
      const earliest = Math.min(...rows.map((r) => r.expiresAt!.getTime()));
      const before = await loadSnapshot(tx, [membershipId]);
      const deleted = await tx.membershipRole.deleteMany({ where: { id: { in: rows.map((r) => r.id) }, expiresAt: { lte: now } } });
      if (deleted.count === 0) return 0;
      const after = await loadSnapshot(tx, [membershipId]);
      const changeId = `expiry:${rows.map((r) => `${r.id}@${r.expiresAt!.toISOString()}`).sort().join(",")}`;
      await audit(tx, orgId, {
        actorId: null,
        action: "people.role_expired",
        entityType: "Membership",
        entityId: membershipId,
        meta: { roles: rows.map((r) => r.role.key).sort(), endedAt: rows.map((r) => r.expiresAt!.toISOString()).sort(), changeId },
      });
      // "Before" is read just before the earliest end date, when the assignment still granted access.
      await alertSafeguardingAccess(execCtx(tx, orgId, { now, effects }), {
        actorId: null,
        who: SYSTEM_ACTOR,
        before,
        after,
        memberIds: [membershipId],
        beforeAt: new Date(earliest - 1),
        changeId,
      });
      return deleted.count;
    });
    await flush(effects);
  }
  return { removed, people: people.length };
}
