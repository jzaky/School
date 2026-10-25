// Server layer for subject levels, elective impact and the worldwide summary. Reads through the
// tenant-scoped client, checks access with the engine actor and keeps small in-memory caches
// (catalog programmes for five minutes, results by input hash) so pages stay fast.
import { tenantTx } from "@/lib/tenant-db";
import { catalogScope } from "@/server/pathways/scope";
import { offeringsFor, registrationYear } from "@/server/registration/service";
import { assertView, type EngineActor } from "./access";
import { evaluate } from "./evaluate";
import { scaleFor } from "./grade-scales";
import { stableStringify, hashString } from "./hash";
import { buildLevelPlan, electiveImpact, familyOf, worldSummary, type ImpactOption, type LevelPlan, type OptionImpact, type WorldSummary } from "./levels";
import { getCurrentPlan, getGoal, loadPrograms, loadSchoolCatalog, loadStudentProfile, mappingsFor, targetProgramIds, type LoadedProgram, type ProgramMeta } from "./service";
import { ENGINE_VERSION, type CatalogCourse } from "./types";

// ---------------------------------------------------------------------------------------------
// Caches

const WORLD_TTL = 5 * 60_000;
const worldCache = new Map<string, { at: number; data: LoadedProgram[] }>();
const resultCache = new Map<string, { at: number; value: unknown }>();
const RESULT_TTL = 10 * 60_000;
const MAX_RESULTS = 300;

function cached<T>(key: string, make: () => T): T {
  const hit = resultCache.get(key);
  if (hit && Date.now() - hit.at < RESULT_TTL) return hit.value as T;
  const value = make();
  if (resultCache.size >= MAX_RESULTS) resultCache.delete(resultCache.keys().next().value as string);
  resultCache.set(key, { at: Date.now(), value });
  return value;
}

/** Every programme with current requirement rows that the school can see, with its rows. */
export async function worldPrograms(actor: EngineActor): Promise<LoadedProgram[]> {
  const hit = worldCache.get(actor.orgId);
  if (hit && Date.now() - hit.at < WORLD_TTL) return hit.data;
  const ids = (await actor.db.programRequirement.findMany({ where: { isCurrent: true, ...catalogScope(actor.orgId) }, select: { programId: true }, distinct: ["programId"] })).map((r) => r.programId);
  const data = (await loadPrograms(actor.db, actor.orgId, ids)).filter((p) => p.program.requirements.length > 0);
  if (worldCache.size > 20) worldCache.clear();
  worldCache.set(actor.orgId, { at: Date.now(), data });
  return data;
}

/** For tests and after catalog changes. */
export function clearLevelCaches() {
  worldCache.clear();
  resultCache.clear();
}

const fingerprint = (programs: LoadedProgram[]) => hashString(programs.map((p) => `${p.meta.id}:${p.program.requirements.map((r) => `${r.id}.${r.version}`).join(",")}`).join("|"));

// ---------------------------------------------------------------------------------------------
// Targets

export type TargetSource = "shortlist" | "goal" | "none";

/** The student's target programmes: their university list first, otherwise programmes that match their goal. */
export async function studentTargets(actor: EngineActor, studentId: string): Promise<{ ids: string[]; source: TargetSource }> {
  assertView(actor, studentId);
  const entries = await actor.db.shortlistEntry.findMany({ where: { orgId: actor.orgId, studentId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { programId: true, universityId: true, programEn: true } });
  // Older entries have no programme id: match them on university and programme name.
  const loose = entries.filter((e) => !e.programId);
  const found = loose.length ? await actor.db.universityProgram.findMany({ where: { ...catalogScope(actor.orgId), universityId: { in: [...new Set(loose.map((e) => e.universityId))] } }, select: { id: true, universityId: true, nameEn: true } }) : [];
  const ids = [...new Set(entries.map((e) => e.programId ?? found.find((p) => p.universityId === e.universityId && p.nameEn === e.programEn)?.id).filter((x): x is string => !!x))];
  if (ids.length) return { ids, source: "shortlist" };
  const goal = await getGoal(actor, studentId);
  if (!goal.careerKey && !goal.fieldKeys.length) return { ids: [], source: "none" };
  return { ids: await targetProgramIds(actor, { careerKey: goal.careerKey, fieldKeys: goal.fieldKeys, countries: goal.countries }, [], 8), source: "goal" };
}

// ---------------------------------------------------------------------------------------------
// Subject levels panel

export type CourseOffer = { code: string; nameEn: string; nameAr: string; gradeLevels: number[] };
export type SubjectLevels = {
  plan: LevelPlan;
  programs: ProgramMeta[];
  source: TargetSource;
  withPlan: boolean;
  /** School catalog courses by code, to say where Horizon offers a named course. */
  offers: Record<string, CourseOffer>;
  /** AP courses the school offers per canonical subject (advanced level), for unnamed lines. */
  advancedBySubject: Record<string, CourseOffer[]>;
  /** Names of named courses the school does not offer. */
  courseNames: Record<string, { nameEn: string; nameAr: string }>;
};

export async function subjectLevelsFor(actor: EngineActor, studentId: string): Promise<SubjectLevels> {
  assertView(actor, studentId);
  const plan = await getCurrentPlan(actor, studentId);
  const [loaded, targets] = await Promise.all([loadStudentProfile(actor, studentId, { planId: plan?.id ?? null }), studentTargets(actor, studentId)]);
  const [programs, catalog] = await Promise.all([loadPrograms(actor.db, actor.orgId, targets.ids), loadSchoolCatalog(actor.db, actor.orgId, loaded.student.curriculum)]);
  const levelPlan = buildLevelPlan(loaded.profile, programs.map((p) => p.program));
  const offers: Record<string, CourseOffer> = {};
  const advancedBySubject: Record<string, CourseOffer[]> = {};
  for (const c of catalog) {
    const offer = { code: c.code, nameEn: c.nameEn, nameAr: c.nameAr, gradeLevels: c.gradeLevels };
    offers[c.code] = offer;
    for (const m of c.mappings) if (m.level === "ADVANCED" || m.level === "HIGHER") (advancedBySubject[m.subjectKey] ??= []).push(offer);
  }
  const missing = [...new Set(levelPlan.rows.flatMap((r) => [r.course, ...r.entries.flatMap((e) => e.apCourses)]).filter((c): c is string => !!c && !offers[c]))];
  const courseNames: SubjectLevels["courseNames"] = {};
  if (missing.length) for (const c of await actor.db.curriculumCourse.findMany({ where: { orgId: null, code: { in: missing } }, select: { code: true, nameEn: true, nameAr: true } })) courseNames[c.code] = { nameEn: c.nameEn, nameAr: c.nameAr };
  return { plan: levelPlan, programs: programs.map((p) => p.meta), source: targets.source, withPlan: !!plan, offers, advancedBySubject, courseNames };
}

// ---------------------------------------------------------------------------------------------
// Worldwide summary

export async function worldwideFor(actor: EngineActor, studentId: string): Promise<WorldSummary & { withPlan: boolean }> {
  assertView(actor, studentId);
  const plan = await getCurrentPlan(actor, studentId);
  const loaded = await loadStudentProfile(actor, studentId, { planId: plan?.id ?? null });
  const world = await worldPrograms(actor);
  const key = `world|${ENGINE_VERSION}|${actor.orgId}|${loaded.hash}|${fingerprint(world)}`;
  const summary = cached(key, () =>
    worldSummary(world.map((p) => {
      const r = evaluate(loaded.profile, p.program);
      return { programId: p.meta.id, universityId: p.meta.university.id, countryCode: p.meta.university.countryCode, status: r.status, covered: r.covered };
    })),
  );
  return { ...summary, withPlan: !!plan };
}

// ---------------------------------------------------------------------------------------------
// Elective impact

export type ElectiveImpact = {
  /** Option impact by offering subject id. */
  options: Record<string, OptionImpact>;
  targetIds: string[];
  targetSource: TargetSource;
  /** How many programmes the impact was checked against. */
  checked: number;
  /** Names for the programmes the options mention. */
  programs: Record<string, { nameEn: string; nameAr: string; universityEn: string; universityAr: string; countryCode: string }>;
  /** The subject family of each linked option (physics, mathematics...), to pair AP and regular versions. */
  families: Record<string, string>;
};

/**
 * University impact of each elective in the student's picker for a year: needed for N of their
 * targets and how many programmes in the catalog it keeps open. chosen: the subject ids picked now.
 */
export async function electiveImpactFor(actor: EngineActor, studentId: string, input: { yearId?: string | null; chosen: string[] }): Promise<ElectiveImpact | null> {
  assertView(actor, studentId);
  const student = await actor.db.student.findFirst({ where: { id: studentId, orgId: actor.orgId }, select: { id: true, gradeLevel: true, curriculum: true } });
  if (!student) return null;
  const setup = await tenantTx(actor.orgId, async (tx) => {
    const target = await registrationYear(tx, actor.orgId, input.yearId);
    if (!target) return null;
    const offerings = await offeringsFor(tx, actor.orgId, target.year.id, student.gradeLevel + target.gradeOffset, student.curriculum);
    return { grade: student.gradeLevel + target.gradeOffset, offerings: offerings.filter((o) => o.kind === "OPTION") };
  });
  if (!setup || setup.offerings.length === 0) return null;
  const courseIds = [...new Set(setup.offerings.map((o) => o.courseId).filter((x): x is string => !!x))];
  if (courseIds.length === 0) return null;
  const [loaded, targets, world, courses, maps] = await Promise.all([
    loadStudentProfile(actor, studentId),
    studentTargets(actor, studentId),
    worldPrograms(actor),
    actor.db.curriculumCourse.findMany({ where: { id: { in: courseIds } } }),
    mappingsFor(actor.db, actor.orgId, courseIds),
  ]);
  const byId = new Map(courses.map((c) => [c.id, c]));
  const options: ImpactOption[] = setup.offerings.map((o) => {
    const c = o.courseId ? byId.get(o.courseId) : undefined;
    const course: CatalogCourse | null = c
      ? { id: o.subjectId, courseId: c.id, code: c.code, nameEn: c.nameEn, nameAr: c.nameAr, gradeLevels: [setup.grade], gradeScale: c.gradeScale || scaleFor(c.curriculum, c.qualification), mappings: maps.get(c.id) ?? [] }
      : null;
    return { key: o.subjectId, block: o.optionBlock ?? "A", course, gradeLevel: setup.grade };
  });
  const offered = new Set(options.map((o) => o.key));
  const chosen: Record<string, string> = {};
  for (const o of options) if (input.chosen.includes(o.key) && offered.has(o.key)) chosen[o.block] = o.key;
  const key = `impact|${ENGINE_VERSION}|${actor.orgId}|${studentId}|${loaded.hash}|${fingerprint(world)}|${hashString(stableStringify([options.map((o) => [o.key, o.block, o.course?.courseId ?? null, o.course?.mappings ?? []]), chosen, targets.ids]))}`;
  const result = cached(key, () => electiveImpact(loaded.profile, world.map((p) => p.program), new Set(targets.ids), options, chosen));
  const mentioned = new Set(Object.values(result).flatMap((r) => [...r.targets, ...r.programs.slice(0, 6)]));
  for (const id of targets.ids) mentioned.add(id);
  const programs: ElectiveImpact["programs"] = {};
  for (const p of world) {
    if (!mentioned.has(p.meta.id)) continue;
    programs[p.meta.id] = { nameEn: p.meta.nameEn, nameAr: p.meta.nameAr, universityEn: p.meta.university.nameEn, universityAr: p.meta.university.nameAr, countryCode: p.meta.university.countryCode };
  }
  const families: Record<string, string> = {};
  for (const o of options) {
    const main = o.course?.mappings.slice().sort((a, b) => b.rigor - a.rigor || (a.subjectKey < b.subjectKey ? -1 : 1))[0];
    if (main) families[o.key] = familyOf([main.subjectKey]);
  }
  return { options: result, targetIds: targets.ids, targetSource: targets.source, checked: world.length, programs, families };
}
