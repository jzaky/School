// Fee notices to families (new invoice, reminders, receipt) and to approvers. All go through notify() with
// idempotency keys and the member's own preferences, carry STANDARD sensitivity and never mention anything but the
// fee document itself. Automated reminders are held for students with an open wellbeing or safeguarding case
// (decided in src/server/access/case-access.ts); staff can still send a reminder by hand.
import type { Tx, ExecCtx } from "@/server/db";
import { notify } from "@/server/notify/notify";
import { studentsWithAutomatedContactHeld } from "@/server/access/case-access";
import { loadFinanceConfig } from "./config";
import { dubaiDayNumber, formatAed } from "./money";
import { balanceOf } from "./ledger";

export const FEE_TEMPLATES = [
  {
    key: "fee_invoice",
    subjectEn: "New invoice {{number}} from {{school}}",
    subjectAr: "فاتورة جديدة {{number}} من {{school}}",
    bodyEn: "Invoice {{number}} for {{amount}} is due on {{due}}. You can view and download it in Horizon under Fees.",
    bodyAr: "الفاتورة {{number}} بمبلغ {{amount}} مستحقة في {{due}}. يمكنكم عرضها وتنزيلها في Horizon ضمن الرسوم.",
  },
  {
    key: "fee_reminder_before",
    subjectEn: "Reminder: invoice {{number}} is due on {{due}}",
    subjectAr: "تذكير: الفاتورة {{number}} مستحقة في {{due}}",
    bodyEn: "The balance of {{amount}} on invoice {{number}} is due on {{due}}. If you have already paid, thank you and please ignore this message.",
    bodyAr: "الرصيد المتبقي {{amount}} على الفاتورة {{number}} مستحق في {{due}}. إذا كنتم قد سددتم المبلغ فشكرًا لكم، ويرجى تجاهل هذه الرسالة.",
  },
  {
    key: "fee_reminder_overdue",
    subjectEn: "Invoice {{number}} is overdue",
    subjectAr: "الفاتورة {{number}} متأخرة السداد",
    bodyEn: "Invoice {{number}} was due on {{due}} and {{amount}} is still open. Please pay or contact the accounts office if you need help.",
    bodyAr: "كانت الفاتورة {{number}} مستحقة في {{due}} وما زال مبلغ {{amount}} غير مسدد. يرجى السداد أو التواصل مع قسم الحسابات إن احتجتم إلى مساعدة.",
  },
  {
    key: "fee_receipt",
    subjectEn: "Payment received: receipt {{number}}",
    subjectAr: "تم استلام الدفعة: الإيصال {{number}}",
    bodyEn: "Thank you. We received {{amount}} on {{date}}. Your receipt is in Horizon under Fees.",
    bodyAr: "شكرًا لكم. استلمنا مبلغ {{amount}} بتاريخ {{date}}. الإيصال متاح في Horizon ضمن الرسوم.",
  },
  {
    key: "fee_approval",
    subjectEn: "Finance approval needed: {{what}}",
    subjectAr: "مطلوب اعتماد مالي: {{what}}",
    bodyEn: "{{who}} asked for {{what}} ({{amount}}). Review it in Finance under Approvals.",
    bodyAr: "طلب {{who}} {{what}} ({{amount}}). راجِع الطلب في المالية ضمن الاعتمادات.",
  },
];

export async function ensureFeeTemplates(tx: Tx, orgId: string) {
  const have = await tx.messageTemplate.findMany({ where: { orgId, key: { in: FEE_TEMPLATES.map((t) => t.key) }, channel: "EMAIL" }, select: { key: true } });
  const missing = FEE_TEMPLATES.filter((t) => !have.some((h) => h.key === t.key));
  if (missing.length) await tx.messageTemplate.createMany({ data: missing.map((t) => ({ orgId, channel: "EMAIL" as const, ...t })), skipDuplicates: true });
}

const fmtDay = (d: Date) => ({
  en: new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Dubai" }).format(d),
  ar: new Intl.DateTimeFormat("ar-AE-u-nu-latn", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Dubai" }).format(d),
});
const aed = (fils: number) => ({ en: formatAed(fils, "en"), ar: formatAed(fils, "ar") });

/** Family members who receive fee notices: the paying guardian and guardians of the children who get updates. */
export async function familyRecipients(tx: Tx, orgId: string, accountId: string) {
  const account = await tx.feeAccount.findFirst({ where: { id: accountId, orgId }, include: { students: { select: { studentId: true } } } });
  if (!account) return { recipients: [] as string[], studentIds: [] as string[] };
  const studentIds = account.students.map((s) => s.studentId);
  const links = studentIds.length ? await tx.guardianLink.findMany({ where: { orgId, studentId: { in: studentIds }, receivesUpdates: true }, select: { guardianId: true } }) : [];
  const guardianIds = [...new Set([...links.map((l) => l.guardianId), ...(account.payerGuardianId ? [account.payerGuardianId] : [])])];
  const guardians = guardianIds.length ? await tx.guardian.findMany({ where: { orgId, id: { in: guardianIds }, membershipId: { not: null } }, select: { membershipId: true } }) : [];
  return { recipients: guardians.map((g) => g.membershipId!), studentIds };
}

async function schoolName(tx: Tx, orgId: string) {
  const org = await tx.organization.findUniqueOrThrow({ where: { id: orgId }, select: { nameEn: true, nameAr: true } });
  return { en: org.nameEn, ar: org.nameAr };
}

export async function notifyInvoiceIssued(ec: ExecCtx, invoice: { id: string; number: string; accountId: string; totalFils: number; dueDate: Date; kind: string }) {
  if (invoice.kind !== "TAX") return;
  const { recipients } = await familyRecipients(ec.tx, ec.orgId, invoice.accountId);
  if (!recipients.length) return;
  await ensureFeeTemplates(ec.tx, ec.orgId);
  await notify(ec, {
    recipients,
    templateKey: "fee_invoice",
    kind: "fee_invoice",
    vars: { number: invoice.number, amount: aed(invoice.totalFils), due: fmtDay(invoice.dueDate), school: await schoolName(ec.tx, ec.orgId) },
    href: `/fees?invoice=${invoice.id}`,
    channels: ["IN_APP", "EMAIL"],
    idempotencyBase: `feeinv:${invoice.id}`,
  });
}

export async function notifyReceipt(ec: ExecCtx, payment: { id: string; number: string | null; accountId: string; amountFils: number; receivedAt: Date }) {
  if (!payment.number) return;
  const { recipients } = await familyRecipients(ec.tx, ec.orgId, payment.accountId);
  if (!recipients.length) return;
  await ensureFeeTemplates(ec.tx, ec.orgId);
  await notify(ec, {
    recipients,
    templateKey: "fee_receipt",
    kind: "fee_receipt",
    vars: { number: payment.number, amount: aed(payment.amountFils), date: fmtDay(payment.receivedAt) },
    href: "/fees",
    channels: ["IN_APP", "EMAIL"],
    idempotencyBase: `feercpt:${payment.id}`,
  });
}

/** Tell the members who can approve (fees.refund.approve) that a refund or an award waits for them. */
export async function notifyApprovers(ec: ExecCtx, input: { kind: "refund" | "award"; id: string; requesterId: string | null; amountFils: number | null; what: { en: string; ar: string } }) {
  const roles = await ec.tx.role.findMany({ where: { orgId: ec.orgId, permissions: { has: "fees.refund.approve" } }, select: { id: true } });
  if (!roles.length) return;
  const members = await ec.tx.membershipRole.findMany({ where: { orgId: ec.orgId, roleId: { in: roles.map((r) => r.id) } }, select: { membershipId: true } });
  const recipients = [...new Set(members.map((m) => m.membershipId))].filter((m) => m !== input.requesterId);
  if (!recipients.length) return;
  const who = input.requesterId ? await ec.tx.membership.findFirst({ where: { id: input.requesterId, orgId: ec.orgId }, select: { user: { select: { nameEn: true, nameAr: true } } } }) : null;
  await ensureFeeTemplates(ec.tx, ec.orgId);
  await notify(ec, {
    recipients,
    templateKey: "fee_approval",
    kind: "fee_approval",
    vars: { what: input.what, who: { en: who?.user.nameEn ?? "Finance", ar: who?.user.nameAr ?? who?.user.nameEn ?? "المالية" }, amount: input.amountFils === null ? { en: "", ar: "" } : aed(input.amountFils) },
    href: "/finance/approvals",
    channels: ["IN_APP", "EMAIL"],
    idempotencyBase: `feeappr:${input.kind}:${input.id}`,
  });
}

export type ReminderStage = "before" | `after${number}`;

/** The reminder stage an invoice has reached today (the latest one only, so a missed day never sends a burst). */
export function reminderStage(dueDate: Date, now: Date, cfg: { reminderDaysBefore: number; reminderDaysAfter: number[] }): ReminderStage | null {
  const diff = dubaiDayNumber(dueDate) - dubaiDayNumber(now);
  if (diff > 0) return cfg.reminderDaysBefore > 0 && diff <= cfg.reminderDaysBefore ? "before" : null;
  const past = -diff;
  const reached = [...cfg.reminderDaysAfter].filter((d) => d > 0 && past >= d).sort((a, b) => b - a)[0];
  return reached ? `after${reached}` : null;
}

/** Send a reminder for one invoice now (by hand or from the daily job). Returns false when it was already sent. */
export async function sendInvoiceReminder(ec: ExecCtx, invoiceId: string, stage: string, opts: { manual: boolean }) {
  const { tx, orgId, now } = ec;
  const inv = await tx.invoice.findFirst({ where: { id: invoiceId, orgId } });
  if (!inv || inv.kind !== "TAX" || (inv.status !== "OPEN" && inv.status !== "PARTIAL")) return false;
  const key = `feeremind:${inv.id}:${stage}`;
  const claim = await tx.jobRun.createMany({ data: [{ orgId, queue: "fees", name: "reminder", idempotencyKey: key, status: "COMPLETED", finishedAt: now }], skipDuplicates: true });
  if (claim.count !== 1) return false;
  const { recipients } = await familyRecipients(tx, orgId, inv.accountId);
  if (!recipients.length) return false;
  await ensureFeeTemplates(tx, orgId);
  const overdue = dubaiDayNumber(inv.dueDate) < dubaiDayNumber(now);
  await notify(ec, {
    recipients,
    templateKey: overdue ? "fee_reminder_overdue" : "fee_reminder_before",
    kind: "fee_reminder",
    vars: { number: inv.number, amount: aed(balanceOf(inv)), due: fmtDay(inv.dueDate) },
    href: `/fees?invoice=${inv.id}`,
    channels: ["IN_APP", "EMAIL"],
    idempotencyBase: key,
  });
  await tx.invoice.update({ where: { id: inv.id }, data: { remindersSent: { increment: 1 }, lastReminderAt: now } });
  await tx.auditEvent.create({ data: { orgId, actorId: ec.actorId ?? null, action: opts.manual ? "fees.reminder.manual" : "fees.reminder.auto", entityType: "Invoice", entityId: inv.id, meta: { stage } } });
  return true;
}

/** Daily: reminders before and after due dates, in pages, skipping paused families and held students. */
export async function sendDueFeeReminders(ec: ExecCtx, pageSize = 200) {
  const { tx, orgId, now } = ec;
  const cfg = await loadFinanceConfig(tx, orgId);
  if (!cfg.remindersEnabled) return { sent: 0, held: 0 };
  const horizon = new Date(now.getTime() + (cfg.reminderDaysBefore + 1) * 86_400_000);
  let cursor: string | undefined;
  let sent = 0;
  let held = 0;
  for (;;) {
    const page = await tx.invoice.findMany({
      where: { orgId, kind: "TAX", status: { in: ["OPEN", "PARTIAL"] }, dueDate: { lte: horizon } },
      orderBy: { id: "asc" },
      take: pageSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, accountId: true, dueDate: true },
    });
    if (!page.length) break;
    cursor = page[page.length - 1].id;
    const accounts = await tx.feeAccount.findMany({ where: { orgId, id: { in: [...new Set(page.map((p) => p.accountId))] } }, select: { id: true, remindersPaused: true, students: { select: { studentId: true } } } });
    const heldStudents = await studentsWithAutomatedContactHeld(tx, orgId, accounts.flatMap((a) => a.students.map((s) => s.studentId)));
    for (const inv of page) {
      const stage = reminderStage(inv.dueDate, now, cfg);
      if (!stage) continue;
      const acc = accounts.find((a) => a.id === inv.accountId);
      if (!acc || acc.remindersPaused) continue;
      if (acc.students.some((s) => heldStudents.has(s.studentId))) {
        held++;
        continue;
      }
      if (await sendInvoiceReminder(ec, inv.id, stage, { manual: false })) sent++;
    }
    if (page.length < pageSize) break;
  }
  return { sent, held };
}
