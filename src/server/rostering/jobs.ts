// Background jobs for roster runs (queue "integrations", job "roster"). A job advances one run for up to eight
// minutes and queues itself again if the run is not finished, so a large school never holds one long job.
// The scheduler (every five minutes) starts due scheduled syncs, resumes runs whose worker stopped, and expires
// old previews. Without Redis (local development) runs are processed in the request instead.
// No "server-only" marker: the worker imports this.
import { queue } from "@/server/queue-core";
import { dueRosterRuns, expireRosterRuns, processRun } from "./run";

export const ROSTER_JOB = "roster";
const BUDGET_MS = 8 * 60_000;

export async function enqueueRosterRun(orgId: string, runId: string, round = 0): Promise<boolean> {
  const q = queue("integrations");
  if (!q) return false;
  try {
    await q.add(ROSTER_JOB, { orgId, runId, round }, { jobId: `roster:${runId}:${round}:${Date.now()}`, attempts: 3, backoff: { type: "exponential", delay: 10_000 } });
    return true;
  } catch {
    return false;
  }
}

export async function runRosterJob(data: { orgId: string; runId: string; round?: number }) {
  const result = await processRun(data.orgId, data.runId, { budgetMs: BUDGET_MS });
  if (result === "continue") await enqueueRosterRun(data.orgId, data.runId, (data.round ?? 0) + 1);
  return result;
}

export async function scheduleRosterRuns(orgId: string) {
  await expireRosterRuns(orgId);
  const ids = await dueRosterRuns(orgId);
  for (const id of ids) await enqueueRosterRun(orgId, id);
  return ids.length;
}

/** Starts a run: on the worker when there is one, otherwise right here (small schools, local development). */
export async function startRosterRun(orgId: string, runId: string) {
  if (await enqueueRosterRun(orgId, runId)) return "queued" as const;
  for (let i = 0; i < 100; i++) if ((await processRun(orgId, runId, { budgetMs: 60_000 })) !== "continue") break;
  return "processed" as const;
}
