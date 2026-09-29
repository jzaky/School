// A school shaped like the demo tenant: grades 6 to 12, core subjects for everyone, and option blocks
// in grades 9 to 12. Used by the timetable solver tests.
import { buildPreset, UAE_PRESET } from "@/server/timetable/bell";
import type { SolverClass, SolverPeriod } from "@/server/timetable/solver";

export function rand(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const LOWER = ["MATH", "ENG", "ARAB", "ISL", "SOC", "BIO", "PE", "ART"];
export const CORE = ["MATH", "ENG", "ARAB", "ISL", "PE"];
export const BLOCKS: Record<string, string[]> = { A: ["PHYS", "BUS", "GEO"], B: ["CHEM", "CS", "PSY"], C: ["ECON", "BIO"], D: ["ART", "FR"] };

export function lessonPeriods(): SolverPeriod[] {
  return buildPreset(UAE_PRESET)
    .filter((r) => r.kind === "LESSON")
    .map((r) => ({ day: r.dayOfWeek, period: r.periodNo }));
}

/** Build classes with students and teachers. `scale` multiplies the number of students per grade. */
export function demoSchool(seed = 7, scale = 1) {
  const r = rand(seed);
  const perGrade: Record<number, number> = { 6: 6, 7: 5, 8: 16, 9: 23, 10: 21, 11: 18, 12: 10 };
  const teachersBySubject: Record<string, string[]> = {
    MATH: ["t-math1", "t-math2", "t-math3", "t-math4", "t-math5"],
    ENG: ["t-eng1", "t-eng2", "t-eng3", "t-eng4"],
    ARAB: ["t-arab1", "t-arab2", "t-arab3"],
    ISL: ["t-isl1", "t-isl2"],
    SOC: ["t-soc1", "t-soc2"],
    BIO: ["t-bio1", "t-bio2", "t-bio3"],
    PE: ["t-pe1", "t-pe2", "t-pe3"],
    ART: ["t-art1", "t-art2"],
    PHYS: ["t-phys1", "t-phys2"],
    CHEM: ["t-chem1", "t-chem2", "t-chem3"],
    CS: ["t-cs1", "t-cs2", "t-cs3"],
    ECON: ["t-econ1"],
    BUS: ["t-bus1"],
    PSY: ["t-psy1", "t-psy2"],
    GEO: ["t-geo1", "t-geo2"],
    FR: ["t-fr1"],
  };
  const classes: SolverClass[] = [];
  const students: Record<string, string[]> = {};
  let n = 0;
  for (const g of [6, 7, 8, 9, 10, 11, 12]) {
    const ids = Array.from({ length: perGrade[g] * scale }, () => `s${String(++n).padStart(4, "0")}`);
    students[g] = ids;
    const subjects = g <= 8 ? LOWER : CORE;
    for (const code of subjects) {
      const pool = teachersBySubject[code];
      classes.push({ id: `c-${g}-${code}`, teacherId: pool[(g + code.length) % pool.length], gradeLevel: g, periods: 4, room: `${code}-${g}`, studentIds: ids });
    }
    if (g >= 9) {
      for (const [block, codes] of Object.entries(BLOCKS)) {
        const members: Record<string, string[]> = {};
        for (const s of ids) {
          const code = codes[Math.floor(r() * codes.length)];
          (members[code] ??= []).push(s);
        }
        codes.forEach((code, i) => {
          const pool = teachersBySubject[code];
          classes.push({ id: `c-${g}-${code}`, teacherId: pool[(g + i) % pool.length], gradeLevel: g, optionBlock: block, periods: 4, room: `${code}-${g}`, studentIds: members[code] ?? [] });
        });
      }
    }
  }
  return { classes, students };
}
