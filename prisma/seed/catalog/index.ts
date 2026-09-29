// Global reference catalog: canonical subjects, fields of study, career links, curriculum courses,
// universities, programmes, intakes and versioned entry requirements (orgId null).
// Runs as the owner role. Idempotent and fast on re-runs: everything is read in a few queries,
// compared in memory, and only differences are written. Safe on every deploy.
//
// Requirement rows are versioned: when the seeded example for a programme and curriculum changes,
// a new version is created and the old one closed. Rows a person has VERIFIED or REVIEWED are never
// replaced by seed data.
import type { Prisma, PrismaClient, SchoolCurriculum } from "@prisma/client";
import { stableStringify } from "@/server/pathway-engine/hash";
import { importInstitutions } from "@/server/pathways/scorecard";
import { snapshotInstitutions, universityStore } from "@/server/pathways/us-data";
import { id } from "../lib";
import { CANONICAL_SUBJECTS } from "./subjects";
import { CAREER_FIELDS, FIELDS_OF_STUDY } from "./fields";
import { CURRICULUM_COURSES } from "./courses";
import { GLOBAL_UNIVERSITIES } from "./universities";
import { buildPrograms, legacyFields, type RowSeed } from "./programs";

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

/** Canonical form of a requirement row and its lines, for change detection. */
function rowFingerprint(r: {
  curriculum: SchoolCurriculum | null;
  minimumGPA: number | null;
  minimumPercent: number | null;
  minimumPoints: number | null;
  gradeProfile: string | null;
  stream: string | null;
  notesEn: string | null;
  notesAr: string | null;
  evidenceLocator: string | null;
  subjects: Array<{ type: string; canonicalSubjectKeys?: string[]; keys?: string[]; minimumLevel: string | null; minimumGrade: string | null; noteEn?: string | null; noteAr?: string | null }>;
  languages: Array<{ test: string; minOverall: number; minComponent: number | null; waiverNoteEn: string | null }>;
  tests: Array<{ test: string; policy: string; minScore: number | null; noteEn: string | null }>;
  additional: Array<{ kind: string; required: boolean; noteEn: string | null; noteAr: string | null }>;
}) {
  const sorted = <T>(xs: T[]) => xs.map((x) => stableStringify(x)).sort();
  return stableStringify({
    c: r.curriculum,
    g: r.minimumGPA,
    p: r.minimumPercent,
    pt: r.minimumPoints,
    gp: r.gradeProfile,
    s: r.stream,
    ne: r.notesEn,
    na: r.notesAr,
    l: r.evidenceLocator,
    subjects: sorted(r.subjects.map((s) => ({ t: s.type, k: s.canonicalSubjectKeys ?? s.keys, lv: s.minimumLevel, gr: s.minimumGrade, ne: s.noteEn ?? null, na: s.noteAr ?? null }))),
    languages: sorted(r.languages.map((l) => ({ t: l.test, o: l.minOverall, c: l.minComponent, w: l.waiverNoteEn }))),
    tests: sorted(r.tests.map((t) => ({ t: t.test, p: t.policy, m: t.minScore, n: t.noteEn }))),
    additional: sorted(r.additional.map((a) => ({ k: a.kind, r: a.required, ne: a.noteEn, na: a.noteAr }))),
  });
}

async function seedUniversitiesAndPrograms(tx: Tx, counts: CatalogCounts, now: Date) {
  const programs = buildPrograms();
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
    const legacy = legacyFields(p, u);
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
      indicative: true,
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
        await tx.universityProgram.update({ where: { id: e.id }, data: { ...data, requirements: data.requirements as Prisma.InputJsonValue, englishReq: (data.englishReq ?? undefined) as Prisma.InputJsonValue | undefined } });
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

  // Sources: one official page per programme. (Earlier seeds used another sourceType name.)
  await tx.requirementSource.updateMany({ where: { orgId: null, sourceType: "OFFICIAL_ADMISSIONS" }, data: { sourceType: "OFFICIAL_UNIVERSITY" } });
  const sources = await tx.requirementSource.findMany({ where: { orgId: null, programId: { in: ids } } });
  const sourceBy = new Map(sources.map((s) => [`${s.programId}|${s.url}`, s.id]));
  const createSources: Prisma.RequirementSourceCreateManyInput[] = [];
  for (const p of programs) {
    const pid = programId.get(p.key)!;
    const k = `${pid}|${p.sourceUrl}`;
    if (!sourceBy.has(k)) {
      const sid = id();
      createSources.push({ id: sid, orgId: null, universityId: unis.get(p.uni)!.id, programId: pid, url: p.sourceUrl, title: `${p.name.en}: entry requirements`, sourceType: "OFFICIAL_UNIVERSITY", status: "PENDING" });
      sourceBy.set(k, sid);
    }
  }
  if (createSources.length) bump(counts, "sources", "created", (await tx.requirementSource.createMany({ data: createSources })).count);

  // Requirement rows, versioned.
  const current = await tx.programRequirement.findMany({ where: { orgId: null, programId: { in: ids }, isCurrent: true }, include: { subjects: true, languages: true, tests: true, additional: true } });
  const curBy = new Map(current.map((r) => [`${r.programId}|${r.curriculum ?? "GENERAL"}`, r]));
  const newRows: Prisma.ProgramRequirementCreateManyInput[] = [];
  const subj: Prisma.SubjectRequirementCreateManyInput[] = [];
  const langs: Prisma.LanguageRequirementCreateManyInput[] = [];
  const tests: Prisma.TestRequirementCreateManyInput[] = [];
  const adds: Prisma.AdditionalRequirementCreateManyInput[] = [];
  const close: string[] = [];
  const wanted = new Set<string>();
  const addRow = (pid: string, r: RowSeed, version: number, sourceId: string | null) => {
    const rid = id();
    newRows.push({
      id: rid,
      orgId: null,
      programId: pid,
      intakeYear: years[0],
      curriculum: r.curriculum,
      version,
      isCurrent: true,
      effectiveFrom: now,
      confidence: "EXAMPLE",
      sourceId,
      minimumGPA: r.minimumGPA,
      minimumPercent: r.minimumPercent,
      minimumPoints: r.minimumPoints,
      gradeProfile: r.gradeProfile,
      stream: r.stream,
      notesEn: r.notesEn,
      notesAr: r.notesAr,
      evidenceLocator: r.evidenceLocator,
    });
    for (const s of r.subjects) subj.push({ orgId: null, programRequirementId: rid, type: s.type, canonicalSubjectKeys: s.keys, minimumLevel: s.minimumLevel, minimumGrade: s.minimumGrade, alternatives: [], noteEn: s.noteEn ?? null, noteAr: s.noteAr ?? null });
    for (const l of r.languages) langs.push({ orgId: null, programRequirementId: rid, test: l.test, minOverall: l.minOverall, minComponent: l.minComponent, waiverNoteEn: l.waiverNoteEn });
    for (const t of r.tests) tests.push({ orgId: null, programRequirementId: rid, test: t.test, policy: t.policy, minScore: t.minScore, noteEn: t.noteEn });
    for (const a of r.additional) adds.push({ orgId: null, programRequirementId: rid, kind: a.kind, required: a.required, noteEn: a.noteEn, noteAr: a.noteAr });
  };
  for (const p of programs) {
    const pid = programId.get(p.key)!;
    const sourceId = sourceBy.get(`${pid}|${p.sourceUrl}`) ?? null;
    for (const r of p.rows) {
      const k = `${pid}|${r.curriculum ?? "GENERAL"}`;
      wanted.add(k);
      const e = curBy.get(k);
      if (!e) {
        addRow(pid, r, 1, sourceId);
        continue;
      }
      if (e.confidence !== "EXAMPLE") continue; // A person checked this one: keep it.
      if (rowFingerprint(e) === rowFingerprint(r)) continue;
      close.push(e.id);
      addRow(pid, r, e.version + 1, sourceId);
    }
  }
  // Seeded example rows for curricula the catalog no longer lists are closed.
  for (const [k, e] of curBy) if (!wanted.has(k) && e.confidence === "EXAMPLE") close.push(e.id);
  if (close.length) {
    await tx.programRequirement.updateMany({ where: { id: { in: close } }, data: { isCurrent: false, effectiveTo: now } });
    bump(counts, "requirements", "updated", close.length);
  }
  if (newRows.length) {
    bump(counts, "requirements", "created", (await tx.programRequirement.createMany({ data: newRows })).count);
    if (subj.length) await tx.subjectRequirement.createMany({ data: subj });
    if (langs.length) await tx.languageRequirement.createMany({ data: langs });
    if (tests.length) await tx.testRequirement.createMany({ data: tests });
    if (adds.length) await tx.additionalRequirement.createMany({ data: adds });
  }
}
