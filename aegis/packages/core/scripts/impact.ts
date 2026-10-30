/**
 * Runs the before-and-after impact test (src/validation/impact.ts), exports the run's evidence as a
 * bundle anyone can verify with scripts/verify-evidence.mjs, proves the verifier catches an edit, and
 * writes the results to docs/validation/results/.
 *   pnpm --filter @aegis/core impact
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { disconnectAll, rawPrisma, withTenant } from "@aegis/db";
import { env } from "../src/env.js";
import { registerUser } from "../src/identity/auth.js";
import { exportCheckpointPublicKey, writeCheckpoint } from "../src/evidence/ledger.js";
import { installShield } from "../src/shield/inspector.js";
import { setupSectorLab } from "../src/validation/sector-lab.js";
import { runImpact, type ImpactRun } from "../src/validation/impact.js";
import { setupCouncilScenarios } from "../src/validation/council.js";

env();
installShield();
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const results = join(root, "docs", "validation", "results");
const bundle = join(results, "impact-evidence");

const email = "sector-lab-operator@aegis.local";
const user = (await rawPrisma().user.findUnique({ where: { email } })) ?? (await registerUser({ email, name: "Sector Lab Operator", password: `Lab-${crypto.randomUUID()}` }));
const org = await setupSectorLab(user.id);
const runTag = Date.now().toString(36).toUpperCase();
await setupCouncilScenarios(user.id, runTag);
const run = await runImpact(org.id, { council: { runTag } });

// Evidence bundle for this run, with a signed checkpoint at its last record.
const pem = exportCheckpointPublicKey();
if (!pem) throw new Error("EVIDENCE_SIGNING_KEY is not set: the bundle needs a signed checkpoint");
const { events, checkpoint } = await withTenant(org.id, async (db) => {
  const cp = (await writeCheckpoint(db, org.id))!;
  const rows = await db.evidenceEvent.findMany({ where: { orgId: org.id, seq: { gte: BigInt(run.evidenceRange.fromSeq), lte: cp.throughSeq } }, orderBy: { seq: "asc" } });
  return { events: rows, checkpoint: cp };
});
rmSync(bundle, { recursive: true, force: true });
mkdirSync(bundle, { recursive: true });
writeFileSync(join(bundle, "events.jsonl"), events.map((e) => JSON.stringify({ ...e, seq: e.seq.toString(), occurredAt: e.occurredAt.toISOString() })).join("\n") + "\n");
writeFileSync(join(bundle, "checkpoint.json"), JSON.stringify({ throughSeq: checkpoint.throughSeq.toString(), hash: checkpoint.hash, signature: checkpoint.signature, keyId: checkpoint.keyId }, null, 2) + "\n");
writeFileSync(join(bundle, "public-key.pem"), pem);
copyFileSync(join(root, "scripts", "verify-evidence.mjs"), join(bundle, "verify-evidence.mjs"));
writeFileSync(join(bundle, "README.md"), `# Evidence bundle: impact run ${run.startedAt}\n\n${events.length} evidence records (sequence ${events[0]?.seq} to ${checkpoint.throughSeq}) written by AEGIS during the run, a checkpoint signed with AEGIS's Ed25519 key, and that key's public half.\n\nVerify with Node.js only, no AEGIS code:\n\n\`\`\`\nnode verify-evidence.mjs .\n\`\`\`\n\nChange any character in events.jsonl and run it again: it fails and names the record.\n\nSynthetic data from the sector validation lab.\n`);

const verifyOutput = (folder: string) => {
  try {
    return { ok: true, out: execFileSync("node", [join(bundle, "verify-evidence.mjs"), folder], { encoding: "utf8" }).trim() };
  } catch (e) {
    return { ok: false, out: String((e as { stdout?: string }).stdout ?? "").trim() };
  }
};
const genuine = verifyOutput(bundle);
// Tamper test: in a copy, rewrite one refusal as an approval and confirm the verifier catches it.
const tampered = join(results, ".impact-evidence-tampered");
rmSync(tampered, { recursive: true, force: true });
cpSync(bundle, tampered, { recursive: true });
const lines = readFileSync(join(tampered, "events.jsonl"), "utf8").split("\n");
const target = lines.findIndex((l) => l.includes('"type":"gateway.decision.deny"'));
if (target < 0) throw new Error("no refusal in the run to tamper with");
lines[target] = lines[target]!.replace('"result":"deny"', '"result":"allow"');
writeFileSync(join(tampered, "events.jsonl"), lines.join("\n"));
const edited = verifyOutput(tampered);
rmSync(tampered, { recursive: true, force: true });

const out = { ...run, verification: { genuine, edited } };
writeFileSync(join(results, "IMPACT_RESULTS.json"), JSON.stringify(out, null, 2) + "\n");
writeFileSync(join(results, "IMPACT_REPORT.md"), report(run, genuine.out, edited.out));
const t = run.totals;
console.log(`harmful executed: ${t.harmful.executedWithout} without AEGIS, ${t.harmful.executedWith} with; legitimate: ${t.legitimate.executedWithout} vs ${t.legitimate.executedWith}; evidence ${t.evidence.recordsWith} records, ledger ${t.evidence.ledgerValid ? "verified" : "FAILED"}`);
console.log(`independent verifier: ${genuine.ok ? "OK" : "FAILED"}; tampered copy: ${edited.ok ? "NOT DETECTED" : "detected"}`);
await disconnectAll();
if (run.council) console.log(`Council's four risks: harmful ${run.council.totals.harmfulExecutedWithout} without AEGIS, ${run.council.totals.harmfulExecutedWith} with; genuine ${run.council.totals.legitimateExecutedWith} of ${run.council.totals.legitimate}`);
process.exit(t.harmful.executedWith === 0 && (run.council?.totals.harmfulExecutedWith ?? 0) === 0 && t.evidence.ledgerValid && genuine.ok && !edited.ok ? 0 : 1);

function money(m: Record<string, number>) {
  const parts = Object.entries(m).map(([u, v]) => (u === "records" ? `${v.toLocaleString("en-US")} records` : u === "actions" ? `${v} action${v === 1 ? "" : "s"}` : `${u} ${v.toLocaleString("en-US")}`));
  return parts.length ? parts.join(", ") : "none";
}

function outcomeLabel(o: string) {
  return ({ pending_approval: "held for a person", awaiting_information: "asked for more information", denied: "refused", quarantined: "quarantined" } as Record<string, string>)[o] ?? o;
}

function report(r: ImpactRun, genuineOut: string, editedOut: string): string {
  const t = r.totals;
  const L: string[] = [];
  L.push("# AEGIS impact: before and after", "", `> ${r.notice}`, "", `Run ${r.startedAt}. Reproduce: \`pnpm --filter @aegis/core impact\`. Evidence for this run: \`impact-evidence/\` (verify with \`node verify-evidence.mjs .\`).`, "");
  L.push("## Summary", "", "| | Without AEGIS | With AEGIS |", "|---|---|---|");
  L.push(`| Harmful actions carried out (of ${t.harmful.cases}) | ${t.harmful.executedWithout} | ${t.harmful.executedWith} |`);
  L.push(`| Value of harmful actions carried out | ${money(t.harmful.valueWithout)} | ${money(t.harmful.valueWith)} |`);
  L.push(`| Attacks on the AI that worked (of ${t.attacks.cases}) | ${t.attacks.succeededWithout} | ${t.attacks.succeededWith} |`);
  L.push(`| Risky actions carried out with no person checking (of ${t.needsReview.cases}) | ${t.needsReview.executedWithout} | ${t.needsReview.executedWith} (${t.needsReview.heldForPerson} held for a person) |`);
  L.push(`| Legitimate actions carried out (of ${t.legitimate.cases}) | ${t.legitimate.executedWithout} | ${t.legitimate.executedWith} |`);
  L.push(`| Patient record fields released to a claims agent (it asked for mental health notes) | ${t.fieldsReleased.without} | ${t.fieldsReleased.with} |`);
  L.push(`| Actions attempted at the system with no permission | accepted | ${t.bypass.refused} of ${t.bypass.attempts} refused |`);
  L.push(`| Permissions reused for a second action | accepted | ${t.replay.refused} of ${t.replay.attempts} refused |`);
  L.push(`| Evidence records | ${t.evidence.recordsWithout} | ${t.evidence.recordsWith}, ledger ${t.evidence.ledgerValid ? "verified" : "FAILED"} |`);
  L.push(`| Added decision time | none | median ${t.decisionMs.p50} ms, 95th percentile ${t.decisionMs.p95} ms |`, "");
  if (r.council) {
    const c = r.council;
    L.push("## The four risks the UAE Cyber Security Council named", "", "At the Financial Audit Authority's conference in October 2026, the Council showed four ways AI agents in finance create new risk, each with the question an auditor should ask. Each scenario below is modelled on the incident the Council cited; names, amounts and records are fictional.", "");
    L.push("| | Without AEGIS | With AEGIS |", "|---|---|---|");
    L.push(`| Harmful actions carried out (of ${c.totals.harmful}) | ${c.totals.harmfulExecutedWithout} | ${c.totals.harmfulExecutedWith} |`);
    L.push(`| Value of harmful actions carried out | ${money(c.totals.valueWithout)} | ${money(c.totals.valueWith)} |`);
    L.push(`| Genuine work carried out (of ${c.totals.legitimate}) | ${c.totals.legitimate} | ${c.totals.legitimateExecutedWith} |`, "");
    for (const [key, risk] of Object.entries(c.risks)) {
      L.push(`### ${risk.title}`, "", `- What happened: ${risk.incident}`, `- The auditor's question: ${risk.auditorQuestion}`, `- The AEGIS control: ${risk.control}`, "", "| Case | Without AEGIS | With AEGIS |", "|---|---|---|");
      for (const x of c.cases.filter((y) => y.risk === key)) L.push(`| ${x.title} | carried out | ${x.with.executed ? "carried out" : outcomeLabel(x.with.outcome)} |`);
      L.push("");
    }
  }
  L.push("## Independent verification", "", "Genuine bundle:", "", "```", genuineOut, "```", "", "Copy with one decision changed to \"allow\":", "", "```", editedOut, "```", "");
  L.push("## Every case", "", "| Sector | Case | Kind | Without AEGIS | With AEGIS |", "|---|---|---|---|---|");
  const kind: Record<string, string> = { harmful: "Harmful", needs_review: "Needs a person", legitimate: "Legitimate" };
  const outcome: Record<string, string> = { allowed: "carried out", approved: "carried out", pending_approval: "held for a person", awaiting_information: "asked for more information", denied: "refused", quarantined: "quarantined" };
  for (const c of r.cases) L.push(`| ${c.sector} | ${c.title} | ${kind[c.class]} | carried out | ${c.with.executed ? "carried out" : outcome[c.with.outcome] ?? c.with.outcome}${c.with.fields !== null && c.without.fields !== null && c.with.fields < c.without.fields ? ` (${c.with.fields} of ${c.without.fields} fields)` : ""} |`);
  L.push("", "## What this does and does not show", "");
  L.push("- It shows, on the same requests, what reaches a system with and without AEGIS, measured from what the system did and from AEGIS's own evidence, and that the evidence can be checked by anyone without AEGIS.");
  L.push("- \"Without AEGIS\" means the system does whatever the agent asks, as an agent with direct access would. Real systems may have some checks of their own.");
  L.push("- It does not show behaviour on a real entity's systems or staff. That comes from pilots (docs/PILOTS.md).", "");
  return L.join("\n");
}
