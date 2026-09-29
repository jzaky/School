// US Department of Education College Scorecard importer (public domain data).
// API: https://api.data.gov/ed/collegescorecard/v1/schools (key from COLLEGE_SCORECARD_API_KEY, DEMO_KEY otherwise).
// Pure mapping plus a paginated, idempotent importer. Storage is injected so the importer is unit tested
// without a database or network. Rows are matched by University.scorecardId, then by name, so re-running
// never creates duplicates and never replaces the curated catalogue entries.
// Field list, retry policy and mapping helpers (test policy, campus setting, ownership) are ported from
// granitehq/college-tools src/config.js, src/scorecard.js and src/colleges.js (MIT, (c) 2025 Granite HQ, LLC);
// the schema drift guard follows collegedata-fyi tools/scorecard/refresh_summary.py (MIT). See docs/third-party.md.

export const SCORECARD_URL = "https://api.data.gov/ed/collegescorecard/v1/schools";
export const SCORECARD_PER_PAGE = 100;

export const SCORECARD_FIELDS = [
  "id",
  "school.name",
  "school.city",
  "school.state",
  "school.school_url",
  "latest.admissions.admission_rate.overall",
  "latest.admissions.sat_scores.25th_percentile.critical_reading",
  "latest.admissions.sat_scores.75th_percentile.critical_reading",
  "latest.admissions.sat_scores.25th_percentile.math",
  "latest.admissions.sat_scores.75th_percentile.math",
  "latest.admissions.act_scores.25th_percentile.cumulative",
  "latest.admissions.act_scores.75th_percentile.cumulative",
  "latest.student.size",
  "school.ownership",
  "school.locale",
  "latest.student.retention_rate.four_year.full_time",
  "latest.completion.rate_suppressed.overall",
  "latest.earnings.10_yrs_after_entry.median",
  "latest.cost.attendance.academic_year",
  "latest.cost.avg_net_price.overall",
  "latest.cost.tuition.out_of_state",
  "latest.cost.tuition.in_state",
  "latest.admissions.sat_scores.average.overall",
  "latest.admissions.test_requirements",
] as const;

/** Stored in University.stats with provenance. */
export type ScorecardStats = {
  source: "college_scorecard";
  dataYear: string;
  fetchedAt: string;
  admissionRate: number | null;
  sat: { readingP25: number | null; readingP75: number | null; mathP25: number | null; mathP75: number | null; average: number | null; compositeP25: number | null; compositeP75: number | null };
  act: { p25: number | null; p75: number | null };
  size: number | null;
  costOfAttendance: number | null;
  avgNetPrice: number | null;
  tuitionInState: number | null;
  tuitionOutOfState: number | null;
  completionRate: number | null;
  retentionRate: number | null;
  medianEarnings10y: number | null;
  testRequirement: number | null;
  testOptional: boolean | null;
  ownership: "PUBLIC" | "PRIVATE_NONPROFIT" | "PRIVATE_FOR_PROFIT" | null;
  locale: "CITY" | "SUBURBAN" | "TOWN" | "RURAL" | null;
};

/** college-tools testOptionalFromRequirement_: 1 required and 2 recommended are not optional; 3, 4 and 5 are. */
export function testOptionalFromRequirement(code: unknown): boolean | null {
  if (code === null || code === undefined || code === "") return null;
  const v = String(code).toLowerCase().trim();
  if (v === "1" || v === "required") return false;
  if (v === "2" || v.includes("recommend")) return false;
  if (v === "3" || v === "4" || v === "5" || v.includes("optional") || v.includes("not required") || v.includes("neither") || v.includes("considered")) return true;
  return null;
}

/** college-tools campusSettingFromLocale_ (IPEDS locale codes 11-43). */
export function campusSettingFromLocale(code: unknown): ScorecardStats["locale"] {
  const n = Number(code);
  if (code === null || code === undefined || code === "" || Number.isNaN(n)) return null;
  if ((n >= 11 && n <= 13) || n === 1) return "CITY";
  if ((n >= 21 && n <= 23) || n === 2) return "SUBURBAN";
  if ((n >= 31 && n <= 33) || n === 3) return "TOWN";
  if ((n >= 41 && n <= 43) || n === 4) return "RURAL";
  return null;
}

/** college-tools typeFromOwnership. */
export function ownershipType(code: unknown): ScorecardStats["ownership"] {
  const n = Number(code);
  return n === 1 ? "PUBLIC" : n === 2 ? "PRIVATE_NONPROFIT" : n === 3 ? "PRIVATE_FOR_PROFIT" : null;
}

export type UsInstitution = {
  scorecardId: string;
  name: string;
  city: string;
  state: string;
  website: string | null;
  /** 0 to 1, or null when not reported (for example open admission). */
  admissionRate: number | null;
  satReading: [number, number] | null;
  satMath: [number, number] | null;
  act: [number, number] | null;
  size: number | null;
  /** Extra facts for University.stats (set by the importer). */
  stats?: ScorecardStats;
};

/** Read a dotted field from a flat ("school.name") or nested ({school:{name}}) API row. */
function field(row: Record<string, unknown>, path: string): unknown {
  if (path in row) return row[path];
  let cur: unknown = row;
  for (const part of path.split(".")) {
    if (cur && typeof cur === "object" && part in (cur as Record<string, unknown>)) cur = (cur as Record<string, unknown>)[part];
    else return undefined;
  }
  return cur;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const range = (a: unknown, b: unknown): [number, number] | null => {
  const x = num(a);
  const y = num(b);
  return x !== null && y !== null ? [x, y] : null;
};

export function normalizeWebsite(url: string): string | null {
  const u = url.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  return u ? u.toLowerCase() : null;
}

/** Map one API row to our shape. Returns null when the row has no id or name. */
export function mapScorecardRow(row: Record<string, unknown>): UsInstitution | null {
  const id = num(field(row, "id"));
  const name = str(field(row, "school.name"));
  if (id === null || !name) return null;
  const rate = num(field(row, "latest.admissions.admission_rate.overall"));
  return {
    scorecardId: String(id),
    name,
    city: str(field(row, "school.city")),
    state: str(field(row, "school.state")),
    website: normalizeWebsite(str(field(row, "school.school_url"))),
    admissionRate: rate !== null && rate >= 0 && rate <= 1 ? rate : null,
    satReading: range(field(row, "latest.admissions.sat_scores.25th_percentile.critical_reading"), field(row, "latest.admissions.sat_scores.75th_percentile.critical_reading")),
    satMath: range(field(row, "latest.admissions.sat_scores.25th_percentile.math"), field(row, "latest.admissions.sat_scores.75th_percentile.math")),
    act: range(field(row, "latest.admissions.act_scores.25th_percentile.cumulative"), field(row, "latest.admissions.act_scores.75th_percentile.cumulative")),
    size: num(field(row, "latest.student.size")),
  };
}

const rate = (v: unknown) => {
  const n = num(v);
  return n !== null && n >= 0 && n <= 1 ? n : null;
};

/** The University.stats object for one API row. */
export function mapScorecardStats(row: Record<string, unknown>, meta: { dataYear: string; fetchedAt: string }): ScorecardStats {
  const rp25 = num(field(row, "latest.admissions.sat_scores.25th_percentile.critical_reading"));
  const rp75 = num(field(row, "latest.admissions.sat_scores.75th_percentile.critical_reading"));
  const mp25 = num(field(row, "latest.admissions.sat_scores.25th_percentile.math"));
  const mp75 = num(field(row, "latest.admissions.sat_scores.75th_percentile.math"));
  const req = num(field(row, "latest.admissions.test_requirements"));
  return {
    source: "college_scorecard",
    dataYear: meta.dataYear,
    fetchedAt: meta.fetchedAt,
    admissionRate: rate(field(row, "latest.admissions.admission_rate.overall")),
    sat: {
      readingP25: rp25,
      readingP75: rp75,
      mathP25: mp25,
      mathP75: mp75,
      average: num(field(row, "latest.admissions.sat_scores.average.overall")),
      // college-tools: composite from the math and reading percentiles.
      compositeP25: rp25 !== null && mp25 !== null ? rp25 + mp25 : null,
      compositeP75: rp75 !== null && mp75 !== null ? rp75 + mp75 : null,
    },
    act: { p25: num(field(row, "latest.admissions.act_scores.25th_percentile.cumulative")), p75: num(field(row, "latest.admissions.act_scores.75th_percentile.cumulative")) },
    size: num(field(row, "latest.student.size")),
    costOfAttendance: num(field(row, "latest.cost.attendance.academic_year")),
    avgNetPrice: num(field(row, "latest.cost.avg_net_price.overall")),
    tuitionInState: num(field(row, "latest.cost.tuition.in_state")),
    tuitionOutOfState: num(field(row, "latest.cost.tuition.out_of_state")),
    completionRate: rate(field(row, "latest.completion.rate_suppressed.overall")),
    retentionRate: rate(field(row, "latest.student.retention_rate.four_year.full_time")),
    medianEarnings10y: num(field(row, "latest.earnings.10_yrs_after_entry.median")),
    testRequirement: req,
    testOptional: testOptionalFromRequirement(req),
    ownership: ownershipType(field(row, "school.ownership")),
    locale: campusSettingFromLocale(field(row, "school.locale")),
  };
}

/** Schema drift guard: expected fields that no row of the page carries at all (renamed or removed upstream). */
export function missingFields(rows: Array<Record<string, unknown>>, expected: readonly string[] = SCORECARD_FIELDS): string[] {
  if (!rows.length) return [];
  return expected.filter((f) => rows.every((r) => !(f in r) && field(r, f) === undefined));
}

/** Build the URL for one page: currently operating, degree-granting (highest award associate or above). */
export function scorecardPageUrl(page: number, apiKey: string, perPage = SCORECARD_PER_PAGE) {
  const p = new URLSearchParams({
    api_key: apiKey,
    "school.operating": "1",
    "school.degrees_awarded.highest__range": "2..4",
    fields: SCORECARD_FIELDS.join(","),
    per_page: String(perPage),
    page: String(page),
    sort: "id",
  });
  return `${SCORECARD_URL}?${p.toString()}`;
}

export const scorecardKey = () => process.env.COLLEGE_SCORECARD_API_KEY || "DEMO_KEY";

/** Compact tuple used for the committed snapshot file. */
export type SnapshotRow = [string, string, string, string, string | null, number | null, number | null, number | null, number | null, number | null, number | null, number | null, number | null];
export const toSnapshotRow = (u: UsInstitution): SnapshotRow => [u.scorecardId, u.name, u.city, u.state, u.website, u.admissionRate, u.satReading?.[0] ?? null, u.satReading?.[1] ?? null, u.satMath?.[0] ?? null, u.satMath?.[1] ?? null, u.act?.[0] ?? null, u.act?.[1] ?? null, u.size];
export const fromSnapshotRow = (r: SnapshotRow): UsInstitution => ({
  scorecardId: r[0],
  name: r[1],
  city: r[2],
  state: r[3],
  website: r[4],
  admissionRate: r[5],
  satReading: r[6] !== null && r[7] !== null ? [r[6], r[7]] : null,
  satMath: r[8] !== null && r[9] !== null ? [r[8], r[9]] : null,
  act: r[10] !== null && r[11] !== null ? [r[10], r[11]] : null,
  size: r[12],
});

// ---------------------------------------------------------------------------------------------
// Import into University rows

export type ExistingUniversity = { id: string; key: string; nameEn: string; countryCode: string; scorecardId: string | null };
export type UniversityWrite = {
  key: string;
  nameEn: string;
  nameAr: string;
  countryCode: "US";
  cityEn: string;
  cityAr: string;
  website: string | null;
  acceptanceRate: number | null;
  system: "US";
  scorecardId: string;
  stats?: ScorecardStats;
};
export type ImportStore = {
  existing(): Promise<ExistingUniversity[]>;
  createMany(rows: UniversityWrite[]): Promise<number>;
  update(id: string, data: Partial<UniversityWrite>): Promise<void>;
};

export const normName = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/^the\s+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export function toUniversityWrite(u: UsInstitution): UniversityWrite {
  const city = u.state ? `${u.city}, ${u.state}` : u.city;
  return {
    key: `us-${u.scorecardId}`,
    nameEn: u.name,
    // No official Arabic names exist in the source; the English name is shown in both languages.
    nameAr: u.name,
    countryCode: "US",
    cityEn: city,
    cityAr: city,
    website: u.website,
    acceptanceRate: u.admissionRate === null ? null : Math.round(u.admissionRate * 100),
    system: "US",
    scorecardId: u.scorecardId,
    ...(u.stats ? { stats: u.stats } : {}),
  };
}

export type ImportCounts = { fetched: number; created: number; updated: number; linked: number; skipped: number };

/**
 * Upsert institutions. Idempotent: rows already carrying the scorecardId are updated in place,
 * curated rows with the same name (and no scorecardId yet) are linked, everything else is created.
 * Curated rows keep their bilingual name; only the scorecardId and missing facts are filled in.
 */
export async function importInstitutions(store: ImportStore, institutions: UsInstitution[], existing?: ExistingUniversity[]): Promise<ImportCounts> {
  const rows = existing ?? (await store.existing());
  const bySc = new Map(rows.filter((r) => r.scorecardId).map((r) => [r.scorecardId!, r]));
  const byName = new Map(rows.filter((r) => r.countryCode === "US" && !r.scorecardId).map((r) => [normName(r.nameEn), r]));
  const counts: ImportCounts = { fetched: institutions.length, created: 0, updated: 0, linked: 0, skipped: 0 };
  const creates: UniversityWrite[] = [];
  const seen = new Set<string>();
  for (const inst of institutions) {
    if (seen.has(inst.scorecardId)) {
      counts.skipped++;
      continue;
    }
    seen.add(inst.scorecardId);
    const w = toUniversityWrite(inst);
    const hit = bySc.get(inst.scorecardId);
    if (hit) {
      if (hit.key.startsWith("us-")) {
        await store.update(hit.id, { nameEn: w.nameEn, nameAr: w.nameAr, cityEn: w.cityEn, cityAr: w.cityAr, website: w.website, acceptanceRate: w.acceptanceRate, ...(w.stats ? { stats: w.stats } : {}) });
      } else {
        await store.update(hit.id, { acceptanceRate: w.acceptanceRate, ...(w.stats ? { stats: w.stats } : {}) });
      }
      counts.updated++;
      continue;
    }
    const curated = byName.get(normName(inst.name));
    if (curated) {
      // Name matching is a one-time bridge: once linked, the row is matched by scorecardId.
      await store.update(curated.id, { scorecardId: inst.scorecardId, acceptanceRate: w.acceptanceRate, ...(w.stats ? { stats: w.stats } : {}) });
      byName.delete(normName(inst.name));
      bySc.set(inst.scorecardId, { ...curated, scorecardId: inst.scorecardId });
      counts.linked++;
      continue;
    }
    creates.push(w);
  }
  if (creates.length) counts.created = await store.createMany(creates);
  return counts;
}

export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export class ScorecardError extends Error {
  constructor(
    public code: "rate_limited" | "unauthorized" | "unreachable" | "bad_response" | "schema_drift",
    public status?: number,
    public missing?: string[],
  ) {
    super(`scorecard:${code}`);
  }
}

export const backoffDelay = (attempt: number, base = 300, max = 10_000) => Math.min(base * 2 ** attempt, max);
export const shouldRetry = (status: number) => status === 429 || (status >= 500 && status < 600);

/** Fetch with exponential backoff on 429, 5xx and network errors (college-tools policy). Never logs the URL: it holds the key. */
export async function fetchWithRetry(f: FetchLike, url: string, opts: { maxAttempts?: number; sleep?: (ms: number) => Promise<void> } = {}) {
  const attempts = opts.maxAttempts ?? 4;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 0; ; attempt++) {
    let res: Awaited<ReturnType<FetchLike>> | null = null;
    try {
      res = await f(url);
    } catch {
      res = null;
    }
    const last = attempt + 1 >= attempts;
    if (res && !shouldRetry(res.status)) return res;
    if (last) {
      if (!res) throw new ScorecardError("unreachable");
      return res;
    }
    await sleep(backoffDelay(attempt));
  }
}

/** Fetch every page and import it. Stops at maxPages (useful with DEMO_KEY, which is heavily rate limited). */
export async function runScorecardImport(opts: {
  store: ImportStore;
  apiKey: string;
  fetchImpl?: FetchLike;
  maxPages?: number;
  onPage?: (page: number, total: number) => void;
  collect?: (rows: UsInstitution[]) => void;
  /** Retry policy for 429 and 5xx (college-tools: base 300 ms, max 10 s). */
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Fields the first page must carry (drift guard). Defaults to SCORECARD_FIELDS. */
  expectFields?: readonly string[];
  dataYear?: string;
  now?: Date;
}): Promise<ImportCounts & { total: number; pages: number }> {
  const f: FetchLike = opts.fetchImpl ?? ((url) => fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(30_000) }));
  const totals: ImportCounts & { total: number; pages: number } = { fetched: 0, created: 0, updated: 0, linked: 0, skipped: 0, total: 0, pages: 0 };
  let existing = await opts.store.existing();
  for (let page = 0; ; page++) {
    if (opts.maxPages !== undefined && page >= opts.maxPages) break;
    const res = await fetchWithRetry(f, scorecardPageUrl(page, opts.apiKey), { maxAttempts: opts.maxAttempts, sleep: opts.sleep });
    if (res.status === 429) throw new ScorecardError("rate_limited", 429);
    if (res.status === 401 || res.status === 403) throw new ScorecardError("unauthorized", res.status);
    if (!res.ok) throw new ScorecardError("bad_response", res.status);
    const body = (await res.json()) as { metadata?: { total?: number }; results?: Array<Record<string, unknown>> };
    if (!body || !Array.isArray(body.results)) throw new ScorecardError("bad_response", res.status);
    if (page === 0) {
      const missing = missingFields(body.results, opts.expectFields ?? SCORECARD_FIELDS);
      if (missing.length) throw new ScorecardError("schema_drift", res.status, missing);
    }
    const meta = { dataYear: opts.dataYear ?? "latest", fetchedAt: (opts.now ?? new Date()).toISOString() };
    const mapped = body.results
      .map((row) => {
        const m = mapScorecardRow(row);
        return m ? ({ ...m, stats: mapScorecardStats(row, meta) } as UsInstitution) : null;
      })
      .filter((x): x is UsInstitution => x !== null);
    opts.collect?.(mapped);
    const c = await importInstitutions(opts.store, mapped, existing);
    totals.fetched += c.fetched;
    totals.created += c.created;
    totals.updated += c.updated;
    totals.linked += c.linked;
    totals.skipped += c.skipped;
    totals.pages = page + 1;
    totals.total = body.metadata?.total ?? totals.total;
    opts.onPage?.(page, totals.total);
    if (mapped.length === 0 || (page + 1) * SCORECARD_PER_PAGE >= totals.total) break;
    if (c.created || c.linked) existing = await opts.store.existing();
  }
  return totals;
}
