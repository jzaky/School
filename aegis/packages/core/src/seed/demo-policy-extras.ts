import { withTenant } from "@aegis/db";
import type { OrgContext } from "../lib/context.js";
import { parsePolicyDocument } from "../policy/schema.js";
import { decidePolicyException, requestPolicyException } from "../policy/exceptions.js";
import type { SeededTenant } from "./demo-tenant.js";

const DAY = 86_400_000;
const at = (ctx: OrgContext, daysAgo: number): OrgContext => ({ ...ctx, now: new Date(Date.now() - daysAgo * DAY) });

/**
 * Phase 9 demo data: one exception that ran its course and one waiting for a second person. No
 * exception is active, so the demo's gateway behaviour is unchanged.
 */
export async function seedDemoPolicyExtras(t: SeededTenant): Promise<number> {
  const omar = t.users.governance_manager!.ctx;
  const nadia = t.users.owner!.ctx;
  return withTenant(t.orgId, async (db) => {
    const treasury = await db.policy.findFirst({ where: { key: "treasury-transfer-limits" }, include: { versions: { where: { state: "active" }, take: 1 } } });
    const refunds = await db.policy.findFirst({ where: { key: "refund-authority" }, include: { versions: { where: { state: "active" }, take: 1 } } });
    if (!treasury?.versions[0] || !refunds?.versions[0]) return 0;
    const tRule = parsePolicyDocument(treasury.versions[0].document).rules[0]!.id;
    const rRule = parsePolicyDocument(refunds.versions[0].document).rules.find((r) => r.id === "duplicate-refund")?.id ?? parsePolicyDocument(refunds.versions[0].document).rules[0]!.id;
    const past = await requestPolicyException(db, at(omar, 40), { policyId: refunds.id, ruleId: rRule, agentId: t.agents["support-refund-agent"]!, toolKey: "issue-refund", reason: "Split shipments refunded per parcel during the warehouse migration", days: 7 });
    await decidePolicyException(db, at(nadia, 39), past.id, { approve: true, note: "Approved for the migration week only" });
    await requestPolicyException(db, at(omar, 1), { policyId: treasury.id, ruleId: tRule, agentId: t.agents["treasury-transfer-agent"]!, toolKey: null, reason: "Quarter-end supplier settlements outside the usual window", days: 3 });
    return 2;
  });
}
