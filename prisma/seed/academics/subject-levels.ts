// Demo data for course selection with AP and regular versions (American track) and university targets.
// - Next academic year with three terms, and course selection for it open now (Grade 9 students choose
//   Grade 10 courses, and so on).
// - American track course subjects (AP Calculus BC, AP Physics 1, Physics...) linked to the curriculum
//   courses they count as, and next year's American offerings for Grades 10 to 12 with AP and regular
//   versions side by side in the option blocks. The British track keeps its current offerings.
// - A few more students on the American track, most of whom have already chosen next year's courses.
// - Adam Nasser has not chosen yet, and his university list gains programmes whose official pages ask
//   for different levels (AP Calculus at Manchester, AP Calculus BC at Birmingham, AP or Calculus 12 at
//   Toronto, regular courses at UT Austin).
// Safe to re-run: everything is looked up first and only missing rows are added.
import type { Prisma, PrismaClient, RegistrationSource } from "@prisma/client";
import { tenantDb } from "@/lib/tenant-db";
import { addProgramToShortlist } from "@/server/pathways/shortlist";
import { blocksOf, missingPrerequisites } from "@/lib/registration";
import { currentYear, getWindow, offeringsFor, priorSubjectCodes, saveRegistration, selectionYear, setWindow } from "@/server/registration/service";
import type { SeedWorld } from "../demo";
import { at } from "../lib";

const DAY = 86400_000;
type Bi = { en: string; ar: string };

/** American course subjects: curriculum course code and the generic subject whose department it joins.
 * Courses whose name matches a subject the school already has (Physics, French, Economics) use that
 * subject instead, so no two subjects share a name in pickers. */
const US_SUBJECTS: Record<string, string> = {
  US_ENG10: "ENG",
  US_ENG11: "ENG",
  US_ENG12: "ENG",
  AP_ENG_LANG: "ENG",
  US_GEOM_H: "MATH",
  US_PRECALC_H: "MATH",
  US_PRECALC: "MATH",
  AP_CALC_AB: "MATH",
  AP_CALC_BC: "MATH",
  AP_STATS: "MATH",
  AP_PHYS_1: "PHYS",
  AP_PHYS_C_MECH: "PHYS",
  US_CHEM_H: "CHEM",
  AP_CHEM: "CHEM",
  AP_BIO: "BIO",
  US_INTRO_CS: "CS",
  AP_CSA: "CS",
  US_WORLD_HIST: "HIST",
  AP_WORLD_HIST: "HIST",
  AP_MACRO: "ECON",
  AP_PSYCH: "PSY",
  US_BUSINESS: "BUS",
  US_ART: "ART",
  US_ROBOTICS: "DT",
};
/** Courses the school catalog did not list yet, with the grades Horizon offers them in. */
const EXTRA_SCHOOL_COURSES: Array<[string, number[], string]> = [
  ["US_PHYS", [10, 11, 12], "PHYS"],
  ["AP_WORLD_HIST", [10, 11], "HIST"],
];

type Spec = { subject: string; course: string; kind: "CORE" | "OPTION"; block?: string; periods: number; prereq?: string[]; notes?: Bi };
const core = (subject: string, course: string, periods: number): Spec => ({ subject, course, kind: "CORE", periods });
/** The school subject for a course: its own subject, or the existing one with the same name. */
const SAME_NAME: Record<string, string> = { US_PHYS: "PHYS", US_FRENCH: "FR", US_ECON: "ECON" };
const opt = (block: string, course: string, periods: number, extra: Partial<Spec> = {}): Spec => ({ subject: SAME_NAME[course] ?? course, course, kind: "OPTION", block, periods, ...extra });

const AP_EXAM: Bi = { en: "Ends with the AP exam in May.", ar: "تنتهي باختبار AP في شهر مايو." };
const NEXT_YEAR: Record<number, Spec[]> = {
  10: [
    core("US_ENG10", "US_ENG10", 5),
    core("US_GEOM_H", "US_GEOM_H", 5),
    core("ARAB", "US_ARABIC", 4),
    core("ISL", "US_ISLAMIC", 2),
    core("PE", "US_PE", 2),
    opt("A", "AP_PHYS_1", 5, { prereq: ["MATH"], notes: { en: "Algebra based, with a weekly lab. Ends with the AP exam in May.", ar: "تعتمد على الجبر مع مختبر أسبوعي. تنتهي باختبار AP في شهر مايو." } }),
    opt("A", "US_PHYS", 4, { notes: { en: "Lab based physics with a design project each term.", ar: "فيزياء عملية مع مشروع تصميم في كل فصل دراسي." } }),
    opt("A", "US_CHEM_H", 4),
    opt("B", "AP_CSA", 5, { prereq: ["MATH"], notes: { en: "Java programming. Ends with the AP exam in May.", ar: "برمجة بلغة جافا. تنتهي باختبار AP في شهر مايو." } }),
    opt("B", "US_INTRO_CS", 4, { notes: { en: "Python and web projects, no exam.", ar: "مشاريع بلغة بايثون ومواقع الويب، دون اختبار نهائي." } }),
    opt("C", "AP_WORLD_HIST", 4, { notes: AP_EXAM }),
    opt("C", "US_WORLD_HIST", 4),
    opt("C", "US_BUSINESS", 4),
    opt("D", "US_FRENCH", 3),
    opt("D", "US_ART", 3, { notes: { en: "Portfolio based, with studio time on Tuesdays.", ar: "يعتمد على ملف الأعمال، مع وقت في المرسم يوم الثلاثاء." } }),
    opt("D", "US_ROBOTICS", 3),
  ],
  11: [
    core("US_PRECALC_H", "US_PRECALC_H", 5),
    core("ARAB", "US_ARABIC", 4),
    core("ISL", "US_ISLAMIC", 2),
    core("PE", "US_PE", 2),
    opt("A", "AP_CHEM", 5, { prereq: ["CHEM"], notes: AP_EXAM }),
    opt("A", "US_CHEM_H", 4),
    opt("A", "AP_BIO", 5, { prereq: ["BIO"], notes: AP_EXAM }),
    opt("B", "AP_PHYS_1", 5, { prereq: ["MATH"], notes: AP_EXAM }),
    opt("B", "US_PHYS", 4),
    opt("B", "AP_CSA", 5, { prereq: ["MATH"], notes: AP_EXAM }),
    opt("C", "AP_ENG_LANG", 5, { notes: { en: "College level reading and writing. Ends with the AP exam in May.", ar: "قراءة وكتابة بمستوى جامعي. تنتهي باختبار AP في شهر مايو." } }),
    opt("C", "US_ENG11", 5),
    opt("D", "AP_MACRO", 4, { prereq: ["MATH"], notes: AP_EXAM }),
    opt("D", "AP_PSYCH", 4, { notes: AP_EXAM }),
    opt("D", "US_BUSINESS", 4),
  ],
  12: [
    core("US_ENG12", "US_ENG12", 5),
    core("ARAB", "US_ARABIC", 4),
    core("ISL", "US_ISLAMIC", 2),
    core("PE", "US_PE", 2),
    opt("A", "AP_CALC_BC", 6, { prereq: ["MATH"], notes: { en: "The full calculus sequence, for students who finished Precalculus Honors. Ends with the AP exam in May.", ar: "منهج التفاضل والتكامل كاملاً، للطلاب الذين أتموا مبادئ التفاضل والتكامل بمستوى الشرف. تنتهي باختبار AP في شهر مايو." } }),
    opt("A", "AP_CALC_AB", 5, { prereq: ["MATH"], notes: { en: "First semester college calculus. Ends with the AP exam in May.", ar: "تعادل الفصل الأول من التفاضل والتكامل الجامعي. تنتهي باختبار AP في شهر مايو." } }),
    opt("A", "AP_STATS", 4, { prereq: ["MATH"], notes: AP_EXAM }),
    opt("A", "US_PRECALC", 4),
    opt("B", "AP_PHYS_C_MECH", 5, { prereq: ["MATH", "PHYS"], notes: { en: "Calculus based mechanics; take it alongside AP Calculus. Ends with the AP exam in May.", ar: "ميكانيكا قائمة على التفاضل والتكامل؛ تُدرس مع التفاضل والتكامل AP. تنتهي باختبار AP في شهر مايو." } }),
    opt("B", "AP_PHYS_1", 5, { prereq: ["MATH"], notes: AP_EXAM }),
    opt("B", "US_PHYS", 4),
    opt("C", "AP_CHEM", 5, { prereq: ["CHEM"], notes: AP_EXAM }),
    opt("C", "AP_BIO", 5, { prereq: ["BIO"], notes: AP_EXAM }),
    opt("C", "AP_CSA", 5, { prereq: ["MATH"], notes: AP_EXAM }),
    opt("D", "US_ECON", 3),
    opt("D", "US_ART", 3),
    opt("D", "US_ROBOTICS", 3),
  ],
};

/** Programmes added to Adam's university list (official pages ask for different subject levels). */
const ADAM_EXTRA_TARGETS: Array<[string, number]> = [
  ["manchester-cs", 9],
  ["birmingham-ai", 7],
  ["university-of-toronto-ce", 5],
  ["ut-austin-cs", 3],
];

/** Deterministic small hash so picks are stable across resets. */
function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export async function seedSubjectLevels(w: SeedWorld) {
  await seedSubjectLevelsFor(w.db, w.orgId, w.now, w.log);
}

export async function seedSubjectLevelsFor(db: PrismaClient, orgId: string, now = new Date(), log: (m: string) => void = () => {}) {
  const tx = db as unknown as Prisma.TransactionClient;
  const year = await currentYear(tx, orgId);
  if (!year) return;

  // 1. Next academic year and its terms.
  let next = await selectionYear(tx, orgId);
  if (!next) {
    const startY = year.startsOn.getUTCFullYear() + 1;
    const d = (y: number, m: number, day: number) => new Date(Date.UTC(y, m - 1, day));
    next = await db.academicYear.create({ data: { orgId, nameEn: `${startY}-${startY + 1}`, nameAr: `${startY}-${startY + 1}`, startsOn: d(startY, 8, 23), endsOn: d(startY + 1, 7, 1), isCurrent: false, createdAt: at(-12, 9, 0, now) } });
    await db.term.createMany({
      data: [
        { orgId, academicYearId: next.id, nameEn: "Autumn term", nameAr: "الفصل الأول", startsOn: d(startY, 8, 23), endsOn: d(startY, 12, 11) },
        { orgId, academicYearId: next.id, nameEn: "Spring term", nameAr: "الفصل الثاني", startsOn: d(startY + 1, 1, 4), endsOn: d(startY + 1, 3, 26) },
        { orgId, academicYearId: next.id, nameEn: "Summer term", nameAr: "الفصل الثالث", startsOn: d(startY + 1, 4, 12), endsOn: d(startY + 1, 7, 1) },
      ],
    });
  }

  // 2. American course subjects, named after the curriculum courses they count as.
  const courses = await db.curriculumCourse.findMany({ where: { orgId: null, curriculum: "AMERICAN" } });
  const courseByCode = new Map(courses.map((c) => [c.code, c]));
  const generic = new Map((await db.subject.findMany({ where: { orgId } })).map((s) => [s.code, s]));
  for (const [code, dept] of Object.entries(US_SUBJECTS)) {
    const c = courseByCode.get(code);
    if (!c || generic.has(code)) continue;
    const s = await db.subject.create({ data: { orgId, code, nameEn: c.nameEn, nameAr: c.nameAr, departmentId: generic.get(dept)?.departmentId ?? null, createdAt: at(-14, 10, 0, now) } });
    generic.set(code, s);
  }
  for (const [code, grades, subject] of EXTRA_SCHOOL_COURSES) {
    const c = courseByCode.get(code);
    if (!c) continue;
    await db.schoolCourse.upsert({
      where: { orgId_courseId: { orgId, courseId: c.id } },
      create: { orgId, courseId: c.id, subjectId: generic.get(subject)?.id ?? null, gradeLevels: grades, createdAt: at(-14, 10, 0, now) },
      update: {},
    });
  }

  // 3. Next year's American offerings (added when missing, so staff edits survive a re-run).
  const rows: Prisma.SubjectOfferingCreateManyInput[] = [];
  for (const [grade, specs] of Object.entries(NEXT_YEAR)) {
    for (const sp of specs) {
      const subject = generic.get(sp.subject);
      const course = courseByCode.get(sp.course);
      if (!subject || !course) continue;
      rows.push({
        orgId,
        academicYearId: next.id,
        subjectId: subject.id,
        gradeLevel: Number(grade),
        kind: sp.kind,
        optionBlock: sp.block ?? null,
        prerequisites: sp.prereq ?? [],
        periodsPerWeek: sp.periods,
        notesEn: sp.notes?.en ?? null,
        notesAr: sp.notes?.ar ?? null,
        curriculum: "AMERICAN",
        courseId: course.id,
        isAP: course.qualification === "AP",
        createdAt: at(-12, 10, 0, now),
      });
    }
  }
  await db.subjectOffering.createMany({ data: rows, skipDuplicates: true });

  // 4. Course selection for next year: open now, closing in two and a half weeks.
  const win = await getWindow(tx, orgId, now, { yearId: next.id, next: true });
  const registrar = (await db.membershipRole.findFirst({ where: { orgId, role: { key: "registrar" } }, select: { membershipId: true } }))?.membershipId ?? null;
  if (!win.eventId) {
    const ev = await setWindow(tx, orgId, at(18, 15, 0, now), registrar, { next: { yearId: next.id, nameEn: next.nameEn, nameAr: next.nameAr } });
    await db.calendarEvent.update({ where: { id: ev.id }, data: { createdAt: at(-10, 8, 30, now) } });
  }

  // 5. More students on the American track: a few per grade who have no pathway records yet.
  const personaIds = new Set((await db.demoPersona.findMany({ where: { orgId } })).map((p) => p.membershipId));
  const busy = new Set([
    ...(await db.studentSubjectResult.findMany({ where: { orgId }, select: { studentId: true }, distinct: ["studentId"] })).map((r) => r.studentId),
    ...(await db.studentCourse.findMany({ where: { orgId }, select: { studentId: true }, distinct: ["studentId"] })).map((r) => r.studentId),
    ...(await db.studentCoursePlan.findMany({ where: { orgId }, select: { studentId: true }, distinct: ["studentId"] })).map((r) => r.studentId),
    ...(await db.shortlistEntry.findMany({ where: { orgId }, select: { studentId: true }, distinct: ["studentId"] })).map((r) => r.studentId),
  ]);
  const WANT: Record<number, number> = { 9: 6, 10: 6, 11: 5 };
  for (const [grade, want] of Object.entries(WANT)) {
    const g = Number(grade);
    const american = await db.student.count({ where: { orgId, gradeLevel: g, status: "ACTIVE", curriculum: "AMERICAN" } });
    if (american >= want) continue;
    const pool = await db.student.findMany({ where: { orgId, gradeLevel: g, status: "ACTIVE", curriculum: "BRITISH" }, orderBy: { studentNo: "asc" } });
    const pick = pool.filter((s) => !busy.has(s.id) && !(s.membershipId && personaIds.has(s.membershipId))).slice(0, want - american);
    if (pick.length) await db.student.updateMany({ where: { id: { in: pick.map((s) => s.id) } }, data: { curriculum: "AMERICAN" } });
  }

  // 6. Choices already made for next year (Adam has not chosen yet).
  const adamMember = (await db.demoPersona.findFirst({ where: { orgId, key: "student" } }))?.membershipId ?? null;
  const students = await db.student.findMany({
    where: { orgId, status: "ACTIVE", curriculum: "AMERICAN", gradeLevel: { in: [9, 10, 11] } },
    include: { guardians: { include: { guardian: { select: { membershipId: true } } }, orderBy: { isPrimary: "desc" } } },
    orderBy: { studentNo: "asc" },
  });
  let chosen = 0;
  for (const s of students) {
    if (s.membershipId && s.membershipId === adamMember) continue;
    const h = hash(`${s.id}:next`);
    if (h % 7 === 0) continue; // still to choose
    if (await db.subjectRegistration.count({ where: { orgId, academicYearId: next.id, studentId: s.id } })) continue;
    const offerings = await offeringsFor(tx, orgId, next.id, s.gradeLevel + 1, s.curriculum);
    if (!offerings.length) continue;
    const prior = await priorSubjectCodes(tx, orgId, s.id, next);
    const taking = new Set(offerings.filter((o) => o.kind === "CORE").map((o) => o.code.toUpperCase()));
    const picks: string[] = [];
    for (const b of blocksOf(offerings)) {
      // About half of the students lean to AP courses where a block offers one.
      const leanAp = (hash(`${s.id}:${b.block}`) >> 3) % 10 < 6;
      const ordered = [...b.options].sort((x, y) => Number(y.isAP === leanAp) - Number(x.isAP === leanAp) || (hash(`${s.id}:${x.code}`) % 97) - (hash(`${s.id}:${y.code}`) % 97));
      const ok = ordered.find((o) => missingPrerequisites(o, taking, prior).length === 0);
      if (ok) {
        picks.push(ok.subjectId);
        taking.add(ok.code.toUpperCase());
      }
    }
    const guardian = s.guardians.find((l) => l.guardian.membershipId)?.guardian.membershipId ?? null;
    const source: RegistrationSource = h % 3 === 0 && guardian ? "PARENT" : s.membershipId ? "STUDENT" : "STAFF";
    const actorId = source === "PARENT" ? guardian : source === "STUDENT" ? s.membershipId : registrar;
    const res = await saveRegistration(tx, orgId, { studentId: s.id, optionSubjectIds: picks, source, actorId, academicYearId: next.id });
    if (!res.ok) continue;
    chosen++;
    const when = at(-9 + (h % 9), 16 + (h % 5), (h >> 4) % 60, now);
    await db.subjectRegistration.updateMany({ where: { orgId, academicYearId: next.id, studentId: s.id }, data: { createdAt: when, updatedAt: when } });
  }

  // 7. Adam's university list: programmes whose official pages ask for different subject levels.
  const adam = adamMember ? await db.student.findFirst({ where: { orgId, membershipId: adamMember } }) : null;
  const advisor = (await db.demoPersona.findFirst({ where: { orgId, key: "career_advisor" } }))?.membershipId ?? null;
  let added = 0;
  if (adam) {
    for (const [key, daysAgo] of ADAM_EXTRA_TARGETS) {
      const p = await db.universityProgram.findFirst({ where: { orgId: null, key } });
      if (!p) continue;
      const res = await addProgramToShortlist(tenantDb(orgId), orgId, { studentId: adam.id, programId: p.id, actorId: advisor, now });
      if (res.ok && res.created) {
        added++;
        await db.shortlistEntry.update({ where: { id: res.entryId }, data: { createdAt: new Date(now.getTime() - daysAgo * DAY), status: "RESEARCHING" } });
      }
    }
    // Older entries were saved before programme ids were recorded: fill them in.
    const loose = await db.shortlistEntry.findMany({ where: { orgId, studentId: adam.id, programId: null } });
    for (const e of loose) {
      const p = await db.universityProgram.findFirst({ where: { universityId: e.universityId, nameEn: e.programEn, OR: [{ orgId: null }, { orgId }] }, select: { id: true } });
      if (p) await db.shortlistEntry.update({ where: { id: e.id }, data: { programId: p.id } });
    }
  }
  log(`subject levels: ${rows.length} next year offerings, ${chosen} students chose next year's courses, ${added} programmes added to Adam's list`);
}
