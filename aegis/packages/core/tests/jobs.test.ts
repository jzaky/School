import { afterAll, describe, expect, it } from "vitest";
import { rawPrisma, disconnectAll } from "@aegis/db";
import { claimJobs, enqueueJob, recoverStaleJobs, registerJobHandler, runJob } from "../src/jobs/queue.js";

const stamp = Date.now().toString(36);
/** Test jobs sort before any due job a stopped local worker left behind, so the test never depends on an empty queue. */
const EPOCH = new Date(0);
afterAll(async () => {
  await rawPrisma().job.deleteMany({ where: { type: { startsWith: `test.${stamp}` } } });
  await disconnectAll();
});

describe("durable job queue", () => {
  it("enqueue is idempotent on the key", async () => {
    const a = await enqueueJob({ type: `test.${stamp}.idem`, payload: { n: 1 }, idempotencyKey: `idem-${stamp}` });
    const b = await enqueueJob({ type: `test.${stamp}.idem`, payload: { n: 2 }, idempotencyKey: `idem-${stamp}` });
    expect(a.id).toBe(b.id);
    expect((await rawPrisma().job.findUniqueOrThrow({ where: { id: a.id } })).payload).toEqual({ n: 1 });
  });
  it("claims each due job once, retries with backoff, and marks done", async () => {
    let runs = 0;
    registerJobHandler(`test.${stamp}.flaky`, async () => {
      runs += 1;
      if (runs === 1) throw new Error("transient");
    });
    await enqueueJob({ type: `test.${stamp}.flaky`, payload: {}, idempotencyKey: `flaky-${stamp}`, runAt: EPOCH, maxAttempts: 3 });
    const [claimed1, claimed2] = await Promise.all([claimJobs(50), claimJobs(50)]);
    const mine = [...claimed1, ...claimed2].filter((j) => j.type === `test.${stamp}.flaky`);
    expect(mine).toHaveLength(1);
    await runJob(mine[0]!);
    let row = await rawPrisma().job.findUniqueOrThrow({ where: { id: mine[0]!.id } });
    expect(row.status).toBe("pending");
    expect(row.lastError).toBe("transient");
    expect(row.runAt.getTime()).toBeGreaterThan(Date.now());
    await rawPrisma().job.update({ where: { id: row.id }, data: { runAt: EPOCH } });
    const again = (await claimJobs(50)).find((j) => j.id === row.id)!;
    await runJob(again);
    row = await rawPrisma().job.findUniqueOrThrow({ where: { id: row.id } });
    expect(row.status).toBe("done");
    expect(runs).toBe(2);
  });
  it("gives up after maxAttempts and records the error", async () => {
    registerJobHandler(`test.${stamp}.dead`, async () => {
      throw new Error("permanent");
    });
    const j = await enqueueJob({ type: `test.${stamp}.dead`, payload: {}, idempotencyKey: `dead-${stamp}`, runAt: EPOCH, maxAttempts: 1 });
    const claimed = (await claimJobs(50)).find((x) => x.id === j.id)!;
    await runJob(claimed);
    const row = await rawPrisma().job.findUniqueOrThrow({ where: { id: j.id } });
    expect(row.status).toBe("failed");
    expect(row.lastError).toBe("permanent");
  });
  it("recovers jobs whose worker died mid-run", async () => {
    const j = await enqueueJob({ type: `test.${stamp}.stale`, payload: {}, idempotencyKey: `stale-${stamp}` });
    await rawPrisma().job.update({ where: { id: j.id }, data: { status: "running", lockedAt: new Date(Date.now() - 20 * 60_000), lockedBy: "dead-worker" } });
    const r = await recoverStaleJobs(10 * 60_000);
    expect(r.count).toBeGreaterThanOrEqual(1);
    expect((await rawPrisma().job.findUniqueOrThrow({ where: { id: j.id } })).status).toBe("pending");
  });
  it("unknown job types fail safely", async () => {
    const j = await enqueueJob({ type: `test.${stamp}.unknown`, payload: {}, idempotencyKey: `unknown-${stamp}`, runAt: EPOCH });
    const claimed = (await claimJobs(50)).find((x) => x.id === j.id)!;
    await runJob(claimed);
    expect((await rawPrisma().job.findUniqueOrThrow({ where: { id: j.id } })).status).toBe("failed");
  });
});
