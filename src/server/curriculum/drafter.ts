// Deterministic lesson and unit drafter. Used when no AI model is configured (and by the demo seed).
// It turns standard statements into a sensible structured lesson sequence a teacher then edits.
import type { Activity, Bilingual, Material } from "./types";

export type DraftInputStandard = { id: string; code: string; strandEn: string; strandAr: string; descEn: string; descAr: string };

export type ProposedLesson = {
  titleEn: string;
  titleAr: string;
  objectivesEn: string;
  objectivesAr: string;
  mainPointsEn: string[];
  mainPointsAr: string[];
  activities: Activity[];
  materials: Material[];
  assessmentEn: string;
  assessmentAr: string;
  differentiation: Bilingual;
  standardIds: string[];
  durationMin: number;
};

export type DraftContext = { subjectCode: string; subjectEn: string; subjectAr: string; gradeLevel: number; durationMin?: number };

const lcFirst = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s);
const stripDot = (s: string) => s.trim().replace(/[.۔]+$/, "");

/** A short title phrase from a standard statement: the first clause, cut at a word boundary. */
export function shortPhrase(desc: string, max = 56) {
  const first = stripDot(desc.split(/[;:,،؛]/)[0] ?? desc);
  if (first.length <= max) return first;
  const cut = first.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(" "), 20)).trim();
}

const SCIENCE = new Set(["PHYS", "CHEM", "BIO", "SCI", "SCIENCE"]);

function subjectMaterials(code: string): Material[] {
  const c = code.toUpperCase();
  if (c === "CS" || c === "ICT" || c === "COMP") {
    return [
      { en: "Laptops with the school coding environment", ar: "حواسيب محمولة مثبت عليها بيئة البرمجة المعتمدة في المدرسة" },
      { en: "Lesson slides and worked example code", ar: "شرائح الدرس وأمثلة برمجية محلولة" },
      { en: "Unplugged activity cards for the starter", ar: "بطاقات نشاط دون حاسوب للتمهيد" },
    ];
  }
  if (c === "MATH" || c === "MATHS") {
    return [
      { en: "Mini whiteboards and pens", ar: "سبورات صغيرة وأقلام" },
      { en: "Scientific calculators", ar: "آلات حاسبة علمية" },
      { en: "Graph paper and worked example sheet", ar: "ورق رسم بياني وورقة أمثلة محلولة" },
    ];
  }
  if (SCIENCE.has(c)) {
    return [
      { en: "Practical equipment as listed on the risk assessment", ar: "أدوات التجربة العملية وفق تقييم المخاطر" },
      { en: "Safety goggles for every student", ar: "نظارات واقية لكل طالب" },
      { en: "Results table worksheet", ar: "ورقة عمل لجدول النتائج" },
    ];
  }
  return [
    { en: "Lesson slides", ar: "شرائح الدرس" },
    { en: "Task worksheet", ar: "ورقة عمل المهمة" },
  ];
}

function timings(duration: number) {
  const d = Math.max(20, Math.round(duration));
  const starter = Math.max(5, Math.round((d * 0.15) / 5) * 5);
  const plenary = Math.max(5, Math.round((d * 0.15) / 5) * 5);
  const main = d - starter - plenary;
  const explain = Math.max(5, Math.round(main * 0.35));
  const guided = Math.max(5, Math.round(main * 0.3));
  const independent = main - explain - guided;
  return { starter, explain, guided, independent, plenary };
}

/** One lesson that teaches the given standards. */
export function draftLesson(standards: DraftInputStandard[], ctx: DraftContext, opts: { titleEn?: string; titleAr?: string; review?: boolean } = {}): ProposedLesson {
  const duration = ctx.durationMin ?? 50;
  const t = timings(duration);
  const first = standards[0];
  const codes = standards.map((s) => s.code).join(", ");
  const titleEn = opts.titleEn ?? (opts.review ? `Review and assess: ${first.strandEn}` : `${first.strandEn}: ${shortPhrase(first.descEn)}`);
  const titleAr = opts.titleAr ?? (opts.review ? `مراجعة وتقييم: ${first.strandAr}` : `${first.strandAr}: ${shortPhrase(first.descAr || first.descEn)}`);
  const objectivesEn = standards.map((s) => `Students can ${lcFirst(stripDot(s.descEn))} (${s.code}).`).join("\n");
  const objectivesAr = standards.map((s) => `أن يتمكن الطالب من: ${stripDot(s.descAr || s.descEn)} (${s.code}).`).join("\n");
  const mainPointsEn = standards.flatMap((s) => [`What ${s.code} asks for: ${lcFirst(stripDot(s.descEn))}`, `Key vocabulary and a worked example for ${s.code}`]);
  const mainPointsAr = standards.flatMap((s) => [`مضمون ${s.code}: ${stripDot(s.descAr || s.descEn)}`, `المفردات الأساسية ومثال محلول على ${s.code}`]);
  const focusEn = shortPhrase(first.descEn, 70).toLowerCase();
  const focusAr = shortPhrase(first.descAr || first.descEn, 70);

  const activities: Activity[] = opts.review
    ? [
        { phase: "starter", minutes: t.starter, titleEn: "Retrieval quiz", titleAr: "اختبار استرجاع سريع", detailEn: `Five quick questions across ${codes}; students self-mark and note gaps.`, detailAr: `خمسة أسئلة سريعة تغطي ${codes}، ويصحح الطلاب إجاباتهم ويحددون الثغرات.` },
        { phase: "main", minutes: t.explain, titleEn: "Address misconceptions", titleAr: "معالجة المفاهيم الخاطئة", detailEn: "Reteach the two most common errors from the quiz with a fresh worked example.", detailAr: "إعادة شرح أكثر خطأين شيوعًا في الاختبار بمثال محلول جديد." },
        { phase: "main", minutes: t.guided + t.independent, titleEn: "Assessment task", titleAr: "مهمة تقييمية", detailEn: `Short written or practical task that checks every objective (${codes}).`, detailAr: `مهمة كتابية أو عملية قصيرة تتحقق من جميع الأهداف (${codes}).` },
        { phase: "plenary", minutes: t.plenary, titleEn: "Reflect and set targets", titleAr: "تأمل وتحديد أهداف", detailEn: "Students record one strength and one target for the unit.", detailAr: "يدوّن كل طالب نقطة قوة وهدفًا واحدًا للوحدة." },
      ]
    : [
        { phase: "starter", minutes: t.starter, titleEn: "Hook and prior knowledge", titleAr: "تمهيد واستدعاء المعرفة السابقة", detailEn: `A short question or puzzle linked to ${focusEn}; share answers on mini whiteboards.`, detailAr: `سؤال أو لغز قصير مرتبط بـ ${focusAr}، ويعرض الطلاب إجاباتهم على السبورات الصغيرة.` },
        { phase: "main", minutes: t.explain, titleEn: "Explain and model", titleAr: "الشرح والنمذجة", detailEn: `Teacher explains the key idea and models a worked example. Key points: ${mainPointsEn.join("; ")}.`, detailAr: `يشرح المعلم الفكرة الأساسية ويعرض مثالًا محلولًا. النقاط الرئيسية: ${mainPointsAr.join("، ")}.` },
        { phase: "main", minutes: t.guided, titleEn: "Guided practice in pairs", titleAr: "تطبيق موجّه في أزواج", detailEn: "Pairs complete scaffolded questions while the teacher checks understanding and addresses misconceptions.", detailAr: "يحل الطلاب في أزواج أسئلة متدرجة بينما يتحقق المعلم من الفهم ويعالج المفاهيم الخاطئة." },
        { phase: "main", minutes: t.independent, titleEn: "Independent task", titleAr: "مهمة فردية", detailEn: `Students apply the idea on their own (${codes}), with an extension challenge for early finishers.`, detailAr: `يطبق الطلاب الفكرة بشكل فردي (${codes})، مع تحدٍّ إضافي لمن ينهي مبكرًا.` },
        { phase: "plenary", minutes: t.plenary, titleEn: "Exit ticket", titleAr: "بطاقة الخروج", detailEn: "Two questions that show whether each objective was met.", detailAr: "سؤالان يوضحان مدى تحقق كل هدف." },
      ];

  return {
    titleEn,
    titleAr,
    objectivesEn,
    objectivesAr,
    mainPointsEn,
    mainPointsAr,
    activities,
    materials: [...subjectMaterials(ctx.subjectCode), { en: "Exit ticket slips", ar: "بطاقات الخروج" }],
    assessmentEn: opts.review ? `End of unit task marked against ${codes}; results recorded in the markbook.` : `Questioning during guided practice and an exit ticket checked against ${codes}.`,
    assessmentAr: opts.review ? `مهمة نهاية الوحدة تُصحح وفق ${codes} وتُسجل النتائج في سجل الدرجات.` : `طرح الأسئلة أثناء التطبيق الموجّه وبطاقة خروج تُراجع وفق ${codes}.`,
    differentiation: {
      en: "Support: worked examples, vocabulary list and sentence starters for EAL learners. Stretch: an open-ended extension that applies the idea to a new context.",
      ar: "الدعم: أمثلة محلولة وقائمة مفردات وبدايات جمل لمتعلمي اللغة الإنجليزية كلغة إضافية. التحدي: مهمة مفتوحة لتطبيق الفكرة في سياق جديد.",
    },
    standardIds: standards.map((s) => s.id),
    durationMin: duration,
  };
}

/**
 * A unit that covers the given standards: grouped by strand, one or two standards per lesson, and a final
 * review lesson that revisits all of them when the unit has three or more lessons.
 */
export function draftUnitFallback(standards: DraftInputStandard[], ctx: DraftContext, opts: { maxLessons?: number } = {}): ProposedLesson[] {
  if (!standards.length) return [];
  const byStrand = new Map<string, DraftInputStandard[]>();
  for (const s of standards) byStrand.set(s.strandEn, [...(byStrand.get(s.strandEn) ?? []), s]);
  const perLesson = standards.length <= 4 ? 1 : 2;
  const groups: DraftInputStandard[][] = [];
  for (const list of byStrand.values()) for (let i = 0; i < list.length; i += perLesson) groups.push(list.slice(i, i + perLesson));
  const max = Math.max(1, opts.maxLessons ?? 12);
  // Merge groups when there are more than the lesson cap allows, keeping every standard.
  while (groups.length > max) {
    const last = groups.pop()!;
    groups[groups.length - 1] = [...groups[groups.length - 1], ...last];
  }
  const lessons = groups.map((g) => draftLesson(g, ctx));
  if (lessons.length >= 3) lessons.push(draftLesson(standards, ctx, { review: true, titleEn: `Review and assess: ${ctx.subjectEn} unit`, titleAr: `مراجعة وتقييم: وحدة ${ctx.subjectAr}` }));
  return lessons;
}

const str = (v: unknown): v is string => typeof v === "string";
const strArr = (v: unknown): v is string[] => Array.isArray(v) && v.every(str);

export function isProposedLesson(v: unknown): v is ProposedLesson {
  const l = v as ProposedLesson;
  return (
    Boolean(l) &&
    str(l.titleEn) &&
    str(l.titleAr) &&
    str(l.objectivesEn) &&
    str(l.objectivesAr) &&
    strArr(l.mainPointsEn) &&
    strArr(l.mainPointsAr) &&
    Array.isArray(l.activities) &&
    Array.isArray(l.materials) &&
    str(l.assessmentEn) &&
    str(l.assessmentAr) &&
    Boolean(l.differentiation) &&
    str(l.differentiation.en) &&
    str(l.differentiation.ar) &&
    strArr(l.standardIds) &&
    typeof l.durationMin === "number"
  );
}
