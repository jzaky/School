// US institution data: the committed College Scorecard snapshot and the University store used by the importer.
// University has no columns for SAT/ACT ranges or enrolment size, so those facts are read from the snapshot
// by scorecardId (see docs/decisions.md). Name, city, state, website and admission rate live on University.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import type { Prisma } from "@prisma/client";
import { fromSnapshotRow, toSnapshotRow, type ImportStore, type SnapshotRow, type UsInstitution } from "./scorecard";

export const SNAPSHOT_FILE = "prisma/seed/data/us-institutions.json.gz";
const snapshotPath = () => path.join(process.cwd(), SNAPSHOT_FILE);

type Snapshot = { source: string; fetchedAt: string; rows: SnapshotRow[] };
let cache: { at: number; data: Snapshot | null; byId: Map<string, UsInstitution> } | null = null;

export function loadSnapshot(): Snapshot | null {
  if (cache && Date.now() - cache.at < 10 * 60_000) return cache.data;
  let data: Snapshot | null = null;
  try {
    if (existsSync(snapshotPath())) data = JSON.parse(gunzipSync(readFileSync(snapshotPath())).toString("utf8")) as Snapshot;
  } catch {
    data = null;
  }
  cache = { at: Date.now(), data, byId: new Map((data?.rows ?? []).map((r) => [r[0], fromSnapshotRow(r)])) };
  return data;
}

export function snapshotInstitutions(): UsInstitution[] {
  return (loadSnapshot()?.rows ?? []).map(fromSnapshotRow);
}

/** Scorecard facts for one institution, or null when the snapshot does not include it. */
export function usStats(scorecardId: string | null | undefined): (UsInstitution & { fetchedAt: string }) | null {
  if (!scorecardId) return null;
  const snap = loadSnapshot();
  const hit = cache?.byId.get(scorecardId);
  return hit && snap ? { ...hit, fetchedAt: snap.fetchedAt } : null;
}

export function writeSnapshot(rows: UsInstitution[], fetchedAt = new Date()) {
  const snap: Snapshot = { source: "US Department of Education College Scorecard (public domain)", fetchedAt: fetchedAt.toISOString(), rows: rows.map(toSnapshotRow) };
  writeFileSync(snapshotPath(), gzipSync(Buffer.from(JSON.stringify(snap)), { level: 9 }));
  cache = null;
}

type UniDb = {
  university: {
    findMany(args: Prisma.UniversityFindManyArgs): Promise<Array<{ id: string; key: string; nameEn: string; countryCode: string; scorecardId: string | null }>>;
    createMany(args: { data: Prisma.UniversityCreateManyInput[]; skipDuplicates?: boolean }): Promise<{ count: number }>;
    update(args: { where: { id: string }; data: Prisma.UniversityUpdateInput }): Promise<unknown>;
  };
};

/** ImportStore backed by the University table of one organization, or the global catalog when orgId is null (owner role only). */
export function universityStore(db: UniDb, orgId: string | null): ImportStore {
  return {
    existing: () => db.university.findMany({ where: { orgId, countryCode: "US" }, select: { id: true, key: true, nameEn: true, countryCode: true, scorecardId: true } }),
    async createMany(rows) {
      let n = 0;
      for (let i = 0; i < rows.length; i += 500) {
        const res = await db.university.createMany({ data: rows.slice(i, i + 500).map((r) => ({ ...r, orgId, programsEn: [] })), skipDuplicates: true });
        n += res.count;
      }
      return n;
    },
    async update(id, data) {
      await db.university.update({ where: { id }, data });
    },
  };
}
