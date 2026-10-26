// Worker job "government.reminders" (daily). Holders of government.reports are reminded of each open return due
// date 14 days and 3 days before it. Idempotent: one JobRun claim per due date, stage and date, created before
// anyone is notified, so a retry, a second worker or a second run on the same day sends nothing twice. If the
// date moves, the reminders run again for the new date. A due date first seen inside 3 days gets only the
// 3-day reminder. No "server-only": the worker runs it. Never logs names.
import { tenantTx } from "@/lib/tenant-db";
import { execCtx, type Effect, type Tx } from "@/server/db";
import { notify } from "@/server/notify/notify";
import { audit } from "@/server/audit/audit";
import { dateKey, keyToDate } from "@/server/timetable/cover";
import { dayText, gbi } from "./labels";
import { todayKey } from "./kinds";

export const LEDGER_QUEUE = "government";
export const TEMPLATE_KEY = "gov_due_reminder";
export const STAGES = [14, 3] as const;
const DAY = 86_400_000;

const TEMPLATE = {
  subject: { en: "{{title}} is due {{when}}", ar: "موعد {{title}} {{when}}" },
  body: {
    en: "{{title}} is due on {{date}}. Open Government reporting to prepare the return, check it for problems and record the submission.",
    ar: "موعد {{title}} في {{date}}. افتح التقارير الحكومية لإعداد التقرير وفحص مشكلاته وتسجيل الإرسال.",
  },
};

export async function ensureReminderTemplate(tx: Tx, orgId: string) {
  const have = await tx.messageTemplate.findFirst({ where: { orgId, key: TEMPLATE_KEY, channel: "EMAIL" }, select: { id: true } });
  if (!have) await tx.messageTemplate.createMany({ data: [{ orgId, key: TEMPLATE_KEY, channel: "EMAIL", subjectEn: TEMPLATE.subject.en, subjectAr: TEMPLATE.subject.ar, bodyEn: TEMPLATE.body.en, bodyAr: TEMPLATE.body.ar }], skipDuplicates: true });
}

/** Which reminder is due today for a date `days` away: the 14-day one from 14 to 4 days, the 3-day one from 3 to 0. */
export function stageFor(days: number): 14 | 3 | null {
  if (days < 0) return null;
  if (days <= 3) return 3;
  if (days <= 14) return 14;
  return null;
}

export const claimKey = (dueId: string, stage: number, dueOn: string) => `gov-due:${dueId}:${stage}:${dueOn}`;

/** Members who hold government.reports through a role that has not expired. */
export async function reportHolders(tx: Tx, orgId: string, now: Date) {
  const rows = await tx.membership.findMany({
    where: { orgId, status: "ACTIVE", roles: { some: { role: { permissions: { has: "government.reports" } }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

export async function runGovReminders(orgId: string, opts: { now?: Date; flush?: (e: Effect[]) => Promise<void>; quiet?: boolean } = {}) {
  const now = opts.now ?? new Date();
  const today = todayKey(now);
  const effects: Effect[] = [];
  const out = await tenantTx(
    orgId,
    async (tx) => {
      const horizon = new Date(keyToDate(today).getTime() + 14 * DAY);
      const due = await tx.govDueDate.findMany({ where: { orgId, doneAt: null, dueOn: { gte: keyToDate(today), lte: horizon } }, orderBy: { dueOn: "asc" } });
      if (!due.length) return { sent: 0 };
      const recipients = await reportHolders(tx, orgId, now);
      if (!recipients.length) return { sent: 0 };
      await ensureReminderTemplate(tx, orgId);
      const ec = execCtx(tx, orgId, { now, effects, quiet: opts.quiet });
      let sent = 0;
      for (const d of due) {
        const dueOn = dateKey(d.dueOn);
        const days = Math.round((keyToDate(dueOn).getTime() - keyToDate(today).getTime()) / DAY);
        const stage = stageFor(days);
        if (!stage) continue;
        // Inside 3 days, the 14-day reminder is claimed silently so it never arrives after the 3-day one.
        const stages = stage === 3 ? [14, 3] : [14];
        let claimedNow = false;
        for (const s of stages) {
          const claim = await tx.jobRun.createMany({ data: [{ orgId, queue: LEDGER_QUEUE, name: "due_reminder", idempotencyKey: claimKey(d.id, s, dueOn), status: "COMPLETED", finishedAt: now, createdAt: now }], skipDuplicates: true });
          if (claim.count === 1 && s === stage) claimedNow = true;
        }
        if (!claimedNow) continue;
        const when = days === 0 ? gbi("reminder.today") : days === 1 ? gbi("reminder.tomorrow") : gbi("reminder.inDays", { n: days });
        await notify(ec, {
          recipients,
          templateKey: TEMPLATE_KEY,
          kind: "gov_due_reminder",
          vars: { title: { en: d.titleEn, ar: d.titleAr }, when, date: { en: dayText(dueOn, "en"), ar: dayText(dueOn, "ar") } },
          href: "/admin/government?tab=due",
          idempotencyBase: claimKey(d.id, stage, dueOn),
        });
        sent++;
      }
      if (sent) await audit(tx, orgId, { action: "government.due_reminders", entityType: "GovDueDate", meta: { sent, recipients: recipients.length, day: today } });
      return { sent };
    },
    { timeout: 60_000 },
  );
  const flush = opts.flush ?? (async (e: Effect[]) => (await import("@/server/queue-core")).flushEffects(e));
  if (effects.length) await flush(effects);
  return out;
}
