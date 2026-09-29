import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { contentHash, normalizeHtml, parseRobots, robotsAllows } from "@/server/catalog-pipeline/fetch";
import { evidencePresent, validateDraft } from "@/server/catalog-pipeline/validate";
import { extractByRules } from "@/server/catalog-pipeline/extract-rules";
import { cacheKeyFor, confidenceOf, draftFromText } from "@/server/catalog-pipeline/extract";
import { changeId, diffGroups, gradeRank } from "@/server/catalog-pipeline/diff";
import { canOverride, canonicalSourceType, normalizeSourceUrl } from "@/server/catalog-pipeline/sources";
import { DEFAULT_VOCAB, resolveSubjectKey } from "@/server/catalog-pipeline/vocab";
import { catalogWriteDenial, type CatalogActor } from "@/server/platform/catalog-db";
import { ScorecardError, campusSettingFromLocale, fetchWithRetry, mapScorecardStats, missingFields, ownershipType, runScorecardImport, testOptionalFromRequirement, type ImportStore } from "@/server/pathways/scorecard";
import type { DraftGroup } from "@/server/catalog-pipeline/types";

const fixture = (name: string) => readFileSync(path.join(__dirname, "../fixtures/catalog", name), "utf8");
const vocab = DEFAULT_VOCAB;

describe("normalization and hashing", () => {
  it("gives the same hash when only scripts, navigation, cookie banners, markup or timestamps change", () => {
    const a = normalizeHtml(fixture("uk-cs.html"));
    const b = normalizeHtml(fixture("uk-cs-cosmetic.html"));
    expect(a).toBe(b);
    expect(contentHash(a)).toBe(contentHash(b));
    expect(a).not.toMatch(/cookie|csrf|Privacy|Study|Research|2026-09/i);
    expect(a).toContain("IELTS 7.0 overall with a minimum of 6.5 in each component.");
  });

  it("gives a different hash when the requirements change", () => {
    expect(contentHash(normalizeHtml(fixture("uk-cs-changed.html")))).not.toBe(contentHash(normalizeHtml(fixture("uk-cs.html"))));
  });

  it("decodes entities, turns dashes into hyphens and keeps block structure", () => {
    expect(normalizeHtml("<p>A&amp;B &ndash; C&nbsp;D</p><p>Next&#8212;line</p>")).toBe("A&B - C D\nNext-line");
  });
});

describe("robots.txt", () => {
  const groups = parseRobots("User-agent: *\nDisallow: /private\nAllow: /private/admissions\n\nUser-agent: badbot\nDisallow: /\n");
  it("applies the longest matching rule", () => {
    expect(robotsAllows(groups, "/study/cs")).toBe(true);
    expect(robotsAllows(groups, "/private/x")).toBe(false);
    expect(robotsAllows(groups, "/private/admissions/cs")).toBe(true);
  });
  it("uses a specific group for our agent when present", () => {
    const ours = parseRobots("User-agent: horizonschoolos-requirementsbot\nDisallow: /\n\nUser-agent: *\nAllow: /\n");
    expect(robotsAllows(ours, "/anything")).toBe(false);
  });
});

describe("evidence validation", () => {
  const text = "Typical offer: A*A*A including Mathematics.\nIELTS 7.0 overall with a minimum of 6.5 in each component.";
  const draft = (lines: Partial<DraftGroup>) => ({ groups: [{ curriculum: null, overall: [], subjects: [], languages: [], tests: [], additional: [], ...lines }] });

  it("accepts a verbatim quote, exact or with different whitespace", () => {
    expect(evidencePresent("IELTS 7.0 overall with a minimum of 6.5 in each component.", text)).toBe(true);
    expect(evidencePresent("IELTS  7.0 overall\nwith a minimum of 6.5 in each component.", text)).toBe(true);
    const r = validateDraft(draft({ languages: [{ test: "IELTS", minOverall: 7, minComponent: 6.5, evidenceQuote: "IELTS 7.0 overall with a minimum of 6.5 in each component." }] }), text, vocab);
    expect(r.accepted).toBe(1);
    expect(r.rejected).toEqual([]);
  });

  it("rejects a paraphrased quote", () => {
    const r = validateDraft(draft({ languages: [{ test: "IELTS", minOverall: 7, evidenceQuote: "Applicants need an IELTS score of 7.0." }] }), text, vocab);
    expect(r.accepted).toBe(0);
    expect(r.rejected[0].reason).toBe("evidence_not_in_text");
  });

  it("rejects a value that is not in its quote", () => {
    const r = validateDraft(draft({ languages: [{ test: "IELTS", minOverall: 7.5, evidenceQuote: "IELTS 7.0 overall with a minimum of 6.5 in each component." }] }), text, vocab);
    expect(r.rejected[0].reason).toBe("value_not_in_evidence");
  });

  it("rejects out-of-range numbers", () => {
    const t2 = "IELTS 9.5 overall. IB 50 points. SAT 1700. ACT 40. GPA 6.0 required.";
    const r = validateDraft(
      {
        groups: [
          { curriculum: null, languages: [{ test: "IELTS", minOverall: 9.5, evidenceQuote: "IELTS 9.5 overall." }] },
          { curriculum: "IB", overall: [{ field: "minimumPoints", value: 50, evidenceQuote: "IB 50 points." }] },
          { curriculum: "AMERICAN", tests: [{ test: "SAT", policy: "REQUIRED", minScore: 1700, evidenceQuote: "SAT 1700." }, { test: "ACT", policy: "REQUIRED", minScore: 40, evidenceQuote: "ACT 40." }], overall: [{ field: "minimumGPA", value: 6, evidenceQuote: "GPA 6.0 required." }] },
        ],
      },
      t2,
      vocab,
    );
    expect(r.accepted).toBe(0);
    expect(r.rejected.map((x) => x.reason)).toEqual(["out_of_range", "out_of_range", "out_of_range", "out_of_range", "out_of_range"]);
  });

  it("rejects subject codes outside the vocabulary and unknown tests", () => {
    const r = validateDraft(
      draft({
        subjects: [{ type: "REQUIRED", keys: ["MATHS_HL_AA"], evidenceQuote: "Typical offer: A*A*A including Mathematics." }],
        tests: [{ test: "GRE", policy: "REQUIRED", evidenceQuote: "Typical offer: A*A*A including Mathematics." }],
      }),
      text,
      vocab,
    );
    expect(r.rejected.map((x) => x.reason)).toEqual(["unknown_subject_code", "unknown_test_code"]);
  });

  it("resolves alias keys against the catalog's own keys and names", () => {
    expect(resolveSubjectKey("english", [{ key: "english_language", nameEn: "English Language" }])).toBe("english_language");
    expect(resolveSubjectKey("mathematics", [{ key: "MATH", nameEn: "Mathematics" }])).toBe("MATH");
    expect(resolveSubjectKey("physics", [{ key: "MATH", nameEn: "Mathematics" }])).toBeNull();
  });
});

describe("rule-based extractor", () => {
  it("reads a UK Computer Science page", () => {
    const text = normalizeHtml(fixture("uk-cs.html"));
    const r = draftFromText(text, vocab);
    expect(r.rejected).toEqual([]);
    const brit = r.groups.find((g) => g.curriculum === "BRITISH")!;
    expect(brit.overall).toEqual([expect.objectContaining({ field: "gradeProfile", value: "A*A*A" })]);
    expect(brit.subjects).toEqual([expect.objectContaining({ type: "REQUIRED", keys: ["mathematics"] }), expect.objectContaining({ type: "RECOMMENDED", keys: ["further_mathematics"] })]);
    const ib = r.groups.find((g) => g.curriculum === "IB")!;
    expect(ib.overall[0]).toMatchObject({ field: "minimumPoints", value: 39 });
    expect(ib.subjects[0]).toMatchObject({ keys: ["mathematics"], minimumLevel: "HIGHER", minimumGrade: "7" });
    const general = r.groups.find((g) => g.curriculum === null)!;
    expect(general.languages).toEqual([expect.objectContaining({ test: "IELTS", minOverall: 7, minComponent: 6.5 })]);
    // "Interviews are not part of the selection process" is not an interview requirement.
    expect(general.additional.map((a) => a.kind)).toEqual(["PERSONAL_STATEMENT"]);
    for (const g of r.groups) for (const l of [...g.overall, ...g.subjects, ...g.languages]) expect(text.includes(l.evidenceQuote)).toBe(true);
  });

  it("reads a US page with test-optional policy and TOEFL", () => {
    const r = draftFromText(normalizeHtml(fixture("us-cs.html")), vocab);
    const us = r.groups.find((g) => g.curriculum === "AMERICAN")!;
    expect(us.tests.map((t) => [t.test, t.policy])).toEqual([
      ["SAT", "OPTIONAL"],
      ["ACT", "OPTIONAL"],
    ]);
    const general = r.groups.find((g) => g.curriculum === null)!;
    expect(general.languages[0]).toMatchObject({ test: "TOEFL", minOverall: 100, minComponent: 25 });
    expect(general.subjects.map((s) => [s.type, s.keys[0]])).toEqual([
      ["RECOMMENDED", "calculus"],
      ["RECOMMENDED", "physics"],
    ]);
    expect(general.additional).toEqual([expect.objectContaining({ kind: "INTERVIEW", required: false })]);
  });

  it("finds A-Level grade profiles like A*AA", () => {
    const raw = extractByRules("A levels\nTypical offer: A*AA including A* in Mathematics.", vocab);
    const g = raw.groups.find((x) => x.curriculum === "BRITISH")!;
    expect(g.overall[0]).toMatchObject({ value: "A*AA" });
    expect(g.subjects[0]).toMatchObject({ keys: ["mathematics"], minimumGrade: "A*" });
  });

  it("caches by source, content hash, model and prompt version", () => {
    expect(cacheKeyFor("s1", "h1", "rules-v1")).toBe(cacheKeyFor("s1", "h1", "rules-v1"));
    expect(cacheKeyFor("s1", "h1", "rules-v1")).not.toBe(cacheKeyFor("s1", "h2", "rules-v1"));
    expect(cacheKeyFor("s1", "h1", "rules-v1")).not.toBe(cacheKeyFor("s1", "h1", "anthropic:x"));
    expect(confidenceOf(3, 1, 0.8)).toBe(0.6);
    expect(confidenceOf(0, 2, 0.8)).toBe(0);
  });
});

describe("diff and severity", () => {
  const g = (p: Partial<DraftGroup>): DraftGroup => ({ curriculum: null, overall: [], subjects: [], languages: [], tests: [], additional: [], ...p });
  const q = "quote";

  it("classifies a raised English threshold as major", () => {
    const d = diffGroups({ prev: g({ languages: [{ test: "IELTS", minOverall: 6.5, evidenceQuote: q }] }), next: g({ languages: [{ test: "IELTS", minOverall: 7, evidenceQuote: q }] }) });
    expect(d.entries[0]).toMatchObject({ type: "THRESHOLD_RAISED", from: "6.5", to: "7.0", severity: "MAJOR" });
    expect(d.severity).toBe("MAJOR");
    expect(d.summaryEn).toBe("IELTS raised from 6.5 to 7.0");
    expect(d.summaryAr).toContain("IELTS");
  });

  it("classifies a new recommended subject as notable and a new required one as major", () => {
    const base = g({ curriculum: "BRITISH", subjects: [{ type: "REQUIRED", keys: ["mathematics"], evidenceQuote: q }] });
    const rec = diffGroups({ prev: base, next: g({ curriculum: "BRITISH", subjects: [...base.subjects, { type: "RECOMMENDED", keys: ["further_mathematics"], evidenceQuote: q }] }), labels: { further_mathematics: { en: "Further Mathematics", ar: "الرياضيات الإضافية" } } });
    expect(rec.entries).toEqual([expect.objectContaining({ type: "ADDED", severity: "NOTABLE", summaryEn: "Further Mathematics now recommended" })]);
    const req = diffGroups({ prev: base, next: g({ curriculum: "BRITISH", subjects: [...base.subjects, { type: "REQUIRED", keys: ["physics"], evidenceQuote: q }] }) });
    expect(req.severity).toBe("MAJOR");
  });

  it("classifies a test policy change and a lowered grade", () => {
    const pol = diffGroups({ prev: g({ tests: [{ test: "SAT", policy: "REQUIRED", evidenceQuote: q }] }), next: g({ tests: [{ test: "SAT", policy: "OPTIONAL", evidenceQuote: q }] }) });
    expect(pol.entries[0]).toMatchObject({ type: "STRENGTH_CHANGED", severity: "NOTABLE" });
    expect(pol.summaryEn).toBe("SAT policy changed from required to test optional");
    const becameRequired = diffGroups({ prev: g({ tests: [{ test: "SAT", policy: "OPTIONAL", evidenceQuote: q }] }), next: g({ tests: [{ test: "SAT", policy: "REQUIRED", evidenceQuote: q }] }) });
    expect(becameRequired.severity).toBe("MAJOR");
    const low = diffGroups({ prev: g({ overall: [{ field: "gradeProfile", value: "A*A*A", evidenceQuote: q }] }), next: g({ overall: [{ field: "gradeProfile", value: "A*AA", evidenceQuote: q }] }) });
    expect(low.entries[0]).toMatchObject({ type: "THRESHOLD_LOWERED", severity: "NOTABLE" });
    expect(gradeRank("A*AA")).toBeGreaterThan(gradeRank("AAA")!);
  });

  it("reports source changes and removals, and caps severity when the source kind changed", () => {
    const a = g({ languages: [{ test: "IELTS", minOverall: 6.5, evidenceQuote: q }] });
    const b = g({ languages: [{ test: "IELTS", minOverall: 7, evidenceQuote: q }] });
    expect(diffGroups({ prev: a, next: a, prevSourceId: "s1", nextSourceId: "s2" }).entries).toEqual([expect.objectContaining({ type: "SOURCE_CHANGED", severity: "WATCH" })]);
    expect(diffGroups({ prev: a, next: a, prevSourceId: "s1", nextSourceId: null }).entries).toEqual([expect.objectContaining({ type: "SOURCE_REMOVED" })]);
    expect(diffGroups({ prev: a, next: b, sourceTypeChanged: true }).severity).toBe("WATCH");
    expect(diffGroups({ prev: null, next: b }).severity).toBe("WATCH");
  });

  it("builds idempotent change ids", () => {
    const x = changeId(["requirement-change", "p1", "BRITISH", "v1", "v2"]);
    expect(x).toHaveLength(32);
    expect(changeId(["requirement-change", "p1", "BRITISH", "v1", "v2"])).toBe(x);
    expect(changeId(["requirement-change", "p1", "BRITISH", "v1", "v3"])).not.toBe(x);
    expect(changeId(["a", null])).toBe(changeId(["a", undefined]));
  });
});

describe("sources and access", () => {
  it("never lets a mirror override official data", () => {
    expect(canOverride("OFFICIAL_UNIVERSITY", "MIRROR")).toBe(false);
    expect(canOverride("OFFICIAL_ADMISSIONS", "MIRROR")).toBe(false);
    expect(canOverride("MIRROR", "OFFICIAL_UNIVERSITY")).toBe(true);
    expect(canOverride(null, "MIRROR")).toBe(true);
    expect(canonicalSourceType("OFFICIAL_ADMISSIONS")).toBe("OFFICIAL_UNIVERSITY");
    expect(normalizeSourceUrl("https://www.ucl.ac.uk/cs#entry")).toBe("https://www.ucl.ac.uk/cs");
    expect(normalizeSourceUrl("javascript:alert(1)")).toBeNull();
  });

  it("allows global writes only for reviewers in the demo school or listed platform admins", () => {
    const base: CatalogActor = { orgId: "o", orgIsDemo: false, email: "a@school.test", canReview: true, membershipId: "m", userId: "u" };
    const prev = process.env.PLATFORM_ADMIN_EMAILS;
    process.env.PLATFORM_ADMIN_EMAILS = "";
    expect(catalogWriteDenial(base, { writable: true })).toBe("not_platform_reviewer");
    expect(catalogWriteDenial({ ...base, orgIsDemo: true }, { writable: true })).toBeNull();
    expect(catalogWriteDenial({ ...base, orgIsDemo: true, canReview: false }, { writable: true })).toBe("forbidden");
    expect(catalogWriteDenial({ ...base, orgIsDemo: true }, { writable: false })).toBe("no_owner_url");
    process.env.PLATFORM_ADMIN_EMAILS = "other@x.test, A@School.test";
    expect(catalogWriteDenial(base, { writable: true })).toBeNull();
    process.env.PLATFORM_ADMIN_EMAILS = prev;
  });
});

describe("College Scorecard upgrade", () => {
  const store: ImportStore = { existing: async () => [], createMany: async (r) => r.length, update: async () => undefined };
  it("retries 429 and 5xx with exponential backoff", async () => {
    const statuses = [429, 503, 200];
    const waits: number[] = [];
    const res = await fetchWithRetry(async () => ({ ok: statuses[0] === 200, status: statuses.shift()!, json: async () => ({}) }), "u", { sleep: async (ms) => void waits.push(ms) });
    expect(res.status).toBe(200);
    expect(waits).toEqual([300, 600]);
  });

  it("fails the import when an expected field is missing from every row (drift guard)", async () => {
    const page = { metadata: { total: 1 }, results: [{ id: 1, "school.name": "X" }] };
    expect(missingFields(page.results, ["id", "school.name", "latest.cost.avg_net_price.overall"])).toEqual(["latest.cost.avg_net_price.overall"]);
    await expect(runScorecardImport({ store, apiKey: "K", fetchImpl: async () => ({ ok: true, status: 200, json: async () => page }) })).rejects.toBeInstanceOf(ScorecardError);
    await expect(runScorecardImport({ store, apiKey: "K", fetchImpl: async () => ({ ok: true, status: 200, json: async () => page }) })).rejects.toMatchObject({ code: "schema_drift" });
  });

  it("maps cost, outcomes, test policy, ownership and locale into stats", () => {
    const s = mapScorecardStats(
      {
        "latest.admissions.admission_rate.overall": 0.12,
        "latest.admissions.sat_scores.25th_percentile.critical_reading": 700,
        "latest.admissions.sat_scores.25th_percentile.math": 720,
        "latest.cost.avg_net_price.overall": 21000,
        "latest.admissions.test_requirements": 3,
        "school.ownership": 2,
        "school.locale": 12,
        "latest.completion.rate_suppressed.overall": 0.94,
      },
      { dataYear: "latest", fetchedAt: "2026-09-29T00:00:00.000Z" },
    );
    expect(s).toMatchObject({ admissionRate: 0.12, avgNetPrice: 21000, testOptional: true, ownership: "PRIVATE_NONPROFIT", locale: "CITY", completionRate: 0.94, dataYear: "latest" });
    expect(s.sat.compositeP25).toBe(1420);
    expect(testOptionalFromRequirement(1)).toBe(false);
    expect(campusSettingFromLocale(42)).toBe("RURAL");
    expect(ownershipType(1)).toBe("PUBLIC");
  });
});
