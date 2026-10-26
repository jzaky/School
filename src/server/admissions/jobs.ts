// Worker job "admissions.daily". Per school:
// - re-enrollment: the "window is open" notice once a scheduled window opens, and automatic reminders to families
//   who have not answered on the school's reminder days before closing (each parent once per round, see reenrollment.ts);
// - students admitted for a later year become active on their first day (status INACTIVE to ACTIVE, audited).
// Never logs names. Safe to run any number of times.
import { tenantTx } from "@/lib/tenant-db";
import { execCtx, type Effect } from "@/server/db";
import { audit } from "@/server/audit/audit";
import { flushEffects } from "@/server/queue-core";
import { sendWindowNotices, windowState } from "./reenrollment";

export async function runAdmissionsDaily(orgId: string, opts: { now?: Date; flush?: (e: Effect[]) => Promise<void> } = {}) {
  const now = opts.now ?? new Date();
  const effects: Effect[] = [];
  const result = await tenantTx(
    orgId,
    async (tx) => {
      const ec = execCtx(tx, orgId, { now, effects });
      let notices = 0;
      const windows = await tx.reenrollmentWindow.findMany({ where: { orgId, closedAt: null, closesAt: { gt: now }, opensAt: { lte: now } } });
      for (const w of windows) {
        if (windowState(w, now) !== "open") continue;
        notices += await sendWindowNotices(ec, w.id, "open");
        const daysLeft = Math.ceil((w.closesAt.getTime() - now.getTime()) / 86_400_000);
        // The closest reminder day that has been reached; earlier rounds already went out (or were skipped).
        const due = w.reminderDays.filter((d) => daysLeft <= d).sort((a, b) => a - b)[0];
        if (due !== undefined) notices += await sendWindowNotices(ec, w.id, `auto-${due}`);
      }
      // Starters: admitted for a year that has now begun.
      const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const starters = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT s.id FROM "Student" s
        WHERE s."orgId" = ${orgId} AND s.status = 'INACTIVE' AND s."enrolledOn" <= ${today}
          AND EXISTS (SELECT 1 FROM "AdmissionApplication" a WHERE a."orgId" = ${orgId} AND a."studentId" = s.id AND a.stage = 'ENROLLED')`;
      for (const s of starters) {
        await tx.student.update({ where: { id: s.id }, data: { status: "ACTIVE" } });
        await audit(tx, orgId, { action: "student.activate", entityType: "Student", entityId: s.id, meta: { source: "admissions.daily" } });
      }
      return { notices, activated: starters.length };
    },
    { timeout: 120_000 },
  );
  await (opts.flush ?? flushEffects)(effects);
  return result;
}
