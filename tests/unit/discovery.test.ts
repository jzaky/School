import { describe, expect, it } from "vitest";
import { buildProgramWhere, filterAndSort, paginate, parseCompareIds, parseDiscoveryQuery, queryParams, searchTokens, tuitionBand, tuitionUsd, type MatchInfo, type SearchItem } from "@/server/discovery/search";
import { alignRequirements, alignmentKey, rowDiffers } from "@/server/discovery/compare";
import { evaluate } from "@/server/pathway-engine/evaluate";
import { course, m, profile, program, row, subj } from "./pathway-engine/fixtures";

describe("search query parsing", () => {
  it("keeps only known values and splits countries", () => {
    const q = parseDiscoveryQuery({ q: "  computer science ", country: "gb,US,xx1,GB", degree: "BACHELOR", level: "NOPE", lang: "en", tuition: "mid", intake: "2027", curriculum: "IB", status: "ON_TRACK", sort: "tuition", page: "3" }, { hasStudent: true });
    expect(q).toMatchObject({ q: "computer science", countries: ["GB", "US"], degreeType: "BACHELOR", level: null, language: "en", tuition: "mid", intake: 2027, curriculum: "IB", status: "ON_TRACK", sort: "tuition", page: 3 });
  });

  it("drops match status and best match without a student", () => {
    const q = parseDiscoveryQuery({ status: "ELIGIBLE", sort: "match" }, { hasStudent: false });
    expect(q.status).toBeNull();
    expect(q.sort).toBe("rank");
    expect(parseDiscoveryQuery({}, { hasStudent: true }).sort).toBe("match");
  });

  it("round trips through URL parameters", () => {
    const q = parseDiscoveryQuery({ q: "ai", country: "GB,CA", tuition: "low", sort: "name" }, { hasStudent: false });
    const p = queryParams({ ...q, page: 2 }, { student: "s1" });
    expect(p.get("country")).toBe("GB,CA");
    expect(p.get("page")).toBe("2");
    expect(p.get("student")).toBe("s1");
    expect(parseDiscoveryQuery(Object.fromEntries(p), { hasStudent: false })).toMatchObject({ q: "ai", countries: ["GB", "CA"], tuition: "low", sort: "name", page: 2 });
  });

  it("splits text into at most six distinct words and strips LIKE wildcards", () => {
    expect(searchTokens("AI  engineering, London")).toEqual(["ai", "engineering", "london"]);
    expect(searchTokens("100%_x")).toEqual(["100", "x"]);
    expect(searchTokens("a b c d e f g h")).toHaveLength(6);
  });
});

describe("database filter", () => {
  it("is always scoped to the school and the global catalog", () => {
    const w = buildProgramWhere(parseDiscoveryQuery({}, { hasStudent: false }), "org1");
    expect(w).toEqual({ AND: [{ OR: [{ orgId: "org1" }, { orgId: null }] }] });
  });

  it("ANDs one OR group per word plus field, degree, language and id lists", () => {
    const q = parseDiscoveryQuery({ q: "computer london", field: "computer_science", degree: "BACHELOR", lang: "en" }, { hasStudent: false });
    const w = buildProgramWhere(q, "org1", { intake: ["p1", "p2"], curriculum: ["p2"] });
    const and = w.AND as Array<Record<string, unknown>>;
    expect(and).toHaveLength(8);
    expect(and[1]).toMatchObject({ OR: expect.arrayContaining([{ searchText: { contains: "computer", mode: "insensitive" } }]) });
    expect(and[2]).toMatchObject({ OR: expect.arrayContaining([{ nameAr: { contains: "london" } }]) });
    expect(and).toContainEqual({ fieldKeys: { has: "computer_science" } });
    expect(and).toContainEqual({ degreeType: "BACHELOR" });
    expect(and).toContainEqual({ teachingLanguage: "en" });
    expect(and).toContainEqual({ id: { in: ["p1", "p2"] } });
    expect(and).toContainEqual({ id: { in: ["p2"] } });
  });

  it("an empty id list filters everything out rather than being ignored", () => {
    const w = buildProgramWhere(parseDiscoveryQuery({}, { hasStudent: false }), "org1", { curriculum: [] });
    expect(w.AND).toContainEqual({ id: { in: [] } });
  });
});

describe("tuition bands", () => {
  it("converts to approximate US dollars", () => {
    expect(tuitionUsd(40000, "GBP")).toBe(50800);
    expect(tuitionUsd(100, "XYZ")).toBeNull();
    expect(tuitionUsd(null, "USD")).toBeNull();
    expect(tuitionBand(19_999)).toBe("low");
    expect(tuitionBand(45_000)).toBe("mid");
    expect(tuitionBand(45_001)).toBe("high");
  });
});

describe("in-memory filters and sorts", () => {
  const item = (id: string, country: string, rank: number | null, tuition: number | null, currency = "USD", name = id): SearchItem => ({ id, nameEn: name, nameAr: name, tuitionPerYear: tuition, tuitionCurrency: currency, university: { countryCode: country, worldRank: rank, nameEn: "U", nameAr: "U" } });
  const items = [item("a", "GB", 10, 30000, "GBP"), item("b", "US", 1, 60000), item("c", "AE", null, 60000, "AED"), item("d", "CA", 30, null, "CAD")];
  const q = (sp: Record<string, string>, hasStudent = true) => parseDiscoveryQuery(sp, { hasStudent });
  const matches = new Map<string, MatchInfo>([
    ["a", { status: "MISSING_REQUIREMENTS", missing: 1 }],
    ["b", { status: "ON_TRACK", missing: 0 }],
    ["c", { status: "ELIGIBLE", missing: 0 }],
    ["d", { status: "ON_TRACK", missing: 0 }],
  ]);

  it("filters by several countries, tuition band and match status", () => {
    expect(filterAndSort(items, q({ country: "GB,US" }), null, "en").map((x) => x.id)).toEqual(["b", "a"]);
    expect(filterAndSort(items, q({ tuition: "low" }), null, "en").map((x) => x.id)).toEqual(["c"]);
    expect(filterAndSort(items, q({ status: "ON_TRACK" }), matches, "en").map((x) => x.id)).toEqual(["b", "d"]);
  });

  it("sorts by best match, then fewer missing lines, then world rank", () => {
    expect(filterAndSort(items, q({}), matches, "en").map((x) => x.id)).toEqual(["c", "b", "d", "a"]);
  });

  it("sorts by tuition with unknown last, and by rank with unranked last", () => {
    expect(filterAndSort(items, q({ sort: "tuition" }), null, "en").map((x) => x.id)).toEqual(["c", "a", "b", "d"]);
    expect(filterAndSort(items, q({ sort: "rank" }), null, "en").map((x) => x.id)).toEqual(["b", "a", "d", "c"]);
  });

  it("paginates and clamps the page", () => {
    const list = Array.from({ length: 45 }, (_, i) => i);
    expect(paginate(list, 3, 20)).toMatchObject({ page: 3, pages: 3, total: 45, items: [40, 41, 42, 43, 44] });
    expect(paginate(list, 9, 20).page).toBe(3);
    expect(paginate([], 1, 20)).toMatchObject({ page: 1, pages: 1, items: [] });
  });

  it("reads 2 to 4 distinct compare ids", () => {
    expect(parseCompareIds("abcdef1,abcdef2,abcdef1,bad id,abcdef3,abcdef4,abcdef5")).toEqual(["abcdef1", "abcdef2", "abcdef3", "abcdef4"]);
    expect(parseCompareIds(undefined)).toEqual([]);
  });
});

describe("compare alignment", () => {
  const student = profile({ curriculum: "BRITISH", courses: [course({ mappings: [m("mathematics")], finalGrade: "A", nameEn: "A-Level Mathematics" })] });
  const lang = (id: string, min: number) => ({ id, test: "IELTS", minOverall: min });
  const p1 = program(row({ curriculum: null, languages: [lang("l1", 6.5)] }), row({ gradeProfile: "AAA", subjects: [subj("REQUIRED", ["mathematics"], "ADVANCED", "A"), subj("RECOMMENDED", ["further_mathematics"])] }));
  const p2 = program(row({ curriculum: null, languages: [lang("l2", 7)] }), row({ subjects: [subj("REQUIRED", ["mathematics"], "ADVANCED", "A*"), subj("ONE_OF", ["physics", "chemistry"])] }));
  const p3 = program(row({ subjects: [subj("ONE_OF", ["chemistry", "physics"]), subj("REQUIRED", ["physics"])], tests: [{ id: "t1", test: "SAT", policy: "REQUIRED" }, { id: "t2", test: "ACT", policy: "REQUIRED" }] }));
  const results = [p1, p2, p3].map((p) => evaluate(student, p));
  const rows = alignRequirements(results);
  const byKey = new Map(rows.map((r) => [r.key, r]));

  it("puts the same canonical subject on one row", () => {
    const maths = byKey.get("subject:mathematics")!;
    expect(maths.cells.map((c) => c?.required ?? null)).toEqual(["A", "A*", null]);
    expect(rowDiffers(maths)).toBe(true);
  });

  it("aligns lines naming the same set of subjects regardless of order", () => {
    const either = byKey.get("subject:chemistry+physics")!;
    expect(either.cells.map((c) => (c ? c.type : null))).toEqual([null, "ONE_OF", "ONE_OF"]);
    expect(byKey.get("subject:physics")!.cells.filter(Boolean)).toHaveLength(1);
  });

  it("gives English tests one row and SAT or ACT one row", () => {
    const l = byKey.get("language")!;
    expect(l.cells.map((c) => c?.required ?? null)).toEqual([6.5, 7, null]);
    expect(byKey.has("test:ACT+SAT")).toBe(true);
  });

  it("orders sections and puts binding lines before advice", () => {
    const sections = rows.map((r) => r.section);
    expect(sections.indexOf("overall")).toBeLessThan(sections.indexOf("subject"));
    expect(sections.lastIndexOf("subject")).toBeLessThan(sections.indexOf("language"));
    expect(sections.indexOf("language")).toBeLessThan(sections.indexOf("test"));
    const subjects = rows.filter((r) => r.section === "subject");
    expect(subjects[subjects.length - 1].key).toBe("subject:further_mathematics");
    expect(subjects[subjects.length - 1].advisory).toBe(true);
    expect(subjects[0].key).toBe("subject:mathematics");
  });

  it("keeps the student's outcome per cell", () => {
    const maths = byKey.get("subject:mathematics")!;
    expect(maths.cells[0]?.status).not.toBe("not_met");
    expect(alignmentKey(maths.cells[0]!)).toBe("subject:mathematics");
  });

  it("handles a programme with no rows", () => {
    const out = alignRequirements([results[0], null]);
    expect(out.every((r) => r.cells[1] === null)).toBe(true);
  });
});
