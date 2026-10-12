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

let inspector: ShieldInspector | null = null;

const lazyDefault: ShieldInspector = async (db, orgId, args) => {
  // Dynamic import avoids a static cycle (shield/inspector imports registerShieldInspector from here).
  const mod = await import("../shield/inspector.js");
  if (inspector === null) inspector = mod.shieldInspector;
  return mod.shieldInspector(db, orgId, args);
};

export function registerShieldInspector(fn: ShieldInspector) {
  inspector = fn;
}

export function getShieldInspector(): ShieldInspector {
  return inspector ?? lazyDefault;
}

/** True once a real or stand-in inspector is registered (the lazy default counts after its first use). */
export function isShieldInspectorRegistered(): boolean {
  return inspector !== null;
}
