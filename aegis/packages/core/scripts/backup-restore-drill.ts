/**
 * Backup and restore drill (docs/BACKUP_RECOVERY.md, docs/SECURITY_VALIDATION.md).
 *   MIGRATION_DATABASE_URL=postgresql://owner@host/aegis pnpm --filter @aegis/core drill:restore
 * 1. pg_dump -Fc of the live database (owner role) to a temporary file.
 * 2. pg_restore into a fresh scratch database on the same server.
 * 3. For every organization: the evidence chain verifies on the restored copy, its last hash equals the
 *    source's, and the row counts of the core tables match.
 * 4. The scratch database and the dump are removed. Exit code 1 on any difference.
 * It never writes to the source database.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@aegis/db";
import { verifyChain } from "../src/evidence/ledger.js";

const source = process.env.MIGRATION_DATABASE_URL;
if (!source) {
  console.error("Set MIGRATION_DATABASE_URL (the owner role): the drill reads every tenant.");
  process.exit(2);
}
const scratchName = `aegis_restore_drill_${Date.now().toString(36)}`;
const srcUrl = new URL(source);
const scratchUrl = new URL(source);
scratchUrl.pathname = `/${scratchName}`;
const adminUrl = new URL(source);
adminUrl.pathname = "/postgres";

const TABLES = ["organizations", "agents", "policies", "policy_versions", "action_requests", "authorization_decisions", "approval_requests", "execution_receipts", "evidence_events", "evidence_checkpoints", "security_events"];
const started = Date.now();
const dir = mkdtempSync(join(tmpdir(), "aegis-drill-"));
const dump = join(dir, "aegis.dump");
const src = new PrismaClient({ datasources: { db: { url: srcUrl.toString() } } });
const dst = new PrismaClient({ datasources: { db: { url: scratchUrl.toString() } } });
let failures = 0;
try {
  execFileSync("pg_dump", ["-Fc", "--no-owner", "-f", dump, srcUrl.toString()], { stdio: "inherit" });
  const dumpBytes = statSync(dump).size;
  execFileSync("psql", [adminUrl.toString(), "-qc", `CREATE DATABASE ${scratchName}`], { stdio: "inherit" });
  execFileSync("pg_restore", ["--no-owner", "-d", scratchUrl.toString(), dump], { stdio: "inherit" });
  const restoredAt = Date.now();
  for (const t of TABLES) {
    const [a] = await src.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*)::bigint AS n FROM ${t}`);
    const [b] = await dst.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*)::bigint AS n FROM ${t}`);
    const ok = a!.n === b!.n;
    if (!ok) failures++;
    console.log(`${ok ? "ok  " : "DIFF"} ${t}: source ${a!.n}, restored ${b!.n}`);
  }
  // Every chain in the copy, including those of organizations removed since (their evidence is append-only).
  const live = new Map((await dst.organization.findMany({ select: { id: true, slug: true } })).map((o) => [o.id, o.slug]));
  const ids = (await dst.$queryRawUnsafe<{ org_id: string }[]>("SELECT DISTINCT org_id::text AS org_id FROM evidence_events")).map((r) => r.org_id);
  const orgs = ids.map((id) => ({ id, slug: live.get(id) ?? `removed organization ${id.slice(0, 8)}` }));
  let events = 0;
  let invalidInSource = 0;
  for (const o of orgs) {
    // A faithful restore gives exactly the verification result the source gives. Chains that are already
    // invalid in the source (test suites tamper with evidence on purpose) must stay invalid, at the same row.
    const [restored, original] = [await verifyChain(dst as never, o.id), await verifyChain(src as never, o.id)];
    events += restored.checked;
    if (!original.valid) invalidInSource++;
    const same = restored.valid === original.valid && restored.lastHash === original.lastHash && restored.firstBadSeq === original.firstBadSeq && restored.checked === original.checked;
    if (!same) {
      failures++;
      console.log(`FAIL ${o.slug}: source ${original.valid ? "valid" : `invalid at ${original.firstBadSeq}`}, restored ${restored.valid ? "valid" : `invalid at ${restored.firstBadSeq} (${restored.reason})`}`);
    } else if (live.has(o.id) && !restored.valid) {
      console.log(`note ${o.slug}: chain invalid in the source as well (${restored.reason})`);
    }
  }
  console.log(`\n${orgs.length} evidence chains (${live.size} live organizations), ${events} evidence events verified on the restored copy, each chain giving the same result as the source (${invalidInSource} already invalid in the source, kept invalid); dump ${(dumpBytes / 1024 / 1024).toFixed(2)} MB; dump and restore took ${((restoredAt - started) / 1000).toFixed(1)} s; total ${((Date.now() - started) / 1000).toFixed(1)} s.`);
  console.log(failures ? `DRILL FAILED: ${failures} difference(s)` : "DRILL PASSED: row counts match and every evidence chain verifies on the restored copy exactly as it does on the source");
} finally {
  await src.$disconnect();
  await dst.$disconnect();
  try {
    execFileSync("psql", [adminUrl.toString(), "-qc", `DROP DATABASE IF EXISTS ${scratchName}`], { stdio: "inherit" });
  } catch {
    console.error(`Could not drop ${scratchName}; drop it by hand.`);
  }
  rmSync(dir, { recursive: true, force: true });
}
process.exit(failures ? 1 : 0);
