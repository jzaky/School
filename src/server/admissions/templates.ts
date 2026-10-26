// Admissions setup every school gets: notification templates for staff and parents, the offer letter and transfer
// certificate templates (editable on Templates), and the "Admission assessment" meeting type.
// Idempotent: only adds what is missing, so it runs at sign-up, in the demo seed and before the first use.
import type { Tx } from "@/server/db";

export const ADMISSION_MESSAGE_TEMPLATES = [
  {
    key: "admission_submitted",
    subject: { en: "New application {{number}} for {{grade}}", ar: "طلب التحاق جديد {{number}} لـ{{grade}}" },
    body: { en: "A family submitted application {{number}} for {{grade}}. Open the admissions board to review it.", ar: "قدّمت أسرة طلب الالتحاق {{number}} لـ{{grade}}. افتح لوحة القبول لمراجعته." },
  },
  {
    key: "admission_family_message",
    subject: { en: "The family replied on {{number}}", ar: "ردّت الأسرة على الطلب {{number}}" },
    body: { en: "The family sent a message on application {{number}}. Open the application to read it.", ar: "أرسلت الأسرة رسالة على طلب الالتحاق {{number}}. افتح الطلب لقراءتها." },
  },
  {
    key: "admission_offer_accepted",
    subject: { en: "Offer accepted: {{number}}", ar: "قُبل العرض: {{number}}" },
    body: { en: "The family accepted the offer on application {{number}} for {{grade}}.", ar: "قبلت الأسرة العرض على طلب الالتحاق {{number}} لـ{{grade}}." },
  },
  {
    key: "admission_offer_declined",
    subject: { en: "Offer declined: {{number}}", ar: "رُفض العرض: {{number}}" },
    body: { en: "The family declined the offer on application {{number}} for {{grade}}. The seat is free again.", ar: "اعتذرت الأسرة عن العرض على طلب الالتحاق {{number}} لـ{{grade}}، وأصبح المقعد متاحًا من جديد." },
  },
  {
    key: "reenrollment_open",
    subject: { en: "Please confirm next year's place for your child", ar: "يُرجى تأكيد مقعد طفلك للعام القادم" },
    body: { en: "Re-enrollment for {{year}} is open until {{closes}}. Tell us whether each child is returning.", ar: "إعادة التسجيل للعام {{year}} مفتوحة حتى {{closes}}. أخبرونا هل سيعود كل طفل." },
  },
  {
    key: "reenrollment_reminder",
    subject: { en: "Reminder: confirm next year's place by {{closes}}", ar: "تذكير: أكّدوا مقعد العام القادم قبل {{closes}}" },
    body: { en: "We have not heard from you yet about {{year}}. Please confirm for each child by {{closes}}.", ar: "لم يصلنا ردكم بعد بشأن العام {{year}}. يُرجى التأكيد لكل طفل قبل {{closes}}." },
  },
] as const;

const OFFER_EN = `Dear {{guardian.name}},

We are delighted to offer {{child.fullName}} a place in {{grade}} at {{school.name}} for the academic year {{year}}.

To accept this offer, please confirm through your application page by {{offer.deadline}}. {{seat.sentence}}

The place is confirmed once the offer is accepted and the registration documents are complete. Enrollment is subject to registering the student with the education regulator.

Application reference: {{application.number}}

We look forward to welcoming {{child.firstName}} to our school community.`;

const OFFER_AR = `السيد/السيدة {{guardian.name}} المحترم/ة،

يسعدنا أن نعرض على {{child.fullName}} مقعدًا في {{grade}} في {{school.nameAr}} للعام الدراسي {{year}}.

لقبول هذا العرض يُرجى التأكيد من خلال صفحة الطلب في موعد أقصاه {{offer.deadline}}. {{seat.sentence}}

يُثبَّت المقعد بعد قبول العرض واكتمال مستندات التسجيل، ويخضع القيد لتسجيل الطالب لدى الجهة التعليمية المختصة.

رقم الطلب: {{application.number}}

نتطلع إلى الترحيب بـ{{child.firstName}} في مجتمعنا المدرسي.`;

const TC_EN = `This is to certify that {{student.fullName}}, student number {{student.studentNo}}, born on {{student.dateOfBirth}}, nationality {{student.nationality}}, was enrolled at {{school.name}} from {{student.enrolledOn}} until {{leaving.date}}.

At the time of leaving the student was in {{student.grade}}.

Reason for leaving: {{leaving.reason}}

This certificate is issued at the request of the family for enrollment at another school.

Transfer certificate number: {{tc.number}}`;

const TC_AR = `تشهد {{school.nameAr}} بأن الطالب/ة {{student.fullName}}، الرقم المدرسي {{student.studentNo}}، تاريخ الميلاد {{student.dateOfBirth}}، الجنسية {{student.nationality}}، كان/ت مقيّدًا/ة لديها من {{student.enrolledOn}} حتى {{leaving.date}}.

وكان/ت عند المغادرة في {{student.grade}}.

سبب المغادرة: {{leaving.reason}}

أُعطيت هذه الشهادة بناءً على طلب الأسرة لغرض الالتحاق بمدرسة أخرى.

رقم شهادة النقل: {{tc.number}}`;

export const OFFER_TEMPLATE_KEY = "admission_offer";
export const TC_TEMPLATE_KEY = "transfer_certificate";

export const ADMISSION_DOCUMENT_TEMPLATES = [
  {
    key: OFFER_TEMPLATE_KEY,
    nameEn: "Offer of a Place",
    nameAr: "عرض مقعد دراسي",
    descEn: "Offer letter sent to a family when the school makes an offer. Generated from the application.",
    descAr: "خطاب العرض الذي يُرسل إلى الأسرة عند تقديم عرض القبول، ويُنشأ من بيانات الطلب.",
    bodyEn: OFFER_EN,
    bodyAr: OFFER_AR,
    mergeFields: ["guardian.name", "child.fullName", "child.firstName", "grade", "year", "school.name", "school.nameAr", "offer.deadline", "seat.sentence", "application.number"],
    signatoryEn: "Admissions Office, on behalf of the Principal",
    signatoryAr: "مكتب القبول، نيابةً عن مدير المدرسة",
  },
  {
    key: TC_TEMPLATE_KEY,
    nameEn: "Transfer Certificate",
    nameAr: "شهادة نقل",
    descEn: "Issued when a student leaves the school. Generated from the withdrawal record.",
    descAr: "تصدر عند مغادرة الطالب للمدرسة، وتُنشأ من سجل الانسحاب.",
    bodyEn: TC_EN,
    bodyAr: TC_AR,
    mergeFields: ["student.fullName", "student.studentNo", "student.dateOfBirth", "student.nationality", "student.enrolledOn", "student.grade", "school.name", "school.nameAr", "leaving.date", "leaving.reason", "tc.number"],
    signatoryEn: "Registrar, on behalf of the Principal",
    signatoryAr: "المسجل، نيابةً عن مدير المدرسة",
  },
];

export const ASSESSMENT_TYPE_KEY = "admission_assessment";

/** Create whatever admissions setup the school is missing. Never overwrites a school's edits. */
export async function ensureAdmissionSetup(tx: Tx, orgId: string) {
  const keys = ADMISSION_MESSAGE_TEMPLATES.map((t) => t.key as string);
  const have = await tx.messageTemplate.findMany({ where: { orgId, key: { in: keys }, channel: "EMAIL" }, select: { key: true } });
  const missing = ADMISSION_MESSAGE_TEMPLATES.filter((t) => !have.some((h) => h.key === t.key));
  if (missing.length)
    await tx.messageTemplate.createMany({
      data: missing.map((t) => ({ orgId, key: t.key, channel: "EMAIL" as const, subjectEn: t.subject.en, subjectAr: t.subject.ar, bodyEn: t.body.en, bodyAr: t.body.ar })),
      skipDuplicates: true,
    });
  await tx.documentTemplate.createMany({
    data: ADMISSION_DOCUMENT_TEMPLATES.map((t) => ({ orgId, key: t.key, nameEn: t.nameEn, nameAr: t.nameAr, descEn: t.descEn, descAr: t.descAr, bodyEn: t.bodyEn, bodyAr: t.bodyAr, output: "BILINGUAL" as const, mergeFields: t.mergeFields, signatoryEn: t.signatoryEn, signatoryAr: t.signatoryAr })),
    skipDuplicates: true,
  });
  await tx.appointmentType.createMany({
    data: [
      {
        orgId,
        key: ASSESSMENT_TYPE_KEY,
        nameEn: "Admission assessment",
        nameAr: "تقييم القبول",
        descEn: "Assessment or interview for a child applying to the school. Booked by the admissions office.",
        descAr: "تقييم أو مقابلة لطفل متقدم للالتحاق بالمدرسة، يحجزه مكتب القبول.",
        durationMin: 45,
        bufferAfterMin: 15,
        minNoticeMin: 0,
        horizonDays: 120,
        locationType: "IN_PERSON",
        locationEn: "Admissions office",
        locationAr: "مكتب القبول",
        hostMode: "SPECIFIC",
        audience: [],
        color: "#0E7490",
      },
    ],
    skipDuplicates: true,
  });
}
