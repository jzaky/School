import { env, isProduction } from "./env.js";
import { logger } from "./lib/logger.js";
import { evidenceKeyRing } from "./evidence/ledger.js";

/**
 * Startup guard for the application processes (api, web, worker). These run as the non-owner
 * database role; if they are handed the table-owner URL as well, a bug or an injection in request
 * code could bypass row-level security. In production that is a startup failure, elsewhere a loud
 * warning, so a misconfigured deployment template cannot pass silently.
 */
export function assertApplicationProcess(processName: "api" | "web" | "worker"): void {
  const e = env();
  const problems: string[] = [];
  if (e.MIGRATION_DATABASE_URL) problems.push("MIGRATION_DATABASE_URL (table-owner credentials) is set");
  if (e.AEGIS_APP_PASSWORD) problems.push("AEGIS_APP_PASSWORD (role bootstrap secret) is set");
  if (problems.length === 0) {
    assertEvidenceSigning(processName);
    return;
  }
  const message = `${processName} received privileged database settings it must not hold: ${problems.join("; ")}. Give them only to the migrate job.`;
  if (isProduction()) throw new Error(message);
  logger.warn({ process: processName }, message);
  assertEvidenceSigning(processName);
}

/**
 * Evidence checkpoints are signed (S9). Production processes refuse to start without a valid signing key,
 * because unsigned checkpoints would make the evidence record weaker than the product claims. Elsewhere a
 * missing key is a warning; an unreadable key is always an error.
 */
export function assertEvidenceSigning(processName: string): void {
  const e = env();
  if (!e.EVIDENCE_SIGNING_KEY) {
    const message = `${processName}: EVIDENCE_SIGNING_KEY is not set, so evidence checkpoints cannot be signed. Generate one with pnpm --filter @aegis/core keygen.`;
    if (isProduction()) throw new Error(message);
    logger.warn({ process: processName }, message);
    return;
  }
  evidenceKeyRing();
}
