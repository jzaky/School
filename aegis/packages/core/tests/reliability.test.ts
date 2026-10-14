/**
 * Reliability (docs/PERFORMANCE.md): metrics, circuit breakers, dead-letter handling and operational alerts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { disconnectAll, rawPrisma } from "@aegis/db";
import { makeGatewayFixture, type GatewayFixture } from "./gateway-fixture.js";
import { Counter, Histogram, m, percentiles, prometheusText } from "../src/lib/metrics.js";
import { breakers, CircuitBreaker } from "../src/lib/circuit.js";
import { enqueueJob, listDeadLetterJobs, recoverStaleJobs, registerJobHandler, requeueDeadLetterJob, runJob } from "../src/jobs/queue.js";
import { evaluateOperationalAlerts, recordOperationalAlerts } from "../src/assurance/ops-alerts.js";

describe("metrics registry (pure)", () => {
  it("counts by label, keeps histogram buckets and percentiles, and renders the Prometheus text format", () => {
    const c = new Counter("test_things_total", "Things");
    c.inc({ kind: "a" });
    c.inc({ kind: "a" }, 2);
    c.inc({ kind: "b" });
    expect(c.get({ kind: "a" })).toBe(3);
    expect(c.total()).toBe(4);
    const h = new Histogram("test_latency_seconds", "Latency", [0.1, 1]);
    for (const v of [0.05, 0.2, 0.3, 2]) h.observe(v);
    const s = h.summary()!;
    expect(s.count).toBe(4);
    expect(s.p50).toBe(0.2);
    expect(s.max).toBe(2);
    const text = prometheusText();
    expect(text).toContain("# TYPE test_things_total counter");
    expect(text).toContain('test_things_total{kind="a"} 3');
    expect(text).toContain('test_latency_seconds_bucket{le="0.1"} 1');
    expect(text).toContain('test_latency_seconds_bucket{le="1"} 3');
    expect(text).toContain('test_latency_seconds_bucket{le="+Inf"} 4');
    expect(percentiles([])).toEqual({ p50: 0, p95: 0, p99: 0, max: 0 });
  });
});

describe("circuit breaker (pure)", () => {
  it("opens after the threshold, refuses while open, lets one trial through, and closes on success", () => {
    let now = 0;
    const b = new CircuitBreaker("test", { threshold: 3, openMs: 1000 }, () => now);
    for (let i = 0; i < 2; i++) b.failure("k");
    expect(b.allow("k")).toBe(true);
    b.failure("k");
    expect(b.state("k")).toBe("open");
    expect(b.allow("k")).toBe(false);
    now = 1500;
    expect(b.state("k")).toBe("half_open");
    expect(b.allow("k")).toBe(true);
    expect(b.allow("k")).toBe(false);
    b.failure("k");
    expect(b.state("k")).toBe("open");
    now = 3000;
    expect(b.allow("k")).toBe(true);
    b.success("k");
    expect(b.state("k")).toBe("closed");
    expect(b.allow("other")).toBe(true);
  });
});

describe("with the database", () => {
  let f: GatewayFixture;
  beforeAll(async () => {
    f = await makeGatewayFixture();
  }, 120_000);
  afterAll(async () => {
    await f.cleanup();
    await disconnectAll();
  });

  it("each gateway decision is counted and timed, and policy evaluation is timed", async () => {
    const before = m.gatewayDecisions.get({ result: "allow" });
    const evalBefore = m.policyEvaluationSeconds.summary()?.count ?? 0;
    const r = await f.call({ amount: 90 });
    expect(r.status).toBe("executed");
    expect(m.gatewayDecisions.get({ result: "allow" })).toBe(before + 1);
    expect(m.gatewayDecisionSeconds.summary({ result: "allow" })!.count).toBeGreaterThan(0);
    expect(m.policyEvaluationSeconds.summary()!.count).toBe(evalBefore + 1);
    expect(m.executions.get({ system: "support-platform-sim", outcome: "succeeded" })).toBeGreaterThan(0);
    expect(m.dbQuerySeconds.summary()!.count).toBeGreaterThan(0);
    expect(m.gatewayInFlight.get()).toBe(0);
  });

  it("an open execution circuit refuses at once with a definitive failure and sends nothing", async () => {
    const key = `${f.orgId}:support-platform-sim`;
    for (let i = 0; i < 5; i++) breakers.execution.failure(key);
    try {
      const ledgerBefore = (await f.ledger()).length;
      const r = await f.call({ amount: 95 });
      expect(r.status).toBe("failed");
      expect(r.receipt?.summary).toMatchObject({ error: expect.stringMatching(/paused calls to it/) });
      expect((await f.ledger()).length).toBe(ledgerBefore);
    } finally {
      breakers.execution.success(key);
    }
    expect((await f.call({ amount: 96 })).status).toBe("executed");
  });

  it("a job that fails its last attempt is dead-lettered, recorded and can be requeued", async () => {
    const type = `test.always_fails.${Date.now().toString(36)}`;
    registerJobHandler(type, async () => {
      throw new Error("downstream refused");
    });
    const job = await enqueueJob({ type, payload: {}, idempotencyKey: `dl-${Date.now()}`, maxAttempts: 1 });
    await runJob({ ...job, attempts: 1 });
    const dead = await listDeadLetterJobs(100);
    expect(dead.find((d) => d.id === job.id)?.lastError).toBe("downstream refused");
    expect(await rawPrisma().platformEvent.findFirst({ where: { type: "job.dead_lettered", detail: { path: ["jobId"], equals: job.id } } })).not.toBeNull();
    expect(m.jobsDeadLettered.get({ type })).toBe(1);
    await requeueDeadLetterJob(job.id, f.ownerUserId);
    const again = await rawPrisma().job.findUniqueOrThrow({ where: { id: job.id } });
    expect(again.status).toBe("pending");
    expect(again.attempts).toBe(0);
    await rawPrisma().job.update({ where: { id: job.id }, data: { status: "done" } });
  });

  it("a job that kills its worker on every attempt is dead-lettered instead of looping forever", async () => {
    const type = `test.poison.${Date.now().toString(36)}`;
    const job = await enqueueJob({ type, payload: {}, idempotencyKey: `poison-${Date.now()}`, maxAttempts: 2 });
    await rawPrisma().job.update({ where: { id: job.id }, data: { status: "running", attempts: 2, lockedAt: new Date(Date.now() - 3600_000) } });
    await recoverStaleJobs();
    const row = await rawPrisma().job.findUniqueOrThrow({ where: { id: job.id } });
    expect(row.status).toBe("failed");
    expect(row.lastError).toMatch(/every attempt/);
  });

  it("operational alerts fire from database state and are recorded once per hour", async () => {
    const alerts = await evaluateOperationalAlerts();
    expect(alerts.some((a) => a.key === "jobs.dead_lettered")).toBe(true);
    const first = await recordOperationalAlerts();
    const second = await recordOperationalAlerts();
    expect(first.firing).toBeGreaterThan(0);
    expect(second.recorded).toBe(0);
  }, 120_000);
});
