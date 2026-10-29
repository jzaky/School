/**
 * Runs the sector validation lab (src/validation/sector-lab.ts) against the configured database and writes
 * the measured results to docs/validation/results/SECTOR_LAB_RESULTS.md.
 *   pnpm --filter @aegis/core sector-lab [repeats=50]
 * Creates (once) a synthetic lab operator and the lab organization. Synthetic data only.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { disconnectAll, rawPrisma } from "@aegis/db";
import { env } from "../src/env.js";
import { registerUser } from "../src/identity/auth.js";
import { listUserMemberships } from "../src/identity/memberships.js";
import { makeContext } from "../src/lib/context.js";
import { installShield } from "../src/shield/inspector.js";
import { SECTOR_PACKS, runSectorLab, setupSectorLab, type LabRun } from "../src/validation/sector-lab.js";

env();
installShield();
const repeats = Number(process.argv[2] ?? 50);
const email = "sector-lab-operator@aegis.local";
const user = (await rawPrisma().user.findUnique({ where: { email } })) ?? (await registerUser({ email, name: "Sector Lab Operator", password: `Lab-${crypto.randomUUID()}` }));
const org = await setupSectorLab(user.id);
const m = (await listUserMemberships(user.id)).find((x) => x.orgId === org.id)!;
const person = makeContext(org.id, { type: "user", id: user.id, permissions: m.permissions, membershipId: m.membershipId });
const run = await runSectorLab(org.id, person, { repeats });

const label: Record<string, string> = { allowed: "Runs on its own", restricted: "Runs with limits", pending_approval: "A person decides", awaiting_information: "More information requested", quarantined: "Quarantined for security review", denied: "Refused", rejected: "Rejected by a person" };

function report(r: LabRun): string {
  const lines: string[] = [];
  lines.push("# Sector validation lab: results", "");
  lines.push(`> ${r.notice}`, "");
  lines.push(`Run: ${r.startedAt} to ${r.finishedAt}. Reproduce with \`pnpm --filter @aegis/core sector-lab\`; the same cases run in CI as \`tests/sector-lab.test.ts\`.`, "");
  lines.push("## Summary", "");
  lines.push(`- Cases: ${r.cases.length} across ${SECTOR_PACKS.length} sectors. Decided as expected: ${r.passed}. Not as expected: ${r.failed}.`);
  lines.push(`- Decision time for routine actions (${r.timing.routineSamples} samples, one process, local database): median ${r.timing.p50Ms} ms, 95th percentile ${r.timing.p95Ms} ms, slowest ${r.timing.maxMs} ms.`);
  lines.push(`- Evidence ledger: ${r.ledger.valid ? "verified" : `FAILED (${r.ledger.reason})`}, ${r.ledger.checked} records rechecked.`, "");
  lines.push("Decision times depend on hardware and load; they describe this run, not a guarantee.", "");
  for (const p of SECTOR_PACKS) {
    lines.push(`## ${p.name}`, "", p.problem, "", "| Case | Expected | AEGIS decided | Shows |", "|---|---|---|---|");
    for (const c of r.cases.filter((x) => x.sector === p.key)) {
      const decided = `${label[c.actual] ?? c.actual}${c.followUp ? `, then ${label[c.followUp.status] ?? c.followUp.status}` : ""}`;
      lines.push(`| ${c.title} | ${label[c.expected]} | ${c.passed ? "" : "NOT AS EXPECTED: "}${decided} | ${c.shows} |`);
    }
    lines.push("");
  }
  lines.push("## What this does and does not show", "");
  lines.push("- It shows that the AEGIS engines make the intended decision for each scenario, record it in a ledger that verifies, and do so quickly enough not to slow routine work.");
  lines.push("- It does not show behaviour against a real entity's systems, data or staff. That needs a pilot; see `docs/SECTOR_LAB.md`.");
  lines.push("- The injection detector is pattern-based. It caught the attacks written for these cases; it can miss others and can flag honest text.", "");
  return lines.join("\n");
}

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docs", "validation", "results", "SECTOR_LAB_RESULTS.md");
writeFileSync(out, report(run));
console.log(`${run.passed}/${run.cases.length} as expected; routine p50 ${run.timing.p50Ms} ms, p95 ${run.timing.p95Ms} ms; ledger ${run.ledger.valid ? "verified" : "FAILED"}`);
console.log(`wrote ${out}`);
await disconnectAll();
process.exit(run.failed === 0 && run.ledger.valid ? 0 : 1);
