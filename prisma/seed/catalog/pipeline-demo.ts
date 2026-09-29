// Demo data for the requirement data pipeline (catalog review screens). EXAMPLE DATA: the source URLs point
// at real official admissions pages, but the page snapshots, extractions and requirement changes below were
// written for the demo and were not checked against those pages. Everything is labeled as example data.
// Runs with the owner client after the global catalog seed. Programs are looked up at runtime (global rows
// first, then the demo school's own rows); a missing program is skipped. Safe to re-run.
import type { Prisma, PrismaClient, SchoolCurriculum } from "@prisma/client";
import { contentHash } from "@/server/catalog-pipeline/fetch";
import { cacheKeyFor, confidenceOf, loadVocab, PROMPT_VERSION, RULES_MODEL } from "@/server/catalog-pipeline/extract";
import { extractByRules } from "@/server/catalog-pipeline/extract-rules";
import { validateDraft } from "@/server/catalog-pipeline/validate";
import { groupFromVersion, LINES_INCLUDE, linesCreate, subjectLabels, writeVersion } from "@/server/catalog-pipeline/publish";
import { changeId, diffGroups } from "@/server/catalog-pipeline/diff";
import { upsertSource } from "@/server/catalog-pipeline/sources";
import { resolveSubjectKey, type VocabEntry } from "@/server/catalog-pipeline/vocab";
import type { ChangeDiff, DraftGroup, DraftSet, SourceType } from "@/server/catalog-pipeline/types";

const DAY = 86_400_000;

type ProgramRef = { keys: string[]; unis: string[]; name: string };
type Found = { id: string; orgId: string | null; universityId: string; sourceUrl: string | null; nameEn: string };

async function findProgram(db: PrismaClient, ref: ProgramRef, orgId: string | null): Promise<Found | null> {
  const scopes: Array<string | null> = orgId ? [null, orgId] : [null];
  const select = { id: true, orgId: true, universityId: true, sourceUrl: true, nameEn: true } as const;
  for (const scope of scopes) {
    const byKey = await db.universityProgram.findFirst({ where: { orgId: scope, key: { in: ref.keys } }, select });
    if (byKey) return byKey;
    const unis = await db.university.findMany({ where: { orgId: scope, key: { in: ref.unis } }, select: { id: true } });
    if (unis.length) {
      const byName = await db.universityProgram.findFirst({ where: { orgId: scope, universityId: { in: unis.map((u) => u.id) }, nameEn: { contains: ref.name, mode: "insensitive" } }, select });
      if (byName) return byName;
    }
  }
  return null;
}

const P = {
  ucl: { keys: ["ucl-computer-science-bsc"], unis: ["ucl"], name: "Computer Science" },
  waterloo: { keys: ["waterloo-computer-science-bcs"], unis: ["waterloo", "university_of_waterloo"], name: "Computer Science" },
  imperial: { keys: ["imperial-computing-beng"], unis: ["imperial_college_london", "imperial"], name: "Computing" },
  cambridge: { keys: ["cambridge-computer-science-ba"], unis: ["cambridge", "university_of_cambridge"], name: "Computer Science" },
  mit: { keys: ["mit-computer-science-sb"], unis: ["mit"], name: "Computer Science" },
  nyuad: { keys: ["nyuad-computer-science-bs"], unis: ["nyu_abu_dhabi", "nyuad"], name: "Computer Science" },
  cmu: { keys: ["cmu-computer-science-bs"], unis: ["carnegie_mellon", "cmu"], name: "Computer Science" },
  toronto: { keys: ["uoft-computer-science-bsc"], unis: ["university_of_toronto", "uoft"], name: "Computer Science" },
} satisfies Record<string, ProgramRef>;

// Example page snapshots (normalized text, as the fetcher would store it).
const SNAPSHOTS = {
  ucl: [
    "Computer Science BSc",
    "Example snapshot for the demo. Confirm on the official page.",
    "Entry requirements",
    "A levels",
    "Typical offer: A*A*A including Mathematics.",
    "Further Mathematics is recommended.",
    "International Baccalaureate",
    "A total of 39 points, including 7 in HL Mathematics.",
    "English language requirements",
    "IELTS 7.0 overall with a minimum of 6.5 in each component.",
    "A personal statement is required as part of your UCAS application.",
  ].join("\n"),
  waterloo: [
    "Computer Science (Bachelor of Computer Science)",
    "Example snapshot for the demo. Confirm on the official page.",
    "Admission requirements for international curricula",
    "A levels",
    "Typical offer: A*AA including Mathematics and Further Mathematics.",
    "International Baccalaureate",
    "36 points overall, including 6 in HL Mathematics: Analysis and Approaches.",
    "Computer Science is recommended.",
    "English language requirements",
    "TOEFL iBT: 90 overall, with at least 25 in each section.",
    "IELTS Academic 6.5 overall with a minimum of 6.5 in each component.",
    "An Admission Information Form is strongly encouraged for all applicants.",
  ].join("\n"),
  imperial: [
    "Computing BEng",
    "Example snapshot for the demo. Confirm on the official page.",
    "Entry requirements for 2025 entry",
    "Typical offer: A*A*A including Mathematics.",
    "IELTS 6.5 overall with a minimum of 6.0 in each component.",
  ].join("\n"),
};

type SourceSpec = { program: keyof typeof P; url: string | null; type: SourceType; status: "FETCHED" | "UNCHANGED" | "CHANGED" | "FAILED"; daysAgo: number; lastError?: string; text?: string; title?: string };

const SOURCES: SourceSpec[] = [
  { program: "ucl", url: "https://www.ucl.ac.uk/prospective-students/undergraduate/degrees/computer-science-bsc", type: "OFFICIAL_UNIVERSITY", status: "CHANGED", daysAgo: 1, text: SNAPSHOTS.ucl },
  { program: "waterloo", url: "https://uwaterloo.ca/future-students/programs/computer-science", type: "OFFICIAL_UNIVERSITY", status: "FETCHED", daysAgo: 2, text: SNAPSHOTS.waterloo },
  { program: "waterloo", url: "https://www.topuniversities.com/universities/university-waterloo", type: "MIRROR", status: "UNCHANGED", daysAgo: 2, title: "QS Top Universities profile" },
  { program: "imperial", url: "https://www.imperial.ac.uk/study/courses/undergraduate/computing-beng/", type: "OFFICIAL_UNIVERSITY", status: "CHANGED", daysAgo: 9, text: SNAPSHOTS.imperial },
  { program: "mit", url: "https://mitadmissions.org/apply/firstyear/", type: "OFFICIAL_UNIVERSITY", status: "UNCHANGED", daysAgo: 3 },
  { program: "cambridge", url: "https://www.undergraduate.study.cam.ac.uk/courses/computer-science", type: "OFFICIAL_UNIVERSITY", status: "UNCHANGED", daysAgo: 4 },
  { program: "cambridge", url: "https://digital.ucas.com/coursedisplay/courses/example-cambridge-computer-science", type: "OFFICIAL_BODY", status: "FAILED", daysAgo: 4, lastError: "http_error:403", title: "UCAS course page" },
  { program: "nyuad", url: "https://nyuad.nyu.edu/en/admissions/undergraduate.html", type: "OFFICIAL_UNIVERSITY", status: "UNCHANGED", daysAgo: 5 },
];

function key(vocab: VocabEntry[], alias: string) {
  return resolveSubjectKey(alias, vocab) ?? alias;
}

export type PipelineDemoResult = { sources: number; extractions: number; changes: number; skipped: string[] };

export async function seedPipelineDemo(db: PrismaClient, opts: { now?: Date; orgId?: string | null; log?: (m: string) => void } = {}): Promise<PipelineDemoResult> {
  const now = opts.now ?? new Date();
  const log = opts.log ?? (() => {});
  const orgId = opts.orgId ?? null;
  const vocab = await loadVocab(db);
  const labels = await subjectLabels(db);
  const result: PipelineDemoResult = { sources: 0, extractions: 0, changes: 0, skipped: [] };
  const programs = new Map<string, Found>();
  for (const [name, ref] of Object.entries(P)) {
    const p = await findProgram(db, ref, orgId);
    if (p) programs.set(name, p);
    else result.skipped.push(name);
  }

  // 1. Sources.
  const sourceIds = new Map<string, string>();
  for (const s of SOURCES) {
    const p = programs.get(s.program);
    if (!p) continue;
    const url = s.url ?? p.sourceUrl;
    if (!url) continue;
    const res = await upsertSource(db, { orgId: p.orgId, universityId: p.universityId, programId: p.id, url, title: s.title ?? p.nameEn, sourceType: s.type });
    if (!res) continue;
    const hash = s.text ? contentHash(s.text) : contentHash(`example:${url}`);
    await db.requirementSource.update({ where: { id: res.source.id }, data: { status: s.status, retrievedAt: new Date(now.getTime() - s.daysAgo * DAY), contentHash: s.status === "FAILED" ? null : hash, lastError: s.lastError ?? null, createdAt: new Date(now.getTime() - 120 * DAY) } });
    if (s.type !== "MIRROR" && s.type !== "OFFICIAL_BODY") sourceIds.set(s.program, res.source.id);
    result.sources++;
  }

  // 2. Extractions: two waiting for review, one rejected.
  const extractions: Array<{ program: keyof typeof SNAPSHOTS; demoKey: string; daysAgo: number; extra: (raw: { groups: Array<Record<string, unknown>> }) => void; rejectNote?: string }> = [
    {
      program: "ucl",
      demoKey: "pipeline-demo:ucl",
      daysAgo: 1,
      // A model-style line whose quote is not on the page: rejected by validation.
      extra: (raw) => raw.groups.push({ curriculum: "BRITISH", subjects: [{ type: "PREFERRED", keys: [key(vocab, "physics")], evidenceQuote: "Physics is preferred for all applicants." }] }),
    },
    {
      program: "waterloo",
      demoKey: "pipeline-demo:waterloo",
      daysAgo: 2,
      // An out-of-range IB total: rejected by the range check.
      extra: (raw) => raw.groups.push({ curriculum: "IB", overall: [{ field: "minimumPoints", value: 360, evidenceQuote: "36 points overall, including 6 in HL Mathematics: Analysis and Approaches." }] }),
    },
    {
      program: "imperial",
      demoKey: "pipeline-demo:imperial",
      daysAgo: 9,
      extra: () => undefined,
      rejectNote: "The page still shows 2025 entry requirements. Waiting for the 2027 entry page before publishing.",
    },
  ];
  for (const e of extractions) {
    const sourceId = sourceIds.get(e.program);
    if (!sourceId) continue;
    const exists = await db.requirementExtraction.findFirst({ where: { sourceId, normalizedJson: { path: ["meta", "demoKey"], equals: e.demoKey } }, select: { id: true } });
    if (exists) {
      result.extractions++;
      continue;
    }
    const text = SNAPSHOTS[e.program];
    const raw = extractByRules(text, vocab) as unknown as { groups: Array<Record<string, unknown>> };
    e.extra(raw);
    const v = validateDraft(raw, text, vocab);
    const hash = contentHash(text);
    const draft: DraftSet = { groups: v.groups, rejected: v.rejected, meta: { contentHash: hash, model: RULES_MODEL, promptVersion: PROMPT_VERSION, cacheKey: cacheKeyFor(sourceId, hash, RULES_MODEL), provider: "built-in", example: true, demoKey: e.demoKey } };
    const at = new Date(now.getTime() - e.daysAgo * DAY);
    const src = await db.requirementSource.findUniqueOrThrow({ where: { id: sourceId }, select: { orgId: true } });
    await db.requirementExtraction.create({
      data: {
        orgId: src.orgId,
        sourceId,
        rawText: text,
        normalizedJson: draft as unknown as Prisma.InputJsonValue,
        confidence: confidenceOf(v.accepted, v.rejected.length, 0.7),
        model: RULES_MODEL,
        status: e.rejectNote ? "REJECTED" : "PENDING_REVIEW",
        reviewNote: e.rejectNote ?? null,
        reviewedAt: e.rejectNote ? new Date(at.getTime() + DAY) : null,
        createdAt: at,
      },
    });
    result.extractions++;
  }

  // 3. Requirement changes with version history. When a program already has a current version (the
  // global catalog seed), the story is told by adding the earlier state below it: a closed older version
  // and a change into the current one, so current requirements (and every match result) stay as seeded.
  // Without a current version, an example base version is created and the change is applied on top.
  type ChangeSpec = {
    demoKey: string;
    candidates: Array<keyof typeof P>;
    curriculum: SchoolCurriculum | null;
    daysAgo: number;
    /** The earlier state, derived from the current one, or null when this program cannot tell the story. */
    before: (g: DraftGroup) => DraftGroup | null;
    /** Fallback when the program has no current version: base, then the changed state. */
    base: () => DraftGroup;
    after: (g: DraftGroup) => DraftGroup;
    reviewedDaysAgo?: number;
  };
  const clone = (g: DraftGroup): DraftGroup => JSON.parse(JSON.stringify(g));
  const fm = key(vocab, "further_mathematics");
  const specs: ChangeSpec[] = [
    {
      demoKey: "pipeline-demo:ielts",
      candidates: ["imperial", "ucl", "cambridge", "toronto"],
      curriculum: null,
      daysAgo: 6,
      before: (g) => {
        const i = g.languages.find((l) => l.test === "IELTS");
        if (!i || i.minOverall < 5.5) return null;
        const n = clone(g);
        const b = n.languages.find((l) => l.test === "IELTS")!;
        b.minOverall = i.minOverall - 0.5;
        if (b.minComponent !== null && b.minComponent !== undefined) b.minComponent = Math.min(b.minComponent, b.minOverall);
        b.evidenceQuote = `IELTS ${b.minOverall.toFixed(1)} overall.`;
        return n;
      },
      base: () => ({ curriculum: null, overall: [], subjects: [], languages: [{ test: "IELTS", minOverall: 6.5, minComponent: 6.0, evidenceQuote: "IELTS 6.5 overall with a minimum of 6.0 in each component." }], tests: [], additional: [] }),
      after: (g) => {
        const n = clone(g);
        n.languages = n.languages.map((l) => (l.test === "IELTS" ? { ...l, minOverall: 7.0, minComponent: 6.5, evidenceQuote: "IELTS 7.0 overall with a minimum of 6.5 in each component." } : l));
        return n;
      },
    },
    {
      demoKey: "pipeline-demo:further-maths",
      candidates: ["cambridge", "imperial", "toronto", "ucl"],
      curriculum: "BRITISH",
      daysAgo: 34,
      reviewedDaysAgo: 30,
      before: (g) => {
        if (!g.subjects.some((s) => s.keys.includes(fm) && s.type === "RECOMMENDED")) return null;
        const n = clone(g);
        n.subjects = n.subjects.filter((s) => !(s.keys.includes(fm) && s.type === "RECOMMENDED"));
        return n;
      },
      base: () => ({
        curriculum: "BRITISH",
        overall: [{ field: "gradeProfile", value: "A*A*A", evidenceQuote: "Typical offer: A*A*A." }],
        subjects: [{ type: "REQUIRED", keys: [key(vocab, "mathematics")], minimumLevel: "ADVANCED", minimumGrade: "A*", evidenceQuote: "A* in Mathematics is required." }],
        languages: [],
        tests: [],
        additional: [],
      }),
      after: (g) => {
        const n = clone(g);
        n.subjects.push({ type: "RECOMMENDED", keys: [fm], minimumLevel: "ADVANCED", minimumGrade: null, evidenceQuote: "Further Mathematics is recommended." });
        return n;
      },
    },
    {
      demoKey: "pipeline-demo:sat-optional",
      candidates: ["nyuad", "toronto", "cmu", "mit"],
      curriculum: "AMERICAN",
      daysAgo: 12,
      before: (g) => {
        const sat = g.tests.find((t) => t.test === "SAT");
        if (!sat || sat.policy !== "OPTIONAL") return null;
        const n = clone(g);
        n.tests = n.tests.map((t) => (t.test === "SAT" ? { ...t, policy: "REQUIRED", evidenceQuote: "SAT or ACT scores are required." } : t));
        return n;
      },
      base: () => ({ curriculum: "AMERICAN", overall: [], subjects: [], languages: [], tests: [{ test: "SAT", policy: "REQUIRED", minScore: null, evidenceQuote: "SAT or ACT scores are required." }], additional: [] }),
      after: (g) => {
        const n = clone(g);
        n.tests = n.tests.map((t) => (t.test === "SAT" ? { ...t, policy: "OPTIONAL", evidenceQuote: "Submitting SAT or ACT scores is optional." } : t));
        return n;
      },
    },
  ];

  for (const spec of specs) {
    const existing = await db.requirementChange.findFirst({ where: { diff: { path: ["demoKey"], equals: spec.demoKey } } });
    if (existing) {
      const to = existing.toVersionId ? await db.programRequirement.findUnique({ where: { id: existing.toVersionId }, select: { isCurrent: true } }) : null;
      if (to?.isCurrent) {
        result.changes++;
        continue;
      }
      // Stale (the catalog was reseeded): remove the demo's closed version and the change.
      await db.requirementChange.delete({ where: { id: existing.id } });
      if (existing.fromVersionId) await db.programRequirement.deleteMany({ where: { id: existing.fromVersionId, isCurrent: false } });
    }
    const changedAt = new Date(now.getTime() - spec.daysAgo * DAY);
    const review = spec.reviewedDaysAgo !== undefined ? { outcome: "REVIEWED" as const, note: "Confirmed on the official page (example data).", at: new Date(now.getTime() - spec.reviewedDaysAgo * DAY).toISOString(), byUserId: null, notified: 0 } : undefined;
    let done = false;
    for (const c of spec.candidates) {
      const p = programs.get(c);
      if (!p) continue;
      const sourceId = sourceIds.get(c) ?? null;
      done = await db.$transaction(async (tx) => {
        const current = await tx.programRequirement.findFirst({ where: { programId: p.id, curriculum: spec.curriculum, isCurrent: true }, include: LINES_INCLUDE });
        if (current) {
          const now_ = groupFromVersion(current);
          const prior = spec.before(now_);
          if (!prior) return false;
          // Prepend: the earlier state becomes the previous version; the current row keeps its lines.
          const older = await tx.programRequirement.create({
            data: {
              orgId: p.orgId,
              programId: p.id,
              intakeYear: current.intakeYear,
              curriculum: spec.curriculum,
              version: current.version,
              isCurrent: false,
              effectiveFrom: new Date(changedAt.getTime() - 180 * DAY),
              effectiveTo: changedAt,
              confidence: "EXAMPLE",
              sourceId: current.sourceId ?? sourceId,
              createdAt: new Date(changedAt.getTime() - 180 * DAY),
              ...linesCreate(prior, p.orgId),
            },
          });
          await tx.programRequirement.update({ where: { id: current.id }, data: { version: current.version + 1, effectiveFrom: changedAt } });
          const d = diffGroups({ prev: prior, next: now_, labels });
          const diff: ChangeDiff = { severity: d.severity, curriculum: d.curriculum, entries: d.entries, summaryAr: d.summaryAr, example: true, demoKey: spec.demoKey, ...(review ? { review } : {}) };
          await tx.requirementChange.create({
            data: { id: changeId(["pipeline-demo", spec.demoKey, p.id, older.id]), orgId: p.orgId, programId: p.id, fromVersionId: older.id, toVersionId: current.id, summaryEn: d.summaryEn, diff: diff as unknown as Prisma.InputJsonValue, status: review ? "ACKNOWLEDGED" : "NEEDS_REVIEW", detectedAt: changedAt },
          });
          return true;
        }
        await writeVersion(tx, { programId: p.id, orgId: p.orgId, group: spec.base(), confidence: "EXAMPLE", sourceId, extractionId: null, verifiedById: null, now: new Date(changedAt.getTime() - 180 * DAY), labels, example: true });
        const base = await tx.programRequirement.findFirst({ where: { programId: p.id, curriculum: spec.curriculum, isCurrent: true }, include: LINES_INCLUDE });
        if (!base) return false;
        await writeVersion(tx, { programId: p.id, orgId: p.orgId, group: spec.after(groupFromVersion(base)), confidence: "EXAMPLE", sourceId, extractionId: null, verifiedById: null, now: changedAt, labels, example: true, demoKey: spec.demoKey, review });
        return true;
      });
      if (done) break;
    }
    if (done) result.changes++;
    else result.skipped.push(spec.demoKey);
  }
  log(`pipeline demo: ${result.sources} sources, ${result.extractions} extractions, ${result.changes} changes${result.skipped.length ? `, skipped ${result.skipped.join(", ")}` : ""}`);
  return result;
}
