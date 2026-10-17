/**
 * Benchmarks with targets (docs/PERFORMANCE.md).
 *   pnpm --filter @aegis/core bench
 * 1. Policy evaluation: pure function, synthetic policies of 10, 50 and 200 rules.
 * 2. Evidence ingestion: sequential appends into one fresh test organization (each append takes the
 *    organization's ledger lock, so this is the per-tenant ceiling, not a cluster figure).
 * Prints measured values next to each target and exits 1 when a target is missed. Never invents a number.
 */
import { disconnectAll, ownerPrisma, withTenant } from "@aegis/db";
import { evaluatePolicies, type PolicyToEvaluate } from "../src/policy/evaluate.js";
import { parsePolicyDocument } from "../src/policy/schema.js";
import { appendEvidence } from "../src/evidence/ledger.js";
import { createOrganization } from "../src/orgs/orgs.js";
import { registerUser } from "../src/identity/auth.js";
import { makeContext } from "../src/lib/context.js";
import { percentiles } from "../src/lib/metrics.js";

const TARGETS = { policyP95MicrosAt50Rules: 1000, evidencePerSecond: 50 };
let missed = 0;

function policy(rules: number): PolicyToEvaluate {
  const doc = parsePolicyDocument({
    version: 1,
    appliesTo: { tools: ["issue-refund"] },
    rules: Array.from({ length: rules }, (_, i) => ({
      id: `r${i}`,
      effect: i % 3 === 0 ? "deny" : i % 3 === 1 ? "require_approval" : "allow",
      when: { all: [{ attr: "params.amount", op: "between", value: [i * 100, i * 100 + 99] }, { attr: "params.currency", op: "in", value: ["AED", "USD"] }, { not: { attr: "context.supplied.channel", op: "eq", value: "blocked" } }] },
      ...(i % 3 === 1 ? { approval: { roles: ["approver"], minApprovers: 1, expiresInMinutes: 60 } } : {}),
    })),
    tests: [],
  });
  return { policyKey: `p${rules}`, policyVersionId: "bench", policyVersion: 1, document: doc };
}

console.log("Policy evaluation (pure, 5,000 evaluations each after 500 warm-up)");
for (const n of [10, 50, 200]) {
  const p = [policy(n)];
  const samples: number[] = [];
  for (let i = 0; i < 5500; i++) {
    const input = { action: { tool: "issue-refund", name: "execute" }, params: { amount: (i * 37) % (n * 100), currency: "AED" }, context: { supplied: { channel: "web" } } };
    const t = process.hrtime.bigint();
    evaluatePolicies(p, input);
    if (i >= 500) samples.push(Number(process.hrtime.bigint() - t) / 1000);
  }
  const s = percentiles(samples);
  const line = `  ${String(n).padStart(3)} rules: p50 ${s.p50.toFixed(1)} us, p95 ${s.p95.toFixed(1)} us, p99 ${s.p99.toFixed(1)} us`;
  if (n === 50) {
    const ok = s.p95 <= TARGETS.policyP95MicrosAt50Rules;
    if (!ok) missed++;
    console.log(`${line}   target p95 <= ${TARGETS.policyP95MicrosAt50Rules} us: ${ok ? "met" : "MISSED"}`);
  } else console.log(line);
}

console.log("\nEvidence ingestion (one organization, sequential appends)");
const stamp = `bench-${Date.now().toString(36)}`;
const user = await registerUser({ email: `${stamp}@test.aegis.local`, name: "Bench", password: "CorrectHorse1Battery" });
const org = await createOrganization({ name: `Bench ${stamp}`, slug: stamp, ownerUserId: user.id });
const ctx = makeContext(org.id, { type: "system", id: null, label: "bench" });
const count = 500;
const t0 = Date.now();
for (let i = 0; i < count; i++) await withTenant(org.id, (db) => appendEvidence(db, ctx, { type: "bench.event", subjectType: "bench", subjectId: String(i), payload: { i } }));
const perSecond = count / ((Date.now() - t0) / 1000);
const okEv = perSecond >= TARGETS.evidencePerSecond;
if (!okEv) missed++;
console.log(`  ${count} appends, one transaction each: ${perSecond.toFixed(0)} events per second   target >= ${TARGETS.evidencePerSecond}/s: ${okEv ? "met" : "MISSED"}`);
await ownerPrisma().user.delete({ where: { id: user.id } }).catch(() => undefined);
await disconnectAll();
console.log(missed ? `\n${missed} target(s) missed` : "\nAll targets met");
process.exit(missed ? 1 : 0);
