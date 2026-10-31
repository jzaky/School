/**
 * Gateway throughput benchmark over HTTP (docs/PERFORMANCE.md). Run bench-gateway-setup first.
 *   AEGIS_URL=http://127.0.0.1:4000 pnpm --filter @aegis/core bench:gateway [requests=600] [concurrency=20] [organizations=1]
 *
 * Workload: issue-refund requests spread round-robin over the agents of each organization, with amounts
 * rotating through the three tiers of the refund policy: under AED 200 is allowed and executed against the
 * simulated support system, AED 1,000 to 2,500 waits for approval, above AED 2,500 is denied. Every
 * request has a unique order and idempotency key, so nothing is a duplicate. A warm-up of 30 requests per
 * organization is excluded. Reports throughput, p50, p95, p99 and maximum latency, decisions and errors.
 * Prints only measured values.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(readFileSync(join(here, "..", "..", "..", ".bench-keys.json"), "utf8")) as { orgs: { orgId: string; keys: string[] }[] };
const base = process.env.AEGIS_URL ?? "http://127.0.0.1:4000";
const total = Number(process.argv[2] ?? 600);
const concurrency = Number(process.argv[3] ?? 20);
const orgs = cfg.orgs.slice(0, Number(process.argv[4] ?? cfg.orgs.length));
const amounts = [120, 150, 60, 1200, 1800, 9000];
const run = `b${Date.now().toString(36)}`;

interface Sample {
  ms: number;
  outcome: string;
  org: number;
}

async function one(org: number, i: number, phase: string): Promise<Sample> {
  const keys = orgs[org]!.keys;
  const key = keys[i % keys.length]!;
  const amount = amounts[i % amounts.length]!;
  const started = performance.now();
  try {
    const res = await fetch(`${base}/v1/gateway/actions`, {
      method: "POST",
      // codeql[js/file-access-to-http] Benchmark script: sends locally generated test keys to the API under test.
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ tool: "issue-refund", action: "execute", resource: "support-tickets", params: { orderId: `${run}-${phase}-${org}-${i}`, customerId: `CUST-${i % 50}`, amount, currency: "AED" }, idempotencyKey: `${run}-${phase}-${org}-${i}`, justification: "benchmark" }),
    });
    const body = (await res.json().catch(() => ({}))) as { decision?: string; status?: string };
    return { ms: performance.now() - started, outcome: res.status >= 500 || res.status === 429 ? `http${res.status}` : `${body.decision ?? "?"}/${body.status ?? res.status}`, org };
  } catch (e) {
    return { ms: performance.now() - started, outcome: `error:${e instanceof Error ? e.message : String(e)}`, org };
  }
}

async function phase(name: string, count: number): Promise<{ samples: Sample[]; wall: number }> {
  const samples: Sample[] = [];
  let next = 0;
  const t0 = performance.now();
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (true) {
        const n = next++;
        if (n >= count) return;
        const org = n % orgs.length;
        samples.push(await one(org, Math.floor(n / orgs.length), name));
      }
    }),
  );
  return { samples, wall: (performance.now() - t0) / 1000 };
}

const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
await phase("warm", 30 * orgs.length);
const { samples, wall } = await phase("run", total);
const ms = samples.map((s) => s.ms).sort((a, b) => a - b);
const errors = samples.filter((s) => s.outcome.startsWith("http5") || s.outcome.startsWith("error") || s.outcome === "http429");
const outcomes = samples.reduce<Record<string, number>>((m, s) => ({ ...m, [s.outcome]: (m[s.outcome] ?? 0) + 1 }), {});
const perOrg = orgs.map((_, o) => samples.filter((s) => s.org === o).length / wall);
const result = {
  at: new Date().toISOString(),
  base,
  organizations: orgs.length,
  agentsPerOrg: orgs[0]!.keys.length,
  requests: total,
  concurrency,
  seconds: Number(wall.toFixed(2)),
  throughputPerSecond: Number((total / wall).toFixed(1)),
  perOrganizationPerSecond: perOrg.map((x) => Number(x.toFixed(1))),
  latencyMs: { p50: Math.round(pct(ms, 50)), p95: Math.round(pct(ms, 95)), p99: Math.round(pct(ms, 99)), max: Math.round(ms[ms.length - 1] ?? 0) },
  errorRate: Number((errors.length / total).toFixed(4)),
  outcomes,
};
console.log(JSON.stringify(result, null, 2));
