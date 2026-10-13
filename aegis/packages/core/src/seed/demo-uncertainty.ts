import { withTenant } from "@aegis/db";
import { createHash } from "node:crypto";
import type { OrgContext } from "../lib/context.js";
import { labelOutcome, recomputeCalibration, updateToolUncertaintyPolicy } from "../uncertainty/service.js";
import type { SeededTenant } from "./demo-tenant.js";

/**
 * Outcome labels and tool requirements for the demo (synthetic). A reviewer has checked most refunds that ran
 * on their own; the seeded outcomes make the refund agent somewhat overconfident, which the calibration
 * report then shows. Labels are a fixed function of the request id, so every reset gives the same picture.
 */
export async function seedDemoUncertainty(t: SeededTenant): Promise<{ labels: number }> {
  const reviewer = t.users.governance_manager!.ctx;
  const at = (ctx: OrgContext, when: Date): OrgContext => ({ ...ctx, now: when });
  let labels = 0;
  await withTenant(t.orgId, async (db) => {
    const refunds = await db.actionRequest.findMany({ where: { agentId: t.agents["support-refund-agent"], status: "executed", idempotencyKey: { startsWith: "hist-rf-" } }, select: { id: true, context: true, createdAt: true }, orderBy: { createdAt: "asc" } });
    for (const r of refunds) {
      const confidence = (r.context as { confidence?: number } | null)?.confidence;
      if (typeof confidence !== "number") continue;
      const roll = parseInt(createHash("sha256").update(r.id).digest("hex").slice(0, 8), 16) / 0xffffffff;
      if (roll > 0.95) continue; // not every refund was reviewed
      const correct = roll < confidence - 0.08;
      await labelOutcome(db, at(reviewer, new Date(r.createdAt.getTime() + 2 * 86_400_000)), { actionRequestId: r.id, correct, note: correct ? "" : "Customer was not entitled on review" });
      labels++;
    }
    const tool = await db.tool.findFirst({ where: { key: "issue-refund" } });
    if (tool) {
      // Shown in the console; left off so the demo scenarios behave exactly as their policies describe.
      await updateToolUncertaintyPolicy(db, t.users.owner!.ctx, tool.id, { enabled: false, requiredContext: ["params.orderId"], requireEvidenceFor: ["amount"], maxEvidenceAgeMinutes: 60, trustedSources: ["orders-db"], minConfidence: 0.7, onHigh: "require_approval" });
    }
    await recomputeCalibration(db, t.users.owner!.ctx);
  }, { timeout: 120_000, lock: "lazy" });
  return { labels };
}
