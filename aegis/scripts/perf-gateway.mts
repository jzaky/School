/**
 * Gateway latency and throughput smoke test against a running API.
 *   AEGIS_URL=http://localhost:4000 npx tsx scripts/perf-gateway.mts [requests=200] [concurrency=10]
 * Uses the demo refund agent key from .demo-keys.json. Amounts rotate through allow, approval and deny
 * tiers so the mix exercises every path. Reports latency percentiles per decision and overall throughput.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const keys = JSON.parse(readFileSync(join(here, "..", ".demo-keys.json"), "utf8")) as { agents: Record<string, string> };
// PERF_SCENARIO=refunds (default) rotates allow, approval and deny tiers; PERF_SCENARIO=transfers exercises the
// allow-and-execute path of the treasury agent (business-hours AED transfers below the autonomous limit).
const scenario = process.env.PERF_SCENARIO ?? "refunds";
const key = keys.agents[scenario === "transfers" ? "treasury-transfer-agent" : "support-refund-agent"]!;
const base = process.env.AEGIS_URL ?? "http://localhost:4000";
const total = Number(process.argv[2] ?? 200);
const concurrency = Number(process.argv[3] ?? 10);
const amounts = [120, 180, 60, 1200, 1800, 9000];
const run = `perf-${Date.now().toString(36)}`;
const samples: { ms: number; decision: string; status: number }[] = [];
let next = 0;
async function worker() {
  while (true) {
    const i = next++;
    if (i >= total) return;
    const amount = amounts[i % amounts.length]!;
    const started = performance.now();
    const payload = scenario === "transfers"
      ? { tool: "initiate-transfer", action: "transfer", resource: "payments-core", params: { fromAccount: "AE07 0331 2345 6789 0123 456", toAccount: "AE12 0260 0010 0000 1234 567", amount: 1000 + (i % 40) * 1000, currency: "AED", reference: `perf ${i}` }, idempotencyKey: `${run}-${i}`, justification: "perf" }
      : { tool: "issue-refund", action: "execute", resource: "support-tickets", params: { orderId: `PERF-${i}`, customerId: "CUST-PERF", amount, currency: "AED" }, idempotencyKey: `${run}-${i}`, justification: "perf" };
    const res = await fetch(`${base}/v1/gateway/actions`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify(payload) });
    const body = (await res.json()) as { decision?: string; status?: string };
    samples.push({ ms: performance.now() - started, decision: body.decision ? `${body.decision}/${(body as { status?: string }).status ?? ""}` : `http${res.status}`, status: res.status });
  }
}
const t0 = performance.now();
await Promise.all(Array.from({ length: concurrency }, worker));
const wall = (performance.now() - t0) / 1000;
const pct = (arr: number[], p: number) => arr.slice().sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor(arr.length * p))] ?? 0;
const by = new Map<string, number[]>();
for (const s of samples) by.set(s.decision, [...(by.get(s.decision) ?? []), s.ms]);
console.log(`requests=${total} concurrency=${concurrency} wall=${wall.toFixed(1)}s throughput=${(total / wall).toFixed(1)}/s`);
for (const [d, arr] of by) console.log(`${d.padEnd(18)} n=${String(arr.length).padStart(4)} p50=${pct(arr, 0.5).toFixed(0)}ms p95=${pct(arr, 0.95).toFixed(0)}ms max=${Math.max(...arr).toFixed(0)}ms`);
const all = samples.map((s) => s.ms);
console.log(`overall            p50=${pct(all, 0.5).toFixed(0)}ms p95=${pct(all, 0.95).toFixed(0)}ms p99=${pct(all, 0.99).toFixed(0)}ms`);
