// Global reference catalog: canonical subjects, fields of study, career links, curriculum courses,
// universities, programmes, intakes and versioned entry requirements (orgId null).
// Runs as the owner role. Idempotent and fast on re-runs: everything is read in a few queries,
// compared in memory, and only differences are written. Safe on every deploy.
//
// Requirement rows are versioned: when the seeded example for a programme and curriculum changes,
// a new version is created and the old one closed. Rows a person has VERIFIED or REVIEWED are never
// replaced by seed data.
import { Prisma as PrismaNS, type Prisma, type PrismaClient } from "@prisma/client";
import { stableStringify } from "@/server/pathway-engine/hash";
import { importInstitutions } from "@/server/pathways/scorecard";
import { snapshotInstitutions, universityStore } from "@/server/pathways/us-data";
import { id } from "../lib";
import { CANONICAL_SUBJECTS } from "./subjects";
import { CAREER_FIELDS, FIELDS_OF_STUDY } from "./fields";
import { CURRICULUM_COURSES } from "./courses";
import { GLOBAL_UNIVERSITIES } from "./universities";
import { buildPrograms } from "./programs";
import { indexOfficial, seedOfficialRequirements } from "./official";
import { OFFICIAL_BATCHES } from "./official/index";

type Tx = Prisma.TransactionClient;
export type CatalogCounts = Record<string, { created: number; updated: number }>;

const eq = (a: unknown, b: unknown) => stableStringify(a) === stableStringify(b);
const bump = (c: CatalogCounts, k: string, f: "created" | "updated", n = 1) => {
  c[k] ??= { created: 0, updated: 0 };
  c[k][f] += n;
};

/** Intake years a catalog shows: the next two, relative to now (a cycle opens in September). */
export function intakeYears(now = new Date()): [number, number] {
  const y = now.getUTCMonth() >= 8 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
  return [y, y + 1];
}

export async function seedGlobalCatalog(db: PrismaClient, opts: { now?: Date; log?: (m: string) => void } = {}) {
  const now = opts.now ?? new Date();
  const log = opts.log ?? (() => undefined);
  const started = Date.now();
  const counts: CatalogCounts = {};
  await db.$transaction(
    async (tx) => {
      // One writer at a time (deploys, resets and tests may start together).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(424243)`;
      await seedSubjects(tx, counts);
      await seedFields(tx, counts);
      await seedCourses(tx, counts);
      await seedUniversitiesAndPrograms(tx, counts, now);
    },
    { timeout: 240_000, maxWait: 120_000 },
  );
  // US institutions from the committed College Scorecard snapshot, when one exists.
  const us = snapshotInstitutions();
  if (us.length) {
    const c = await importInstitutions(universityStore(db, null), us);
    log(`catalog: US snapshot ${c.created} created, ${c.updated} updated`);
  }
  const changed = Object.entries(counts).filter(([, v]) => v.created || v.updated);
  log(`catalog: ${changed.length ? changed.map(([k, v]) => `${k} +${v.created}/~${v.updated}`).join(", ") : "unchanged"} in ${Date.now() - started}ms`);
  return { counts, ms: Date.now() - started };
}

async function seedSubjects(tx: Tx, counts: CatalogCounts) {
  const existing = new Map((await tx.canonicalSubject.findMany()).map((s) => [s.key, s]));
  const create: Prisma.CanonicalSubjectCreateManyInput[] = [];
  for (const [i, s] of CANONICAL_SUBJECTS.entries()) {
    const data = { nameEn: s.en, nameAr: s.ar, category: s.category, parentKey: s.parent ?? null, sortOrder: i };
    const e = existing.get(s.key);
    if (!e) create.push({ key: s.key, ...data });
    else if (!eq({ nameEn: e.nameEn, nameAr: e.nameAr, category: e.category, parentKey: e.parentKey, sortOrder: e.sortOrder }, data)) {
      await tx.canonicalSubject.update({ where: { key: s.key }, data });
      bump(counts, "subjects", "updated");
    }
  }
  if (create.length) bump(counts, "subjects", "created", (await tx.canonicalSubject.createMany({ data: create, skipDuplicates: true })).count);
}

async function seedFields(tx: Tx, counts: CatalogCounts) {
  const existing = new Map((await tx.fieldOfStudy.findMany()).map((s) => [s.key, s]));
  const create: Prisma.FieldOfStudyCreateManyInput[] = [];
  for (const [i, f] of FIELDS_OF_STUDY.entries()) {
    const data = { nameEn: f.en, nameAr: f.ar, cipCodes: f.cip, related: f.related, sortOrder: i };
    const e = existing.get(f.key);
    if (!e) create.push({ key: f.key, ...data });
    else if (!eq({ nameEn: e.nameEn, nameAr: e.nameAr, cipCodes: e.cipCodes, related: e.related, sortOrder: e.sortOrder }, data)) {
      await tx.fieldOfStudy.update({ where: { key: f.key }, data });
      bump(counts, "fields", "updated");
    }
  }
  if (create.length) bump(counts, "fields", "created", (await tx.fieldOfStudy.createMany({ data: create, skipDuplicates: true })).count);

  const links = new Map((await tx.careerField.findMany()).map((l) => [`${l.careerKey}|${l.fieldKey}`, l]));
  const wanted = new Set<string>();
  const createLinks: Prisma.CareerFieldCreateManyInput[] = [];
  for (const [careerKey, list] of Object.entries(CAREER_FIELDS)) {
    for (const [fieldKey, weight] of list) {
      const k = `${careerKey}|${fieldKey}`;
      wanted.add(k);
      const e = links.get(k);
      if (!e) createLinks.push({ careerKey, fieldKey, weight });
      else if (e.weight !== weight) {
        await tx.careerField.update({ where: { id: e.id }, data: { weight } });
        bump(counts, "careerFields", "updated");
      }
    }
  }
  if (createLinks.length) bump(counts, "careerFields", "created", (await tx.careerField.createMany({ data: createLinks, skipDuplicates: true })).count);
  const stale = [...links.entries()].filter(([k]) => !wanted.has(k)).map(([, l]) => l.id);
  if (stale.length) await tx.careerField.deleteMany({ where: { id: { in: stale } } });
}

async function seedCourses(tx: Tx, counts: CatalogCounts) {
  const rows = await tx.curriculumCourse.findMany({ where: { orgId: null }, include: { mappings: { where: { orgId: null } } } });
  const byKey = new Map(rows.map((r) => [`${r.curriculum}|${r.code}`, r]));
  const createCourses: Prisma.CurriculumCourseCreateManyInput[] = [];
  const createMaps: Prisma.CurriculumCourseMappingCreateManyInput[] = [];
  for (const c of CURRICULUM_COURSES) {
    const data = { nameEn: c.en, nameAr: c.ar, qualification: c.qualification, gradeLevel: c.gradeLevel, gradeScale: c.gradeScale };
    const e = byKey.get(`${c.curriculum}|${c.code}`);
    if (!e) {
      const cid = id();
      createCourses.push({ id: cid, orgId: null, curriculum: c.curriculum, code: c.code, ...data });
      for (const m of c.mappings) createMaps.push({ orgId: null, courseId: cid, canonicalSubjectKey: m.key, level: m.level, rigorScore: m.rigor, confidence: 1 });
      continue;
    }
    if (!eq({ nameEn: e.nameEn, nameAr: e.nameAr, qualification: e.qualification, gradeLevel: e.gradeLevel, gradeScale: e.gradeScale }, data)) {
      await tx.curriculumCourse.update({ where: { id: e.id }, data });
      bump(counts, "courses", "updated");
    }
    const maps = new Map(e.mappings.map((m) => [m.canonicalSubjectKey, m]));
    for (const m of c.mappings) {
      const em = maps.get(m.key);
      if (!em) createMaps.push({ orgId: null, courseId: e.id, canonicalSubjectKey: m.key, level: m.level, rigorScore: m.rigor, confidence: 1 });
      else if (em.level !== m.level || em.rigorScore !== m.rigor) {
        await tx.curriculumCourseMapping.update({ where: { id: em.id }, data: { level: m.level, rigorScore: m.rigor } });
        bump(counts, "mappings", "updated");
      }
      maps.delete(m.key);
    }
    if (maps.size) await tx.curriculumCourseMapping.deleteMany({ where: { id: { in: [...maps.values()].map((m) => m.id) } } });
  }
  if (createCourses.length) bump(counts, "courses", "created", (await tx.curriculumCourse.createMany({ data: createCourses })).count);
  if (createMaps.length) bump(counts, "mappings", "created", (await tx.curriculumCourseMapping.createMany({ data: createMaps })).count);
}

async function seedUniversitiesAndPrograms(tx: Tx, counts: CatalogCounts, now: Date) {
  // Programme names, awards, lengths and pages come from the official research where it exists;
  // programmes a university does not offer are removed.
  const official = indexOfficial(OFFICIAL_BATCHES);
  const dropped = new Set<string>();
  const programs = buildPrograms().flatMap((p) => {
    const o = official.programs.get(p.key)?.program;
    if (!o) return [p];
    if (o.status === "DROP") {
      dropped.add(p.key);
      return [];
    }
    return [{ ...p, name: { en: o.nameEn ?? p.name.en, ar: o.nameAr ?? p.name.ar }, degree: o.degree ?? p.degree, durationYears: o.durationYears ?? p.durationYears, sourceUrl: o.url ?? p.sourceUrl }];
  });
  const namesByUni = new Map<string, string[]>();
  for (const p of programs) namesByUni.set(p.uni, [...(namesByUni.get(p.uni) ?? []), p.name.en]);

  // Universities
  const unis = new Map((await tx.university.findMany({ where: { orgId: null } })).map((u) => [u.key, u]));
  const createUnis: Prisma.UniversityCreateManyInput[] = [];
  for (const u of GLOBAL_UNIVERSITIES) {
    const programsEn = [...new Set([...u.programs, ...(namesByUni.get(u.key) ?? [])])];
    const data = {
      nameEn: u.name.en,
      nameAr: u.name.ar,
      countryCode: u.countryCode,
      cityEn: u.city.en,
      cityAr: u.city.ar,
      worldRank: u.worldRank,
      acceptanceRate: u.acceptanceRate,
      minAverage: u.minAverage,
      programsEn,
      website: u.website,
      deadlineMonth: u.deadlineMonth,
      system: u.system,
      applyVia: u.applyVia,
      nameSearch: `${u.name.en} ${u.name.ar} ${u.city.en}`.toLowerCase(),
      flagCode: u.countryCode,
    };
    const e = unis.get(u.key);
    if (!e) {
      const uid = id();
      createUnis.push({ id: uid, orgId: null, key: u.key, ...data });
      unis.set(u.key, { id: uid } as never);
    } else if (!eq(Object.fromEntries(Object.keys(data).map((k) => [k, (e as Record<string, unknown>)[k]])), data)) {
      await tx.university.update({ where: { id: e.id }, data });
      bump(counts, "universities", "updated");
    }
  }
  if (createUnis.length) bump(counts, "universities", "created", (await tx.university.createMany({ data: createUnis })).count);
  const uniMeta = new Map(GLOBAL_UNIVERSITIES.map((u) => [u.key, u]));

  // Programmes
  const existingPrograms = new Map((await tx.universityProgram.findMany({ where: { orgId: null } })).map((p) => [p.key, p]));
  const createPrograms: Prisma.UniversityProgramCreateManyInput[] = [];
  const programId = new Map<string, string>();
  for (const p of programs) {
    const u = uniMeta.get(p.uni)!;
    const universityId = unis.get(p.uni)!.id;
    // The older requirement fields held example data; requirements now live in ProgramRequirement rows only.
    const legacy = { requiredSubjects: [] as string[], recommendedSubjects: [] as string[], requirements: {} as Record<string, unknown>, englishReq: null as Prisma.InputJsonValue | null };
    const data = {
      universityId,
      nameEn: p.name.en,
      nameAr: p.name.ar,
      field: p.field,
      degree: p.degree,
      durationYears: p.durationYears,
      requiredSubjects: legacy.requiredSubjects,
      recommendedSubjects: legacy.recommendedSubjects,
      requirements: legacy.requirements,
      englishReq: legacy.englishReq,
      notesEn: p.notes?.en ?? null,
      notesAr: p.notes?.ar ?? null,
      sourceUrl: p.sourceUrl,
      indicative: !official.programs.has(p.key),
      degreeType: p.degreeType,
      level: "UNDERGRADUATE",
      fieldKeys: p.fieldKeys,
      tuitionPerYear: p.tuitionPerYear,
      tuitionCurrency: p.tuitionCurrency,
      teachingLanguage: p.teachingLanguage,
      searchText: [p.name.en, p.name.ar, u.name.en, u.name.ar, u.city.en, u.city.ar, u.countryCode, p.degree, ...p.fieldKeys].join(" ").toLowerCase(),
    };
    const e = existingPrograms.get(p.key);
    if (!e) {
      const pid = id();
      createPrograms.push({ id: pid, orgId: null, key: p.key, ...data, requirements: data.requirements as Prisma.InputJsonValue, englishReq: (data.englishReq ?? undefined) as Prisma.InputJsonValue | undefined });
      programId.set(p.key, pid);
    } else {
      programId.set(p.key, e.id);
      const cur = Object.fromEntries(Object.keys(data).map((k) => [k, (e as Record<string, unknown>)[k]]));
      if (!eq(cur, data)) {
        await tx.universityProgram.update({ where: { id: e.id }, data: { ...data, requirements: data.requirements as Prisma.InputJsonValue, englishReq: data.englishReq === null ? PrismaNS.DbNull : (data.englishReq as Prisma.InputJsonValue) } });
        bump(counts, "programs", "updated");
      }
    }
  }
  if (createPrograms.length) bump(counts, "programs", "created", (await tx.universityProgram.createMany({ data: createPrograms })).count);
  const ids = [...programId.values()];

  // Intakes: the next two years are current.
  const years = intakeYears(now);
  const intakes = await tx.programIntake.findMany({ where: { orgId: null, programId: { in: ids } } });
  const have = new Set(intakes.map((i) => `${i.programId}|${i.intakeYear}`));
  const createIntakes: Prisma.ProgramIntakeCreateManyInput[] = [];
  for (const pid of ids)
    for (const y of years) if (!have.has(`${pid}|${y}`)) createIntakes.push({ orgId: null, programId: pid, intakeYear: y, cycleLabel: `${y}/${String((y + 1) % 100).padStart(2, "0")}`, applicationOpens: new Date(Date.UTC(y - 1, 8, 1)), isCurrent: true });
  if (createIntakes.length) bump(counts, "intakes", "created", (await tx.programIntake.createMany({ data: createIntakes, skipDuplicates: true })).count);
  const old = intakes.filter((i) => i.isCurrent && i.intakeYear < years[0]).map((i) => i.id);
  if (old.length) await tx.programIntake.updateMany({ where: { id: { in: old } }, data: { isCurrent: false } });

  // Programmes the research showed a university does not offer.
  if (dropped.size) {
    const gone = await tx.universityProgram.findMany({ where: { orgId: null, key: { in: [...dropped] } }, select: { id: true } });
    const goneIds = gone.map((g) => g.id);
    if (goneIds.length) {
      await tx.programRequirement.deleteMany({ where: { programId: { in: goneIds } } });
      await tx.requirementSource.deleteMany({ where: { programId: { in: goneIds } } });
      await tx.programIntake.deleteMany({ where: { programId: { in: goneIds } } });
      await tx.applicationDeadline.deleteMany({ where: { programId: { in: goneIds } } });
      await tx.requirementMatch.deleteMany({ where: { programId: { in: goneIds } } });
      await tx.shortlistEntry.updateMany({ where: { programId: { in: goneIds } }, data: { programId: null } });
      await tx.application.updateMany({ where: { programId: { in: goneIds } }, data: { programId: null } });
      for (const g of goneIds) await tx.$executeRaw`UPDATE "StudentCoursePlan" SET "targetProgramIds" = array_remove("targetProgramIds", ${g})`;
      await tx.universityProgram.deleteMany({ where: { id: { in: goneIds } } });
      bump(counts, "programs", "updated", goneIds.length);
    }
  }
  // Official requirements, sources, deadlines and real changes.
  const universityIdByKey = new Map([...unis.entries()].map(([k, v]) => [k, v.id]));
  const countryByUniversity = new Map(GLOBAL_UNIVERSITIES.map((u) => [u.key, u.countryCode]));
  const r = await seedOfficialRequirements(tx, { batches: OFFICIAL_BATCHES, programIdByKey: programId, universityIdByKey, countryByUniversity, intakeYear: years[0], now });
  if (r.rows || r.removedExample) bump(counts, "requirements", "created", r.rows);
  if (r.changes) bump(counts, "changes", "created", r.changes);
  if (r.deadlines) bump(counts, "deadlines", "created", r.deadlines);
}
