// Document categories and bilingual letter templates with merge fields.
import type { I18nText } from "@/server/forms/schema";

export const DOCUMENT_CATEGORIES: Array<{ key: string; name: I18nText; sensitivity: "STANDARD" | "CONFIDENTIAL" | "MEDICAL" | "WELLBEING" | "SAFEGUARDING" }> = [
  { key: "official_letters", name: { en: "Official letters", ar: "الخطابات الرسمية" }, sensitivity: "STANDARD" },
  { key: "reports", name: { en: "Reports and transcripts", ar: "التقارير وكشوف الدرجات" }, sensitivity: "STANDARD" },
  { key: "identity", name: { en: "Identity documents", ar: "وثائق الهوية" }, sensitivity: "CONFIDENTIAL" },
  { key: "medical", name: { en: "Medical", ar: "السجلات الطبية" }, sensitivity: "MEDICAL" },
  { key: "learning_support", name: { en: "Learning support plans", ar: "خطط دعم التعلم" }, sensitivity: "CONFIDENTIAL" },
  { key: "wellbeing", name: { en: "Wellbeing", ar: "الرفاه" }, sensitivity: "WELLBEING" },
  { key: "safeguarding", name: { en: "Safeguarding", ar: "حماية الطفل" }, sensitivity: "SAFEGUARDING" },
  { key: "consent", name: { en: "Consent forms", ar: "نماذج الموافقة" }, sensitivity: "STANDARD" },
  { key: "career", name: { en: "Career and university", ar: "التوجيه المهني والجامعي" }, sensitivity: "STANDARD" },
];

export type DocumentTemplateSeed = {
  key: string;
  name: I18nText;
  description: I18nText;
  bodyEn: string;
  bodyAr: string;
  output: "EN" | "AR" | "BILINGUAL";
  mergeFields: string[];
  signatory: I18nText;
};

export const MERGE_FIELDS = [
  "student.fullName",
  "student.fullNameAr",
  "student.studentNo",
  "student.grade",
  "student.dateOfBirth",
  "student.nationality",
  "student.enrolledOn",
  "school.name",
  "school.nameAr",
  "academicYear.name",
  "request.number",
  "request.addressedTo",
  "request.purpose",
  "today",
];

export const DOCUMENT_TEMPLATES: DocumentTemplateSeed[] = [
  {
    key: "enrollment_letter",
    name: { en: "Enrollment Confirmation Letter", ar: "خطاب تأكيد القيد" },
    description: {
      en: "Confirms that a student is currently enrolled. Used for visas, embassies and banks.",
      ar: "يؤكد قيد الطالب حاليًا في المدرسة، ويُستخدم لأغراض التأشيرات والسفارات والبنوك.",
    },
    bodyEn:
      "To: {{request.addressedTo}}\n\nThis is to confirm that {{student.fullName}}, date of birth {{student.dateOfBirth}}, {{student.nationality}} national, student number {{student.studentNo}}, is enrolled at {{school.name}} in Grade {{student.grade}} for the academic year {{academicYear.name}}.\n\nThe student has been enrolled with us since {{student.enrolledOn}} and is in good standing.\n\nThis letter is issued at the request of the family for the purpose of {{request.purpose}} and carries no liability on the school beyond the facts stated.",
    bodyAr:
      "إلى: {{request.addressedTo}}\n\nتشهد {{school.nameAr}} بأن الطالب/ة {{student.fullNameAr}}، تاريخ الميلاد {{student.dateOfBirth}}، الجنسية {{student.nationality}}، الرقم المدرسي {{student.studentNo}}، مقيّد/ة لديها في الصف {{student.grade}} للعام الدراسي {{academicYear.name}}.\n\nوقد التحق/ت بالمدرسة منذ {{student.enrolledOn}}، وسجله/ا الدراسي والسلوكي جيد.\n\nأُعطي هذا الخطاب بناءً على طلب الأسرة لغرض {{request.purpose}}، دون أدنى مسؤولية على المدرسة تجاه الغير.",
    output: "BILINGUAL",
    mergeFields: MERGE_FIELDS,
    signatory: { en: "Registrar, on behalf of the Principal", ar: "المسجل، نيابةً عن مدير المدرسة" },
  },
  {
    key: "transcript",
    name: { en: "Transcript Cover Letter", ar: "خطاب تغطية كشف الدرجات" },
    description: {
      en: "Accompanies an official transcript sent to universities.",
      ar: "يرافق كشف الدرجات الرسمي المرسل إلى الجامعات.",
    },
    bodyEn:
      "To: {{request.addressedTo}}\n\nPlease find enclosed the official academic transcript for {{student.fullName}}, student number {{student.studentNo}}, currently in Grade {{student.grade}} at {{school.name}}.\n\nThe transcript lists all subjects and final grades recorded since enrollment on {{student.enrolledOn}}. Grades follow the school's published grading scale, which is printed on the reverse of the transcript.\n\nFor verification, please contact the Registrar's Office quoting reference {{request.number}}.",
    bodyAr:
      "إلى: {{request.addressedTo}}\n\nنرفق طيه كشف الدرجات الأكاديمي الرسمي للطالب/ة {{student.fullNameAr}}، الرقم المدرسي {{student.studentNo}}، المقيّد/ة حاليًا في الصف {{student.grade}} في {{school.nameAr}}.\n\nيتضمن الكشف جميع المواد والدرجات النهائية المسجلة منذ الالتحاق بالمدرسة في {{student.enrolledOn}}، وفق سلّم التقديرات المعتمد في المدرسة والمطبوع على ظهر الكشف.\n\nللتحقق، يُرجى التواصل مع مكتب التسجيل مع ذكر الرقم المرجعي {{request.number}}.",
    output: "BILINGUAL",
    mergeFields: MERGE_FIELDS,
    signatory: { en: "Registrar", ar: "المسجل" },
  },
  {
    key: "good_conduct",
    name: { en: "Good Conduct Certificate", ar: "شهادة حسن سيرة وسلوك" },
    description: { en: "Certifies the student's conduct at school.", ar: "تشهد بحسن سيرة الطالب وسلوكه في المدرسة." },
    bodyEn:
      "To whom it may concern\n\n{{school.name}} certifies that {{student.fullName}}, student number {{student.studentNo}}, Grade {{student.grade}}, has shown good conduct and behavior throughout their time at the school.\n\nIssued on {{today}} at the request of the family.",
    bodyAr:
      "إلى من يهمه الأمر\n\nتشهد {{school.nameAr}} بأن الطالب/ة {{student.fullNameAr}}، الرقم المدرسي {{student.studentNo}}، الصف {{student.grade}}، يتحلى/تتحلى بحسن السيرة والسلوك طوال فترة دراسته/ا في المدرسة.\n\nصدرت بتاريخ {{today}} بناءً على طلب الأسرة.",
    output: "BILINGUAL",
    mergeFields: MERGE_FIELDS,
    signatory: { en: "Principal", ar: "مدير المدرسة" },
  },
  {
    key: "bus_pass_letter",
    name: { en: "Transport Pass Letter", ar: "خطاب تصريح النقل" },
    description: { en: "Confirms enrollment for a student transport pass.", ar: "يؤكد القيد لغرض إصدار تصريح النقل المدرسي." },
    bodyEn:
      "To: {{request.addressedTo}}\n\nThis letter confirms that {{student.fullName}}, Grade {{student.grade}}, is a registered student of {{school.name}} for {{academicYear.name}} and is eligible for a student transport pass.",
    bodyAr:
      "إلى: {{request.addressedTo}}\n\nيؤكد هذا الخطاب أن الطالب/ة {{student.fullNameAr}}، الصف {{student.grade}}، مقيّد/ة في {{school.nameAr}} للعام الدراسي {{academicYear.name}}، ويحق له/ا الحصول على تصريح النقل المدرسي.",
    output: "BILINGUAL",
    mergeFields: MERGE_FIELDS,
    signatory: { en: "Registrar", ar: "المسجل" },
  },
];
