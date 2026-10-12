import "server-only";
import type { TenantDb } from "@aegis/db";

interface RuleDoc {
  id: string;
  description?: string;
  reason?: string;
  approval?: { instructions?: string; roles?: string[] };
}

export interface RuleExplanation {
  policyName: string | null;
  policyId: string | null;
  policyVersionId: string | null;
  version: number | null;
  ruleId: string | null;
  description: string | null;
  instructions: string | null;
}

/** Looks up the plain-language description of the rule that stopped each request for a person. */
export async function ruleExplanations(db: TenantDb, approvals: { policyVersionId: string | null; triggeringRuleId: string | null }[]): Promise<Map<string, RuleExplanation>> {
  const ids = [...new Set(approvals.map((a) => a.policyVersionId).filter((x): x is string => !!x))];
  const versions = ids.length ? await db.policyVersion.findMany({ where: { id: { in: ids } }, select: { id: true, version: true, document: true, policyId: true, policy: { select: { name: true } } } }) : [];
  const byId = new Map(versions.map((v) => [v.id, v]));
  const out = new Map<string, RuleExplanation>();
  for (const a of approvals) {
    const key = `${a.policyVersionId ?? ""}:${a.triggeringRuleId ?? ""}`;
    if (out.has(key)) continue;
    const v = a.policyVersionId ? byId.get(a.policyVersionId) : undefined;
    const ruleId = a.triggeringRuleId?.split("/").pop() ?? null;
    const rule = v ? ((v.document as { rules?: RuleDoc[] }).rules ?? []).find((r) => r.id === ruleId) : undefined;
    out.set(key, { policyName: v?.policy.name ?? null, policyId: v?.policyId ?? null, policyVersionId: v?.id ?? null, version: v?.version ?? null, ruleId, description: rule?.description ?? rule?.reason ?? null, instructions: rule?.approval?.instructions ?? null });
  }
  return out;
}

export function explanationKey(a: { policyVersionId: string | null; triggeringRuleId: string | null }): string {
  return `${a.policyVersionId ?? ""}:${a.triggeringRuleId ?? ""}`;
}
