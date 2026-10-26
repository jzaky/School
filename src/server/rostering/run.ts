// Roster runs: a preview (dry run) or a sync. A run fetches the feed page by page into the staging table, then
// plans (preview) or applies (sync) it batch by batch (src/server/rostering/plan.ts). After every page and
// every batch the cursor, counts and a heartbeat are saved, so a run that stops (deploy, crash, time budget)
// is picked up by the worker where it left off. Only one worker processes a run at a time (heartbeat claim),
// and every write is idempotent through RosterLink. A preview keeps its staged records for 24 hours so
// "Apply" syncs exactly what was previewed. Runs record counts and codes; personal data stays in the tables.
// No "server-only" marker: the worker imports this.
import type { Prisma, RosterConnection, RosterRun } from "@prisma/client";
import { tenantDb } from "@/lib/tenant-db";
import { dueSlot } from "@/lib/integrations/schedule";
import type { Staged } from "@/lib/rostering/records";
import { audit } from "@/server/audit/audit";
import { RosterFetchError, START_CURSOR, type FetchCursor } from "./client";
import { ConnectionError, fetchPage } from "./connections";
import { emptyCounts, initialState, planContext, planStep, type PlanState } from "./plan";

export const PREVIEW_TTL_MS = 24 * 3600_000;
export const STALE_AFTER_MS = 3 * 60_000;
const ACTIVE = ["QUEUED", "FETCHING", "PLANNING", "APPLYING"];
export const FINISHED = ["PREVIEWED", "SUCCEEDED", "PARTIAL", "FAILED", "BLOCKED", "EXPIRED"];

type Cursor = { fetch?: FetchCursor | null; fetchDone?: boolean; staged?: number; plan?: PlanState["cursor"] | null };

export class RosterRunError extends Error {
  constructor(public code: string) {
    super(`roster-run:${code}`);
  }
}

/** Writes staged records in chunks; a record seen twice in one run keeps its first copy. */
export async function stageRecords(orgId: string, runId: string, records: Staged[]) {
  const db = tenantDb(orgId);
  let n = 0;
  for (let i = 0; i < records.length; i += 500) {
    const chunk = records.slice(i, i + 500);
    const res = await db.rosterRecord.createMany({
      data: chunk.map((r) => ({ orgId, runId, kind: r.kind, externalId: r.externalId.slice(0, 200), data: r.data as unknown as Prisma.InputJsonValue, hash: r.hash })),
      skipDuplicates: true,
    });
    n += res.count;
  }
  return n;
}

export type NewRun = { orgId: string; connectionId: string | null; provider: string; source: "API" | "CSV"; trigger: "MANUAL" | "SCHEDULE" | "UPLOAD"; mode: "FULL" | "DELTA"; dryRun: boolean; actorId: string | null; slot?: string | null };

export async function createRun(r: NewRun) {
  return tenantDb(r.orgId).rosterRun.create({
    data: { orgId: r.orgId, connectionId: r.connectionId, provider: r.provider, source: r.source, trigger: r.trigger, mode: r.mode, dryRun: r.dryRun, actorId: r.actorId, slot: r.slot ?? null, status: "QUEUED", counts: emptyCounts() as unknown as Prisma.InputJsonValue },
  });
}

/** Claims the run for this worker unless another one is on it (fresh heartbeat). */
async function claim(orgId: string, runId: string, now: Date): Promise<boolean> {
  const res = await tenantDb(orgId).rosterRun.updateMany({
    where: { id: runId, status: { in: ACTIVE }, OR: [{ heartbeatAt: null }, { heartbeatAt: { lt: new Date(now.getTime() - STALE_AFTER_MS) } }] },
    data: { heartbeatAt: now },
  });
  return res.count === 1;
}

const json = (v: unknown) => v as Prisma.InputJsonValue;

export type ProcessOptions = { budgetMs?: number; now?: () => Date };
export type ProcessResult = "busy" | "continue" | "done";

/**
 * Advances a run until it finishes or the time budget runs out ("continue": call again; the worker re-queues).
 * Safe to call from several places: only the claimant works, the others get "busy".
 */
export async function processRun(orgId: string, runId: string, opts: ProcessOptions = {}): Promise<ProcessResult> {
  const clock = opts.now ?? (() => new Date());
  const started = Date.now();
  const budget = opts.budgetMs ?? 8 * 60_000;
  if (!(await claim(orgId, runId, clock()))) return "busy";
  const db = tenantDb(orgId);
  let run = (await db.rosterRun.findUnique({ where: { id: runId } }))!;
  const connection = run.connectionId ? await db.rosterConnection.findUnique({ where: { id: run.connectionId } }) : null;
  const cursor: Cursor = (run.cursor as Cursor | null) ?? {};
  const beat = (data: Prisma.RosterRunUncheckedUpdateInput) => db.rosterRun.update({ where: { id: runId }, data: { ...data, heartbeatAt: clock() } });

  try {
    // 1. Fetch (API sources; uploads are staged by the upload action).
    if (run.source === "API" && !cursor.fetchDone) {
      if (!connection) throw new RosterRunError("NO_CONNECTION");
      const since = run.mode === "DELTA" ? connection.lastDeltaAt : null;
      let fc = cursor.fetch ?? START_CURSOR;
      let staged = cursor.staged ?? 0;
      run = await beat({ status: "FETCHING", phase: "fetch" });
      for (let pages = 0; pages < 5000; pages++) {
        const page = await fetchPage(connection, fc, since);
        staged += await stageRecords(orgId, runId, page.records);
        fc = page.cursor;
        cursor.fetch = fc;
        cursor.staged = staged;
        cursor.fetchDone = page.done;
        run = await beat({ cursor: json(cursor), progressDone: staged, progressTotal: 0 });
        if (page.done) break;
        if (Date.now() - started > budget) return release("continue");
      }
      if (!cursor.fetchDone) throw new RosterRunError("TOO_MANY_PAGES");
    }

    // 2. Plan (preview) or apply (sync), batch by batch.
    const total = await db.rosterRecord.count({ where: { runId, kind: { in: ["user", "class", "enrollment"] } } });
    // An empty full feed is a problem with the source; an empty delta just means nothing changed.
    if (total === 0 && run.mode !== "DELTA") throw new RosterRunError("EMPTY");
    // A preview keeps what earlier phases would create in memory only, so it restarts planning after a stop.
    const resumeApply = !run.dryRun && !!cursor.plan;
    const state: PlanState = resumeApply
      ? { counts: (run.counts as unknown as PlanState["counts"]) ?? emptyCounts(), issues: (run.issues as unknown as PlanState["issues"]) ?? [], changes: (run.changes as unknown as PlanState["changes"]) ?? [], cursor: cursor.plan!, blocked: false }
      : initialState();
    let done = resumeApply ? run.progressDone : 0;
    run = await beat({ status: run.dryRun ? "PLANNING" : "APPLYING", phase: state.cursor.phase, progressTotal: total, progressDone: done });
    const ctx = await planContext(
      { orgId, runId, provider: run.provider, mode: run.mode === "DELTA" ? "DELTA" : "FULL", apply: !run.dryRun, allowMassDelete: run.allowMassDelete, options: connection?.options ?? csvOptions(run), schoolIds: connection?.schoolIds ?? [], now: clock() },
      state,
    );
    for (;;) {
      const step = await planStep(ctx);
      done += step.processed;
      cursor.plan = state.cursor;
      run = await beat({ cursor: json(cursor), phase: state.cursor.phase, counts: json(state.counts), issues: json(state.issues), changes: json(state.changes), progressDone: Math.min(done, total) });
      if (step.done) break;
      if (Date.now() - started > budget) return release("continue");
    }
    await finish(state);
    return "done";
  } catch (e) {
    const code = e instanceof RosterFetchError ? `FETCH_${e.code}` : e instanceof ConnectionError ? `CONNECTION_${e.code}` : e instanceof RosterRunError ? e.code : "INTERNAL";
    if (code === "INTERNAL") console.error(`[roster] run ${runId} failed: ${(e as { name?: string })?.name ?? "Error"}`);
    await db.rosterRun.update({ where: { id: runId }, data: { status: "FAILED", errorCode: code, finishedAt: clock(), heartbeatAt: null } });
    await db.rosterRecord.deleteMany({ where: { runId } });
    if (connection) await db.rosterConnection.update({ where: { id: connection.id }, data: { lastRunAt: clock(), lastStatus: "FAILED", consecutiveFailures: { increment: 1 } } });
    await audit(db, orgId, { actorId: run.actorId, action: run.dryRun ? "roster.preview_failed" : "roster.sync_failed", entityType: "RosterRun", entityId: runId, meta: { provider: run.provider, errorCode: code } });
    return "done";
  }

  async function release(result: ProcessResult): Promise<ProcessResult> {
    // Let the next job (or the scheduler's stale check) continue straight away.
    await db.rosterRun.update({ where: { id: runId }, data: { heartbeatAt: null } });
    return result;
  }

  async function finish(state: PlanState) {
    const now = clock();
    const issues = state.issues.length;
    const status = run.dryRun ? "PREVIEWED" : state.blocked ? "BLOCKED" : issues > 0 ? "PARTIAL" : "SUCCEEDED";
    await db.rosterRun.update({ where: { id: runId }, data: { status, finishedAt: now, heartbeatAt: null, phase: "done", appliedAt: run.dryRun ? null : now, progressDone: run.progressTotal } });
    // A sync is done with its staged copy; a blocked sync keeps it so it can be confirmed and applied.
    if (!run.dryRun && !state.blocked) await db.rosterRecord.deleteMany({ where: { runId } });
    if (connection) {
      await db.rosterConnection.update({
        where: { id: connection.id },
        data: { lastRunAt: now, lastStatus: status, consecutiveFailures: 0, ...(!run.dryRun && !state.blocked ? { lastDeltaAt: run.startedAt } : {}) },
      });
    }
    const totals = Object.fromEntries(Object.entries(state.counts).filter(([k]) => k !== "removalBlocked" && k !== "total"));
    await audit(db, orgId, { actorId: run.actorId, action: run.dryRun ? "roster.previewed" : state.blocked ? "roster.sync_blocked" : "roster.sync_applied", entityType: "RosterRun", entityId: runId, meta: { provider: run.provider, mode: run.mode, source: run.source, counts: totals, issues } });
  }
}

/** Options for an uploaded file (no connection): defaults, plus the school's grade map from its first connection. */
function csvOptions(run: RosterRun): unknown {
  return (run.cursor as { options?: unknown } | null)?.options ?? null;
}

/** Turns a preview (or a blocked sync) into a sync of exactly the staged records. */
export async function applyRun(orgId: string, runId: string, input: { actorId: string; allowMassDelete: boolean; now?: Date }): Promise<RosterRun> {
  const db = tenantDb(orgId);
  const now = input.now ?? new Date();
  const run = await db.rosterRun.findUnique({ where: { id: runId } });
  if (!run) throw new RosterRunError("NOT_FOUND");
  if (run.status !== "PREVIEWED" && run.status !== "BLOCKED") throw new RosterRunError("NOT_APPLICABLE");
  if (run.status === "PREVIEWED" && now.getTime() - (run.finishedAt ?? run.startedAt).getTime() > PREVIEW_TTL_MS) throw new RosterRunError("EXPIRED");
  const cursor = { ...((run.cursor as Cursor | null) ?? {}), plan: null };
  const res = await db.rosterRun.updateMany({
    where: { id: runId, status: run.status },
    data: { dryRun: false, status: "QUEUED", allowMassDelete: input.allowMassDelete, actorId: input.actorId, cursor: json(cursor), counts: json(emptyCounts()), issues: json([]), changes: json([]), progressDone: 0, heartbeatAt: null, finishedAt: null, errorCode: null },
  });
  if (res.count !== 1) throw new RosterRunError("NOT_APPLICABLE");
  await audit(db, orgId, { actorId: input.actorId, action: "roster.apply_requested", entityType: "RosterRun", entityId: runId, meta: { allowMassDelete: input.allowMassDelete, fromStatus: run.status } });
  return (await db.rosterRun.findUnique({ where: { id: runId } }))!;
}

/** Scheduled connections whose slot is due get a sync run; stopped runs are resumed. Returns run ids to process. */
export async function dueRosterRuns(orgId: string, now = new Date()): Promise<string[]> {
  const db = tenantDb(orgId);
  const [org, connections, stale] = await Promise.all([
    db.organization.findUnique({ where: { id: orgId }, select: { timezone: true } }),
    db.rosterConnection.findMany({ where: { enabled: true, schedule: { in: ["DAILY", "HOURLY"] } } }),
    db.rosterRun.findMany({ where: { status: { in: ACTIVE }, OR: [{ heartbeatAt: null, startedAt: { lt: new Date(now.getTime() - 2 * 60_000) } }, { heartbeatAt: { lt: new Date(now.getTime() - STALE_AFTER_MS) } }] }, select: { id: true }, take: 10 }),
  ]);
  const ids = stale.map((r) => r.id);
  for (const c of connections) {
    const slot = dueSlot(c, now, org?.timezone ?? "Asia/Dubai");
    if (!slot) continue;
    const busy = await db.rosterRun.count({ where: { connectionId: c.id, status: { in: ACTIVE } } });
    if (busy) continue;
    // Daily syncs pull everything (that is how removals are found). Hourly syncs ask OneRoster servers for changes
    // only, with one full pull a day at the connection's hour. Clever has no change filter, so it is always full.
    const hourly = /^h:.*T(\d{2})$/.exec(slot);
    const full = !c.lastDeltaAt || c.provider === "clever" || !hourly || Number(hourly[1]) === c.hour;
    const created = await db.rosterRun.createMany({ data: [{ orgId, connectionId: c.id, provider: c.provider, source: "API", trigger: "SCHEDULE", mode: full ? "FULL" : "DELTA", dryRun: false, status: "QUEUED", slot, actorId: c.createdById, counts: json(emptyCounts()) }], skipDuplicates: true });
    await db.rosterConnection.update({ where: { id: c.id }, data: { lastSlot: slot } });
    if (created.count) {
      const run = await db.rosterRun.findUnique({ where: { connectionId_slot: { connectionId: c.id, slot } }, select: { id: true } });
      if (run) ids.push(run.id);
    }
  }
  return [...new Set(ids)];
}

/** Previews older than a day expire and their staged copy is removed (keeps the database small). */
export async function expireRosterRuns(orgId: string, now = new Date()) {
  const db = tenantDb(orgId);
  const old = await db.rosterRun.findMany({ where: { status: { in: ["PREVIEWED", "BLOCKED"] }, finishedAt: { lt: new Date(now.getTime() - PREVIEW_TTL_MS) } }, select: { id: true } });
  if (old.length) {
    await db.rosterRecord.deleteMany({ where: { runId: { in: old.map((r) => r.id) } } });
    await db.rosterRun.updateMany({ where: { id: { in: old.map((r) => r.id) } }, data: { status: "EXPIRED" } });
  }
  return old.length;
}

export type { RosterConnection };
