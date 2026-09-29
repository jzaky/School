import { describe, expect, it } from "vitest";
import sample from "../fixtures/scorecard-sample.json";
import {
  fromSnapshotRow,
  importInstitutions,
  mapScorecardRow,
  normalizeWebsite,
  runScorecardImport,
  scorecardPageUrl,
  ScorecardError,
  toSnapshotRow,
  type ExistingUniversity,
  type ImportStore,
} from "@/server/pathways/scorecard";

function memoryStore(initial: ExistingUniversity[] = []) {
  const rows = new Map<string, ExistingUniversity & Record<string, unknown>>(initial.map((r) => [r.id, { ...r }]));
  let n = 0;
  const store: ImportStore = {
    existing: async () => [...rows.values()].map((r) => ({ id: r.id, key: r.key, nameEn: r.nameEn!, countryCode: r.countryCode, scorecardId: r.scorecardId ?? null })),
    createMany: async (list) => {
      let c = 0;
      for (const w of list) {
        if ([...rows.values()].some((r) => r.key === w.key)) continue;
        const id = `new-${++n}`;
        rows.set(id, { id, ...w });
        c++;
      }
      return c;
    },
    update: async (id, data) => {
      rows.set(id, { ...rows.get(id)!, ...data });
    },
  };
  return { store, rows };
}

const results = sample.results as Array<Record<string, unknown>>;

describe("College Scorecard mapping", () => {
  it("maps flat API rows to institutions", () => {
    const a = mapScorecardRow(results[0])!;
    expect(a).toEqual({
      scorecardId: "900001",
      name: "Example State University",
      city: "Springfield",
      state: "IL",
      website: "www.example-state.edu",
      admissionRate: 0.4321,
      satReading: [560, 660],
      satMath: [570, 690],
      act: [23, 29],
      size: 18000,
    });
    const b = mapScorecardRow(results[1])!;
    expect(b.admissionRate).toBeNull();
    expect(b.satMath).toBeNull();
    expect(b.website).toBe("sample-cc.edu");
    expect(mapScorecardRow(results[2])!.website).toBeNull();
  });

  it("maps nested rows and rejects rows without id or name", () => {
    const nested = mapScorecardRow({ id: 5, school: { name: "Nested College", city: "Austin", state: "TX" }, latest: { admissions: { admission_rate: { overall: 0.9 } } } })!;
    expect(nested).toMatchObject({ scorecardId: "5", name: "Nested College", admissionRate: 0.9, act: null });
    expect(mapScorecardRow({ "school.name": "No id" })).toBeNull();
    expect(mapScorecardRow({ id: 7 })).toBeNull();
  });

  it("round-trips the compact snapshot row and builds page URLs", () => {
    const a = mapScorecardRow(results[0])!;
    expect(fromSnapshotRow(toSnapshotRow(a))).toEqual(a);
    const url = new URL(scorecardPageUrl(3, "KEY"));
    expect(url.searchParams.get("page")).toBe("3");
    expect(url.searchParams.get("school.operating")).toBe("1");
    expect(url.searchParams.get("school.degrees_awarded.highest__range")).toBe("2..4");
    expect(url.searchParams.get("fields")).toContain("latest.admissions.sat_scores.25th_percentile.math");
    expect(normalizeWebsite("HTTPS://Www.X.edu/")).toBe("www.x.edu");
  });
});

describe("College Scorecard import", () => {
  it("creates, links curated rows by name, and is idempotent", async () => {
    const { store, rows } = memoryStore([{ id: "curated", key: "test_tech", nameEn: "Test Institute of Technology", countryCode: "US", scorecardId: null }]);
    const inst = results.map(mapScorecardRow).filter((x) => x !== null);
    const first = await importInstitutions(store, inst);
    expect(first).toMatchObject({ fetched: 3, created: 2, linked: 1, updated: 0 });
    expect(rows.get("curated")).toMatchObject({ key: "test_tech", scorecardId: "900003", acceptanceRate: 5 });
    const created = [...rows.values()].find((r) => r.scorecardId === "900001")!;
    expect(created).toMatchObject({ key: "us-900001", cityEn: "Springfield, IL", acceptanceRate: 43, countryCode: "US", system: "US" });

    const again = await importInstitutions(store, inst);
    expect(again).toMatchObject({ created: 0, linked: 0, updated: 3 });
    expect(rows.size).toBe(3);
    // The curated row keeps its own name.
    expect(rows.get("curated")!.nameEn).toBe("Test Institute of Technology");
  });

  it("paginates until the total is reached", async () => {
    const { store, rows } = memoryStore();
    const pages = [
      { metadata: { total: 150 }, results: Array.from({ length: 100 }, (_, i) => ({ id: 1000 + i, "school.name": `College ${i}`, "school.city": "Town", "school.state": "NY" })) },
      { metadata: { total: 150 }, results: Array.from({ length: 50 }, (_, i) => ({ id: 2000 + i, "school.name": `Institute ${i}`, "school.city": "City", "school.state": "OH" })) },
    ];
    const urls: string[] = [];
    const res = await runScorecardImport({
      store,
      apiKey: "TEST",
      expectFields: ["id", "school.name"],
      fetchImpl: async (url) => {
        urls.push(url);
        const page = Number(new URL(url).searchParams.get("page"));
        return { ok: true, status: 200, json: async () => pages[page] };
      },
    });
    expect(urls).toHaveLength(2);
    expect(res).toMatchObject({ total: 150, pages: 2, created: 150 });
    expect(rows.size).toBe(150);
  });

  it("reports rate limiting and unreachable hosts as typed errors", async () => {
    const { store } = memoryStore();
    await expect(runScorecardImport({ store, apiKey: "DEMO_KEY", sleep: async () => undefined, fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({}) }) })).rejects.toMatchObject({ code: "rate_limited" });
    await expect(
      runScorecardImport({
        store,
        apiKey: "DEMO_KEY",
        sleep: async () => undefined,
        fetchImpl: async () => {
          throw new Error("ECONNREFUSED");
        },
      }),
    ).rejects.toBeInstanceOf(ScorecardError);
  });
});
