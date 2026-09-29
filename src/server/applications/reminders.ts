// Worker job "applications.reminders" (daily). In-app reminders for application tasks due within 14 days or
// overdue, to whoever owns the task (the student or the counselor), plus one daily digest per counselor.
// Idempotent: one JobRun key per task and day, and per counselor and day. Parents are not notified: the
// school has no setting for an application digest to families yet (see docs/decisions.md).
// Never logs names or task titles.
import { tenantTx } from "@/lib/tenant-db";
import { execCtx, type Effect } from "@/server/db";
import { notify } from "@/server/notify/notify";
import { flushEffects } from "@/server/queue-core";
import { daysUntil } from "./deadlines";
import { ensureTemplates, LEDGER_QUEUE, LEDGER_LETTER, LEDGER_TASK } from "./service";

export const REMINDER_WINDOW_DAYS = 14;

export async function runApplicationReminders(orgId: string, opts: { now?: Date; flush?: (e: Effect[]) => Promise<void> } = {}) {
  const now = opts.now ?? new Date();
  const day = now.toISOString().slice(0, 10);
  const effects: Effect[] = [];
  const counts = await tenantTx(
    orgId,
    async (tx) => {
      const ledger = await tx.jobRun.findMany({ where: { orgId, queue: LEDGER_QUEUE, name: { in: [LEDGER_TASK, LEDGER_LETTER] }, status: "COMPLETED" }, select: { result: true } });
      const taskIds = ledger.map((r) => (r.result as { taskId?: string } | null)?.taskId).filter(Boolean) as string[];
      if (!taskIds.length) return { reminders: 0, digests: 0 };
      const horizon = new Date(now.getTime() + REMINDER_WINDOW_DAYS * 86_400_000);
      const due = await tx.task.findMany({ where: { orgId, id: { in: taskIds }, status: { in: ["TODO", "IN_PROGRESS"] }, dueAt: { lte: horizon }, assigneeId: { not: null } } });
      if (!due.length) return { reminders: 0, digests: 0 };
      await ensureTemplates(tx, orgId);
      const ec = execCtx(tx, orgId, { now, effects });
      let reminders = 0;
      for (const t of due) {
        const key = `appremind:${t.id}:${day}`;
        const claim = await tx.jobRun.createMany({ data: [{ orgId, queue: LEDGER_QUEUE, name: "reminder", idempotencyKey: key, status: "COMPLETED", finishedAt: now }], skipDuplicates: true });
        if (claim.count !== 1) continue;
        const days = daysUntil(t.dueAt!, now);
        const when =
          days < 0
            ? { en: `${-days} days ago (overdue)`, ar: `منذ ${-days} يوما (متأخرة)` }
            : days === 0
              ? { en: "today", ar: "اليوم" }
              : { en: `in ${days} days`, ar: `خلال ${days} يوما` };
        await notify(ec, {
          recipients: [t.assigneeId!],
          templateKey: "application_reminder",
          kind: "application_reminder",
          vars: { title: { en: t.titleEn, ar: t.titleAr }, when },
          href: t.href,
          urgent: false,
          channels: ["IN_APP"],
          idempotencyBase: key,
        });
        reminders++;
      }
      // Counselor digest: student tasks on applications they own that are overdue or due soon.
      const apps = await tx.application.findMany({ where: { orgId, counselorId: { not: null }, studentId: { in: [...new Set(due.map((t) => t.studentId).filter(Boolean))] as string[] } }, select: { id: true, counselorId: true } });
      const perCounselor = new Map<string, number>();
      for (const t of due) {
        const app = apps.find((a) => t.href?.endsWith(`/${a.id}`));
        if (!app?.counselorId || t.assigneeId === app.counselorId) continue;
        perCounselor.set(app.counselorId, (perCounselor.get(app.counselorId) ?? 0) + 1);
      }
      let digests = 0;
      for (const [counselorId, count] of perCounselor) {
        const key = `appdigest:${counselorId}:${day}`;
        const claim = await tx.jobRun.createMany({ data: [{ orgId, queue: LEDGER_QUEUE, name: "digest", idempotencyKey: key, status: "COMPLETED", finishedAt: now }], skipDuplicates: true });
        if (claim.count !== 1) continue;
        await notify(ec, { recipients: [counselorId], templateKey: "application_digest", kind: "application_digest", vars: { count: String(count) }, href: "/career/applications/manage?due=14", channels: ["IN_APP"], idempotencyBase: key });
        digests++;
      }
      return { reminders, digests };
    },
    { timeout: 120_000 },
  );
  await (opts.flush ?? flushEffects)(effects);
  return counts;
}
