// Letter and message templates used by trips and exam timetables. Created on first use when an
// organisation does not have them yet; existing rows (possibly edited by the school) are never overwritten.
import type { Tx } from "@/server/db";

export const TRIP_LETTER_KEY = "trip_consent";

export const TRIP_LETTER = {
  key: TRIP_LETTER_KEY,
  nameEn: "Trip consent letter",
  nameAr: "خطاب الموافقة على الرحلة",
  descEn: "Sent to families when a school trip is published. Parents give or decline consent online.",
  descAr: "يُرسل إلى الأسر عند نشر رحلة مدرسية، ويمنح أولياء الأمور موافقتهم أو يرفضونها عبر المنصة.",
  bodyEn:
    "Dear Parent or Guardian of {{student.fullName}},\n\nWe are pleased to invite {{student.fullName}} (Grade {{student.grade}}) to join the following school trip.\n\nTrip: {{trip.title}}\nDestination: {{trip.destination}}\nDate: {{trip.dates}}\nCost: {{trip.cost}}\n\n{{trip.description}}\n\nStudents will be supervised by school staff throughout the trip, and the usual school code of conduct applies. Please make sure your child brings water, a packed snack and their school ID.\n\nPlease give or decline consent in the Horizon parent portal by {{trip.deadline}}. Students without consent will stay in school and follow the normal timetable.\n\nWith thanks,\n{{trip.organizer}}",
  bodyAr:
    "ولي أمر الطالب/ة {{student.fullNameAr}} المحترم،\n\nيسعدنا دعوة {{student.fullNameAr}} (الصف {{student.grade}}) للمشاركة في الرحلة المدرسية التالية.\n\nالرحلة: {{trip.title}}\nالوجهة: {{trip.destination}}\nالتاريخ: {{trip.dates}}\nالتكلفة: {{trip.cost}}\n\n{{trip.description}}\n\nسيكون الطلاب تحت إشراف موظفي المدرسة طوال الرحلة، وتنطبق قواعد السلوك المدرسي المعتادة. يُرجى التأكد من إحضار الماء ووجبة خفيفة وبطاقة الطالب.\n\nيُرجى منح الموافقة أو رفضها عبر بوابة أولياء الأمور في منصة هورايزن قبل {{trip.deadline}}. يبقى الطلاب الذين لم تصل موافقتهم في المدرسة ويتابعون جدولهم المعتاد.\n\nمع الشكر،\n{{trip.organizer}}",
  signatoryEn: "Trip organiser, Horizon International School",
  signatoryAr: "منظم الرحلة، مدرسة هورايزن الدولية",
  mergeFields: ["student.fullName", "student.fullNameAr", "student.grade", "trip.title", "trip.destination", "trip.dates", "trip.cost", "trip.description", "trip.deadline", "trip.organizer"],
};

export const CALENDAR_MESSAGE_TEMPLATES: Array<{ key: string; subject: { en: string; ar: string }; body: { en: string; ar: string } }> = [
  {
    key: "trip_consent_request",
    subject: { en: "Consent needed: {{trip}} for {{student}}", ar: "مطلوب موافقتك: {{trip}} للطالب/ة {{student}}" },
    body: {
      en: "{{student}} is invited on {{trip}} on {{date}}. Please read the letter and give or decline consent by {{deadline}}.",
      ar: "تمت دعوة {{student}} للمشاركة في {{trip}} بتاريخ {{date}}. يُرجى قراءة الخطاب ومنح الموافقة أو رفضها قبل {{deadline}}.",
    },
  },
  {
    key: "trip_consent_reminder",
    subject: { en: "Reminder: consent for {{trip}}", ar: "تذكير: الموافقة على {{trip}}" },
    body: {
      en: "We have not yet received your decision for {{student}} on {{trip}}. The deadline is {{deadline}}.",
      ar: "لم يصلنا قرارك بعد بشأن مشاركة {{student}} في {{trip}}. الموعد النهائي هو {{deadline}}.",
    },
  },
  {
    key: "trip_cancelled",
    subject: { en: "Trip cancelled: {{trip}}", ar: "إلغاء الرحلة: {{trip}}" },
    body: {
      en: "{{trip}} planned for {{date}} has been cancelled. {{reason}}",
      ar: "تم إلغاء {{trip}} المقررة بتاريخ {{date}}. {{reason}}",
    },
  },
  {
    key: "exam_timetable_published",
    subject: { en: "Exam timetable published for Grade {{grade}}", ar: "نشر جدول الامتحانات للصف {{grade}}" },
    body: {
      en: "The {{term}} exam timetable for Grade {{grade}} is now available: {{count}} exams from {{from}}. You can download it as a PDF.",
      ar: "أصبح جدول امتحانات {{term}} للصف {{grade}} متاحاً: {{count}} امتحانات تبدأ من {{from}}. يمكنك تنزيله بصيغة PDF.",
    },
  },
];

/** Create the trip letter template and the notification templates when missing. */
export async function ensureCalendarTemplates(tx: Tx, orgId: string) {
  const letter = await tx.documentTemplate.findUnique({ where: { orgId_key: { orgId, key: TRIP_LETTER_KEY } } });
  const template =
    letter ??
    (await tx.documentTemplate.create({
      data: {
        orgId,
        key: TRIP_LETTER.key,
        nameEn: TRIP_LETTER.nameEn,
        nameAr: TRIP_LETTER.nameAr,
        descEn: TRIP_LETTER.descEn,
        descAr: TRIP_LETTER.descAr,
        bodyEn: TRIP_LETTER.bodyEn,
        bodyAr: TRIP_LETTER.bodyAr,
        output: "BILINGUAL",
        mergeFields: TRIP_LETTER.mergeFields,
        signatoryEn: TRIP_LETTER.signatoryEn,
        signatoryAr: TRIP_LETTER.signatoryAr,
      },
    }));
  const existing = await tx.messageTemplate.findMany({ where: { orgId, key: { in: CALENDAR_MESSAGE_TEMPLATES.map((t) => t.key) }, channel: "EMAIL" }, select: { key: true } });
  const missing = CALENDAR_MESSAGE_TEMPLATES.filter((t) => !existing.some((e) => e.key === t.key));
  if (missing.length) {
    await tx.messageTemplate.createMany({
      data: missing.map((t) => ({ orgId, key: t.key, channel: "EMAIL" as const, subjectEn: t.subject.en, subjectAr: t.subject.ar, bodyEn: t.body.en, bodyAr: t.body.ar })),
      skipDuplicates: true,
    });
  }
  return template;
}
