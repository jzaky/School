// Demo data for the grades module. Runs after the core demo seed and is safe to re-run:
// bands and the notification template are upserted, and assessments are only created when the org has none.
import { randomUUID } from "node:crypto";
import type { AssessmentKind, Prisma, PrismaClient } from "@prisma/client";
import type { SeedWorld } from "../demo";

const DAY = 86400000;

const BANDS = [
  { label: "A*", minPercent: 90 },
  { label: "A", minPercent: 80 },
  { label: "B", minPercent: 70 },
  { label: "C", minPercent: 60 },
  { label: "D", minPercent: 50 },
  { label: "E", minPercent: 40 },
  { label: "U", minPercent: 0 },
];

type Bi = { en: string; ar: string };
const bi = (en: string, ar: string): Bi => ({ en, ar });

// Four topics per subject, used in order across the term's assessments.
const TOPICS: Record<string, Bi[]> = {
  MATH: [bi("Linear equations", "المعادلات الخطية"), bi("Simultaneous equations", "المعادلات الآنية"), bi("Quadratics", "المعادلات التربيعية"), bi("Probability", "الاحتمالات")],
  PHYS: [bi("Forces and motion", "القوى والحركة"), bi("Energy transfers", "تحولات الطاقة"), bi("Waves", "الموجات"), bi("Electric circuits", "الدوائر الكهربائية")],
  CHEM: [bi("Atomic structure", "التركيب الذري"), bi("Bonding", "الروابط الكيميائية"), bi("Rates of reaction", "سرعة التفاعل"), bi("Acids and bases", "الأحماض والقواعد")],
  BIO: [bi("Cells", "الخلايا"), bi("Photosynthesis", "البناء الضوئي"), bi("Human digestion", "الجهاز الهضمي"), bi("Ecosystems", "الأنظمة البيئية")],
  CS: [bi("Algorithms", "الخوارزميات"), bi("Python loops", "الحلقات في بايثون"), bi("Data representation", "تمثيل البيانات"), bi("Networks", "الشبكات")],
  ENG: [bi("Persuasive writing", "الكتابة الإقناعية"), bi("Of Mice and Men", "رواية عن الفئران والرجال"), bi("Poetry analysis", "تحليل الشعر"), bi("Speaking and listening", "التحدث والاستماع")],
  ARAB: [bi("Reading comprehension", "الفهم القرائي"), bi("Grammar: nominal sentences", "النحو: الجملة الاسمية"), bi("Extended writing", "الكتابة الموسعة"), bi("Poetry recitation", "إلقاء الشعر")],
  ISL: [bi("Surat Al Hujurat", "سورة الحجرات"), bi("Values in Islam", "القيم في الإسلام"), bi("Biography of the Prophet", "السيرة النبوية"), bi("Fiqh of worship", "فقه العبادات")],
  SOC: [bi("UAE founding", "قيام دولة الإمارات"), bi("Geography of the UAE", "جغرافية الإمارات"), bi("Citizenship", "المواطنة"), bi("Heritage", "التراث")],
  PE: [bi("Fitness testing", "اختبارات اللياقة"), bi("Basketball skills", "مهارات كرة السلة"), bi("Athletics", "ألعاب القوى"), bi("Health and nutrition", "الصحة والتغذية")],
  ART: [bi("Observational drawing", "الرسم بالملاحظة"), bi("Colour theory", "نظرية الألوان"), bi("Islamic patterns", "الزخارف الإسلامية"), bi("Portfolio review", "مراجعة ملف الأعمال")],
  ECON: [bi("Supply and demand", "العرض والطلب"), bi("Market structures", "هياكل السوق"), bi("Inflation", "التضخم"), bi("Trade", "التجارة")],
  BUS: [bi("Business ownership", "ملكية الأعمال"), bi("Marketing mix", "المزيج التسويقي"), bi("Finance basics", "أساسيات التمويل"), bi("Human resources", "الموارد البشرية")],
  PSY: [bi("Memory", "الذاكرة"), bi("Research methods", "مناهج البحث"), bi("Social influence", "التأثير الاجتماعي"), bi("Development", "النمو")],
  GEO: [bi("Rivers", "الأنهار"), bi("Urbanisation", "التحضر"), bi("Climate", "المناخ"), bi("Deserts", "الصحارى")],
  FR: [bi("Daily routine", "الروتين اليومي"), bi("Past tense", "الزمن الماضي"), bi("Holidays", "العطلات"), bi("Describing people", "وصف الأشخاص")],
};
const FALLBACK_TOPICS = [bi("Unit 1", "الوحدة 1"), bi("Unit 2", "الوحدة 2"), bi("Unit 3", "الوحدة 3"), bi("Unit 4", "الوحدة 4")];

type Plan = { kind: AssessmentKind; at: number; max: number; weight: number; topic: number; label: Bi; difficulty: number };
const PLAN: Plan[] = [
  { kind: "HOMEWORK", at: 0.08, max: 20, weight: 1, topic: 0, label: bi("Homework", "واجب منزلي"), difficulty: 3 },
  { kind: "QUIZ", at: 0.24, max: 10, weight: 1, topic: 0, label: bi("Quiz", "اختبار قصير"), difficulty: 1 },
  { kind: "HOMEWORK", at: 0.4, max: 20, weight: 1, topic: 1, label: bi("Homework", "واجب منزلي"), difficulty: 3 },
  { kind: "TEST", at: 0.56, max: 50, weight: 2, topic: 1, label: bi("Unit test", "اختبار الوحدة"), difficulty: -2 },
  { kind: "QUIZ", at: 0.7, max: 10, weight: 1, topic: 2, label: bi("Quiz", "اختبار قصير"), difficulty: 0 },
  { kind: "EXAM", at: 0.86, max: 100, weight: 3, topic: 2, label: bi("Mid-term exam", "امتحان منتصف الفصل"), difficulty: -4 },
  { kind: "HOMEWORK", at: 1, max: 20, weight: 1, topic: 3, label: bi("Homework", "واجب منزلي"), difficulty: 2 },
];

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

/** Subject strength for the demo student: strong in Maths, Physics and Computing, weaker in Arabic writing. */
const ADAM: Record<string, number> = { MATH: 94, PHYS: 90, CS: 93, CHEM: 84, ECON: 82, ENG: 80, ISL: 79, PE: 83, ART: 76, ARAB: 72 };

export async function seedGrades(w: SeedWorld) {
  await seedGradesFor(w.db, w.orgId, w.now, w.log);
}

export async function seedGradesFor(db: PrismaClient, orgId: string, now: Date, log: (m: string) => void = () => undefined) {
  if ((await db.gradeBand.count({ where: { orgId } })) === 0) {
    await db.gradeBand.createMany({ data: BANDS.map((b, i) => ({ orgId, label: b.label, minPercent: b.minPercent, sortOrder: i })) });
  }
  await db.messageTemplate.upsert({
    where: { orgId_key_channel: { orgId, key: "grade_published", channel: "EMAIL" } },
    create: {
      orgId,
      key: "grade_published",
      channel: "EMAIL",
      subjectEn: "New grade published: {{assessment}}",
      subjectAr: "تم نشر درجة جديدة: {{assessment}}",
      bodyEn: "{{student}} has a new published grade in {{subject}}: {{assessment}}. Open Horizon to see the result.",
      bodyAr: "نُشرت درجة جديدة لـ {{student}} في مادة {{subject}}: {{assessment}}. افتح منصة هورايزن للاطلاع على النتيجة.",
    },
    update: {},
  });
  if ((await db.assessment.count({ where: { orgId } })) > 0) {
    log("grades: assessments already present, skipped");
    return;
  }

  const year = await db.academicYear.findFirst({ where: { orgId, isCurrent: true }, include: { terms: true } });
  if (!year) return;
  const classes = await db.schoolClass.findMany({ where: { orgId, academicYearId: year.id, isHomeroom: false }, include: { subject: true } });
  const enrollments = await db.enrollment.findMany({ where: { orgId, classId: { in: classes.map((c) => c.id) }, status: "ACTIVE" }, select: { classId: true, studentId: true } });
  const personas = await db.demoPersona.findMany({ where: { orgId } });
  const personaMember = (k: string) => personas.find((p) => p.key === k)?.membershipId ?? null;
  const adamMember = personaMember("student");
  const adam = adamMember ? await db.student.findFirst({ where: { orgId, membershipId: adamMember } }) : null;
  const danielMember = personaMember("teacher");
  const fallbackCreator = personaMember("admin") ?? (await db.membership.findFirst({ where: { orgId }, select: { id: true } }))?.id ?? "system";

  const end = now.getTime() - DAY;
  let start = Math.max(now.getTime() - 56 * DAY, year.startsOn.getTime() + 3 * DAY);
  if (end - start < 14 * DAY) start = end - 14 * DAY;
  const termFor = (d: Date) => year.terms.find((t) => t.startsOn <= d && d.getTime() <= t.endsOn.getTime() + DAY)?.id ?? null;

  // Drafts: the newest homework in the demo teacher's class (graded, not yet published), an empty quiz there,
  // and the newest homework in Grade 9 Maths.
  const demoClass = classes.find((c) => c.teacherMembershipId === danielMember && c.subject?.code === "PHYS") ?? null;
  const maths9 = classes.find((c) => c.gradeLevel === 9 && c.subject?.code === "MATH") ?? null;

  const assessmentRows: Prisma.AssessmentCreateManyInput[] = [];
  const gradeRows: Prisma.GradeCreateManyInput[] = [];
  for (const c of classes) {
    const code = c.subject?.code ?? "";
    const topics = TOPICS[code] ?? FALLBACK_TOPICS;
    const students = enrollments.filter((e) => e.classId === c.id).map((e) => e.studentId);
    const creator = c.teacherMembershipId ?? fallbackCreator;
    // Stagger classes by a day or two so the school's calendar of assessments looks natural.
    const shift = Math.floor(hash(c.id) * 3) * DAY;
    const plan = [...PLAN];
    if (c.id === demoClass?.id) plan.push({ kind: "QUIZ", at: 1, max: 10, weight: 1, topic: 3, label: bi("Quiz", "اختبار قصير"), difficulty: 0 });
    plan.forEach((p, idx) => {
      const due = new Date(Math.min(end, start + (end - start) * p.at - shift));
      const isLastHomework = idx === PLAN.length - 1;
      const isEmptyQuiz = idx === PLAN.length;
      const draft = isEmptyQuiz || (isLastHomework && (c.id === demoClass?.id || c.id === maths9?.id));
      const topic = topics[p.topic % topics.length];
      const writing = code === "ARAB" && p.topic === 2;
      const title = writing && p.kind === "EXAM" ? bi("Mid-term exam: reading and writing", "امتحان منتصف الفصل: القراءة والكتابة") : p.kind === "EXAM" ? p.label : bi(`${p.label.en}: ${topic.en}`, `${p.label.ar}: ${topic.ar}`);
      const id = randomUUID();
      const publishedAt = draft ? null : new Date(Math.min(due.getTime() + (2 + Math.floor(hash(id) * 3)) * DAY, now.getTime() - 2 * 3600000));
      assessmentRows.push({ id, orgId, classId: c.id, termId: termFor(due), titleEn: title.en, titleAr: title.ar, kind: p.kind, maxScore: p.max, weight: p.weight, dueAt: due, publishedAt, createdById: creator, createdAt: new Date(due.getTime() - 5 * DAY) });
      if (isEmptyQuiz) return;
      for (const sid of students) {
        const r = hash(`${sid}:${id}`);
        if (r < 0.025) continue; // not handed in yet
        const excused = r > 0.98;
        const isAdam = sid === adam?.id;
        let target = isAdam ? (ADAM[code] ?? 80) : 56 + hash(sid) * 34 + (hash(`${sid}:${code}`) - 0.5) * 16;
        if (isAdam && writing) target = p.kind === "EXAM" ? 61 : 55;
        const pct = Math.max(8, Math.min(100, target + p.difficulty + (p.at - 0.5) * 8 + (hash(`${id}:${sid}:n`) - 0.5) * 14));
        const step = p.max <= 20 ? 0.5 : 1;
        const score = excused ? null : Math.round((pct / 100) * p.max / step) * step;
        let comment: Bi | null = null;
        if (isAdam && writing) comment = bi("Good ideas and vocabulary. Focus on sentence structure and spelling in extended writing.", "أفكار ومفردات جيدة. ركّز على بناء الجمل والإملاء في الكتابة الموسعة.");
        else if (isAdam && code === "MATH" && p.kind === "EXAM") comment = bi("Outstanding problem solving and clear working.", "حل متميز للمسائل وخطوات واضحة.");
        else if (isAdam && code === "PHYS" && p.kind === "TEST") comment = bi("Excellent grasp of forces. Keep showing units in every answer.", "فهم ممتاز للقوى. استمر في كتابة الوحدات في كل إجابة.");
        else if (!excused && pct < 50 && hash(`${sid}:${id}:c`) < 0.35) comment = bi("Please come to the support session to review this topic.", "يُرجى حضور حصة الدعم لمراجعة هذا الموضوع.");
        else if (!excused && pct >= 92 && hash(`${sid}:${id}:c`) < 0.2) comment = bi("Excellent work.", "عمل ممتاز.");
        gradeRows.push({ orgId, assessmentId: id, studentId: sid, score, excused, commentEn: comment?.en ?? null, commentAr: comment?.ar ?? null, updatedById: creator });
      }
    });
  }
  for (let i = 0; i < assessmentRows.length; i += 500) await db.assessment.createMany({ data: assessmentRows.slice(i, i + 500) });
  for (let i = 0; i < gradeRows.length; i += 2000) await db.grade.createMany({ data: gradeRows.slice(i, i + 2000) });
  log(`grades: ${assessmentRows.length} assessments, ${gradeRows.length} grades`);
}
