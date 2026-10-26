// Message templates for course selection notices, created on first use in each school (admins can then
// edit them under Message templates). {{placeholders}} are filled at send time, in the reader's language.
import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

export const SELECTION_TEMPLATES: Array<{ key: string; subjectEn: string; subjectAr: string; bodyEn: string; bodyAr: string }> = [
  {
    key: "course_selection_open",
    subjectEn: "Course selection is open for {{year}}",
    subjectAr: "اختيار المواد للعام {{year}} مفتوح الآن",
    bodyEn: "Course choices for {{student}} for {{year}} are open until {{closes}} (Dubai time). Open Horizon to see the options and choose one course in each block.",
    bodyAr: "اختيار مواد {{student}} للعام {{year}} مفتوح حتى {{closes}} بتوقيت دبي. افتح منصة هورايزن لعرض الخيارات واختيار مادة واحدة من كل مجموعة.",
  },
  {
    key: "course_selection_reminder",
    subjectEn: "Course selection closes {{when}}",
    subjectAr: "يغلق اختيار المواد {{when}}",
    bodyEn: "Course choices for {{student}} for {{year}} are not finished yet. Choosing closes on {{closes}} (Dubai time).",
    bodyAr: "لم يكتمل اختيار مواد {{student}} للعام {{year}} بعد. يغلق الاختيار في {{closes}} بتوقيت دبي.",
  },
  {
    key: "course_selection_closed",
    subjectEn: "Course selection for {{year}} has closed",
    subjectAr: "انتهت فترة اختيار المواد للعام {{year}}",
    bodyEn: "Choices recorded for {{student}}: {{choices}}. To change them now, ask the homeroom teacher or the counselor.",
    bodyAr: "الاختيارات المسجلة لـ {{student}}: {{choices}}. لتغييرها الآن، تواصل مع معلم الصف أو المرشد الطلابي.",
  },
  {
    key: "course_selection_helper_asked",
    subjectEn: "{{by}} asked for your help choosing courses",
    subjectAr: "طلب {{by}} مساعدتك في اختيار المواد",
    bodyEn: "You can make course choices for {{student}} until {{until}} (Dubai time). Every choice you make shows your name.",
    bodyAr: "يمكنك اختيار المواد نيابة عن {{student}} حتى {{until}} بتوقيت دبي. يظهر اسمك مع كل اختيار تقوم به.",
  },
  {
    key: "course_selection_helper_on",
    subjectEn: "{{helper}} can help {{student}} choose courses",
    subjectAr: "يمكن لـ {{helper}} مساعدة {{student}} في اختيار المواد",
    bodyEn: "{{helper}} can make course choices for {{student}} until {{until}} (Dubai time). Every choice shows who made it.",
    bodyAr: "يمكن لـ {{helper}} اختيار المواد نيابة عن {{student}} حتى {{until}} بتوقيت دبي. يظهر مع كل اختيار اسم من قام به.",
  },
  {
    key: "course_selection_helper_off",
    subjectEn: "Helping {{student}} choose courses has ended",
    subjectAr: "انتهت مساعدتك لـ {{student}} في اختيار المواد",
    bodyEn: "You can no longer make course choices for {{student}}.",
    bodyAr: "لم يعد بإمكانك اختيار المواد نيابة عن {{student}}.",
  },
  {
    key: "course_selection_exception",
    subjectEn: "Course changes allowed for {{student}} until {{until}}",
    subjectAr: "يُسمح بتغيير مواد {{student}} حتى {{until}}",
    bodyEn: "The school allowed changes to {{student}}'s course choices for {{year}} until {{until}} (Dubai time).",
    bodyAr: "سمحت المدرسة بتغيير اختيارات مواد {{student}} للعام {{year}} حتى {{until}} بتوقيت دبي.",
  },
  {
    key: "course_selection_chosen_for",
    subjectEn: "{{by}} saved course choices for {{student}}",
    subjectAr: "حفظ {{by}} اختيارات المواد لـ {{student}}",
    bodyEn: "{{by}} made course choices for {{student}} for {{year}}. Open Horizon to see them.",
    bodyAr: "اختار {{by}} المواد لـ {{student}} للعام {{year}}. افتح منصة هورايزن للاطلاع عليها.",
  },
  {
    key: "course_selection_sign_off",
    subjectEn: "Please confirm {{student}}'s course choices",
    subjectAr: "يرجى تأكيد اختيارات مواد {{student}}",
    bodyEn: "Course choices for {{student}} for {{year}} are submitted and waiting for your confirmation.",
    bodyAr: "تم تقديم اختيارات مواد {{student}} للعام {{year}} وهي بانتظار تأكيدك.",
  },
  {
    key: "course_selection_signed_off",
    subjectEn: "{{student}}'s course choices are confirmed",
    subjectAr: "تم تأكيد اختيارات مواد {{student}}",
    bodyEn: "{{by}} confirmed the course choices for {{student}}.",
    bodyAr: "أكّد {{by}} اختيارات مواد {{student}}.",
  },
];

export async function ensureSelectionTemplates(tx: Tx, orgId: string) {
  const have = await tx.messageTemplate.findMany({ where: { orgId, key: { in: SELECTION_TEMPLATES.map((t) => t.key) }, channel: "EMAIL" }, select: { key: true } });
  const missing = SELECTION_TEMPLATES.filter((t) => !have.some((h) => h.key === t.key));
  if (missing.length) await tx.messageTemplate.createMany({ data: missing.map((t) => ({ orgId, channel: "EMAIL" as const, ...t })), skipDuplicates: true });
}
