import { withTenant } from "@aegis/db";
import { completeAccessReview, decideAccessReviewItem, startAccessReview } from "../agents/access-reviews.js";
import type { SeededTenant } from "./demo-tenant.js";

/**
 * Access review demo: last quarter's review, completed on time by the governance manager, and this
 * quarter's review, opened four days ago with part of it decided. Every decision in the seed is "keep",
 * so no demo agent loses access its other demo flows rely on.
 */
export async function seedDemoAccessReviews(t: SeededTenant): Promise<{ completed: number; open: number }> {
  const gm = t.users.governance_manager!.ctx;
  const at = (daysAgo: number) => ({ ...gm, now: new Date(Date.now() - daysAgo * 86400_000) });
  return withTenant(t.orgId, async (db) => {
    const past = await startAccessReview(db, at(96), { title: "Q3 agent access review", dueInDays: 14, intervalDays: 90 });
    const pastItems = await db.accessReviewItem.findMany({ where: { reviewId: past.review.id } });
    for (const i of pastItems) await decideAccessReviewItem(db, at(91), i.id, { decision: "keep", note: i.uses === 0 ? "Needed for the year-end campaign; review again next quarter" : "" });
    await completeAccessReview(db, at(90), past.review.id);
    const open = await startAccessReview(db, at(4), { title: "Q4 agent access review", dueInDays: 14, intervalDays: 90 });
    const openItems = await db.accessReviewItem.findMany({ where: { reviewId: open.review.id }, orderBy: [{ uses: "desc" }] });
    for (const i of openItems.filter((x) => x.uses > 0).slice(0, 4)) await decideAccessReviewItem(db, at(2), i.id, { decision: "keep", note: "" });
    return { completed: 1, open: 1 };
  });
}
