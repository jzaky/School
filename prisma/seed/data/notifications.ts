// Bilingual message templates. Admins can edit them per language. {{placeholders}} are filled at send time.

export type TemplateSeed = {
  key: string;
  subject: { en: string; ar: string };
  body: { en: string; ar: string };
  sms?: { en: string; ar: string };
};

export const MESSAGE_TEMPLATES: TemplateSeed[] = [
  {
    key: "request_submitted",
    subject: { en: "We received your request {{number}}", ar: "تم استلام طلبك رقم {{number}}" },
    body: {
      en: "Your request \"{{title}}\" has been received. You can follow every step in Horizon.",
      ar: "تم استلام طلبك \"{{title}}\". يمكنك متابعة كل خطوة عبر منصة هورايزن.",
    },
  },
  {
    key: "approval_needed",
    subject: { en: "Your approval is needed: {{title}}", ar: "مطلوب موافقتك: {{title}}" },
    body: {
      en: "{{title}} is waiting for your decision.",
      ar: "الطلب \"{{title}}\" بانتظار قرارك.",
    },
    sms: { en: "Horizon: your approval is needed for {{title}}.", ar: "هورايزن: مطلوب موافقتك على {{title}}." },
  },
  {
    key: "case_assigned",
    subject: { en: "New case assigned: {{title}}", ar: "حالة جديدة مسندة إليك: {{title}}" },
    body: {
      en: "A new case for {{student}} has been assigned to you.",
      ar: "أُسندت إليك حالة جديدة تخص الطالب/ة {{student}}.",
    },
  },
  {
    key: "referral_accepted",
    subject: { en: "Your referral is being handled", ar: "إحالتك قيد المعالجة" },
    body: {
      en: "Thank you. {{assignee}} is now supporting {{student}}.",
      ar: "شكرًا لك. يتولى {{assignee}} الآن دعم الطالب/ة {{student}}.",
    },
  },
  {
    key: "case_escalated",
    subject: { en: "Escalated: {{title}}", ar: "تصعيد: {{title}}" },
    body: {
      en: "A high priority case for {{student}} needs leadership attention.",
      ar: "حالة ذات أولوية عالية تخص الطالب/ة {{student}} تحتاج إلى متابعة الإدارة.",
    },
  },
  {
    key: "subject_change_done",
    subject: { en: "Subject change approved", ar: "تمت الموافقة على تغيير المادة" },
    body: {
      en: "The subject change for {{student}} is approved and the timetable has been updated.",
      ar: "تمت الموافقة على تغيير المادة للطالب/ة {{student}} وتحديث الجدول الدراسي.",
    },
  },
  {
    key: "document_ready",
    subject: { en: "Your document is ready", ar: "مستندك جاهز" },
    body: {
      en: "{{title}} is ready to download from Horizon.",
      ar: "المستند \"{{title}}\" جاهز للتنزيل من منصة هورايزن.",
    },
  },
  {
    key: "meeting_booked",
    subject: { en: "Meeting booked: {{when}}", ar: "تم حجز اجتماع: {{when}}" },
    body: {
      en: "A meeting about {{student}} has been booked for {{when}}.",
      ar: "تم حجز اجتماع بخصوص الطالب/ة {{student}} في {{when}}.",
    },
  },
  {
    key: "appointment_confirmed",
    subject: { en: "Confirmed: {{title}} on {{when}}", ar: "تم التأكيد: {{title}} في {{when}}" },
    body: {
      en: "Your meeting with {{host}} is confirmed for {{when}} at {{location}}.",
      ar: "تم تأكيد موعدك مع {{host}} في {{when}}، المكان: {{location}}.",
    },
    sms: { en: "Horizon: confirmed with {{host}}, {{when}}.", ar: "هورايزن: تم تأكيد موعدك مع {{host}}، {{when}}." },
  },
  {
    key: "appointment_reminder",
    subject: { en: "Reminder: {{title}} {{relative}}", ar: "تذكير: {{title}} {{relative}}" },
    body: {
      en: "This is a reminder of your meeting with {{host}} at {{when}}, {{location}}.",
      ar: "نذكّرك بموعدك مع {{host}} في {{when}}، المكان: {{location}}.",
    },
    sms: { en: "Horizon reminder: {{title}} {{relative}}.", ar: "تذكير من هورايزن: {{title}} {{relative}}." },
  },
  {
    key: "request_completed",
    subject: { en: "Request {{number}} is complete", ar: "اكتمل الطلب رقم {{number}}" },
    body: {
      en: "Your request \"{{title}}\" is complete.",
      ar: "اكتمل طلبك \"{{title}}\".",
    },
  },
  {
    key: "request_rejected",
    subject: { en: "Request {{number}} was not approved", ar: "لم تتم الموافقة على الطلب رقم {{number}}" },
    body: {
      en: "Your request \"{{title}}\" was not approved. Open it in Horizon to see the comment.",
      ar: "لم تتم الموافقة على طلبك \"{{title}}\". افتحه في منصة هورايزن للاطلاع على التعليق.",
    },
  },
  {
    key: "task_assigned",
    subject: { en: "New task: {{title}}", ar: "مهمة جديدة: {{title}}" },
    body: { en: "You have a new task due {{when}}.", ar: "لديك مهمة جديدة تستحق {{when}}." },
  },
  {
    key: "wellbeing_referral",
    subject: { en: "Confidential wellbeing referral", ar: "إحالة رفاه سرية" },
    body: {
      en: "A confidential wellbeing referral needs your attention. Open Horizon to view it.",
      ar: "إحالة رفاه سرية تحتاج إلى اهتمامك. افتح منصة هورايزن للاطلاع عليها.",
    },
  },
  {
    key: "safeguarding_new",
    subject: { en: "New safeguarding concern", ar: "بلاغ حماية جديد" },
    body: {
      en: "A new safeguarding concern has been raised. Open Horizon to review it. Details are not included in this message.",
      ar: "تم رفع بلاغ حماية جديد. افتح منصة هورايزن لمراجعته. لا تتضمن هذه الرسالة أي تفاصيل.",
    },
  },
  {
    key: "safeguarding_immediate",
    subject: { en: "URGENT: immediate danger concern raised", ar: "عاجل: بلاغ حماية بخطر فوري" },
    body: {
      en: "A concern marked immediate danger has just been raised by {{referrer}}. Contact them now. Open Horizon for the case.",
      ar: "رفع {{referrer}} للتو بلاغ حماية مصنّفًا بخطر فوري. تواصل معه الآن وافتح منصة هورايزن للاطلاع على الحالة.",
    },
    sms: {
      en: "URGENT Horizon: immediate danger concern raised by {{referrer}}. Call now.",
      ar: "عاجل من هورايزن: بلاغ خطر فوري من {{referrer}}. اتصل الآن.",
    },
  },
  {
    key: "break_glass",
    subject: { en: "Emergency access used on a safeguarding case", ar: "تم استخدام الوصول الطارئ لملف حماية" },
    body: {
      en: "{{actor}} used emergency access on case {{number}}. Reason: {{reason}}",
      ar: "استخدم {{actor}} الوصول الطارئ لملف الحالة {{number}}. السبب: {{reason}}",
    },
  },
  {
    key: "parent_update",
    subject: { en: "An update about {{student}}", ar: "مستجدات بخصوص {{student}}" },
    body: { en: "{{message}}", ar: "{{message}}" },
  },
];
