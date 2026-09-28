// UAE compliance records for the demo school: purposes, consents, DSRs, breach log, retention, transfers.
import { at, id } from "./lib";
import type { SeedWorld } from "./demo";

export async function seedCompliance(w: SeedWorld) {
  const { db, orgId, now } = w;
  const aisha = w.staff.get("aisha_rahman")!.membershipId;

  const purposes = [
    { key: "education", en: "Delivering education", ar: "تقديم التعليم", descEn: "Teaching, assessment, reporting and timetabling.", descAr: "التدريس والتقييم وإعداد التقارير والجداول.", basis: "Contract with the family", cats: ["identity", "academic", "attendance"], consent: false },
    { key: "wellbeing", en: "Student wellbeing and counseling", ar: "رفاه الطلاب والإرشاد", descEn: "Counseling, wellbeing support and learning support.", descAr: "الإرشاد ودعم الرفاه ودعم التعلم.", basis: "Vital interests and legal obligation", cats: ["wellbeing", "special category"], consent: false },
    { key: "safeguarding", en: "Child protection", ar: "حماية الطفل", descEn: "Meeting duties under Federal Law No. 3 of 2016 (Wadeema's Law).", descAr: "الوفاء بالالتزامات بموجب القانون الاتحادي رقم 3 لسنة 2016 (قانون وديمة).", basis: "Legal obligation", cats: ["safeguarding", "special category"], consent: false },
    { key: "health", en: "Health and medical care", ar: "الرعاية الصحية والطبية", descEn: "Clinic visits, allergies, medication and emergencies.", descAr: "زيارات العيادة والحساسية والأدوية والطوارئ.", basis: "Vital interests", cats: ["medical"], consent: false },
    { key: "photo_media", en: "Photos and media", ar: "الصور والوسائط", descEn: "Using student photos in the newsletter, website and social media.", descAr: "استخدام صور الطلاب في النشرة والموقع ووسائل التواصل.", basis: "Consent", cats: ["images"], consent: true },
    { key: "ai_assist", en: "AI-assisted drafting", ar: "الصياغة بمساعدة الذكاء الاصطناعي", descEn: "Staff use an AI assistant to draft summaries and plans. Sensitive data is excluded unless the school enables it.", descAr: "يستخدم الكادر مساعدًا ذكيًا لصياغة الملخصات والخطط، وتُستثنى البيانات الحساسة ما لم تفعّلها المدرسة.", basis: "Legitimate interest with opt-out", cats: ["academic"], consent: true },
    { key: "trips", en: "Trips and activities", ar: "الرحلات والأنشطة", descEn: "Registration, transport and supervision for trips and clubs.", descAr: "التسجيل والنقل والإشراف في الرحلات والأندية.", basis: "Consent", cats: ["identity", "medical"], consent: true },
  ];
  const purposeIds = new Map<string, string>();
  await db.processingPurpose.createMany({
    data: purposes.map((p) => {
      const pid = id();
      purposeIds.set(p.key, pid);
      return { id: pid, orgId, key: p.key, nameEn: p.en, nameAr: p.ar, descEn: p.descEn, descAr: p.descAr, lawfulBasis: p.basis, dataCategories: p.cats, requiresConsent: p.consent };
    }),
  });

  const consentRows = [];
  for (const [i, s] of w.students.entries()) {
    const g = w.guardians.find((x) => x.studentIds.includes(s.id));
    if (!g) continue;
    for (const key of ["photo_media", "ai_assist", "trips"]) {
      const refused = key === "photo_media" && i % 9 === 4;
      const pending = key === "trips" && i % 13 === 7;
      consentRows.push({
        orgId,
        purposeId: purposeIds.get(key)!,
        studentId: s.id,
        guardianId: g.id,
        status: pending ? ("PENDING" as const) : refused ? ("REFUSED" as const) : ("GRANTED" as const),
        method: i % 3 === 0 ? "paper form" : "portal",
        recordedById: aisha,
        decidedAt: at(-(200 - (i % 30)), 10, 0, now),
      });
    }
  }
  await db.consentRecord.createMany({ data: consentRows });

  const dsrs = [
    { type: "ACCESS" as const, status: "IN_PROGRESS" as const, subject: w.students[12], requester: "Parent", days: 6, due: 24 },
    { type: "CORRECTION" as const, status: "COMPLETED" as const, subject: w.students[20], requester: "Parent", days: 40, due: -10, resolution: "Date of birth corrected from passport copy." },
    { type: "DELETION" as const, status: "RECEIVED" as const, subject: w.students[33], requester: "Former parent", days: 2, due: 28 },
    { type: "ACCESS" as const, status: "COMPLETED" as const, subject: w.students[41], requester: "Parent", days: 75, due: -45, resolution: "Export shared through the parent portal." },
  ];
  await db.dataSubjectRequest.createMany({
    data: dsrs.map((d, i) => ({
      orgId,
      number: `DSR-${now.getUTCFullYear()}-${String(i + 1).padStart(3, "0")}`,
      type: d.type,
      status: d.status,
      subjectName: `${d.subject.first.en} ${d.subject.last.en}`,
      requesterName: `${d.requester} of ${d.subject.first.en} ${d.subject.last.en}`,
      studentId: d.subject.id,
      detailsEn: d.type === "DELETION" ? "Family has left the UAE and asks for records to be deleted where the law allows." : d.type === "CORRECTION" ? "Date of birth on the record does not match the passport." : "Copy of all records held about the student.",
      receivedAt: at(-d.days, 9, 0, now),
      dueAt: at(d.due, 17, 0, now),
      completedAt: d.status === "COMPLETED" ? at(-(d.days - 8), 12, 0, now) : null,
      handledById: aisha,
      resolution: d.resolution ?? null,
    })),
  });

  await db.breachLog.create({
    data: {
      orgId,
      titleEn: "Class list emailed to the wrong parent group",
      titleAr: "إرسال قائمة صف إلى مجموعة أولياء أمور غير معنية",
      descriptionEn: "A Grade 7 class list with names and homeroom only was sent to the Grade 8 parent group. Recalled within 20 minutes, recipients asked to delete. No sensitive data involved.",
      descriptionAr: "أُرسلت قائمة صف للصف السابع تتضمن الأسماء والفصل فقط إلى مجموعة أولياء أمور الصف الثامن. تم استرجاعها خلال 20 دقيقة وطُلب من المستلمين حذفها. لم تتضمن بيانات حساسة.",
      severity: "LOW",
      status: "CLOSED",
      affectedCount: 24,
      occurredAt: at(-63, 9, 10, now),
      detectedAt: at(-63, 9, 25, now),
      reportedToSubjectsAt: at(-62, 12, 0, now),
      createdById: aisha,
    },
  });

  const policies = [
    { type: "student_record", en: "Student academic record", ar: "السجل الأكاديمي للطالب", days: 365 * 50, action: "REVIEW" as const },
    { type: "request", en: "Service requests", ar: "طلبات الخدمات", days: 365 * 3, action: "ANONYMIZE" as const },
    { type: "case_standard", en: "Academic and behavior cases", ar: "الحالات الأكاديمية والسلوكية", days: 365 * 6, action: "REVIEW" as const },
    { type: "case_wellbeing", en: "Wellbeing and counseling cases", ar: "حالات الرفاه والإرشاد", days: 365 * 7, action: "REVIEW" as const },
    { type: "case_safeguarding", en: "Safeguarding cases", ar: "ملفات حماية الطفل", days: 365 * 25, action: "REVIEW" as const },
    { type: "medical", en: "Medical records", ar: "السجلات الطبية", days: 365 * 7, action: "REVIEW" as const },
    { type: "audit", en: "Audit log", ar: "سجل التدقيق", days: 365 * 7, action: "DELETE" as const },
    { type: "notification", en: "In-app notifications", ar: "الإشعارات داخل المنصة", days: 180, action: "DELETE" as const },
    { type: "ai_interaction", en: "AI drafts", ar: "مسودات الذكاء الاصطناعي", days: 365, action: "DELETE" as const },
  ];
  await db.retentionPolicy.createMany({
    data: policies.map((p) => ({ orgId, recordType: p.type, nameEn: p.en, nameAr: p.ar, retentionDays: p.days, action: p.action, lastRunAt: at(-1, 3, 0, now), lastRunCount: p.type === "notification" ? 212 : 0 })),
  });

  await db.crossBorderTransfer.createMany({
    data: [
      { orgId, providerName: "Resend (email delivery)", countryCode: "US", purposeEn: "Delivering notification emails", purposeAr: "إرسال رسائل البريد الإلكتروني للإشعارات", safeguardEn: "Contractual clauses. No sensitive case details in email bodies.", safeguardAr: "بنود تعاقدية، ولا تتضمن الرسائل أي تفاصيل حساسة عن الحالات.", approved: true, approvedAt: at(-180, 10, 0, now) },
      { orgId, providerName: "AI provider", countryCode: "US", purposeEn: "Drafting summaries and plans for staff review", purposeAr: "صياغة ملخصات وخطط لمراجعة الكادر", safeguardEn: "Sensitive categories blocked by default. No training on school data.", safeguardAr: "حجب الفئات الحساسة افتراضيًا، ولا تُستخدم بيانات المدرسة في التدريب.", approved: true, approvedAt: at(-120, 10, 0, now) },
      { orgId, providerName: "Cloudflare R2 (document storage)", countryCode: "AE", purposeEn: "Storing documents", purposeAr: "تخزين المستندات", safeguardEn: "Encrypted at rest. Signed, expiring links only.", safeguardAr: "تشفير أثناء التخزين وروابط موقّعة مؤقتة فقط.", approved: true, approvedAt: at(-180, 10, 0, now) },
    ],
  });
}
