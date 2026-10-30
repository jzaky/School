import { afterAll, describe, expect, it } from "vitest";
import { rawPrisma, disconnectAll } from "@aegis/db";
import { claimJobs, enqueueJob, recoverStaleJobs, registerJobHandler, runJob, scopedJobKey } from "../src/jobs/queue.js";
import { consumeRateLimit, purgeRateLimitBuckets, secretBucketKey } from "../src/platform/rate-limit.js";

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
  it("stores an organization's key scoped to that organization, so two organizations never collide", async () => {
    const orgA = "00000000-0000-7000-8000-00000000000a";
    const orgB = "00000000-0000-7000-8000-00000000000b";
    const a = await enqueueJob({ type: `test.${stamp}.scoped`, payload: {}, idempotencyKey: `same-${stamp}`, orgId: orgA, runAt: new Date(Date.now() + 3_600_000) });
    const b = await enqueueJob({ type: `test.${stamp}.scoped`, payload: {}, idempotencyKey: `same-${stamp}`, orgId: orgB, runAt: new Date(Date.now() + 3_600_000) });
    expect(a.id).not.toBe(b.id);
    expect(a.idempotencyKey).toBe(scopedJobKey(`same-${stamp}`, orgA));
    expect(b.orgId).toBe(orgB);
  });
  it("refuses to enqueue a job whose payload names a different organization", async () => {
    await expect(enqueueJob({ type: `test.${stamp}.mismatch`, payload: { orgId: "00000000-0000-7000-8000-00000000000b" }, idempotencyKey: `mismatch-${stamp}`, orgId: "00000000-0000-7000-8000-00000000000a" })).rejects.toThrow(/different organization/);
  });
  it("the worker refuses a job whose payload organization differs from the job row, without running it", async () => {
    let ran = false;
    registerJobHandler(`test.${stamp}.tampered`, async () => {
      ran = true;
    });
    const j = await rawPrisma().job.create({ data: { type: `test.${stamp}.tampered`, payload: { orgId: "00000000-0000-7000-8000-00000000000b" }, idempotencyKey: `tampered-${stamp}`, orgId: "00000000-0000-7000-8000-00000000000a", runAt: EPOCH } });
    const claimed = (await claimJobs(50)).find((x) => x.id === j.id)!;
    await runJob(claimed);
    const after = await rawPrisma().job.findUniqueOrThrow({ where: { id: j.id } });
    expect(ran).toBe(false);
    expect(after.status).toBe("failed");
    expect(after.lastError).toMatch(/does not match/);
  });
});

describe("shared rate limits (S14)", () => {
  afterAll(async () => {
    await rawPrisma().rateLimitBucket.deleteMany({ where: { key: { startsWith: `test:${stamp}` } } });
  });
  it("counts across callers in one window and refuses past the limit", async () => {
    const now = Date.UTC(2026, 0, 1, 10, 0, 30);
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await consumeRateLimit(`test:${stamp}:a`, 3, 60_000, now));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results[3]!.count).toBe(4);
    expect(results[0]!.resetInMs).toBe(30_000);
  });
  it("starts a fresh count in the next window", async () => {
    const r = await consumeRateLimit(`test:${stamp}:a`, 3, 60_000, Date.UTC(2026, 0, 1, 10, 1, 5));
    expect(r).toMatchObject({ allowed: true, count: 1 });
  });
  it("buckets a credential by its hash, never by a fragment of it", () => {
    const k1 = secretBucketKey("key", "Bearer aegis_live_aaaaaaaaaaaaaaaaaaaaSAMESUFFIX");
    const k2 = secretBucketKey("key", "Bearer aegis_live_bbbbbbbbbbbbbbbbbbbbSAMESUFFIX");
    expect(k1).not.toBe(k2);
    expect(k1).not.toContain("SAMESUFFIX");
  });
  it("purges windows that ended long ago", async () => {
    const n = await purgeRateLimitBuckets(60_000, Date.UTC(2026, 0, 2));
    expect(n).toBeGreaterThanOrEqual(2);
  });
});
