/**
 * Live validation with real-world data (docs/LIVE_VALIDATION.md). Nothing here is synthetic:
 *
 * 1. Real packages, real advisories. Real npm packages, including ones that really were compromised, go
 *    through AEGIS Software Security with live OSV.dev lookups (the public open-source vulnerability and
 *    malicious-package database run by Google). The result is what AEGIS would decide today.
 * 2. Real attack text. Every row of a public, labelled prompt-injection dataset (deepset/prompt-injections,
 *    Apache-2.0, 662 rows of real attack and ordinary text) is passed to the AEGIS injection detector as
 *    the content of a tool parameter, exactly as the gateway does. The report counts what was caught and
 *    what was wrongly flagged.
 *
 *   pnpm --filter @aegis/core live
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { disconnectAll, rawPrisma, withTenant } from "@aegis/db";
import { env } from "../src/env.js";
import { registerUser } from "../src/identity/auth.js";
import { listUserMemberships } from "../src/identity/memberships.js";
import { makeContext } from "../src/lib/context.js";
import { attachSoftwareEvidence, requestSoftware, updateSoftwareSettings } from "../src/secure/software.js";
import { detectInjectionInParams } from "../src/shield/injection.js";
import { createOrganization } from "../src/orgs/orgs.js";

env();
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const results = join(root, "docs", "validation", "results");
const ranAt = new Date().toISOString();

// ---------- 1. Real packages, live OSV.dev ----------

/** Real npm packages and versions. "Expected" is the public record, cited, not an AEGIS output. */
const PACKAGES = [
  { name: "postmark-mcp", version: "1.0.15", record: "Last version before the compromise", expectProblem: false },
  { name: "postmark-mcp", version: "1.0.16", record: "Malicious: copied every email to the attacker by BCC (OSV MAL-2025-47604), the connector incident the UAE Cyber Security Council cited", expectProblem: true },
  { name: "event-stream", version: "3.3.6", record: "Compromised in 2018 through the flatmap-stream dependency, which stole cryptocurrency wallets", expectProblem: true },
  { name: "ua-parser-js", version: "0.7.29", record: "Hijacked in October 2021 to install a cryptominer and password stealer", expectProblem: true },
  { name: "node-ipc", version: "10.1.1", record: "Sabotaged in March 2022 to overwrite files on machines with Russian or Belarusian IP addresses", expectProblem: true },
  { name: "lodash", version: "4.17.21", record: "Latest 4.x release; vulnerabilities in it have been published since its release", expectProblem: true },
  { name: "express", version: "4.21.2", record: "Widely used web framework, patched release", expectProblem: false },
  { name: "zod", version: "4.1.12", record: "Validation library; a memory-exhaustion advisory (GHSA-mrhx-c7xc-m3w5) was published against it", expectProblem: true },
  { name: "zod", version: "4.6.7", record: "The patched release AEGIS itself upgraded to for that advisory", expectProblem: false },
  { name: "lodash", version: "4.17.4", record: "Old version with published prototype-pollution vulnerabilities", expectProblem: true },
];

/** A lockfile entry with the package's real license and integrity hash from the public npm registry. */
async function lockFor(name: string, version: string) {
  const r = await fetch(`https://registry.npmjs.org/${name}/${version}`);
  const meta = r.ok ? ((await r.json()) as { license?: string; dist?: { integrity?: string; tarball?: string } }) : {};
  return JSON.stringify({ lockfileVersion: 3, packages: { "": { dependencies: { [name]: version } }, [`node_modules/${name}`]: { version, resolved: meta.dist?.tarball ?? `https://registry.npmjs.org/${name}/-/${name.split("/").pop()}-${version}.tgz`, integrity: meta.dist?.integrity, license: typeof meta.license === "string" ? meta.license : undefined } } });
}

const email = "sector-lab-operator@aegis.local";
const user = (await rawPrisma().user.findUnique({ where: { email } })) ?? (await registerUser({ email, name: "Sector Lab Operator", password: `Lab-${crypto.randomUUID()}` }));
// A fresh organization for every run, so each result reflects only that day's evidence and advisories.
const org = await createOrganization({ name: `Live validation ${ranAt.slice(0, 10)} (real data)`, slug: `live-validation-${Date.now().toString(36)}`, ownerUserId: user.id });
await rawPrisma().organization.update({ where: { id: org.id }, data: { plan: "enterprise_trial" } });
const m = (await listUserMemberships(user.id)).find((x) => x.orgId === org.id)!;
const ctx = makeContext(org.id, { type: "user", id: user.id, permissions: m.permissions, membershipId: m.membershipId, label: "Live validation" });

const pkgResults: { name: string; version: string; record: string; expectProblem: boolean; recommended: string; riskScore: number; findings: { ref: string; kind: string; severity: string; title: string }[]; osvError: string | null; matches: boolean }[] = [];
await withTenant(org.id, (db) => updateSoftwareSettings(db, ctx, { internalPrefixes: [], internalHosts: [], osvLookup: true, autoApprove: false }));
for (const p of PACKAGES) {
  const lock = await lockFor(p.name, p.version);
  const out = await withTenant(org.id, async (db) => {
    const r = await requestSoftware(db, ctx, { name: p.name, ecosystem: "npm", version: p.version, purpose: `Live validation ${ranAt}` });
    const a = await attachSoftwareEvidence(db, ctx, r.item.id, { format: "npm_lock", text: lock });
    const findings = await db.softwareFinding.findMany({ where: { itemId: r.item.id }, select: { ref: true, kind: true, severity: true, title: true } });
    const ev = await db.softwareEvidence.findFirst({ where: { itemId: r.item.id, format: "npm_lock" }, orderBy: { createdAt: "desc" } });
    return { recommended: a.item.recommended, riskScore: a.item.riskScore, findings, osvError: ((ev?.summary ?? {}) as { osvError?: string | null }).osvError ?? null };
  }, { timeout: 120_000 });
  const flagged = out.recommended !== "approved";
  pkgResults.push({ ...p, ...out, matches: flagged === p.expectProblem });
  console.log(`${p.name}@${p.version}: ${out.recommended} (risk ${out.riskScore}), ${out.findings.length} finding(s)${out.osvError ? `, OSV error: ${out.osvError}` : ""}`);
}

// ---------- 2. Real prompt-injection dataset ----------

const DATASET = "deepset/prompt-injections";
type Row = { text: string; label: number; split: string };
const rows: Row[] = [];
for (const split of ["train", "test"]) {
  for (let offset = 0; ; offset += 100) {
    const r = await fetch(`https://datasets-server.huggingface.co/rows?dataset=${encodeURIComponent(DATASET)}&config=default&split=${split}&offset=${offset}&length=100`);
    if (!r.ok) throw new Error(`dataset download failed: HTTP ${r.status}`);
    const j = (await r.json()) as { rows: { row: { text: string; label: number } }[]; num_rows_total: number };
    rows.push(...j.rows.map((x) => ({ text: x.row.text, label: x.row.label, split })));
    if (offset + 100 >= j.num_rows_total) break;
  }
}
let tp = 0, fn = 0, fp = 0, tn = 0;
// The detector's multilingual reset and persona patterns were written from the train split only; the test split
// is held out, so its figures are the fair measure of how the detector does on attacks it was not tuned on.
const held = { tp: 0, fn: 0, fp: 0, tn: 0 };
const missed: string[] = [];
const wrong: string[] = [];
const bySignal: Record<string, number> = {};
for (const r of rows) {
  // As the gateway sees it: untrusted text arriving inside a tool parameter.
  const d = detectInjectionInParams({ content: r.text }, 0);
  const flagged = d.signals.length > 0;
  for (const k of d.keys) bySignal[k] = (bySignal[k] ?? 0) + 1;
  if (r.split === "test") {
    if (r.label === 1) flagged ? held.tp++ : held.fn++;
    else flagged ? held.fp++ : held.tn++;
  }
  if (r.label === 1 && flagged) tp++;
  else if (r.label === 1) {
    fn++;
    if (missed.length < 8) missed.push(r.text.slice(0, 140));
  } else if (flagged) {
    fp++;
    if (wrong.length < 5) wrong.push(r.text.slice(0, 140));
  } else tn++;
}
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const injection = { dataset: DATASET, license: "Apache-2.0", rows: rows.length, attacks: tp + fn, ordinary: fp + tn, caught: tp, missed: fn, wronglyFlagged: fp, recall: pct(tp, tp + fn), falsePositiveRate: pct(fp, fp + tn), heldOut: { attacks: held.tp + held.fn, caught: held.tp, recall: pct(held.tp, held.tp + held.fn), ordinary: held.fp + held.tn, wronglyFlagged: held.fp, falsePositiveRate: pct(held.fp, held.fp + held.tn) }, before: { recall: 4.6, falsePositiveRate: 0.5, note: "First live run on 2026-10-29, before the multilingual patterns, all 662 rows" }, bySignal, examplesMissed: missed, examplesWronglyFlagged: wrong };
console.log(`injection: caught ${tp} of ${tp + fn} attacks (${injection.recall}%), wrongly flagged ${fp} of ${fp + tn} ordinary texts (${injection.falsePositiveRate}%)`);

writeFileSync(join(results, "LIVE_RESULTS.json"), JSON.stringify({ ranAt, packages: pkgResults, injection }, null, 2) + "\n");
const L: string[] = [];
L.push("# AEGIS live validation: real-world data", "", `Run ${ranAt}. Reproduce: \`pnpm --filter @aegis/core live\`. Nothing in this report is synthetic: the packages, the advisories and the attack texts are real and were fetched live during the run.`, "");
L.push("## 1. Real packages, checked against the live OSV.dev database", "", "Each package went through AEGIS Software Security with live lookups in OSV.dev, the public open-source vulnerability and malicious-package database. \"Public record\" is what is publicly known about that version, not an AEGIS output.", "");
L.push("| Package | Public record | AEGIS recommends | Risk | Findings | Matches the record |", "|---|---|---|---|---|---|");
for (const p of pkgResults) L.push(`| ${p.name} ${p.version} | ${p.record} | ${p.recommended} | ${p.riskScore} | ${p.findings.length ? p.findings.slice(0, 3).map((f) => f.ref).join(", ") + (p.findings.length > 3 ? ` and ${p.findings.length - 3} more` : "") : "none"} | ${p.matches ? "yes" : "**no**"} |`);
L.push("", "The compromised versions show no license and no integrity hash because npm removed them from its registry after each incident, so the registry has nothing to return for them.", "", `${pkgResults.filter((p) => p.matches).length} of ${pkgResults.length} matched the public record.${pkgResults.some((p) => p.osvError) ? " Some lookups failed; see LIVE_RESULTS.json." : ""}`, "");
L.push("## 2. Real prompt-injection attempts", "", `All ${rows.length} rows of [${DATASET}](https://huggingface.co/datasets/${DATASET}) (Apache-2.0), a public dataset of real injection attempts and ordinary requests labelled by people, in English and German. Each text was given to the AEGIS injection detector as the content of a tool parameter, the way the gateway inspects what an agent sends.`, "");
L.push("| | Count | Rate |", "|---|---|---|");
L.push(`| Injection attempts caught | ${tp} of ${tp + fn} | ${injection.recall}% |`);
L.push(`| Ordinary texts wrongly flagged | ${fp} of ${fp + tn} | ${injection.falsePositiveRate}% |`);
L.push(`| Held-out test split only: attacks caught | ${held.tp} of ${held.tp + held.fn} | ${injection.heldOut.recall}% |`);
L.push(`| Held-out test split only: ordinary texts wrongly flagged | ${held.fp} of ${held.fp + held.tn} | ${injection.heldOut.falsePositiveRate}% |`, "");
L.push("The first live run, before any change, caught 12 of 263 attacks (4.6%). The detector was then extended with general reset and persona patterns in English, German and French, written from the dataset's train split only. The test split was held out, so its figures are the fair measure; the all-rows figures include text the patterns were written from.", "");
L.push("Signals that fired: " + (Object.entries(bySignal).map(([k, v]) => `${k} ${v}`).join(", ") || "none") + ".", "");
L.push("Examples it missed:", "", ...missed.map((x) => `- "${x.replace(/\s+/g, " ")}"`), "");
if (wrong.length) L.push("Examples it wrongly flagged:", "", ...wrong.map((x) => `- "${x.replace(/\s+/g, " ")}"`), "", "Both contain invisible zero-width characters (before \"IT\" and \"jewelry\"), a known way to hide instructions, which the detector flags on purpose.", "");
L.push("## Reading these results honestly", "");
L.push("- The injection detector is a fast, explainable pattern check. It is one layer: AEGIS does not rely on spotting an attack, because the policy, approval, data protection and payment controls still decide what an agent may do even when an attack is missed.");
L.push("- This dataset includes many attempts that do not ask the agent to act (for example, asking a chatbot for an opinion), and texts in German; a pattern check built for agent actions catches fewer of those. The figure is reported as measured.");
L.push("- Package results depend on what OSV.dev knows on the day of the run.");
L.push("- The first live run found a real gap: OSV's malicious-package records carry no severity, so AEGIS rated postmark-mcp 1.0.16 as a medium issue and approved it. Malicious-code records are now a separate finding that prohibits the software outright, with a regression test (packages/core/tests/software-security.test.ts).", "");
// codeql[js/http-to-file-access] Validation script: writes a report of measured results for a person to review.
writeFileSync(join(results, "LIVE_RESULTS.md"), L.join("\n"));
await disconnectAll();
