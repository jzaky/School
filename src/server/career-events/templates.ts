// Message templates the career events module sends. Created per school by the starter template (so admins can
// edit them before first use) and again on first use for older schools.
import type { Tx } from "@/server/db";

export const CAREER_EVENT_TEMPLATES = [
  {
    key: "career_event_new",
    subjectEn: "New {{kind}}: {{title}}",
    subjectAr: "{{kind}} جديد: {{title}}",
    bodyEn: "{{title}} on {{when}}. Register in Horizon under University fairs and visits{{deadline}}.",
    bodyAr: "{{title}} في {{when}}. سجّل في Horizon ضمن المعارض والزيارات الجامعية{{deadline}}.",
  },
  {
    key: "career_event_reminder",
    subjectEn: "Reminder: {{title}} {{relative}}",
    subjectAr: "تذكير: {{title}} {{relative}}",
    bodyEn: "{{student}} is registered for {{title}} on {{when}} ({{place}}).",
    bodyAr: "{{student}} مسجّل في {{title}} بتاريخ {{when}} ({{place}}).",
  },
  {
    key: "career_event_cancelled",
    subjectEn: "Cancelled: {{title}}",
    subjectAr: "أُلغي: {{title}}",
    bodyEn: "{{title}} on {{when}} has been cancelled. The registration for {{student}} is closed.",
    bodyAr: "أُلغي {{title}} المقرر في {{when}}. أُغلق تسجيل {{student}}.",
  },
];

export async function ensureCareerEventTemplates(tx: Tx, orgId: string) {
  const have = await tx.messageTemplate.findMany({ where: { orgId, key: { in: CAREER_EVENT_TEMPLATES.map((t) => t.key) }, channel: "EMAIL" }, select: { key: true } });
  const missing = CAREER_EVENT_TEMPLATES.filter((t) => !have.some((h) => h.key === t.key));
  if (missing.length) await tx.messageTemplate.createMany({ data: missing.map((t) => ({ orgId, channel: "EMAIL" as const, ...t })), skipDuplicates: true });
}
