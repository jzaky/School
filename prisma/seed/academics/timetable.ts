// Demo data for the timetable module: teacher qualifications, a UAE bell schedule, generated lessons,
// a staff absence today with cover arranged (one lesson left uncovered) and a few past absences.
// Safe to re-run: every step skips when its data already exists. Uses only db, orgId and now.
import type { PrismaClient } from "@prisma/client";
import type { SeedWorld } from "../demo";
import type { Tx } from "@/server/db";
import { execCtx } from "@/server/db";
import { buildPreset, UAE_PRESET } from "@/server/timetable/bell";
import { currentYear, loadSections, prefillQualifications, runAssignment, runGenerate } from "@/server/timetable/service";
import { dateKey, ensureCoverTemplates, reassignCover, reportAbsence, weekdayOfKey } from "@/server/timetable/cover";
import { dateOnly, schoolDay } from "../lib";

// Option blocks used when the registration module has not set any: one elective from each block.
const FALLBACK_BLOCKS: Record<string, string> = { PHYS: "A", BUS: "A", GEO: "A", CHEM: "B", CS: "B", PSY: "B", ECON: "C", BIO: "C", ART: "D", FR: "D" };
const CORE_UPPER = new Set(["MATH", "ENG", "ARAB", "ISL", "PE"]);

type World = Pick<SeedWorld, "db" | "orgId" | "now"> & Partial<Pick<SeedWorld, "students" | "log">>;

export async function seedTimetable(w: World) {
  const { db, orgId, now } = w;
  const tx = db as unknown as Tx;
  const log = w.log ?? (() => undefined);
  const year = await currentYear(tx, orgId);
  if (!year) return;
  await ensureCoverTemplates(tx, orgId);

  // 1. Qualifications from current classes and departments; everyone a little more flexible across grades.
  if ((await db.teacherSubject.count({ where: { orgId } })) === 0) {
    await prefillQualifications(tx, orgId);
    const rows = await db.teacherSubject.findMany({ where: { orgId } });
    for (const r of rows) {
      const lo = Math.min(...r.gradeLevels);
      const hi = Math.max(...r.gradeLevels);
      const grades = [...new Set([...r.gradeLevels, ...(lo >= 9 ? [9, 10, 11, 12] : hi <= 8 ? [6, 7, 8] : [])])].sort((a, b) => a - b);
      await db.teacherSubject.update({ where: { id: r.id }, data: { gradeLevels: grades, maxPeriodsPerWeek: 26 } });
    }
  }

  // 2. Bell schedule: the standard UAE day.
  if ((await db.bellPeriod.count({ where: { orgId, academicYearId: year.id } })) === 0) {
    const org = await db.organization.findUnique({ where: { id: orgId }, select: { weekDays: true } });
    const rows = buildPreset({ ...UAE_PRESET, days: org?.weekDays?.length ? org.weekDays : UAE_PRESET.days });
    await db.bellPeriod.createMany({ data: rows.map((r) => ({ orgId, academicYearId: year.id, ...r })) });
  }

  // 3. Option blocks for grades 9 to 12 when nothing defines them yet, so electives can run in parallel.
  if ((await db.timetableSlot.count({ where: { orgId, academicYearId: year.id } })) === 0) {
    await fallbackBlocks(w, year.id);
    await runAssignment(tx, orgId, {});
    const report = await runGenerate(tx, orgId, {});
    log(`timetable: ${report?.stats.lessonsPlaced ?? 0} of ${report?.stats.lessonsRequired ?? 0} lessons placed`);
  }

  // 4. Absences and cover.
  if ((await db.staffAbsence.count({ where: { orgId } })) === 0) await seedAbsences(db, orgId, now);
}

async function fallbackBlocks(w: World, yearId: string) {
  const { db, orgId } = w;
  const tx = db as unknown as Tx;
  for (const grade of [9, 10, 11, 12]) {
    let sections = (await loadSections(tx, orgId, yearId)).filter((c) => c.gradeLevel === grade);
    const subjects = await db.subject.findMany({ where: { orgId, id: { in: sections.map((c) => c.subjectId!) } } });
    const code = (c: { subjectId: string | null }) => subjects.find((s) => s.id === c.subjectId)?.code ?? "";
    if (!sections.some((c) => c.optionBlock)) {
      // Nothing defines blocks for this grade yet: use a standard four-block pattern.
      for (const c of sections.filter((x) => FALLBACK_BLOCKS[code(x)] && !CORE_UPPER.has(code(x)))) await db.schoolClass.update({ where: { id: c.id }, data: { optionBlock: FALLBACK_BLOCKS[code(c)] } });
      sections = (await loadSections(tx, orgId, yearId)).filter((c) => c.gradeLevel === grade);
    }
    const electives = sections.filter((c) => c.optionBlock);
    if (electives.length === 0) continue;
    const blockOf = new Map(electives.map((c) => [c.id, c.optionBlock!]));
    const byBlock = new Map<string, typeof electives>();
    for (const c of electives) byBlock.set(c.optionBlock!, [...(byBlock.get(c.optionBlock!) ?? []), c]);
    const enrollments = await db.enrollment.findMany({ where: { orgId, classId: { in: electives.map((c) => c.id) } }, orderBy: [{ studentId: "asc" }, { classId: "asc" }] });
    const byStudent = new Map<string, typeof enrollments>();
    for (const e of enrollments) byStudent.set(e.studentId, [...(byStudent.get(e.studentId) ?? []), e]);
    let i = 0;
    for (const [studentId, es] of byStudent) {
      i++;
      // A student takes one elective per block: move any second choice in a block to a block they do not have yet.
      const used = new Set<string>();
      const clashing: typeof es = [];
      for (const e of es) {
        const b = blockOf.get(e.classId)!;
        if (used.has(b)) clashing.push(e);
        else used.add(b);
      }
      for (const e of clashing) {
        const free = [...byBlock.keys()].sort().find((b) => !used.has(b));
        if (!free) {
          await db.enrollment.delete({ where: { id: e.id } });
          continue;
        }
        const options = byBlock.get(free)!;
        const target = options[i % options.length];
        used.add(free);
        await db.enrollment.update({ where: { id: e.id }, data: { classId: target.id } });
        const s = w.students?.find((x) => x.id === studentId);
        if (s) {
          const old = electives.find((c) => c.id === e.classId)!;
          s.classIds = s.classIds.map((cid) => (cid === e.classId ? target.id : cid));
          s.subjects = s.subjects.map((x) => (x === code(old) ? code(target) : x));
        }
      }
    }
  }
}

async function seedAbsences(db: PrismaClient, orgId: string, now: Date) {
  const tx = db as unknown as Tx;
  const year = await currentYear(tx, orgId);
  if (!year) return;
  const science = await db.department.findFirst({ where: { orgId, key: "science" } });
  const daniel = await db.demoPersona.findFirst({ where: { orgId, key: "teacher" } });
  const admin = await db.demoPersona.findFirst({ where: { orgId, key: "admin" } });
  const reporter = admin?.membershipId;
  if (!science || !reporter) return;
  const scienceStaff = await db.staffProfile.findMany({ where: { orgId, departmentId: science.id, membershipId: { not: daniel?.membershipId ?? "" } }, select: { membershipId: true } });
  const slots = await db.timetableSlot.findMany({ where: { orgId, academicYearId: year.id } });

  // Today (or the next school day): the science teacher with the most lessons that day is off sick.
  const todayKey = dateKey(dateOnly(schoolDay(0, now), now));
  const wd = weekdayOfKey(todayKey);
  const count = (m: string, day: number) => slots.filter((s) => s.teacherMembershipId === m && s.dayOfWeek === day).length;
  const absent = [...scienceStaff].sort((a, b) => count(b.membershipId, wd) - count(a.membershipId, wd) || a.membershipId.localeCompare(b.membershipId))[0];
  if (!absent || count(absent.membershipId, wd) === 0) return;
  const at = (k: string, h: number) => new Date(`${k}T0${h - 4}:15:00.000Z`);
  const ec = (when: Date) => execCtx(tx, orgId, { now: when, quiet: true, actorId: reporter });

  const res = await reportAbsence(ec(at(todayKey, 6)), {
    membershipId: absent.membershipId,
    startsOn: todayKey,
    endsOn: todayKey,
    allDay: true,
    notes: "Worksheets and slides are in the shared Science drive. Students continue the practice questions.",
    reportedById: absent.membershipId,
  });
  const covers = await db.coverAssignment.findMany({ where: { orgId, absenceId: res.absence.id }, orderBy: { periodNo: "asc" } });
  // Daniel Carter covers one lesson when he is free, so his timetable shows cover.
  if (daniel) {
    const busy = new Set(slots.filter((s) => s.teacherMembershipId === daniel.membershipId && s.dayOfWeek === wd).map((s) => s.periodNo));
    const target = covers.find((c) => !busy.has(c.periodNo) && c.substituteId !== daniel.membershipId && !covers.some((x) => x.substituteId === daniel.membershipId && x.periodNo === c.periodNo));
    if (target && !covers.some((c) => c.substituteId === daniel.membershipId)) {
      try {
        await reassignCover(ec(at(todayKey, 6)), target.id, { substituteId: daniel.membershipId, actorId: reporter });
      } catch {
        // Daniel is not free after all; the automatic pick stays.
      }
    }
  }
  // Leave the last lesson uncovered to show that state on the cover board.
  const last = covers[covers.length - 1];
  if (covers.length > 1 && last) await db.coverAssignment.update({ where: { id: last.id }, data: { substituteId: null, status: "UNCOVERED", notifiedAt: null } });
  await db.staffAbsence.update({ where: { id: res.absence.id }, data: { status: covers.length > 1 ? "PARTLY_COVERED" : "COVERED" } });

  // History: past absences across departments, all covered.
  const teachers = [...new Set(slots.map((s) => s.teacherMembershipId).filter(Boolean) as string[])].filter((m) => m !== absent.membershipId && m !== daniel?.membershipId).sort();
  const past = [
    { offset: -3, notes: "Medical appointment in the morning.", periods: [2, 5] as [number, number] },
    { offset: -8, notes: "Year 10 practice papers are on the shared drive." },
    { offset: -14, notes: "Training day at KHDA." },
    { offset: -17, notes: "Family matter." },
    { offset: -21, notes: "Please collect homework at the end of the lesson." },
  ];
  for (let i = 0; i < past.length; i++) {
    const p = past[i];
    const key = dateKey(dateOnly(schoolDay(p.offset, now), now));
    const who = teachers[(i * 7 + 3) % teachers.length];
    if (!who) continue;
    const r = await reportAbsence(ec(at(key, 6)), {
      membershipId: who,
      startsOn: key,
      endsOn: key,
      allDay: !p.periods,
      fromPeriod: p.periods?.[0] ?? null,
      toPeriod: p.periods?.[1] ?? null,
      notes: p.notes,
      reportedById: i % 2 ? reporter : who,
    });
    await db.coverAssignment.updateMany({ where: { orgId, absenceId: r.absence.id, status: "ASSIGNED" }, data: { status: "DONE" } });
  }
}
