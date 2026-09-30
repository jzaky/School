// Official entry requirements: loaded from prisma/seed/catalog/official/*.json, which
// scripts/research/assemble.mjs writes from research that passed the quote validator (every value is
// backed by a verbatim quote from the university's official page, checked against the fetched text).
//
// Rows get confidence OFFICIAL. Each line keeps its quote and its own source page. Where an archived
// copy of the page from about a year earlier showed different requirements, that earlier version is
// stored too and the difference becomes a real RequirementChange for the change monitor.
// Programmes without official data have no requirement rows at all (nothing is invented).
import type { Prisma, SchoolCurriculum } from "@prisma/client";
import { diffGroups, changeId } from "@/server/catalog-pipeline/diff";
import { groupFromVersion } from "@/server/catalog-pipeline/publish";
import { id } from "../lib";

type Tx = Prisma.TransactionClient;

export type OfficialSource = { id: string; url: string; title?: string; retrievedAt?: string; hash?: string | null; via?: string | null; waybackTimestamp?: string | null };
type Quoted = { source?: string; quote?: string; wayback?: boolean };
export type OSubject = Quoted & { type: string; keys: string[]; minimumLevel?: string | null; minimumGrade?: string | null; noteEn?: string | null; noteAr?: string | null };
export type OEnglish = Quoted & { test: string; minOverall: number; minComponent?: number | null; waiverNoteEn?: string | null };
export type OTest = Quoted & { test: string; policy: string; minScore?: number | null; noteEn?: string | null };
export type OAdditional = Quoted & { kind: string; required?: boolean; noteEn: string; noteAr?: string | null };
export type ORow = Quoted & {
  accepted?: boolean;
  gradeProfile?: string | null;
  minimumPoints?: number | null;
  minimumPercent?: number | null;
  minimumGPA?: number | null;
  stream?: string | null;
  notesEn?: string | null;
  notesAr?: string | null;
  subjects?: OSubject[];
};
export type OGeneral = { subjects?: OSubject[]; english?: OEnglish[]; tests?: OTest[]; additional?: OAdditional[]; source?: string };
export type OProgram = {
  key: string;
  status: "EXISTS" | "REPLACED" | "DROP" | string;
  nameEn?: string;
  nameAr?: string;
  degree?: string | null;
  durationYears?: number | null;
  url?: string | null;
  curricula?: Record<string, ORow>;
  general?: OGeneral | null;
  previous?: { asOf: string; curricula?: Record<string, ORow>; general?: OGeneral | null } | null;
};
export type ODeadline = Quoted & { intakeYear: number; kind: string; date: string; labelEn?: string; labelAr?: string };
export type OUniversity = {
  key: string;
  website?: string;
  applyVia?: string;
  sources?: OfficialSource[];
  english?: OEnglish[];
  tests?: OTest[];
  additional?: OAdditional[];
  deadlines?: ODeadline[];
  curriculumRules?: Record<string, ORow>;
  programs?: OProgram[];
};
export type OfficialBatch = { batch: string; assembledAt?: string; universities: OUniversity[] };

const CURRICULA: SchoolCurriculum[] = ["BRITISH", "IB", "AMERICAN", "UAE_MOE", "JORDAN_TAWJIHI", "CBSE", "ISC", "SABIS"];

/** Everything the loader needs, indexed by key. */
export function indexOfficial(batches: OfficialBatch[]) {
  const unis = new Map<string, OUniversity>();
  const programs = new Map<string, { uni: OUniversity; program: OProgram }>();
  for (const b of batches)
    for (const u of b.universities ?? []) {
      unis.set(u.key, u);
      for (const p of u.programs ?? []) programs.set(p.key, { uni: u, program: p });
    }
  return { unis, programs };
}

type LineSrc = { sourceId: string | null; evidenceQuote: string | null };
type BuiltRow = {
  curriculum: SchoolCurriculum | null;
  sourceId: string | null;
  evidenceLocator: string | null;
  minimumGPA: number | null;
  minimumPercent: number | null;
  minimumPoints: number | null;
  gradeProfile: string | null;
  stream: string | null;
  notesEn: string | null;
  notesAr: string | null;
  subjects: Array<LineSrc & { type: string; keys: string[]; minimumLevel: string | null; minimumGrade: string | null; noteEn: string | null; noteAr: string | null }>;
  languages: Array<LineSrc & { test: string; minOverall: number; minComponent: number | null; waiverNoteEn: string | null }>;
  tests: Array<LineSrc & { test: string; policy: string; minScore: number | null; noteEn: string | null }>;
  additional: Array<LineSrc & { kind: string; required: boolean; noteEn: string | null; noteAr: string | null }>;
};

function builder(sourceIdFor: (sid?: string) => string | null) {
  const src = (q: Quoted, fallback?: string) => ({ sourceId: sourceIdFor(q.source ?? fallback), evidenceQuote: q.quote ?? null });
  const subjects = (xs: OSubject[] | undefined, fb?: string) =>
    (xs ?? []).map((s) => ({ ...src(s, fb), type: s.type, keys: s.keys, minimumLevel: s.minimumLevel ?? null, minimumGrade: s.minimumGrade ?? null, noteEn: s.noteEn ?? null, noteAr: s.noteAr ?? s.noteEn ?? null }));
  const general = (g: OGeneral, fallbackSource?: string): BuiltRow => ({
    curriculum: null,
    sourceId: sourceIdFor(g.source ?? fallbackSource),
    evidenceLocator: null,
    minimumGPA: null,
    minimumPercent: null,
    minimumPoints: null,
    gradeProfile: null,
    stream: null,
    notesEn: null,
    notesAr: null,
    subjects: subjects(g.subjects, g.source),
    languages: (g.english ?? []).map((e) => ({ ...src(e), test: e.test, minOverall: e.minOverall, minComponent: e.minComponent ?? null, waiverNoteEn: e.waiverNoteEn ?? null })),
    tests: (g.tests ?? []).map((t) => ({ ...src(t), test: t.test, policy: t.policy, minScore: t.minScore ?? null, noteEn: t.noteEn ?? null })),
    additional: (g.additional ?? []).map((a) => ({ ...src(a), kind: a.kind, required: a.required !== false, noteEn: a.noteEn ?? null, noteAr: a.noteAr ?? a.noteEn ?? null })),
  });
  const curriculumRow = (c: SchoolCurriculum, r: ORow): BuiltRow => {
    const base: BuiltRow = {
      curriculum: c,
      sourceId: sourceIdFor(r.source),
      evidenceLocator: r.quote ?? null,
      minimumGPA: r.minimumGPA ?? null,
      minimumPercent: r.minimumPercent ?? null,
      minimumPoints: r.minimumPoints ?? null,
      gradeProfile: r.gradeProfile ?? null,
      stream: r.stream ?? null,
      notesEn: r.notesEn ?? null,
      notesAr: r.notesAr ?? r.notesEn ?? null,
      subjects: subjects(r.subjects, r.source),
      languages: [],
      tests: [],
      additional: [],
    };
    if (r.accepted === false) {
      // Not accepted for direct entry: the engine shows it as a missing requirement.
      return { ...base, minimumGPA: null, minimumPercent: null, minimumPoints: null, gradeProfile: null, stream: null, subjects: [], additional: [{ ...src(r), kind: "NOT_ACCEPTED", required: true, noteEn: r.notesEn ?? null, noteAr: r.notesAr ?? r.notesEn ?? null }] };
    }
    const evaluable = base.minimumGPA !== null || base.minimumPercent !== null || base.minimumPoints !== null || !!base.gradeProfile || !!base.stream || base.subjects.length > 0;
    if (!evaluable && (base.notesEn || base.evidenceLocator)) {
      // Only a note (for example a score on a scale we do not model): a person has to read it.
      // A note with a figure in it is a requirement we cannot check automatically; one without is guidance.
      const figure = /\d/.test(base.notesEn ?? "");
      base.additional.push({ ...src(r), kind: "NOTE", required: figure, noteEn: base.notesEn ?? base.evidenceLocator, noteAr: base.notesAr ?? base.notesEn ?? base.evidenceLocator });
    }
    return base;
  };
  return { general, curriculumRow };
}

/** Current (and, when the archive showed a difference, previous) rows for one programme. */
export function officialRows(uni: OUniversity, p: OProgram, sourceIdFor: (sid?: string) => string | null) {
  const b = builder(sourceIdFor);
  const programSource = (uni.sources ?? []).find((s) => s.url === p.url)?.id;
  const g = p.general ?? {};
  const byTest = <T extends { test: string }>(own: T[] | undefined, uniLevel: T[] | undefined) => {
    const seen = new Set((own ?? []).map((x) => x.test.toUpperCase()));
    return [...(own ?? []), ...(uniLevel ?? []).filter((x) => !seen.has(x.test.toUpperCase()))];
  };
  const generalSpec: OGeneral = {
    source: g.source ?? programSource,
    subjects: g.subjects ?? [],
    english: g.english?.length ? g.english : (uni.english ?? []),
    tests: byTest(g.tests, uni.tests),
    additional: [...(g.additional ?? []), ...(uni.additional ?? []).filter((a) => !(g.additional ?? []).some((x) => x.kind === a.kind && x.noteEn === a.noteEn))],
  };
  const current: BuiltRow[] = [];
  const general = b.general(generalSpec, programSource);
  if (general.subjects.length || general.languages.length || general.tests.length || general.additional.length) current.push(general);
  for (const c of CURRICULA) {
    const r = p.curricula?.[c] ?? uni.curriculumRules?.[c];
    if (r) current.push(b.curriculumRow(c, r));
  }
  let previous: { asOf: Date; rows: BuiltRow[] } | null = null;
  if (p.previous?.asOf) {
    const rows: BuiltRow[] = [];
    const pg = p.previous.general;
    if (pg && (pg.english?.length || pg.tests?.length)) {
      rows.push(b.general({ ...generalSpec, english: pg.english?.length ? pg.english : generalSpec.english, tests: pg.tests?.length ? byTest(pg.tests, uni.tests) : generalSpec.tests }, programSource));
    }
    for (const [c, r] of Object.entries(p.previous.curricula ?? {})) {
      const cur = p.curricula?.[c] ?? uni.curriculumRules?.[c];
      // Fields the archive did not restate are taken as unchanged.
      rows.push(b.curriculumRow(c as SchoolCurriculum, { ...(cur ?? {}), ...r, subjects: r.subjects ?? cur?.subjects }));
    }
    if (rows.length) previous = { asOf: new Date(`${p.previous.asOf}T00:00:00Z`), rows };
  }
  return { current, previous };
}

function rowData(programId: string, intakeYear: number, r: BuiltRow, version: number, isCurrent: boolean, from: Date, to: Date | null): Prisma.ProgramRequirementCreateInput {
  return {
    id: id(),
    orgId: null,
    programId,
    intakeYear,
    curriculum: r.curriculum,
    version,
    isCurrent,
    effectiveFrom: from,
    effectiveTo: to,
    confidence: "OFFICIAL",
    sourceId: r.sourceId,
    minimumGPA: r.minimumGPA,
    minimumPercent: r.minimumPercent,
    minimumPoints: r.minimumPoints,
    gradeProfile: r.gradeProfile,
    stream: r.stream,
    notesEn: r.notesEn,
    notesAr: r.notesAr,
    evidenceLocator: r.evidenceLocator,
    subjects: { create: r.subjects.map((s) => ({ orgId: null, type: s.type as never, canonicalSubjectKeys: s.keys, minimumLevel: (s.minimumLevel as never) ?? null, minimumGrade: s.minimumGrade, alternatives: [], noteEn: s.noteEn, noteAr: s.noteAr, evidenceQuote: s.evidenceQuote, sourceId: s.sourceId })) },
    languages: { create: r.languages.map((l) => ({ orgId: null, test: l.test, minOverall: l.minOverall, minComponent: l.minComponent, waiverNoteEn: l.waiverNoteEn, evidenceQuote: l.evidenceQuote, sourceId: l.sourceId })) },
    tests: { create: r.tests.map((t) => ({ orgId: null, test: t.test, policy: t.policy, minScore: t.minScore, noteEn: t.noteEn, evidenceQuote: t.evidenceQuote, sourceId: t.sourceId })) },
    additional: { create: r.additional.map((a) => ({ orgId: null, kind: a.kind, required: a.required, noteEn: a.noteEn, noteAr: a.noteAr, evidenceQuote: a.evidenceQuote, sourceId: a.sourceId })) },
  };
}

/** Canonical form of a built or stored row, for "did anything change" checks. */
export function fingerprint(r: { curriculum: string | null; minimumGPA: number | null; minimumPercent: number | null; minimumPoints: number | null; gradeProfile: string | null; stream: string | null; evidenceLocator: string | null; subjects: Array<{ type: string; canonicalSubjectKeys?: string[]; keys?: string[]; minimumLevel: string | null; minimumGrade: string | null; evidenceQuote: string | null }>; languages: Array<{ test: string; minOverall: number; minComponent: number | null; evidenceQuote: string | null }>; tests: Array<{ test: string; policy: string; minScore: number | null; evidenceQuote: string | null }>; additional: Array<{ kind: string; required: boolean; noteEn: string | null; evidenceQuote: string | null }> }) {
  const s = (xs: unknown[]) => xs.map((x) => JSON.stringify(x)).sort();
  return JSON.stringify({
    c: r.curriculum,
    v: [r.minimumGPA, r.minimumPercent, r.minimumPoints, r.gradeProfile, r.stream, r.evidenceLocator],
    s: s(r.subjects.map((x) => [x.type, [...(x.canonicalSubjectKeys ?? x.keys ?? [])].sort(), x.minimumLevel, x.minimumGrade, x.evidenceQuote])),
    l: s(r.languages.map((x) => [x.test, x.minOverall, x.minComponent, x.evidenceQuote])),
    t: s(r.tests.map((x) => [x.test, x.policy, x.minScore, x.evidenceQuote])),
    a: s(r.additional.map((x) => [x.kind, x.required, x.noteEn, x.evidenceQuote])),
  });
}

const DEADLINE_KIND: Record<string, string> = {
  UCAS_EQUAL_CONSIDERATION: "UCAS_EQUAL",
  UCAS_OXBRIDGE_MEDICINE: "OXBRIDGE_MEDICINE",
  EARLY_DECISION: "ED",
  EARLY_DECISION_II: "ED",
  EARLY_ACTION: "EA",
  RESTRICTIVE_EARLY_ACTION: "EA",
  REGULAR_DECISION: "RD",
  SCHOLARSHIP: "SCHOLARSHIP",
};
function deadlineKind(kind: string, applyVia: string | undefined, country: string) {
  if (DEADLINE_KIND[kind]) return DEADLINE_KIND[kind];
  if (applyVia === "OUAC") return "OUAC_EQUAL";
  if (country === "AE") return "UAE_WINDOW";
  if (country === "JO") return "UNIFIED";
  return "REGULAR";
}

/**
 * Loads official requirements, sources and deadlines for every programme that has them, removes all
 * EXAMPLE rows, and records real changes found between the archived and current pages.
 */
export async function seedOfficialRequirements(
  tx: Tx,
  opts: {
    batches: OfficialBatch[];
    programIdByKey: Map<string, string>;
    universityIdByKey: Map<string, string>;
    countryByUniversity: Map<string, string>;
    intakeYear: number;
    now: Date;
  },
) {
  const { batches, programIdByKey, universityIdByKey, intakeYear, now } = opts;
  const counts = { rows: 0, previous: 0, changes: 0, sources: 0, deadlines: 0, removedExample: 0 };
  // 1. Example data never stays in the catalog.
  const example = await tx.programRequirement.findMany({ where: { orgId: null, confidence: "EXAMPLE" }, select: { id: true } });
  if (example.length) {
    await tx.programRequirement.deleteMany({ where: { id: { in: example.map((e) => e.id) } } });
    counts.removedExample = example.length;
  }
  // Changes and drafts that did not come from official pages (earlier demo data) are removed.
  await tx.$executeRaw`DELETE FROM "RequirementChange" WHERE "orgId" IS NULL AND COALESCE(diff->>'official', '') <> 'true'`;
  await tx.$executeRaw`DELETE FROM "RequirementExtraction" WHERE "orgId" IS NULL AND COALESCE("normalizedJson"->'meta'->>'example', '') = 'true'`;
  // Deadlines that were not taken from an official page are removed.
  await tx.applicationDeadline.deleteMany({ where: { orgId: null, sourceId: null } });

  const { unis } = indexOfficial(batches);
  const officialUrls = new Set<string>();
  for (const [uniKey, u] of unis) {
    const universityId = universityIdByKey.get(uniKey);
    if (!universityId) continue;
    // 2. Sources: one row per official page, with the date and hash of the text the quotes were checked against.
    const sourceId = new Map<string, string>();
    const existing = await tx.requirementSource.findMany({ where: { orgId: null, universityId } });
    const byUrl = new Map(existing.map((s) => [s.url, s]));
    for (const s of u.sources ?? []) {
      officialUrls.add(s.url);
      const programKey = (u.programs ?? []).find((p) => p.url === s.url)?.key;
      const data = {
        programId: programKey ? (programIdByKey.get(programKey) ?? null) : null,
        title: s.title ?? null,
        sourceType: "OFFICIAL_UNIVERSITY",
        status: "FETCHED" as const,
        retrievedAt: s.retrievedAt ? new Date(s.retrievedAt) : now,
        contentHash: s.hash ?? null,
        lastError: null,
      };
      const e = byUrl.get(s.url);
      if (e) {
        await tx.requirementSource.update({ where: { id: e.id }, data });
        sourceId.set(s.id, e.id);
      } else {
        const sid = id();
        await tx.requirementSource.create({ data: { id: sid, orgId: null, universityId, url: s.url, ...data } });
        sourceId.set(s.id, sid);
        counts.sources++;
      }
    }
    const sourceIdFor = (sid?: string) => (sid ? (sourceId.get(sid) ?? null) : null);
    const retrieved = (sid?: string) => {
      const s = (u.sources ?? []).find((x) => x.id === sid);
      return s?.retrievedAt ? new Date(s.retrievedAt) : now;
    };

    // 3. Deadlines for the next intake.
    const country = opts.countryByUniversity.get(uniKey) ?? "";
    const deadlines = (u.deadlines ?? []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date));
    const haveDeadlines = await tx.applicationDeadline.findMany({ where: { orgId: null, universityId, programId: null }, orderBy: { date: "asc" } });
    const key = (x: { kind: string; date: Date | string; noteEn?: string | null }) => `${x.kind}|${new Date(x.date).toISOString().slice(0, 10)}|${x.noteEn ?? ""}`;
    const wantDeadlines = deadlines.map((d) => ({ kind: deadlineKind(d.kind, u.applyVia, country), date: `${d.date}T00:00:00Z`, noteEn: d.labelEn ?? null }));
    const same = haveDeadlines.length === wantDeadlines.length && haveDeadlines.map(key).sort().join() === wantDeadlines.map(key).sort().join();
    if (!same) await tx.applicationDeadline.deleteMany({ where: { orgId: null, universityId, programId: null } });
    if (deadlines.length && !same) {
      await tx.applicationDeadline.createMany({
        data: deadlines.map((d) => ({ orgId: null, universityId, programId: null, intakeYear: d.intakeYear, kind: deadlineKind(d.kind, u.applyVia, country), date: new Date(`${d.date}T00:00:00Z`), sourceId: sourceIdFor(d.source), noteEn: d.labelEn ?? null })),
      });
      counts.deadlines += deadlines.length;
    }

    // 4. Requirement rows per programme.
    for (const p of u.programs ?? []) {
      if (p.status === "DROP") continue;
      const programId = programIdByKey.get(p.key);
      if (!programId) continue;
      const { current, previous } = officialRows(u, p, sourceIdFor);
      const stored = await tx.programRequirement.findMany({ where: { orgId: null, programId, isCurrent: true }, include: { subjects: true, languages: true, tests: true, additional: true } });
      const storedBy = new Map(stored.map((r) => [r.curriculum ?? "GENERAL", r]));
      const wanted = new Set<string>(current.map((r) => r.curriculum ?? "GENERAL"));
      const firstLoad = stored.length === 0;
      for (const r of current) {
        const k = r.curriculum ?? "GENERAL";
        const e = storedBy.get(k);
        const from = retrieved((u.sources ?? []).find((s) => sourceIdFor(s.id) === r.sourceId)?.id);
        if (e && (e.confidence === "VERIFIED" || e.confidence === "REVIEWED")) continue; // a person checked it
        if (e && fingerprint(e) === fingerprint({ ...r, subjects: r.subjects.map((s) => ({ ...s, canonicalSubjectKeys: s.keys })) })) continue;
        const prevRow = firstLoad ? previous?.rows.find((x) => (x.curriculum ?? "GENERAL") === k) : undefined;
        let version = (e?.version ?? 0) + 1;
        let fromVersion: { id: string } | null = e ?? null;
        if (prevRow && previous) {
          const old = await tx.programRequirement.create({ data: rowData(programId, intakeYear, prevRow, version, false, previous.asOf, from), include: { subjects: true, languages: true, tests: true, additional: true } });
          counts.previous++;
          fromVersion = old;
          version++;
        }
        if (e) await tx.programRequirement.update({ where: { id: e.id }, data: { isCurrent: false, effectiveTo: from } });
        const created = await tx.programRequirement.create({ data: rowData(programId, intakeYear, r, version, true, from, null), include: { subjects: true, languages: true, tests: true, additional: true } });
        counts.rows++;
        if (fromVersion) {
          const before = await tx.programRequirement.findUnique({ where: { id: fromVersion.id }, include: { subjects: true, languages: true, tests: true, additional: true } });
          if (before) {
            const d = diffGroups({ prev: groupFromVersion(before), next: groupFromVersion(created), prevSourceId: before.sourceId, nextSourceId: created.sourceId });
            if (d.entries.length) {
              await tx.requirementChange.createMany({
                data: [{ id: changeId(["requirement-change", programId, k, before.id, created.id]), orgId: null, programId, fromVersionId: before.id, toVersionId: created.id, summaryEn: d.summaryEn, diff: { severity: d.severity, curriculum: d.curriculum, entries: d.entries, summaryAr: d.summaryAr, official: true } as unknown as Prisma.InputJsonValue, status: "NEEDS_REVIEW", detectedAt: from }],
                skipDuplicates: true,
              });
              counts.changes++;
            }
          }
        }
      }
      // Rows the official data no longer lists are closed.
      for (const [k, e] of storedBy) if (!wanted.has(k) && e.confidence === "OFFICIAL") await tx.programRequirement.update({ where: { id: e.id }, data: { isCurrent: false, effectiveTo: now } });
    }
  }
  // 5. Sources that are not official pages (the old generic admissions links) are removed.
  await tx.requirementSource.deleteMany({ where: { orgId: null, url: { notIn: [...officialUrls] }, extractions: { none: {} } } });
  // Cached match results are recomputed from the new rows.
  await tx.requirementMatch.deleteMany({});
  await tx.courseImpactAnalysis.deleteMany({});
  return counts;
}
