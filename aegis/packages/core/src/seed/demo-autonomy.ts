import { withTenant } from "@aegis/db";
import type { OrgContext } from "../lib/context.js";
import { decideAutonomyRaise, lowerAutonomy, requestAutonomyRaise } from "../autonomy/service.js";
import type { SeededTenant } from "./demo-tenant.js";

/**
 * Autonomy levels and their history for the demo tenant (synthetic). Recorded through the same service
 * functions people use, at past times, so every change is in the evidence record. The four agents the demo
 * scenarios drive (treasury, refunds, trading, marketing) stay at level 4 so the scenarios behave exactly
 * as their policies describe. Automatic downgrades stay off in the demo for the same reason.
 */
export async function seedDemoAutonomy(t: SeededTenant): Promise<void> {
  const day = 86_400_000;
  const at = (ctx: OrgContext, daysAgo: number): OrgContext => ({ ...ctx, now: new Date(Date.now() - daysAgo * day) });
  const omar = t.users.governance_manager!.ctx;
  const tariq = t.users.security_analyst!.ctx;
  const nadia = t.users.owner!.ctx;
  await withTenant(t.orgId, async (db) => {
    const helpdesk = t.agents["it-helpdesk-agent"];
    const fraud = t.agents["fraud-triage-agent"];
    const kyc = t.agents["kyc-document-agent"];
    const copilot = t.agents["analytics-copilot"];
    if (helpdesk) {
      await lowerAutonomy(db, at(tariq, 3), helpdesk, { level: 1, ceilingAmount: null, reason: "Suspended pending the access review; when it resumes, every action is approved until the review closes." });
    }
    if (fraud) {
      await lowerAutonomy(db, at(tariq, 15), fraud, { level: 2, ceilingAmount: 1000, reason: "Card-block actions above AED 1,000 should be seen by an analyst while the scoring model is retrained." });
    }
    if (kyc) {
      await lowerAutonomy(db, at(omar, 30), kyc, { level: 2, ceilingAmount: null, reason: "New document vendor: low-risk checks run on their own, anything with an amount goes to a person." });
      const raise = await requestAutonomyRaise(db, at(omar, 8), kyc, { level: 3, ceilingAmount: null, reason: "Three weeks with the new vendor, no refusals and no rejected approvals." });
      await decideAutonomyRaise(db, at(tariq, 7), raise.id, { approve: true, note: "Checked the last three weeks of requests; agreed." });
    }
    if (copilot) {
      await lowerAutonomy(db, at(nadia, 11), copilot, { level: 1, ceilingAmount: null, reason: "The customer records export tool is new; every export is approved until it has a track record." });
      await requestAutonomyRaise(db, at(omar, 1), copilot, { level: 2, ceilingAmount: null, reason: "Exports have gone to the approved warehouse only; ask to let low-risk queries run on their own." });
    }
  });
}
