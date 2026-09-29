// Demo data for subject registration and class allocation.
// Offerings for grades 6 to 12 (core subjects, plus option blocks A to D from Grade 9), a registration
// window that is open now, a registration for every student made from the classes they already sit in,
// completed subject changes applied, and allocation run so every class has a roster.
// Safe to re-run: offerings are only added when missing, students who already registered are kept,
// and allocation is idempotent. Uses only db, orgId and now, and reads everything else.
import type { Prisma, PrismaClient, RegistrationSource } from "@prisma/client";
import type { SeedWorld } from "../demo";
import { at } from "../lib";
import { blocksOf, missingPrerequisites } from "@/lib/registration";
import { applySubjectChange, currentYear, getWindow, offeringsFor, runAllocation, setWindow } from "@/server/registration/service";

type Bi = { en: string; ar: string };
type OfferingSpec = { code: string; kind: "CORE" | "OPTION"; block?: string; periods: number; prereq?: string[]; notes?: Bi };

const LOWER: OfferingSpec[] = [
  { code: "MATH", kind: "CORE", periods: 6 },
  { code: "ENG", kind: "CORE", periods: 5 },
  { code: "ARAB", kind: "CORE", periods: 5 },
  { code: "ISL", kind: "CORE", periods: 2 },
  { code: "SOC", kind: "CORE", periods: 2 },
  { code: "BIO", kind: "CORE", periods: 3 },
  { code: "PE", kind: "CORE", periods: 2 },
  { code: "ART", kind: "CORE", periods: 2 },
];

function upper(grade: number): OfferingSpec[] {
  const senior = grade >= 11;
  return [
    { code: "MATH", kind: "CORE", periods: 6 },
    { code: "ENG", kind: "CORE", periods: 5 },
    { code: "ARAB", kind: "CORE", periods: 4 },
    { code: "ISL", kind: "CORE", periods: 2 },
    { code: "PE", kind: "CORE", periods: 2 },
    { code: "PHYS", kind: "OPTION", block: "A", periods: 4, prereq: senior ? ["MATH"] : [] },
    {
      code: "CS",
      kind: "OPTION",
      block: "A",
      periods: 4,
      notes: { en: "Python programming with a coursework project each term.", ar: "برمجة بلغة بايثون مع مشروع عملي في كل فصل دراسي." },
    },
    { code: "GEO", kind: "OPTION", block: "A", periods: 4, notes: { en: "Includes a field study day in Hatta.", ar: "تشمل يوماً للدراسة الميدانية في حتا." } },
    { code: "CHEM", kind: "OPTION", block: "B", periods: 4 },
    { code: "BUS", kind: "OPTION", block: "B", periods: 4 },
    { code: "ECON", kind: "OPTION", block: "C", periods: 4, prereq: ["MATH"] },
    {
      code: "BIO",
      kind: "OPTION",
      block: "C",
      periods: 4,
      prereq: senior ? ["CHEM"] : [],
      notes: senior ? { en: "Students who plan to study medicine should also take Chemistry.", ar: "ننصح الطلاب الراغبين في دراسة الطب بأن يدرسوا الكيمياء أيضاً." } : undefined,
    },
    { code: "FR", kind: "OPTION", block: "C", periods: 4 },
    { code: "ART", kind: "OPTION", block: "D", periods: 4, notes: { en: "Portfolio based, with studio time after school on Tuesdays.", ar: "يعتمد على ملف الأعمال، مع وقت في المرسم بعد الدوام يوم الثلاثاء." } },
    { code: "PSY", kind: "OPTION", block: "D", periods: 4 },
  ];
}

/** Deterministic small hash so picks are stable across resets. */
function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export async function seedRegistration(w: SeedWorld) {
  await seedRegistrationData(w.db, w.orgId, w.now, w.log);
  // Keep the in-memory world in step with the classes students now sit in, for the seeds that follow.
  if (w.students.length) {
    const enr = await w.db.enrollment.findMany({ where: { orgId: w.orgId }, select: { studentId: true, classId: true, class: { select: { subject: { select: { code: true } } } } } });
    const byStudent = new Map<string, typeof enr>();
    for (const e of enr) byStudent.set(e.studentId, [...(byStudent.get(e.studentId) ?? []), e]);
    for (const s of w.students) {
      const rows = byStudent.get(s.id) ?? [];
      s.classIds = rows.map((r) => r.classId);
      s.subjects = rows.map((r) => r.class.subject?.code).filter(Boolean) as string[];
    }
    const known = new Set(w.classes.map((c) => c.id));
    const added = await w.db.schoolClass.findMany({ where: { orgId: w.orgId, id: { notIn: [...known] } }, include: { subject: true } });
    for (const c of added) w.classes.push({ id: c.id, grade: c.gradeLevel, subject: c.subject?.code ?? null, section: c.section, teacherId: c.teacherMembershipId, homeroom: c.isHomeroom });
  }
}

export async function seedRegistrationData(db: PrismaClient, orgId: string, now: Date, log: (m: string) => void = () => undefined) {
  const tx = db as unknown as Prisma.TransactionClient;
  const year = await currentYear(tx, orgId);
  if (!year) return;
  const subjects = await db.subject.findMany({ where: { orgId } });
  const subjectByCode = new Map(subjects.map((s) => [s.code, s]));

  // 1. Offerings (added when missing, so admin edits survive a re-run).
  const offeringRows: Prisma.SubjectOfferingCreateManyInput[] = [];
  for (let g = 6; g <= 12; g++) {
    for (const o of g <= 8 ? LOWER : upper(g)) {
      const s = subjectByCode.get(o.code);
      if (!s) continue;
      offeringRows.push({
        orgId,
        academicYearId: year.id,
        subjectId: s.id,
        gradeLevel: g,
        kind: o.kind,
        optionBlock: o.block ?? null,
        prerequisites: o.prereq ?? [],
        periodsPerWeek: o.periods,
        notesEn: o.notes?.en ?? null,
        notesAr: o.notes?.ar ?? null,
        createdAt: at(-170, 9, 0, now),
      });
    }
  }
  await db.subjectOffering.createMany({ data: offeringRows, skipDuplicates: true });

  // 2. Registration window: open, closing in nine days.
  const win = await getWindow(tx, orgId, now);
  if (!win.eventId) {
    const registrar = await db.membershipRole.findFirst({ where: { orgId, role: { key: "registrar" } }, select: { membershipId: true } });
    await setWindow(tx, orgId, at(9, 15, 0, now), registrar?.membershipId ?? null);
  }

  // 3. Registrations from the classes students already sit in.
  const [students, existing, enrollments, registrarRole] = await Promise.all([
    db.student.findMany({ where: { orgId, status: "ACTIVE" }, include: { guardians: { include: { guardian: { select: { membershipId: true } } }, orderBy: { isPrimary: "desc" } } }, orderBy: { studentNo: "asc" } }),
    db.subjectRegistration.findMany({ where: { orgId, academicYearId: year.id } }),
    db.enrollment.findMany({ where: { orgId, class: { academicYearId: year.id, isHomeroom: false } }, select: { studentId: true, class: { select: { subjectId: true } } } }),
    db.membershipRole.findFirst({ where: { orgId, role: { key: "registrar" } }, select: { membershipId: true } }),
  ]);
  const registrar = registrarRole?.membershipId ?? null;
  const regsByStudent = new Map<string, typeof existing>();
  for (const r of existing) regsByStudent.set(r.studentId, [...(regsByStudent.get(r.studentId) ?? []), r]);
  const enrolledSubjects = new Map<string, Set<string>>();
  for (const e of enrollments) if (e.class.subjectId) enrolledSubjects.set(e.studentId, new Set([...(enrolledSubjects.get(e.studentId) ?? []), e.class.subjectId]));
  const offeringsByGrade = new Map<number, Awaited<ReturnType<typeof offeringsFor>>>();
  for (let g = 6; g <= 12; g++) offeringsByGrade.set(g, await offeringsFor(tx, orgId, year.id, g));

  const rows: Prisma.SubjectRegistrationCreateManyInput[] = [];
  let lowerCount = 0;
  for (const s of students) {
    const offerings = offeringsByGrade.get(s.gradeLevel) ?? [];
    if (!offerings.length) continue;
    const mine = regsByStudent.get(s.id) ?? [];
    // Students who registered through the normal flow are left as they are.
    if (mine.some((r) => r.source !== "SUBJECT_CHANGE")) continue;
    const have = new Set(mine.map((r) => r.subjectId));
    const dropped = new Set(mine.filter((r) => r.status === "DROPPED").map((r) => r.subjectId));
    const activeHave = new Set(mine.filter((r) => r.status !== "DROPPED").map((r) => r.subjectId));
    const enrolled = enrolledSubjects.get(s.id) ?? new Set<string>();

    // One option per block: the one already registered, else the class they sit in, else a stable pick.
    const picks = new Map<string, string>();
    for (const b of blocksOf(offerings)) {
      const ids = b.options.map((o) => o.subjectId).filter((id) => !dropped.has(id));
      const pick = ids.find((id) => activeHave.has(id)) ?? ids.find((id) => enrolled.has(id)) ?? ids[hash(`${s.id}:${b.block}`) % Math.max(ids.length, 1)];
      if (pick) picks.set(b.block, pick);
    }
    // Respect prerequisites (for example Biology needs Chemistry from Grade 11).
    const codeOf = (id: string) => offerings.find((o) => o.subjectId === id)!.code;
    for (const [block, id] of [...picks]) {
      const o = offerings.find((x) => x.subjectId === id)!;
      const taking = new Set([...offerings.filter((x) => x.kind === "CORE").map((x) => x.code), ...[...picks.values()].map(codeOf)]);
      for (const code of missingPrerequisites(o, taking)) {
        const need = offerings.find((x) => x.code === code && x.kind === "OPTION");
        if (need && need.optionBlock !== block && !activeHave.has(picks.get(need.optionBlock!) ?? "")) picks.set(need.optionBlock!, need.subjectId);
      }
    }

    const upperGrade = s.gradeLevel >= 9;
    const h = hash(s.id);
    const guardianMember = s.guardians.find((l) => l.guardian.membershipId)?.guardian.membershipId ?? null;
    let source: RegistrationSource;
    let createdById: string | null;
    if (!upperGrade) {
      source = "IMPORT";
      createdById = registrar;
      lowerCount++;
    } else if (h % 10 < 5 && s.membershipId) {
      source = "STUDENT";
      createdById = s.membershipId;
    } else if (h % 10 < 9 && guardianMember) {
      source = "PARENT";
      createdById = guardianMember;
    } else {
      source = "STAFF";
      createdById = registrar;
    }
    // Returning students chose in the spring; the Grade 6 to 8 sheet was imported before term.
    const createdAt = upperGrade ? at(-150 + (h % 30), 10 + (h % 8), (h >> 3) % 60, now) : at(-40, 11, 20, now);
    const wanted = [...offerings.filter((o) => o.kind === "CORE").map((o) => o.subjectId), ...picks.values()];
    for (const subjectId of wanted) {
      if (have.has(subjectId)) continue;
      rows.push({ orgId, academicYearId: year.id, studentId: s.id, subjectId, status: "REQUESTED", source, createdById, createdAt, updatedAt: createdAt });
    }
  }
  if (rows.length) await db.subjectRegistration.createMany({ data: rows, skipDuplicates: true });

  // The Grade 6 to 8 sheet came in as an import.
  if (lowerCount && !(await db.csvImport.findFirst({ where: { orgId, entity: "registrations" } }))) {
    await db.csvImport.create({
      data: { orgId, entity: "registrations", fileName: "Grades 6-8 subjects 2026-27.csv", status: "COMPLETED", total: lowerCount, succeeded: lowerCount, failed: 0, errors: [], createdById: registrar ?? "", createdAt: at(-40, 11, 20, now) },
    });
  }

  // 4. Subject changes that already completed.
  const done = await db.request.findMany({ where: { orgId, status: "COMPLETED", service: { key: "subject_change" }, studentId: { not: null } }, select: { studentId: true, submission: { select: { data: true } } }, orderBy: { completedAt: "asc" } });
  for (const r of done) {
    const form = (r.submission?.data ?? {}) as Record<string, unknown>;
    await applySubjectChange(tx, orgId, { studentId: r.studentId!, fromSubject: form.fromSubject, toSubject: form.toSubject, actorId: registrar });
  }

  // 5. A class a student sits in for an option they did not choose (another option in the same block
  //    won) is recorded as dropped, so allocation takes them off that roster.
  const allRegs = await db.subjectRegistration.findMany({ where: { orgId, academicYearId: year.id } });
  const regKey = new Set(allRegs.map((r) => `${r.studentId}:${r.subjectId}`));
  const activeBy = new Map<string, Set<string>>();
  for (const r of allRegs) if (r.status !== "DROPPED") activeBy.set(r.studentId, new Set([...(activeBy.get(r.studentId) ?? []), r.subjectId]));
  const droppedRows: Prisma.SubjectRegistrationCreateManyInput[] = [];
  for (const s of students) {
    const offerings = offeringsByGrade.get(s.gradeLevel) ?? [];
    const active = activeBy.get(s.id);
    if (!active) continue;
    for (const subjectId of enrolledSubjects.get(s.id) ?? []) {
      const o = offerings.find((x) => x.subjectId === subjectId);
      if (!o || o.kind !== "OPTION" || regKey.has(`${s.id}:${subjectId}`)) continue;
      const blockTaken = offerings.some((x) => x.kind === "OPTION" && x.optionBlock === o.optionBlock && active.has(x.subjectId));
      if (!blockTaken) continue;
      const when = at(-150 + (hash(s.id) % 30), 12, 0, now);
      droppedRows.push({ orgId, academicYearId: year.id, studentId: s.id, subjectId, status: "DROPPED", source: "STAFF", createdById: registrar, createdAt: when, updatedAt: when });
    }
  }
  if (droppedRows.length) await db.subjectRegistration.createMany({ data: droppedRows, skipDuplicates: true });

  // Grade 10 Mathematics runs in sets of 12: the class takes its first 12 and allocation opens set B.
  const math = subjectByCode.get("MATH");
  if (math) {
    const m10 = await db.schoolClass.findMany({ where: { orgId, academicYearId: year.id, subjectId: math.id, gradeLevel: 10, isHomeroom: false }, include: { enrollments: { include: { student: { select: { studentNo: true } } } } } });
    if (m10.length === 1 && m10[0].capacity === null && m10[0].enrollments.length > 12) {
      const cls = m10[0];
      await db.schoolClass.update({ where: { id: cls.id }, data: { capacity: 12, section: "A", nameEn: `Grade 10 ${math.nameEn} A`, nameAr: `${math.nameAr} للصف 10 A` } });
      const overflow = [...cls.enrollments].sort((a, b) => a.student.studentNo.localeCompare(b.student.studentNo)).slice(12).map((e) => e.studentId);
      await db.enrollment.deleteMany({ where: { orgId, classId: cls.id, studentId: { in: overflow } } });
      await db.subjectRegistration.updateMany({ where: { orgId, academicYearId: year.id, subjectId: math.id, studentId: { in: overflow } }, data: { classId: null, status: "REQUESTED" } });
    }
  }

  // 6. Allocate everyone.
  const summary = await runAllocation(tx, orgId, year.id);
  if (summary.registrationsUpdated) {
    // Allocation happened when the registrations came in, not today.
    await db.$executeRaw`UPDATE "SubjectRegistration" SET "updatedAt" = "createdAt" + interval '2 hours' WHERE "orgId" = ${orgId} AND "source" <> 'SUBJECT_CHANGE' AND "updatedAt" > "createdAt" + interval '1 day'`;
  }
  log(`registration: ${rows.length} registrations, ${summary.placed} placed, ${summary.removed} removed, ${summary.sectionsCreated} new sections`);
}
