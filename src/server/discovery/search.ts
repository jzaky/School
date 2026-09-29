// Programme search: parsing the URL, building the database filter, and the in-memory filters and sorts
// that need university facts or engine results. Pure (no database, no server-only imports) so it can be
// unit tested and shared by the page and the global search.
import type { Prisma } from "@prisma/client";
import { CURRICULA, MATCH_STATUSES, STATUS_RANK, type Curriculum, type MatchStatus } from "@/server/pathway-engine/types";

export const SORTS = ["match", "name", "tuition", "rank"] as const;
export type Sort = (typeof SORTS)[number];
export const TUITION_BANDS = ["low", "mid", "high"] as const;
export type TuitionBand = (typeof TUITION_BANDS)[number];
export const DEGREE_TYPES = ["BACHELOR", "INTEGRATED_MASTERS", "PROFESSIONAL", "ASSOCIATE", "FOUNDATION"] as const;
export const LEVELS = ["UNDERGRADUATE", "POSTGRADUATE"] as const;
export const LANGUAGES = ["en", "ar", "fr", "de"] as const;
export const PAGE_SIZE = 20;
export const MAX_COMPARE = 4;

export type DiscoveryQuery = {
  q: string;
  countries: string[];
  field: string | null;
  degreeType: string | null;
  level: string | null;
  language: string | null;
  tuition: TuitionBand | null;
  intake: number | null;
  curriculum: Curriculum | null;
  status: MatchStatus | null;
  sort: Sort;
  page: number;
};

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || "";
const oneOf = <T extends string>(list: readonly T[], v: string): T | null => ((list as readonly string[]).includes(v) ? (v as T) : null);
const SAFE = /^[a-z0-9_]{1,40}$/i;

/** Read the search from URL parameters. Unknown values are dropped, never passed on to the database. */
export function parseDiscoveryQuery(sp: Params, opts: { hasStudent: boolean }): DiscoveryQuery {
  const countries = [
    ...new Set(
      one(sp.country)
        .split(",")
        .map((c) => c.trim().toUpperCase())
        .filter((c) => /^[A-Z]{2}$/.test(c)),
    ),
  ].slice(0, 20);
  const field = one(sp.field);
  const intake = Number.parseInt(one(sp.intake), 10);
  const sort = oneOf(SORTS, one(sp.sort)) ?? (opts.hasStudent ? "match" : "rank");
  return {
    q: one(sp.q).slice(0, 100),
    countries,
    field: SAFE.test(field) ? field : null,
    degreeType: oneOf(DEGREE_TYPES, one(sp.degree)),
    level: oneOf(LEVELS, one(sp.level)),
    language: oneOf(LANGUAGES, one(sp.lang)),
    tuition: oneOf(TUITION_BANDS, one(sp.tuition)),
    intake: Number.isFinite(intake) && intake >= 2000 && intake <= 2100 ? intake : null,
    curriculum: oneOf(CURRICULA, one(sp.curriculum)),
    status: opts.hasStudent ? oneOf(MATCH_STATUSES, one(sp.status)) : null,
    sort: sort === "match" && !opts.hasStudent ? "rank" : sort,
    page: Math.max(1, Math.min(1000, Number.parseInt(one(sp.page), 10) || 1)),
  };
}

/** Words to match. Every word must appear (AND); each word may match any searchable column (OR). */
export function searchTokens(q: string): string[] {
  return [
    ...new Set(
      q
        .toLowerCase()
        .replace(/[%_\\]/g, " ")
        .split(/[\s,()·]+/)
        .map((w) => w.trim())
        .filter(Boolean),
    ),
  ].slice(0, 6);
}

/**
 * The database part of the search: text, field of study, degree type, level and teaching language, plus
 * id lists worked out beforehand for intake year and curriculum coverage (null means no such filter).
 * Always scoped to the school's own rows and the global catalog.
 */
export function buildProgramWhere(query: DiscoveryQuery, orgId: string, ids: { intake?: string[] | null; curriculum?: string[] | null } = {}): Prisma.UniversityProgramWhereInput {
  const and: Prisma.UniversityProgramWhereInput[] = [{ OR: [{ orgId }, { orgId: null }] }];
  for (const w of searchTokens(query.q)) {
    and.push({ OR: [{ searchText: { contains: w, mode: "insensitive" } }, { nameEn: { contains: w, mode: "insensitive" } }, { nameAr: { contains: w } }, { degree: { contains: w, mode: "insensitive" } }] });
  }
  if (query.field) and.push({ fieldKeys: { has: query.field } });
  if (query.degreeType) and.push({ degreeType: query.degreeType });
  if (query.level) and.push({ level: query.level });
  if (query.language) and.push({ teachingLanguage: query.language });
  if (ids.intake) and.push({ id: { in: ids.intake } });
  if (ids.curriculum) and.push({ id: { in: ids.curriculum } });
  return { AND: and };
}

/** Approximate US dollars per unit, used only to put programmes in tuition bands and sort by cost. */
export const USD_RATE: Record<string, number> = { USD: 1, GBP: 1.27, EUR: 1.08, CAD: 0.73, AUD: 0.66, AED: 0.2723, SGD: 0.74, HKD: 0.128, CHF: 1.12, JOD: 1.41, SAR: 0.2667, QAR: 0.2747 };

export function tuitionUsd(amount: number | null | undefined, currency: string | null | undefined): number | null {
  if (amount == null || !currency) return null;
  const rate = USD_RATE[currency.toUpperCase()];
  return rate ? Math.round(amount * rate) : null;
}

/** Low: under 20,000 US dollars a year. Mid: 20,000 to 45,000. High: over 45,000. */
export function tuitionBand(usd: number | null): TuitionBand | null {
  if (usd == null) return null;
  if (usd < 20_000) return "low";
  if (usd <= 45_000) return "mid";
  return "high";
}

/** What the in-memory steps need to know about a programme (a subset of the engine's ProgramMeta). */
export type SearchItem = {
  id: string;
  nameEn: string;
  nameAr: string;
  tuitionPerYear: number | null;
  tuitionCurrency: string | null;
  university: { countryCode: string; worldRank: number | null; nameEn: string; nameAr: string };
};
export type MatchInfo = { status: MatchStatus; missing: number };

/** Country, tuition and match status filters, then the chosen sort. Stable: ties fall back to world rank and name. */
export function filterAndSort<T extends SearchItem>(items: T[], query: DiscoveryQuery, matches: Map<string, MatchInfo> | null, locale: string): T[] {
  const countries = new Set(query.countries);
  const name = (x: T) => (locale === "ar" ? x.nameAr || x.nameEn : x.nameEn);
  const rank = (x: T) => x.university.worldRank ?? 99_999;
  const out = items.filter((x) => {
    if (countries.size && !countries.has(x.university.countryCode)) return false;
    if (query.tuition && tuitionBand(tuitionUsd(x.tuitionPerYear, x.tuitionCurrency)) !== query.tuition) return false;
    if (query.status && matches?.get(x.id)?.status !== query.status) return false;
    return true;
  });
  const byName = (a: T, b: T) => name(a).localeCompare(name(b), locale === "ar" ? "ar" : "en") || a.id.localeCompare(b.id);
  const byRank = (a: T, b: T) => rank(a) - rank(b) || byName(a, b);
  const cmp: Record<Sort, (a: T, b: T) => number> = {
    name: byName,
    rank: byRank,
    tuition: (a, b) => (tuitionUsd(a.tuitionPerYear, a.tuitionCurrency) ?? Infinity) - (tuitionUsd(b.tuitionPerYear, b.tuitionCurrency) ?? Infinity) || byRank(a, b),
    match: (a, b) => {
      const ma = matches?.get(a.id);
      const mb = matches?.get(b.id);
      return (mb ? STATUS_RANK[mb.status] : -1) - (ma ? STATUS_RANK[ma.status] : -1) || (ma?.missing ?? 99) - (mb?.missing ?? 99) || byRank(a, b);
    },
  };
  return out.sort(cmp[query.sort]);
}

export function paginate<T>(items: T[], page: number, pageSize = PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const p = Math.min(Math.max(1, page), pages);
  return { page: p, pages, total: items.length, items: items.slice((p - 1) * pageSize, p * pageSize) };
}

/** URL parameters for a query (defaults left out), for links such as pagination. */
export function queryParams(query: DiscoveryQuery, extra: Record<string, string | null | undefined> = {}): URLSearchParams {
  const p = new URLSearchParams();
  if (query.q) p.set("q", query.q);
  if (query.countries.length) p.set("country", query.countries.join(","));
  if (query.field) p.set("field", query.field);
  if (query.degreeType) p.set("degree", query.degreeType);
  if (query.level) p.set("level", query.level);
  if (query.language) p.set("lang", query.language);
  if (query.tuition) p.set("tuition", query.tuition);
  if (query.intake) p.set("intake", String(query.intake));
  if (query.curriculum) p.set("curriculum", query.curriculum);
  if (query.status) p.set("status", query.status);
  p.set("sort", query.sort);
  if (query.page > 1) p.set("page", String(query.page));
  for (const [k, v] of Object.entries(extra)) {
    if (v) p.set(k, v);
    else p.delete(k);
  }
  return p;
}

/** Programme ids for the compare page: 2 to 4 distinct ids from ?ids=a,b,c. */
export function parseCompareIds(raw: string | string[] | undefined): string[] {
  return [
    ...new Set(
      one(raw)
        .split(",")
        .map((s) => s.trim())
        .filter((s) => /^[a-z0-9_-]{6,64}$/i.test(s)),
    ),
  ].slice(0, MAX_COMPARE);
}
