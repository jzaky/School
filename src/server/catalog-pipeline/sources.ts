// Source registry. Every requirement version points at a RequirementSource: where the data came from.
// sourceType: OFFICIAL_UNIVERSITY (the university's own page), OFFICIAL_BODY (UCAS, Common App, a
// ministry), MIRROR (a third-party copy) or MANUAL (typed in by a person). Mirrors never override official
// data (the collegedata-fyi source_provenance rule): a mirror is not extracted while the program has a
// working official source, and a mirror extraction cannot replace a version that came from an official one.
// No "server-only" marker: the worker imports it.
import type { Prisma } from "@prisma/client";
import { SOURCE_TYPES, type SourceType } from "./types";

export const REFRESH_INTERVAL_DAYS = 7;
const OFFICIAL = ["OFFICIAL_UNIVERSITY", "OFFICIAL_ADMISSIONS", "OFFICIAL_BODY"];

/** Seeded variants map onto the four source types (OFFICIAL_ADMISSIONS is a university's own admissions page). */
export const canonicalSourceType = (t: string): SourceType => (t === "OFFICIAL_ADMISSIONS" ? "OFFICIAL_UNIVERSITY" : isSourceType(t) ? t : "MANUAL");
export const isOfficial = (t: string) => t.startsWith("OFFICIAL_");
export const sourceRank = (t: string) => {
  const c = canonicalSourceType(t);
  return c === "OFFICIAL_UNIVERSITY" ? 3 : c === "OFFICIAL_BODY" ? 2 : c === "MANUAL" ? 1 : 0;
};

/** Can data from `incoming` replace data that came from `current`? */
export function canOverride(current: string | null | undefined, incoming: string) {
  if (!current) return true;
  return !(incoming === "MIRROR" && isOfficial(current));
}

/** Only http(s) URLs with a host are accepted; the fragment is dropped. */
export function normalizeSourceUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname.includes(".")) return null;
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

export const isSourceType = (t: string): t is SourceType => (SOURCE_TYPES as readonly string[]).includes(t);

type SourceDb = Pick<Prisma.TransactionClient, "requirementSource" | "universityProgram" | "university">;

/** Add a source (or return the existing one with the same URL for that program). */
export async function upsertSource(db: SourceDb, input: { orgId: string | null; universityId: string; programId: string | null; url: string; title?: string | null; sourceType: SourceType }) {
  const url = normalizeSourceUrl(input.url);
  if (!url) return null;
  const existing = await db.requirementSource.findFirst({ where: { url, programId: input.programId, universityId: input.universityId } });
  if (existing) return { source: existing, created: false };
  const source = await db.requirementSource.create({ data: { orgId: input.orgId, universityId: input.universityId, programId: input.programId, url, title: input.title ?? null, sourceType: input.sourceType, status: "PENDING" } });
  return { source, created: true };
}

/**
 * Discover sources from the catalog: each program's sourceUrl (official university page) and each
 * university's website (university-level source, no program). Idempotent. Global rows only by default.
 */
export async function discoverSources(db: SourceDb, opts: { orgId?: string | null; limit?: number } = {}) {
  const orgId = opts.orgId ?? null;
  const programs = await db.universityProgram.findMany({ where: { orgId, sourceUrl: { not: null } }, select: { id: true, universityId: true, sourceUrl: true, nameEn: true }, take: opts.limit ?? 2000 });
  const unis = await db.university.findMany({ where: { orgId, website: { not: null }, id: { in: [...new Set(programs.map((p) => p.universityId))] } }, select: { id: true, website: true, nameEn: true } });
  let created = 0;
  for (const p of programs) {
    const r = await upsertSource(db, { orgId, universityId: p.universityId, programId: p.id, url: p.sourceUrl!, title: p.nameEn, sourceType: "OFFICIAL_UNIVERSITY" });
    if (r?.created) created++;
  }
  for (const u of unis) {
    const site = u.website!.startsWith("http") ? u.website! : `https://${u.website}`;
    const r = await upsertSource(db, { orgId, universityId: u.id, programId: null, url: site, title: u.nameEn, sourceType: "OFFICIAL_UNIVERSITY" });
    if (r?.created) created++;
  }
  return { programs: programs.length, universities: unis.length, created };
}

/** Sources that are due: never fetched, or last fetched more than the interval ago. Official first. */
export async function dueSources(db: Pick<Prisma.TransactionClient, "requirementSource">, now: Date, limit = 50) {
  const cutoff = new Date(now.getTime() - REFRESH_INTERVAL_DAYS * 86_400_000);
  const rows = await db.requirementSource.findMany({ where: { OR: [{ retrievedAt: null }, { retrievedAt: { lt: cutoff } }] }, orderBy: [{ retrievedAt: { sort: "asc", nulls: "first" } }], take: limit * 2 });
  return rows.sort((a, b) => sourceRank(b.sourceType) - sourceRank(a.sourceType)).slice(0, limit);
}

/** True when this mirror should not be extracted because the program has a working official source. */
export async function mirrorShadowed(db: Pick<Prisma.TransactionClient, "requirementSource">, source: { id: string; programId: string | null; sourceType: string }) {
  if (source.sourceType !== "MIRROR" || !source.programId) return false;
  const official = await db.requirementSource.count({ where: { programId: source.programId, id: { not: source.id }, sourceType: { in: OFFICIAL }, status: { not: "FAILED" } } });
  return official > 0;
}
