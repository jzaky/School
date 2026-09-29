// Background jobs for the requirement pipeline (queue "catalog"):
// - "catalog.refresh": weekly (and on demand from "Check now"): fetch due sources, extract changed ones.
// - "catalog.scorecard": on demand: College Scorecard import into the global University catalog.
// Idempotent: extraction is keyed by (source, contentHash, model, prompt version); Scorecard rows are
// matched by scorecardId. Without an owner database URL the jobs log a skip and succeed.
// Logs carry ids and counts only, never page text or personal data.
import type { Prisma, PrismaClient } from "@prisma/client";
import { tenantDb } from "@/lib/tenant-db";
import { catalogDb } from "@/server/platform/catalog-db";
import { runScorecardImport, ScorecardError, type ExistingUniversity, type FetchLike, type ImportStore } from "@/server/pathways/scorecard";
import { extractForSource, loadVocab } from "./extract";
import { refreshSource, type FetchImpl, type RawStore } from "./fetch";
import { dueSources, mirrorShadowed } from "./sources";

export const CATALOG_QUEUE = "catalog";
export const REFRESH_JOB = "catalog.refresh";
export const SCORECARD_JOB = "catalog.scorecard";

export type RefreshJob = { sourceIds?: string[]; requestedByOrgId?: string; runId?: string };
export type ScorecardJob = { requestedByOrgId?: string; runId?: string };

type Log = (msg: string) => void;
const defaultLog: Log = (m) => console.log(`[catalog] ${m}`);

async function recordRun(orgId: string | undefined, runId: string | undefined, status: "COMPLETED" | "FAILED", result: Record<string, unknown>) {
  if (!orgId || !runId) return;
  await tenantDb(orgId)
    .jobRun.update({ where: { id: runId }, data: { status, finishedAt: new Date(), result: result as Prisma.InputJsonValue } })
    .catch(() => undefined);
}

export type RefreshCounts = { checked: number; inserted: number; unchanged: number; changed: number; failed: number; extracted: number; cached: number; shadowed: number };

export async function runCatalogRefresh(
  data: RefreshJob,
  opts: { catalog?: PrismaClient | null; now?: Date; fetchImpl?: FetchImpl; store?: RawStore | null; limit?: number; log?: Log } = {},
): Promise<RefreshCounts | { skipped: "no_owner_url" }> {
  const log = opts.log ?? defaultLog;
  const db = opts.catalog === undefined ? catalogDb() : opts.catalog;
  if (!db) {
    log("refresh skipped: no owner database URL (PLATFORM_DATABASE_URL or MIGRATION_DATABASE_URL) is configured");
    await recordRun(data.requestedByOrgId, data.runId, "FAILED", { error: "no_owner_url" });
    return { skipped: "no_owner_url" };
  }
  const now = opts.now ?? new Date();
  const sources = data.sourceIds?.length ? await db.requirementSource.findMany({ where: { id: { in: data.sourceIds } } }) : await dueSources(db, now, opts.limit ?? 50);
  const counts: RefreshCounts = { checked: 0, inserted: 0, unchanged: 0, changed: 0, failed: 0, extracted: 0, cached: 0, shadowed: 0 };
  const robotsCache = new Map();
  const vocab = await loadVocab(db);
  for (const s of sources) {
    counts.checked++;
    const r = await refreshSource(db, s.id, { now, fetchImpl: opts.fetchImpl, store: opts.store, robotsCache });
    if (r.outcome === "FAILED") {
      counts.failed++;
      continue;
    }
    if (r.outcome === "UNCHANGED") {
      counts.unchanged++;
      continue;
    }
    if (r.outcome === "INSERTED") counts.inserted++;
    else counts.changed++;
    if (await mirrorShadowed(db, s)) {
      counts.shadowed++;
      continue;
    }
    const ex = await extractForSource(db, { sourceId: s.id, text: r.text, contentHash: r.contentHash, finalUrl: r.finalUrl, vocab });
    if (ex.status === "created") counts.extracted++;
    else if (ex.status === "cached") counts.cached++;
  }
  log(`refresh done: ${JSON.stringify(counts)}`);
  await recordRun(data.requestedByOrgId, data.runId, "COMPLETED", counts);
  return counts;
}

/** ImportStore backed by the global University catalog (orgId null). */
export function globalUniversityStore(db: PrismaClient): ImportStore {
  return {
    existing: () => db.university.findMany({ where: { orgId: null, countryCode: "US" }, select: { id: true, key: true, nameEn: true, countryCode: true, scorecardId: true } }) as Promise<ExistingUniversity[]>,
    async createMany(rows) {
      let n = 0;
      for (let i = 0; i < rows.length; i += 500) {
        const res = await db.university.createMany({ data: rows.slice(i, i + 500).map((r) => ({ ...r, stats: (r.stats ?? undefined) as Prisma.InputJsonValue | undefined, orgId: null, programsEn: [] })), skipDuplicates: true });
        n += res.count;
      }
      return n;
    },
    async update(id, data) {
      await db.university.update({ where: { id }, data: { ...data, stats: (data.stats ?? undefined) as Prisma.InputJsonValue | undefined } });
    },
  };
}

export async function runCatalogScorecard(
  data: ScorecardJob,
  opts: { catalog?: PrismaClient | null; apiKey?: string | null; fetchImpl?: FetchLike; maxPages?: number; now?: Date; log?: Log } = {},
) {
  const log = opts.log ?? defaultLog;
  const db = opts.catalog === undefined ? catalogDb() : opts.catalog;
  if (!db) {
    log("scorecard skipped: no owner database URL is configured");
    await recordRun(data.requestedByOrgId, data.runId, "FAILED", { error: "no_owner_url" });
    return { skipped: "no_owner_url" as const };
  }
  const apiKey = opts.apiKey === undefined ? process.env.COLLEGE_SCORECARD_API_KEY || null : opts.apiKey;
  if (!apiKey) {
    log("scorecard skipped: COLLEGE_SCORECARD_API_KEY is not set");
    await recordRun(data.requestedByOrgId, data.runId, "FAILED", { error: "no_api_key" });
    return { skipped: "no_api_key" as const };
  }
  try {
    const res = await runScorecardImport({ store: globalUniversityStore(db), apiKey, fetchImpl: opts.fetchImpl, maxPages: opts.maxPages, now: opts.now });
    log(`scorecard done: created=${res.created} updated=${res.updated} linked=${res.linked} pages=${res.pages}`);
    await recordRun(data.requestedByOrgId, data.runId, "COMPLETED", res);
    return res;
  } catch (e) {
    const code = e instanceof ScorecardError ? e.code : "unreachable";
    const missing = e instanceof ScorecardError ? e.missing : undefined;
    log(`scorecard failed: ${code}${missing?.length ? ` missing=${missing.join(",")}` : ""}`);
    await recordRun(data.requestedByOrgId, data.runId, "FAILED", { error: code, ...(missing ? { missing } : {}) });
    throw e;
  }
}
