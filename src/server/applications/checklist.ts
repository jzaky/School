// Checklist generation for one application: what the route always asks for, plus the programme's current
// requirement rows (tests, language tests, portfolio, interview and so on). Pure. Titles are stored on the
// ApplicationRequirement rows in English and Arabic.
import type { AppRoute, ItemKind } from "./types";

export type ChecklistItem = { kind: ItemKind; titleEn: string; titleAr: string };

export type RequirementRows = {
  tests: Array<{ test: string; policy: string; minScore?: number | null }>;
  languages: Array<{ test: string; minOverall: number }>;
  additional: Array<{ kind: string; required: boolean; noteEn?: string | null; noteAr?: string | null }>;
};

export type ChecklistInput = {
  route: AppRoute;
  oxbridgeOrMedicine?: boolean;
  /** The programme's current structured requirement rows (general row plus the student's curriculum row). */
  current?: RequirementRows | null;
  /** Older per-programme JSON (admissions tests, English minimums, US test policy). Used when there are no rows. */
  legacy?: { admissionsTests?: string[]; ielts?: number | null; toefl?: number | null; testPolicy?: string | null } | null;
};

const it = (kind: ItemKind, en: string, ar: string): ChecklistItem => ({ kind, titleEn: en, titleAr: ar });

const ROUTE_ITEMS: Record<AppRoute, ChecklistItem[]> = {
  UCAS: [
    it("PERSONAL_STATEMENT", "UCAS personal statement", "المقال الشخصي في UCAS"),
    it("PREDICTED_GRADES", "Predicted grades entered by the school", "إدخال المدرسة للدرجات المتوقعة"),
    it("RECOMMENDATION", "UCAS reference from a teacher", "خطاب مرجعي من معلم عبر UCAS"),
    it("TRANSCRIPT", "GCSE and IGCSE results added to UCAS Hub", "إضافة نتائج GCSE وIGCSE إلى UCAS Hub"),
    it("PASSPORT", "Passport details for the visa section", "بيانات جواز السفر لقسم التأشيرة"),
    it("FORM", "Submit the UCAS application", "تقديم طلب UCAS"),
  ],
  COMMON_APP: [
    it("ESSAY", "Common App personal essay", "المقال الشخصي في Common App"),
    it("ESSAY", "Supplemental essays", "المقالات الإضافية"),
    it("RECOMMENDATION", "Teacher recommendation letter", "خطاب توصية من معلم"),
    it("RECOMMENDATION", "Counselor recommendation and school report", "توصية المرشد وتقرير المدرسة"),
    it("TRANSCRIPT", "Official transcript (Grades 9 to 12)", "كشف الدرجات الرسمي (الصفوف 9 إلى 12)"),
    it("FINANCIAL", "Financial documents (CSS Profile or certification of finances)", "المستندات المالية (CSS Profile أو إثبات القدرة المالية)"),
    it("PASSPORT", "Passport copy", "نسخة من جواز السفر"),
    it("FORM", "Submit the Common App", "تقديم طلب Common App"),
  ],
  MIT_APP: [
    it("ESSAY", "MIT short answer essays", "مقالات الإجابات القصيرة لمعهد MIT"),
    it("RECOMMENDATION", "Two teacher evaluations (maths or science and humanities)", "تقييمان من معلمين (رياضيات أو علوم وعلوم إنسانية)"),
    it("TRANSCRIPT", "Secondary school report and transcript", "تقرير المدرسة الثانوية وكشف الدرجات"),
    it("INTERVIEW", "Educational Counselor interview", "مقابلة المرشد التعليمي"),
    it("FINANCIAL", "Financial aid documents", "مستندات المساعدة المالية"),
    it("FORM", "Submit the MIT application", "تقديم طلب MIT"),
  ],
  UC_APP: [
    it("ESSAY", "Personal insight questions", "أسئلة الرؤية الشخصية"),
    it("TRANSCRIPT", "Self-reported academic record", "السجل الأكاديمي المدخل ذاتيا"),
    it("PASSPORT", "Passport copy", "نسخة من جواز السفر"),
    it("FORM", "Submit the University of California application", "تقديم طلب جامعة كاليفورنيا"),
  ],
  OUAC: [
    it("PREDICTED_GRADES", "Grade 12 predicted marks", "الدرجات المتوقعة للصف الثاني عشر"),
    it("TRANSCRIPT", "Official transcripts sent to OUAC", "إرسال كشوف الدرجات الرسمية إلى OUAC"),
    it("ESSAY", "Supplementary application or profile", "الطلب الإضافي أو الملف الشخصي"),
    it("PASSPORT", "Passport copy", "نسخة من جواز السفر"),
    it("FORM", "Submit the OUAC 105 application", "تقديم طلب OUAC 105"),
  ],
  UAE: [
    it("TRANSCRIPT", "Attested transcripts for Grades 10 to 12", "كشوف درجات مصدقة للصفوف 10 إلى 12"),
    it("PASSPORT", "Passport, Emirates ID and residence visa copies", "نسخ جواز السفر والهوية الإماراتية والإقامة"),
    it("FORM", "Submit the online application", "تقديم الطلب الإلكتروني"),
  ],
  JORDAN_UNIFIED: [
    it("TRANSCRIPT", "Certificate equivalency from the Ministry of Education", "معادلة الشهادة من وزارة التربية والتعليم"),
    it("PASSPORT", "Passport and national ID copies", "نسخ جواز السفر والرقم الوطني"),
    it("FORM", "Submit the unified admission application", "تقديم طلب القبول الموحد"),
  ],
  STUDIELINK: [
    it("TRANSCRIPT", "Diploma and transcripts uploaded", "رفع الشهادة وكشوف الدرجات"),
    it("PERSONAL_STATEMENT", "Motivation letter", "خطاب الدافعية"),
    it("PASSPORT", "Passport copy", "نسخة من جواز السفر"),
    it("FORM", "Submit the Studielink enrolment", "تقديم التسجيل عبر Studielink"),
  ],
  CAO: [
    it("TRANSCRIPT", "School results and transcripts", "نتائج المدرسة وكشوف الدرجات"),
    it("PASSPORT", "Passport copy", "نسخة من جواز السفر"),
    it("FORM", "Submit the CAO application", "تقديم طلب CAO"),
  ],
  UNI_ASSIST: [
    it("TRANSCRIPT", "Certified copies of certificates", "نسخ مصدقة من الشهادات"),
    it("PERSONAL_STATEMENT", "Motivation letter", "خطاب الدافعية"),
    it("PASSPORT", "Passport copy", "نسخة من جواز السفر"),
    it("FORM", "Submit through uni-assist", "التقديم عبر uni-assist"),
  ],
  DIRECT: [
    it("TRANSCRIPT", "Official transcripts", "كشوف الدرجات الرسمية"),
    it("PERSONAL_STATEMENT", "Personal statement or motivation letter", "المقال الشخصي أو خطاب الدافعية"),
    it("PASSPORT", "Passport copy", "نسخة من جواز السفر"),
    it("FORM", "Submit the application", "تقديم الطلب"),
  ],
};

const TEST_AR: Record<string, string> = { SAT: "SAT", ACT: "ACT", TMUA: "TMUA", UCAT: "UCAT", LNAT: "LNAT", BMAT: "BMAT", MAT: "MAT", ESAT: "ESAT", EMSAT_MATH: "إمسات الرياضيات", EMSAT_ENGLISH: "إمسات اللغة الإنجليزية", EMSAT_PHYSICS: "إمسات الفيزياء", EMSAT_CHEMISTRY: "إمسات الكيمياء" };
const testName = (t: string) => t.replace(/_/g, " ");

function additionalItem(a: RequirementRows["additional"][number]): ChecklistItem | null {
  if (!a.required) return null;
  const k = a.kind.toUpperCase();
  const en = a.noteEn?.trim();
  const ar = a.noteAr?.trim() || en;
  if (k.includes("PORTFOLIO")) return it("PORTFOLIO", en || "Portfolio", ar || "ملف الأعمال");
  if (k.includes("INTERVIEW")) return it("INTERVIEW", en || "Admissions interview", ar || "مقابلة القبول");
  if (k.includes("ESSAY") || k.includes("STATEMENT")) return it("ESSAY", en || "Written statement", ar || "بيان مكتوب");
  if (k.includes("REFERENCE") || k.includes("RECOMMEND")) return it("RECOMMENDATION", en || "Recommendation letter", ar || "خطاب توصية");
  if (k.includes("FINANC")) return it("FINANCIAL", en || "Financial documents", ar || "المستندات المالية");
  if (k.includes("TEST") || k.includes("ADMISSIONS")) return it("TEST", en || "Admissions test", ar || "اختبار القبول");
  if (!en) return null;
  return it("OTHER", en, ar || en);
}

/** Build the checklist. Items are unique by kind and English title, so regeneration never duplicates. */
export function buildChecklist(input: ChecklistInput): ChecklistItem[] {
  const out: ChecklistItem[] = [];
  const add = (x: ChecklistItem | null) => {
    if (x && !out.some((o) => o.kind === x.kind && o.titleEn === x.titleEn)) out.push(x);
  };
  const form = ROUTE_ITEMS[input.route].filter((x) => x.kind === "FORM");
  for (const x of ROUTE_ITEMS[input.route]) if (x.kind !== "FORM") add(x);

  if (input.current && (input.current.tests.length || input.current.languages.length || input.current.additional.length)) {
    const req = input.current.tests.filter((t) => ["REQUIRED", "RECOMMENDED"].includes(t.policy.toUpperCase()));
    // SAT and ACT are alternatives: one checklist line.
    const satAct = req.filter((t) => ["SAT", "ACT"].includes(t.test.toUpperCase()));
    if (satAct.length) add(it("TEST", "SAT or ACT scores", "درجات SAT أو ACT"));
    for (const t of req.filter((x) => !satAct.includes(x))) add(it("TEST", `${testName(t.test)} admissions test`, `اختبار القبول ${TEST_AR[t.test.toUpperCase()] ?? testName(t.test)}`));
    const langs = input.current.languages;
    if (langs.length) {
      const ielts = langs.find((l) => l.test.toUpperCase() === "IELTS");
      const first = ielts ?? langs[0];
      add(it("LANGUAGE_TEST", `${first.test.toUpperCase()} ${first.minOverall} or equivalent`, `${first.test.toUpperCase()} بدرجة ${first.minOverall} أو ما يعادلها`));
    }
    for (const a of input.current.additional) add(additionalItem(a));
  } else if (input.legacy) {
    if (input.legacy.testPolicy === "REQUIRED") add(it("TEST", "SAT or ACT scores", "درجات SAT أو ACT"));
    for (const t of input.legacy.admissionsTests ?? []) add(it("TEST", `${testName(t)} admissions test`, `اختبار القبول ${TEST_AR[t.toUpperCase()] ?? testName(t)}`));
    if (input.legacy.ielts) add(it("LANGUAGE_TEST", `IELTS ${input.legacy.ielts} or equivalent`, `IELTS بدرجة ${input.legacy.ielts} أو ما يعادلها`));
    else if (input.legacy.toefl) add(it("LANGUAGE_TEST", `TOEFL ${input.legacy.toefl} or equivalent`, `TOEFL بدرجة ${input.legacy.toefl} أو ما يعادلها`));
  }
  if (input.oxbridgeOrMedicine) add(it("INTERVIEW", "Admissions interview", "مقابلة القبول"));
  for (const f of form) add(f);
  return out;
}
