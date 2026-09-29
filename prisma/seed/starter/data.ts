// Starter configuration every new school gets: departments, subjects, grade bands and compliance defaults.
// Everything here is editable by the school later from the admin pages.
import type { SchoolCurriculum } from "@prisma/client";

export type Bi = { en: string; ar: string };
const bi = (en: string, ar: string): Bi => ({ en, ar });

export const STARTER_DEPARTMENTS: Array<{ key: string; name: Bi }> = [
  { key: "science", name: bi("Science", "العلوم") },
  { key: "mathematics", name: bi("Mathematics", "الرياضيات") },
  { key: "computing", name: bi("Computing", "الحوسبة") },
  { key: "english", name: bi("English", "اللغة الإنجليزية") },
  { key: "arabic_islamic", name: bi("Arabic and Islamic Studies", "اللغة العربية والدراسات الإسلامية") },
  { key: "humanities", name: bi("Humanities", "العلوم الإنسانية") },
  { key: "arts", name: bi("Arts", "الفنون") },
  { key: "pe", name: bi("Physical Education", "التربية الرياضية") },
  { key: "student_services", name: bi("Student Services", "خدمات الطلاب") },
  { key: "administration", name: bi("Administration", "الإدارة") },
];

export const STARTER_SUBJECTS: Array<{ code: string; dept: string; name: Bi }> = [
  { code: "MATH", dept: "mathematics", name: bi("Mathematics", "الرياضيات") },
  { code: "PHYS", dept: "science", name: bi("Physics", "الفيزياء") },
  { code: "CHEM", dept: "science", name: bi("Chemistry", "الكيمياء") },
  { code: "BIO", dept: "science", name: bi("Biology", "الأحياء") },
  { code: "CS", dept: "computing", name: bi("Computer Science", "علوم الحاسوب") },
  { code: "ENG", dept: "english", name: bi("English", "اللغة الإنجليزية") },
  { code: "ARAB", dept: "arabic_islamic", name: bi("Arabic", "اللغة العربية") },
  { code: "ISL", dept: "arabic_islamic", name: bi("Islamic Education", "التربية الإسلامية") },
  { code: "SOC", dept: "arabic_islamic", name: bi("UAE Social Studies", "الدراسات الاجتماعية الإماراتية") },
  { code: "ECON", dept: "humanities", name: bi("Economics", "الاقتصاد") },
  { code: "BUS", dept: "humanities", name: bi("Business Studies", "إدارة الأعمال") },
  { code: "GEO", dept: "humanities", name: bi("Geography", "الجغرافيا") },
  { code: "HIST", dept: "humanities", name: bi("History", "التاريخ") },
  { code: "PSY", dept: "humanities", name: bi("Psychology", "علم النفس") },
  { code: "FR", dept: "humanities", name: bi("French", "اللغة الفرنسية") },
  { code: "ART", dept: "arts", name: bi("Art and Design", "الفنون والتصميم") },
  { code: "DT", dept: "arts", name: bi("Design and Technology", "التصميم والتكنولوجيا") },
  { code: "MUSIC", dept: "arts", name: bi("Music", "الموسيقى") },
  { code: "PE", dept: "pe", name: bi("Physical Education", "التربية الرياضية") },
];

/** Default grade bands by curriculum family. The first chosen curriculum decides; schools edit them on the grades page. */
export const GRADE_BANDS: Record<"letter" | "percent", Array<{ label: string; minPercent: number }>> = {
  letter: [
    { label: "A*", minPercent: 90 },
    { label: "A", minPercent: 80 },
    { label: "B", minPercent: 70 },
    { label: "C", minPercent: 60 },
    { label: "D", minPercent: 50 },
    { label: "E", minPercent: 40 },
    { label: "U", minPercent: 0 },
  ],
  percent: [
    { label: "A", minPercent: 90 },
    { label: "B", minPercent: 80 },
    { label: "C", minPercent: 70 },
    { label: "D", minPercent: 60 },
    { label: "F", minPercent: 0 },
  ],
};

export function bandsFor(curricula: SchoolCurriculum[]) {
  const first = curricula[0];
  return first && first !== "BRITISH" ? GRADE_BANDS.percent : GRADE_BANDS.letter;
}

/** Which local subject a global course belongs to, from its code or English name. */
export function subjectCodeForCourse(code: string, nameEn: string): string | null {
  const s = `${code} ${nameEn}`.toUpperCase();
  const rules: Array<[RegExp, string]> = [
    [/FURTHER.?MATH|ADD.?MATH|CALC|ALG|GEOM|PRECALC|STAT|MATH/, "MATH"],
    [/PHYS/, "PHYS"],
    [/CHEM/, "CHEM"],
    [/BIO/, "BIO"],
    [/COMPUT|\bCS\b|_CS|CSA|CSP|\bIT\b|INFORMATION TECH/, "CS"],
    [/ARABIC/, "ARAB"],
    [/ISLAM/, "ISL"],
    [/SOCIAL|UAE_SS|MORAL/, "SOC"],
    [/ECON|MACRO|MICRO/, "ECON"],
    [/BUSINESS|\bBUS\b|_BUS|ACCOUNT/, "BUS"],
    [/GEOG|\bGEO\b|_GEO/, "GEO"],
    [/HIST/, "HIST"],
    [/PSYCH/, "PSY"],
    [/FRENCH|\bFR\b/, "FR"],
    [/\bART\b|_ART|VISUAL/, "ART"],
    [/DESIGN|\bDT\b|_DT|ROBOT/, "DT"],
    [/MUSIC/, "MUSIC"],
    [/\bPE\b|_PE|PHYSICAL ED/, "PE"],
    [/ENG|LITERATURE|LANGUAGE A/, "ENG"],
  ];
  for (const [re, subject] of rules) if (re.test(s)) return subject;
  return null;
}

export const STARTER_PURPOSES = [
  { key: "education", en: "Delivering education", ar: "تقديم التعليم", descEn: "Teaching, assessment, reporting and timetabling.", descAr: "التدريس والتقييم وإعداد التقارير والجداول.", basis: "Contract with the family", cats: ["identity", "academic", "attendance"], consent: false },
  { key: "wellbeing", en: "Student wellbeing and counseling", ar: "رفاه الطلاب والإرشاد", descEn: "Counseling, wellbeing support and learning support.", descAr: "الإرشاد ودعم الرفاه ودعم التعلم.", basis: "Vital interests and legal obligation", cats: ["wellbeing", "special category"], consent: false },
  { key: "safeguarding", en: "Child protection", ar: "حماية الطفل", descEn: "Meeting duties under Federal Law No. 3 of 2016 (Wadeema's Law).", descAr: "الوفاء بالالتزامات بموجب القانون الاتحادي رقم 3 لسنة 2016 (قانون وديمة).", basis: "Legal obligation", cats: ["safeguarding", "special category"], consent: false },
  { key: "health", en: "Health and medical care", ar: "الرعاية الصحية والطبية", descEn: "Clinic visits, allergies, medication and emergencies.", descAr: "زيارات العيادة والحساسية والأدوية والطوارئ.", basis: "Vital interests", cats: ["medical"], consent: false },
  { key: "photo_media", en: "Photos and media", ar: "الصور والوسائط", descEn: "Using student photos in the newsletter, website and social media.", descAr: "استخدام صور الطلاب في النشرة والموقع ووسائل التواصل.", basis: "Consent", cats: ["images"], consent: true },
  { key: "ai_assist", en: "AI-assisted drafting", ar: "الصياغة بمساعدة الذكاء الاصطناعي", descEn: "Staff use an AI assistant to draft summaries and plans. Sensitive data is excluded unless the school enables it.", descAr: "يستخدم الكادر مساعدًا ذكيًا لصياغة الملخصات والخطط، وتُستثنى البيانات الحساسة ما لم تفعّلها المدرسة.", basis: "Legitimate interest with opt-out", cats: ["academic"], consent: true },
  { key: "trips", en: "Trips and activities", ar: "الرحلات والأنشطة", descEn: "Registration, transport and supervision for trips and clubs.", descAr: "التسجيل والنقل والإشراف في الرحلات والأندية.", basis: "Consent", cats: ["identity", "medical"], consent: true },
];

export const STARTER_RETENTION = [
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

/** The platform's processors. A new school starts with them listed but not approved, so it reviews them. */
export const STARTER_TRANSFERS = [
  { providerName: "Resend (email delivery)", countryCode: "US", purposeEn: "Delivering notification emails", purposeAr: "إرسال رسائل البريد الإلكتروني للإشعارات", safeguardEn: "Contractual clauses. No sensitive case details in email bodies.", safeguardAr: "بنود تعاقدية، ولا تتضمن الرسائل أي تفاصيل حساسة عن الحالات." },
  { providerName: "AI provider", countryCode: "US", purposeEn: "Drafting summaries and plans for staff review", purposeAr: "صياغة ملخصات وخطط لمراجعة الكادر", safeguardEn: "Sensitive categories blocked by default. No training on school data.", safeguardAr: "حجب الفئات الحساسة افتراضيًا، ولا تُستخدم بيانات المدرسة في التدريب." },
  { providerName: "Cloudflare R2 (document storage)", countryCode: "AE", purposeEn: "Storing documents", purposeAr: "تخزين المستندات", safeguardEn: "Encrypted at rest. Signed, expiring links only.", safeguardAr: "تشفير أثناء التخزين وروابط موقّعة مؤقتة فقط." },
];

/** Email sent to a new school's administrator to confirm their address. */
export const VERIFY_EMAIL_TEMPLATE = {
  key: "email_verification",
  subjectEn: "Confirm your email for {{school}}",
  subjectAr: "أكّد بريدك الإلكتروني لمدرسة {{school}}",
  bodyEn: "Welcome, {{name}}. Please confirm your email address to unlock staff invitations and family access for {{school}}. The link is valid for 48 hours.",
  bodyAr: "مرحبًا {{name}}. يُرجى تأكيد بريدك الإلكتروني لتفعيل دعوات الموظفين ووصول العائلات إلى {{school}}. الرابط صالح لمدة 48 ساعة.",
};

/** Words in the demo school's texts that a new school gets replaced with its own name. One pass, so it is idempotent. */
export function rebrand(text: string, names: { nameEn: string; nameAr: string; shortEn: string; shortAr: string }) {
  return text.replace(/Horizon International School(?: Dubai)?|مدرسة هورايزن الدولية(?: - دبي| في دبي)?|منصة هورايزن|مدرسة هورايزن|هورايزن|Horizon/g, (m) => {
    if (m.startsWith("Horizon International")) return names.nameEn;
    if (m.startsWith("مدرسة")) return names.nameAr;
    if (m === "منصة هورايزن") return `منصة ${names.shortAr}`;
    if (m === "هورايزن") return names.shortAr;
    return names.shortEn;
  });
}
