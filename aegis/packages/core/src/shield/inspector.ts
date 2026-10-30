import type { TenantDb } from "@aegis/db";
import { registerShieldInspector, type ShieldInspection, type ShieldInspector } from "../gateway/shield-hook.js";
import { logger } from "../lib/logger.js";
import { loadEnabledDataClasses } from "./data-classes.js";
import { inspectParams } from "./detectors.js";
import { detectInjectionInParams } from "./injection.js";

/**
 * The Shield inspector the gateway calls before policy evaluation.
 *
 * - Loads the org's enabled data classes (cached 30 seconds, invalidated on writes).
 * - Classifies every string in the parameters and applies the per-class action.
 * - Runs the heuristic injection signal detector over strings longer than 20 characters,
 *   because parameters often embed untrusted text (ticket bodies, retrieved documents).
 * - Blocks when any finding's class action is block; requires approval when any is require_approval.
 *
 * Fails closed: any internal error becomes blocked=true with a fixed block reason so the gateway
 * denies. The inspector never throws for data reasons and never logs parameter values.
 */
export const shieldInspector: ShieldInspector = async (db: TenantDb, orgId: string, args): Promise<ShieldInspection> => {
  try {
    const classes = await loadEnabledDataClasses(db, orgId);
    const inspection = inspectParams(args.params, classes);
    const injection = detectInjectionInParams(args.params, 20);
    const blockReason = inspection.blocked ? `Sensitive data blocked by data protection: ${inspection.blockedClasses.join(", ")}` : null;
    return {
      shield: {
        dataClasses: inspection.dataClasses,
        highestSeverity: inspection.highestSeverity,
        injectionSignals: injection.keys,
        blocked: inspection.blocked,
      },
      params: inspection.blocked ? args.params : inspection.params,
      findings: inspection.findings.map((f) => ({ dataClass: f.dataClass, action: f.action, count: f.count, severity: f.severity, field: f.field })),
      blockReason,
      requireApproval: inspection.requireApproval,
    };
  } catch (err) {
    logger.error({ orgId, toolKey: args.toolKey, agentId: args.agentId, err: err instanceof Error ? err.message : String(err) }, "shield inspection failed; failing closed");
    return {
      shield: { dataClasses: [], highestSeverity: "high", injectionSignals: [], blocked: true },
      params: args.params,
      findings: [],
      blockReason: "shield inspection failed",
      requireApproval: false,
    };
  }
};

let installed = false;

/** Registers the real inspector with the gateway hook. Idempotent; call once per process at startup. */
export function installShield(): void {
  registerShieldInspector(shieldInspector);
  installed = true;
}

export function isShieldInstalled(): boolean {
  return installed;
}
