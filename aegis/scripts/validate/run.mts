/**
 * Runs one provider check and writes a validation record (docs/INTEGRATION_VALIDATION.md).
 *
 *   npx tsx scripts/validate/run.mts stripe     # needs STRIPE_TEST_SECRET_KEY (sk_test_...)
 *   npx tsx scripts/validate/run.mts alpaca     # needs ALPACA_PAPER_KEY (keyId:secret of a paper account)
 *   npx tsx scripts/validate/run.mts entra      # needs AEGIS_VALIDATE_ENTRA_TENANT_ID, _CLIENT_ID, _CLIENT_SECRET (an app registration)
 *   npx tsx scripts/validate/run.mts ai         # needs AEGIS_VALIDATE_AI_BASE_URL, AEGIS_VALIDATE_AI_KEY, AEGIS_VALIDATE_AI_MODEL
 *
 * Credentials are read from the environment of the shell that runs this; they are never printed or recorded.
 * Without the credential the record says "not_run_missing_credentials", never a pass.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { report, save, type ValidationRecord } from "./record.mts";

const which = process.argv[2];
const here = dirname(fileURLToPath(import.meta.url));
const plans: Record<string, { script: string; needs: string[]; hosts: () => string[] }> = {
  stripe: { script: join(here, "..", "stripe-sandbox-check.mts"), needs: ["STRIPE_TEST_SECRET_KEY"], hosts: () => ["api.stripe.com"] },
  alpaca: { script: join(here, "..", "alpaca-paper-check.mts"), needs: ["ALPACA_PAPER_KEY"], hosts: () => [new URL(process.env.ALPACA_API_BASE ?? "https://paper-api.alpaca.markets").host] },
  entra: { script: join(here, "entra.mts"), needs: ["AEGIS_VALIDATE_ENTRA_TENANT_ID", "AEGIS_VALIDATE_ENTRA_CLIENT_ID", "AEGIS_VALIDATE_ENTRA_CLIENT_SECRET"], hosts: () => ["login.microsoftonline.com", "graph.microsoft.com"] },
  ai: { script: join(here, "ai-provider.mts"), needs: ["AEGIS_VALIDATE_AI_BASE_URL", "AEGIS_VALIDATE_AI_KEY", "AEGIS_VALIDATE_AI_MODEL"], hosts: () => (process.env.AEGIS_VALIDATE_AI_BASE_URL ? [new URL(process.env.AEGIS_VALIDATE_AI_BASE_URL).host] : []) },
};
const plan = plans[which ?? ""];
if (!plan) {
  console.error(`usage: npx tsx scripts/validate/run.mts <${Object.keys(plans).join("|")}>`);
  process.exit(2);
}
const startedAt = new Date().toISOString();
const missing = plan.needs.filter((n) => !process.env[n]);
let record: ValidationRecord;
if (missing.length) {
  record = { integration: which!, mode: "not_run_missing_credentials", hosts: [], transport: "none", startedAt, finishedAt: new Date().toISOString(), checks: [], notes: [`Missing ${missing.join(", ")}. See docs/INTEGRATION_VALIDATION.md for how to obtain test credentials.`] };
} else {
  const r = spawnSync("npx", ["tsx", plan.script], { encoding: "utf8", env: process.env, maxBuffer: 16 * 1024 * 1024 });
  const out = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
  // Keep provider-side identifiers and outcomes; drop anything that looks like a credential.
  const lines = out.split("\n").map((l) => l.trimEnd()).filter((l) => l && !/sk_(test|live)_|rk_(test|live)_|aegis_ak_|Bearer |secret/i.test(l));
  const checks = lines.filter((l) => /^(PASS|FAIL)\s/.test(l)).map((l) => ({ name: l.replace(/^(PASS|FAIL)\s+/, "").split(/\s{2,}/)[0]!, pass: l.startsWith("PASS"), detail: l.replace(/^(PASS|FAIL)\s+/, "").split(/\s{2,}/).slice(1).join(" ") }));
  if (!checks.length) checks.push({ name: "provider journey", pass: r.status === 0, detail: `exit code ${r.status}` });
  // A loopback or private host is a local stand-in, never an external verification.
  const local = plan.hosts().some((h) => /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1)/.test(h));
  record = { integration: which!, mode: local ? "local_simulation" : r.status === 0 ? "external_verified" : "external_failed", hosts: plan.hosts(), transport: "AEGIS connector code (production path)", startedAt, finishedAt: new Date().toISOString(), checks, notes: lines.filter((l) => !/^(PASS|FAIL)\s/.test(l)).slice(-25) };
}
const failed = report(record);
console.log(`record: ${save(record)}`);
process.exit(record.mode === "not_run_missing_credentials" ? 0 : failed ? 1 : 0);
