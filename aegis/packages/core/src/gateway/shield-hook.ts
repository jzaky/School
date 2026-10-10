import type { TenantDb } from "@aegis/db";
import type { AuthorizationInput } from "./input.js";

/**
 * Shield inspects parameters before policy evaluation. The result feeds the policy input
 * (shield.*), can block outright, and can rewrite parameters (mask/redact) before execution.
 * The default inspector is a no-op; the Shield module (phase 4) registers the real one.
 */
export interface ShieldInspection {
  shield: AuthorizationInput["shield"];
  /** Parameters after masking or redaction; what the downstream system will receive. */
  params: Record<string, unknown>;
  /** Findings for evidence and security events. */
  findings: { dataClass: string; action: string; count: number; severity: string; field: string }[];
  blockReason: string | null;
  requireApproval: boolean;
}

export type ShieldInspector = (db: TenantDb, orgId: string, args: { params: Record<string, unknown>; toolKey: string; destinationDomain: string | null; agentId: string }) => Promise<ShieldInspection>;

let inspector: ShieldInspector = async (_db, _orgId, args) => ({
  shield: { dataClasses: [], highestSeverity: null, injectionSignals: [], blocked: false },
  params: args.params,
  findings: [],
  blockReason: null,
  requireApproval: false,
});

export function registerShieldInspector(fn: ShieldInspector) {
  inspector = fn;
}

export function getShieldInspector(): ShieldInspector {
  return inspector;
}
