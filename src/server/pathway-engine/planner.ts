// Goal-first course planner. Pure and deterministic.
// 1. Find target programmes from a career (CareerField weights) or field keys, in the target countries.
// 2. Add up the subject requirements of those programmes for the student's curriculum, weighted by how
//    many programmes need them.
// 3. Propose a Grade 9 to 12 plan using ONLY courses the school offers, in the grades it offers them,
//    with prerequisites in earlier grades and sensible core courses in every year.
// AI never chooses courses or decides eligibility; it may only write a narrative summary of this output.
import { applicableRows } from "./evaluate";
import { prerequisitesOf } from "./prereqs";
import { LEVEL_RANK, type CatalogCourse, type ProgramForEval, type StudentProfile, type SubjectLevel } from "./types";

export type CareerFieldWeight = { careerKey: string; fieldKey: string; weight: number };
export type PlannerProgram = {
  id: string;
  nameEn: string;
  nameAr: string;
  universityEn: string;
  universityAr: string;
  countryCode: string;
  fieldKeys: string[];
  worldRank?: number | null;
  program: ProgramForEval;
};
export type Goal = { careerKey?: string | null; fieldKeys?: string[]; countries?: string[] };

export type SubjectNeed = { subjectKey: string; level: SubjectLevel | null; weight: number; required: boolean; programIds: string[] };
export type PlanSource = "locked" | "requirement" | "recommended" | "prerequisite" | "core";
export type PlanItemOut = {
  catalogId: string;
  courseId: string;
  code: string;
  nameEn: string;
  nameAr: string;
  gradeLevel: number;
  source: PlanSource;
  reasonEn: string;
  reasonAr: string;
  programIds: string[];
  locked: boolean;
};
export type PlanWarning = { code: "no_course" | "no_room"; subjectKey?: string; courseCode?: string };
export type PlannerOutput = {
  targets: Array<{ id: string; weight: number }>;
  needs: SubjectNeed[];
  items: PlanItemOut[];
  warnings: PlanWarning[];
};

/** Core subjects to keep in every planned year, per curriculum (UAE private schools teach Arabic to all). */
export const CORE_SUBJECTS: Record<string, string[]> = {
  AMERICAN: ["english_language", "mathematics", "science", "arabic"],
  UAE_MOE: ["english_language", "mathematics", "science", "arabic"],
  BRITISH: ["arabic"],
  IB: ["arabic"],
};
/** Subjects taught as one course across several years; the same course repeats each year. */
export const REPEATABLE_SUBJECTS = new Set(["arabic", "islamic_studies", "uae_social_studies", "physical_education", "moral_education"]);
export const MAX_COURSES_PER_GRADE = 7;
const LAST_GRADE = 12;

/** Target programmes for a goal, best matching first. */
export function findTargetPrograms(goal: Goal, careerFields: CareerFieldWeight[], programs: PlannerProgram[], max = 25): Array<{ p: PlannerProgram; weight: number }> {
  const fieldWeight = new Map<string, number>();
  if (goal.careerKey) for (const cf of careerFields) if (cf.careerKey === goal.careerKey) fieldWeight.set(cf.fieldKey, Math.max(fieldWeight.get(cf.fieldKey) ?? 0, cf.weight));
  for (const f of goal.fieldKeys ?? []) fieldWeight.set(f, 5);
  const countries = new Set(goal.countries ?? []);
  const ranked = programs
    .map((p) => ({ p, weight: Math.max(0, ...p.fieldKeys.map((f) => fieldWeight.get(f) ?? 0)) }))
    .filter((x) => x.weight > 0 && (!countries.size || countries.has(x.p.countryCode)))
    .sort((a, b) => b.weight - a.weight || (a.p.worldRank ?? 9999) - (b.p.worldRank ?? 9999) || (a.p.id < b.p.id ? -1 : 1));
  // Take the best programmes country by country (in goal order), so every target country is represented.
  const order = goal.countries?.length ? goal.countries : [...new Set(ranked.map((x) => x.p.countryCode))];
  const queues = order.map((c) => ranked.filter((x) => x.p.countryCode === c));
  const out: typeof ranked = [];
  for (let i = 0; out.length < max && queues.some((q) => q.length > i); i++) for (const q of queues) if (q[i] && out.length < max) out.push(q[i]);
  return out;
}

const maxLevel = (a: SubjectLevel | null, b: SubjectLevel | null) => (!a ? b : !b ? a : LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b);

/** Weighted subject needs of the target programmes for one curriculum. OR lines go to the most demanded key. */
export function aggregateNeeds(targets: Array<{ p: PlannerProgram; weight: number }>, curriculum: string, catalog: CatalogCourse[]): SubjectNeed[] {
  type Line = { keys: string[]; level: SubjectLevel | null; n: number; required: boolean; programId: string; weight: number };
  const lines: Line[] = [];
  for (const { p, weight } of targets) {
    const { rows } = applicableRows(p.program, curriculum);
    for (const row of rows)
      for (const s of row.subjects) {
        const required = s.type === "REQUIRED" || s.type === "ONE_OF" || s.type === "TWO_OF";
        lines.push({ keys: [...s.keys, ...(s.alternatives ?? [])], level: s.minimumLevel ?? null, n: s.type === "TWO_OF" ? 2 : 1, required, programId: p.id, weight: (required ? 1 : 0.3) * weight });
      }
  }
  const offered = new Set(catalog.flatMap((c) => c.mappings.map((m) => m.subjectKey)));
  // Demand from single-key lines decides where OR lines go.
  const single = new Map<string, number>();
  for (const l of lines) if (l.keys.length === 1) single.set(l.keys[0], (single.get(l.keys[0]) ?? 0) + l.weight);
  const needs = new Map<string, SubjectNeed>();
  for (const l of lines) {
    const ranked = [...l.keys].sort((a, b) => Number(offered.has(b)) - Number(offered.has(a)) || (single.get(b) ?? 0) - (single.get(a) ?? 0) || l.keys.indexOf(a) - l.keys.indexOf(b));
    for (const key of ranked.slice(0, l.n)) {
      const n = needs.get(key) ?? { subjectKey: key, level: null, weight: 0, required: false, programIds: [] };
      n.level = maxLevel(n.level, l.level);
      n.weight += l.weight;
      n.required ||= l.required;
      if (!n.programIds.includes(l.programId)) n.programIds.push(l.programId);
      needs.set(key, n);
    }
  }
  return [...needs.values()].sort((a, b) => Number(b.required) - Number(a.required) || b.weight - a.weight || (a.subjectKey < b.subjectKey ? -1 : 1));
}

type Placed = { course: CatalogCourse | null; code: string; courseId: string | null; gradeLevel: number; item?: PlanItemOut };

export function planCourses(input: {
  profile: StudentProfile;
  goal: Goal;
  careerFields: CareerFieldWeight[];
  programs: PlannerProgram[];
  catalog: CatalogCourse[];
  locked?: Array<{ catalogId: string; gradeLevel: number; reasonEn?: string | null; reasonAr?: string | null }>;
  maxPrograms?: number;
}): PlannerOutput {
  const { profile, catalog } = input;
  const targets = findTargetPrograms(input.goal, input.careerFields, input.programs, input.maxPrograms ?? 25);
  const byId = new Map(targets.map((t) => [t.p.id, t.p]));
  const needs = aggregateNeeds(targets, profile.curriculum, catalog);
  const catalogByCode = new Map(catalog.map((c) => [c.code, c]));
  const catalogById = new Map(catalog.map((c) => [c.id, c]));
  const warnings: PlanWarning[] = [];

  // Courses already on the record keep their grade. New courses start after the current year when it has begun.
  const record: Placed[] = profile.courses.filter((c) => c.status !== "PLANNED").map((c) => ({ course: null, code: c.code ?? "", courseId: c.courseId, gradeLevel: c.gradeLevel }));
  const startGrade = profile.courses.some((c) => c.status === "IN_PROGRESS" && c.gradeLevel === profile.gradeLevel) ? profile.gradeLevel + 1 : profile.gradeLevel;
  const placed: Placed[] = [...record];
  const countIn = (g: number) => placed.filter((p) => p.gradeLevel === g && p.item).length + record.filter((r) => r.gradeLevel === g).length;
  const gradeOf = (code: string) => placed.filter((p) => p.code === code).map((p) => p.gradeLevel);
  const has = (course: CatalogCourse) => placed.some((p) => p.courseId === course.courseId);

  /** Up to two different universities among the programmes, for reasons. */
  const names = (ids: string[], locale: "en" | "ar") =>
    [...new Set(ids.map((id) => byId.get(id)!).map((p) => (locale === "en" ? p.universityEn : p.universityAr)))].slice(0, 2).join(locale === "en" ? " and " : " و");

  const place = (course: CatalogCourse, after: number, source: PlanSource, reason: { en: string; ar: string }, programIds: string[], locked = false, fixedGrade?: number): number | null => {
    const grades = fixedGrade !== undefined ? [fixedGrade] : [...course.gradeLevels].sort((a, b) => a - b).filter((g) => g >= startGrade && g > after && g <= LAST_GRADE);
    const g = grades.find((x) => fixedGrade !== undefined || countIn(x) < MAX_COURSES_PER_GRADE);
    if (g === undefined) return null;
    const item: PlanItemOut = { catalogId: course.id, courseId: course.courseId, code: course.code, nameEn: course.nameEn, nameAr: course.nameAr, gradeLevel: g, source, reasonEn: reason.en, reasonAr: reason.ar, programIds, locked };
    placed.push({ course, code: course.code, courseId: course.courseId, gradeLevel: g, item });
    return g;
  };

  /** Place a course and, first, its missing prerequisites. Returns the grade or null. */
  const placeWithPrereqs = (course: CatalogCourse, source: PlanSource, reason: { en: string; ar: string }, programIds: string[], depth = 0): number | null => {
    if (has(course)) return Math.max(...gradeOf(course.code), 0);
    let after = 0;
    for (const group of prerequisitesOf(course.code)) {
      const done = group.flatMap((code) => gradeOf(code));
      if (done.length) {
        after = Math.max(after, Math.min(...done));
        continue;
      }
      const option = group.map((code) => catalogByCode.get(code)).find((c): c is CatalogCourse => !!c);
      if (!option || depth > 5) continue; // Not offered here: the school handles equivalents.
      const g = placeWithPrereqs(option, "prerequisite", { en: `Prepares you for ${course.nameEn}.`, ar: `تمهّد لمادة ${course.nameAr}.` }, programIds, depth + 1);
      if (g === null) return null;
      after = Math.max(after, g);
    }
    return place(course, after, source, reason, programIds);
  };

  // 1. Locked items from the current plan stay where they are.
  for (const l of input.locked ?? []) {
    const c = catalogById.get(l.catalogId);
    if (c && !has(c)) place(c, 0, "locked", { en: l.reasonEn ?? "Kept from your plan.", ar: l.reasonAr ?? "مادة ثابتة في خطتك." }, [], true, l.gradeLevel);
  }

  // 2. Requirement-driven courses, most demanded first.
  const recordSatisfies = (need: SubjectNeed) =>
    profile.courses.some((c) => c.status !== "PLANNED" && c.mappings.some((m) => m.subjectKey === need.subjectKey && (!need.level || LEVEL_RANK[m.level] >= LEVEL_RANK[need.level])));
  const placedSatisfies = (need: SubjectNeed) => placed.some((p) => p.course?.mappings.some((m) => m.subjectKey === need.subjectKey && (!need.level || LEVEL_RANK[m.level] >= LEVEL_RANK[need.level])));
  for (const need of needs) {
    if (!need.required && need.programIds.length < 2) continue;
    if (recordSatisfies(need) || placedSatisfies(need)) continue;
    const options = catalog
      .filter((c) => c.gradeLevels.some((g) => g >= startGrade))
      .map((c) => ({ c, m: c.mappings.find((m) => m.subjectKey === need.subjectKey && (!need.level || LEVEL_RANK[m.level] >= LEVEL_RANK[need.level])) }))
      .filter((x) => x.m)
      .sort((a, b) => b.m!.rigor - a.m!.rigor || (a.c.code < b.c.code ? -1 : 1));
    if (!options.length) {
      if (need.required) warnings.push({ code: "no_course", subjectKey: need.subjectKey });
      continue;
    }
    const n = need.programIds.length;
    const total = targets.length;
    const reason = need.required
      ? { en: `Needed by ${n} of your ${total} target programmes, including ${names(need.programIds, "en")}.`, ar: `مطلوبة في ${n} من ${total} برنامجًا مستهدفًا، منها ${names(need.programIds, "ar")}.` }
      : { en: `Recommended by ${n} of your target programmes, including ${names(need.programIds, "en")}.`, ar: `موصى بها في ${n} من برامجك المستهدفة، منها ${names(need.programIds, "ar")}.` };
    let ok = false;
    for (const { c } of options) {
      if (placeWithPrereqs(c, need.required ? "requirement" : "recommended", reason, need.programIds) !== null) {
        ok = true;
        break;
      }
    }
    if (!ok) warnings.push({ code: "no_room", subjectKey: need.subjectKey });
  }

  // 3. Core courses in every planned year.
  const demand = new Map(needs.map((n) => [n.subjectKey, n.weight]));
  const coreReason = { en: "Core course for your diploma.", ar: "مادة أساسية لشهادتك." };
  for (let g = startGrade; g <= LAST_GRADE; g++) {
    for (const key of CORE_SUBJECTS[profile.curriculum] ?? []) {
      const inGrade = (x: Placed) => x.gradeLevel === g && (x.course?.mappings.some((m) => m.subjectKey === key) || profile.courses.some((c) => c.courseId === x.courseId && c.mappings.some((m) => m.subjectKey === key)));
      if (placed.some(inGrade)) continue;
      const priorOk = (c: CatalogCourse) => prerequisitesOf(c.code).every((group) => group.some((code) => gradeOf(code).some((x) => x < g)) || !group.some((code) => catalogByCode.has(code)));
      const options = catalog
        .filter((c) => c.gradeLevels.includes(g) && c.mappings.some((m) => m.subjectKey === key) && (REPEATABLE_SUBJECTS.has(key) || !has(c)) && priorOk(c))
        .map((c) => ({ c, score: c.mappings.reduce((s, m) => s + (demand.get(m.subjectKey) ?? 0), 0), rigor: Math.max(...c.mappings.map((m) => m.rigor)) }))
        .sort((a, b) => b.score - a.score || a.rigor - b.rigor || (a.c.code < b.c.code ? -1 : 1));
      if (options.length && countIn(g) < MAX_COURSES_PER_GRADE) place(options[0].c, 0, "core", coreReason, [], false, g);
    }
  }

  const items = placed.filter((p) => p.item).map((p) => p.item!);
  items.sort((a, b) => a.gradeLevel - b.gradeLevel || (a.code < b.code ? -1 : 1));
  return { targets: targets.map((t) => ({ id: t.p.id, weight: t.weight })), needs, items, warnings };
}
