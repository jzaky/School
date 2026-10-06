// Scheduled sync from a file export: the worker fetches each source's file (CSV or XLSX in the Import center
// template format, or another layout through a column mapping) and imports it with the Import center
// services, so behaviour matches a manual upload exactly. Each run is keyed by (source, slot): a scheduled
// slot or a "Run now" click runs once, however often the job is retried. Runs record counts and an error
// code, never cell values. After FAILURE_ALERT_AFTER failed runs in a row, the school's integration admins
// are notified once (idempotency key per source and run).
// No "server-only" marker: the worker imports this.
import { tenantDb, tenantTx } from "@/lib/tenant-db";
import { decryptField, encryptField } from "@/lib/crypto";
import { SYNC_COLUMNS, SYNC_KINDS, type SyncKind } from "@/lib/integrations/kinds";
import { tableToSheet } from "@/lib/imports/table";
import { MAX_ROWS, type ImportSummary } from "@/lib/imports/types";
import { applyMapping, cleanMapping, type ColumnMapping } from "@/lib/integrations/mapping";
import { dueSlot, FAILURE_ALERT_AFTER, runStatus } from "@/lib/integrations/schedule";
import { permissionsOf } from "@/server/identity/can";
import { audit } from "@/server/audit/audit";
import { execCtx, type Effect, type Tx } from "@/server/db";
import { notify } from "@/server/notify/notify";
import { FileReadError, readTable } from "@/server/imports/files";
import { ImportError, importAccess, type ImportActor } from "@/server/imports/access";
import { importStaff } from "@/server/imports/staff";
import { importClasses, importEnrollments } from "@/server/imports/classes";
import { fixXlsxDates, importStudents } from "@/server/imports/reuse";
import { fetchExport, FetchExportError, isXlsx, type SyncAuth } from "./fetch-export";

export { SYNC_COLUMNS, SYNC_KINDS, isSyncKind, type SyncKind } from "@/lib/integrations/kinds";

export const MAX_SOURCES = 12;

// ---------------------------------------------------------------------------
// Credentials: stored encrypted, never returned to the browser
// ---------------------------------------------------------------------------

export function encryptAuth(auth: SyncAuth): string | null {
  if (auth.type === "NONE") return null;
  return encryptField(JSON.stringify(auth.type === "BASIC" ? { u: auth.username, p: auth.password } : { t: auth.token }));
}

export function decryptAuth(authType: string, secretEnc: string | null): SyncAuth {
  if (authType === "NONE" || !secretEnc) return { type: "NONE" };
  const data = JSON.parse(decryptField(secretEnc)) as { u?: string; p?: string; t?: string };
  if (authType === "BASIC") return { type: "BASIC", username: data.u ?? "", password: data.p ?? "" };
  return { type: "BEARER", token: data.t ?? "" };
}

// ---------------------------------------------------------------------------
// Reading a fetched file
// ---------------------------------------------------------------------------

export class SyncError extends Error {
  constructor(public code: string) {
    super(`sync:${code}`);
  }
}

/** The records of a fetched file for a kind, through the mapping. Throws SyncError with a code. */
export function recordsFromFile(kind: SyncKind, buf: Buffer, mapping: ColumnMapping) {
  const xlsx = isXlsx(buf);
  let table: string[][];
  try {
    table = readTable(xlsx ? "export.xlsx" : "export.csv", buf, MAX_ROWS[kind] + 200).table;
  } catch (e) {
    throw new SyncError(e instanceof FileReadError ? `FILE_${e.code}` : "FILE_UNREADABLE");
  }
  const sheet = tableToSheet(applyMapping(table, mapping), SYNC_COLUMNS[kind]);
  if (sheet.missing.length) throw new SyncError("MISSING_COLUMNS");
  if (!sheet.records.length) throw new SyncError("EMPTY");
  if (sheet.records.length > MAX_ROWS[kind]) throw new SyncError("TOO_MANY_ROWS");
  return { records: kind === "students" && xlsx ? fixXlsxDates(sheet.records) : sheet.records, unknownHeaders: sheet.unknownHeaders };
}

/** The header row of a file (for the mapping editor). Header names only, never data cells. */
export function headersFromFile(buf: Buffer): string[] {
  const xlsx = isXlsx(buf);
  let table: string[][];
  try {
    table = readTable(xlsx ? "export.xlsx" : "export.csv", buf, 5).table;
  } catch (e) {
    throw new SyncError(e instanceof FileReadError ? `FILE_${e.code}` : "FILE_UNREADABLE");
  }
  const header = table.find((r) => r.some((c) => String(c ?? "").trim()));
  if (!header) throw new SyncError("EMPTY");
  return header.map((c) => String(c ?? "").trim().slice(0, 120)).slice(0, 120);
}

// ---------------------------------------------------------------------------
// Running a source
// ---------------------------------------------------------------------------

export type Fetcher = (url: string, auth: SyncAuth) => Promise<{ buf: Buffer }>;

export type RunOptions = {
  slot: string;
  trigger: "SCHEDULE" | "MANUAL";
  /** Membership whose permissions the import runs with. Defaults to the person who set up the source. */
  actorId?: string | null;
  now?: Date;
  fetcher?: Fetcher;
  flush?: (effects: Effect[]) => Promise<void>;
};

async function actorFor(orgId: string, membershipId: string): Promise<ImportActor | null> {
  const m = await tenantDb(orgId).membership.findUnique({ where: { id: membershipId }, select: { id: true, userId: true, status: true, roles: { select: { role: { select: { key: true, permissions: true } } } } } });
  const perms = permissionsOf(m);
  if (!m || !perms.has("integrations.manage") || !importAccess(perms).center) return null;
  return { orgId, membershipId: m.id, userId: m.userId, perms };
}

/** Claims (source, slot). A manual run is created QUEUED by the page and claimed here. Null: already ran. */
async function claimRun(orgId: string, sourceId: string, opts: RunOptions, now: Date) {
  const db = tenantDb(orgId);
  const created = await db.syncRun.createMany({ data: [{ orgId, sourceId, slot: opts.slot, trigger: opts.trigger, status: "RUNNING", startedAt: now, actorId: opts.actorId ?? null }], skipDuplicates: true });
  if (created.count === 0) {
    const claimed = await db.syncRun.updateMany({ where: { sourceId, slot: opts.slot, status: "QUEUED" }, data: { status: "RUNNING", startedAt: now } });
    if (claimed.count === 0) return null;
  }
  return db.syncRun.findUnique({ where: { sourceId_slot: { sourceId, slot: opts.slot } } });
}

export async function ensureIntegrationTemplates(tx: Tx, orgId: string) {
  const have = await tx.messageTemplate.findFirst({ where: { orgId, key: "integration_sync_failed", channel: "EMAIL" }, select: { id: true } });
  if (have) return;
  await tx.messageTemplate.createMany({
    data: [
      {
        orgId,
        key: "integration_sync_failed",
        channel: "EMAIL",
        subjectEn: "Scheduled sync is failing: {{source}}",
        subjectAr: "المزامنة المجدولة تفشل: {{source}}",
        bodyEn: "The scheduled sync \"{{source}}\" has failed {{count}} times in a row. Open Integrations to see the run history and fix the source.",
        bodyAr: "فشلت المزامنة المجدولة \"{{source}}\" {{count}} مرات متتالية. افتح صفحة التكاملات لمراجعة سجل التشغيل وإصلاح المصدر.",
      },
    ],
    skipDuplicates: true,
  });
}

async function alertAdmins(orgId: string, source: { id: string; name: string }, runId: string, failures: number, now: Date, flush: (effects: Effect[]) => Promise<void>) {
  const effects: Effect[] = [];
  await tenantTx(orgId, async (tx) => {
    await ensureIntegrationTemplates(tx, orgId);
    const admins = await tx.membership.findMany({ where: { status: "ACTIVE", roles: { some: { role: { permissions: { has: "integrations.manage" } } } } }, select: { id: true } });
    await notify(execCtx(tx, orgId, { now, effects }), {
      recipients: admins.map((a) => a.id),
      templateKey: "integration_sync_failed",
      vars: { source: source.name, count: String(failures) },
      href: "/admin/integrations?tab=sync",
      kind: "integration_sync_failed",
      idempotencyBase: `sync-failed:${source.id}:${runId}`,
    });
  });
  await flush(effects);
}

async function importRecords(kind: SyncKind, actor: ImportActor, fileName: string, records: Parameters<typeof importStaff>[2], flush: (effects: Effect[]) => Promise<void>): Promise<ImportSummary> {
  if (kind === "staff") {
    const res = await importStaff(actor, fileName, records, { invite: false });
    await flush(res.effects);
    return res;
  }
  if (kind === "students") return importStudents(actor, fileName, records);
  if (kind === "classes") return importClasses(actor, fileName, records);
  return importEnrollments(actor, fileName, records);
}

export type RunOutcome = { runId: string; status: string; errorCode: string | null } | null;

export async function runSync(orgId: string, sourceId: string, opts: RunOptions): Promise<RunOutcome> {
  const now = opts.now ?? new Date();
  const flush = opts.flush ?? (async (effects: Effect[]) => (await import("@/server/queue-core")).flushEffects(effects));
  const db = tenantDb(orgId);
  const source = await db.syncSource.findUnique({ where: { id: sourceId } });
  if (!source) return null;
  const run = await claimRun(orgId, sourceId, opts, now);
  if (!run) return null;

  let status: "SUCCEEDED" | "PARTIAL" | "FAILED" = "FAILED";
  let errorCode: string | null = null;
  let summary: ImportSummary | null = null;
  const actorId = run.actorId ?? source.createdById;
  try {
    const actor = await actorFor(orgId, actorId);
    if (!actor) throw new SyncError("OWNER_NO_ACCESS");
    if (!(SYNC_KINDS as readonly string[]).includes(source.kind)) throw new SyncError("KIND");
    const kind = source.kind as SyncKind;
    let auth: SyncAuth;
    try {
      auth = decryptAuth(source.authType, source.secretEnc);
    } catch {
      throw new SyncError("CREDENTIALS");
    }
    const fetcher: Fetcher = opts.fetcher ?? ((url, a) => fetchExport(url, a));
    const { buf } = await fetcher(source.url, auth);
    const { records } = recordsFromFile(kind, buf, cleanMapping(source.mapping, SYNC_COLUMNS[kind]));
    summary = await importRecords(kind, actor, `Sync: ${source.name}`.slice(0, 200), records, flush);
    status = runStatus(summary.total, summary.succeeded, summary.failed);
    if (status === "FAILED") errorCode = "ALL_ROWS_FAILED";
  } catch (e) {
    status = "FAILED";
    errorCode = e instanceof SyncError ? e.code : e instanceof FetchExportError ? `FETCH_${e.code}` : e instanceof ImportError ? `IMPORT_${e.code}` : "INTERNAL";
    if (errorCode === "INTERNAL") console.error(`[sync] source ${sourceId} failed: ${(e as { name?: string })?.name ?? "Error"}`);
  }

  const finishedAt = new Date();
  await db.syncRun.update({
    where: { id: run.id },
    data: {
      status,
      errorCode,
      finishedAt,
      actorId,
      importId: summary?.importId ?? null,
      total: summary?.total ?? 0,
      created: summary?.created ?? 0,
      updated: summary?.updated ?? 0,
      unchanged: summary?.unchanged ?? 0,
      failed: summary?.failed ?? 0,
    },
  });
  const failures = status === "FAILED" ? source.consecutiveFailures + 1 : 0;
  await db.syncSource.update({
    where: { id: source.id },
    data: { lastRunAt: finishedAt, lastStatus: status, consecutiveFailures: failures, ...(opts.trigger === "SCHEDULE" ? { lastSlot: opts.slot } : {}) },
  });
  await audit(db, orgId, {
    actorId,
    action: "integrations.sync_run",
    entityType: "SyncSource",
    entityId: source.id,
    meta: { runId: run.id, trigger: opts.trigger, slot: opts.slot, status, errorCode, total: summary?.total ?? 0, created: summary?.created ?? 0, updated: summary?.updated ?? 0, failed: summary?.failed ?? 0 },
  });
  if (failures === FAILURE_ALERT_AFTER) await alertAdmins(orgId, source, run.id, failures, now, flush);
  return { runId: run.id, status, errorCode };
}

/** Runs every source of a school whose schedule slot is due, and manual runs left queued for over 5 minutes. */
export async function runDueSyncs(orgId: string, opts: { now?: Date; fetcher?: Fetcher; flush?: (effects: Effect[]) => Promise<void> } = {}) {
  const now = opts.now ?? new Date();
  const db = tenantDb(orgId);
  const [org, sources, stale] = await Promise.all([
    db.organization.findUnique({ where: { id: orgId }, select: { timezone: true } }),
    db.syncSource.findMany({ where: { enabled: true }, select: { id: true, schedule: true, hour: true, enabled: true, lastSlot: true } }),
    db.syncRun.findMany({ where: { status: "QUEUED", startedAt: { lt: new Date(now.getTime() - 5 * 60_000) } }, select: { sourceId: true, slot: true, actorId: true }, take: 20 }),
  ]);
  let ran = 0;
  for (const s of sources) {
    const slot = dueSlot(s, now, org?.timezone ?? "Asia/Dubai");
    if (!slot) continue;
    if (await runSync(orgId, s.id, { slot, trigger: "SCHEDULE", now, fetcher: opts.fetcher, flush: opts.flush })) ran++;
  }
  for (const r of stale) if (await runSync(orgId, r.sourceId, { slot: r.slot, trigger: "MANUAL", actorId: r.actorId, now, fetcher: opts.fetcher, flush: opts.flush })) ran++;
  return { ran };
}
