/**
 * Validation records (docs/INTEGRATION_VALIDATION.md). Each run writes one JSON file under
 * docs/validation/results/. A record never contains a credential: only hosts, check names, outcomes and
 * provider-side identifiers that are safe to publish (test-mode ids, advisory ids).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type Mode = "external_verified" | "external_failed" | "not_run_missing_credentials" | "local_simulation";

export interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

export interface ValidationRecord {
  integration: string;
  mode: Mode;
  /** Hosts actually contacted. Empty for a local simulation. */
  hosts: string[];
  /** How bytes left the machine, so a reader knows which AEGIS code path carried them. */
  transport: string;
  startedAt: string;
  finishedAt: string;
  checks: Check[];
  notes: string[];
}

const RESULTS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "validation", "results");

/** A fetch-based transport that honours HTTPS_PROXY (Node 22: NODE_USE_ENV_PROXY=1). Used only when the environment has no direct egress. */
export const viaEnvProxy = () => !!process.env.HTTPS_PROXY && process.env.AEGIS_VALIDATE_DIRECT !== "1";

export function save(r: ValidationRecord): string {
  mkdirSync(RESULTS, { recursive: true });
  const file = join(RESULTS, `${r.integration}-${r.startedAt.slice(0, 19).replace(/[:T]/g, "-")}.json`);
  const text = JSON.stringify(r, null, 2);
  if (/sk_(test|live)_[A-Za-z0-9]{8,}|aegis_ak_[A-Za-z0-9]|Bearer\s+[A-Za-z0-9]/.test(text)) throw new Error("Refusing to write a validation record that looks like it contains a credential");
  writeFileSync(file, text + "\n");
  return file;
}

export function report(r: ValidationRecord) {
  const pad = Math.max(...r.checks.map((c) => c.name.length), 10);
  console.log(`\n${r.integration}: ${r.mode}  (${r.hosts.join(", ") || "no external host"})`);
  for (const c of r.checks) console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.name.padEnd(pad)}  ${c.detail}`);
  for (const n of r.notes) console.log(`note: ${n}`);
  const failed = r.checks.filter((c) => !c.pass).length;
  console.log(`${r.checks.length - failed}/${r.checks.length} checks passed`);
  return failed;
}
