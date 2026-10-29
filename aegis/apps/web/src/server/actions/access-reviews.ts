"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@aegis/db";
import { completeAccessReview, decideAccessReviewItem, startAccessReview } from "@aegis/core";
import { getConsoleContext } from "@/server/session";
import { act } from "./util";

/** Agent access reviews (docs/ACCESS_REVIEWS.md): permission and input checks are in core. */
export async function startAccessReviewAction(input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    const out = await withTenant(c.ctx.orgId, (db) => startAccessReview(db, c.ctx, input));
    revalidatePath("/agents/access-reviews");
    return { id: out.review.id, items: out.items };
  });
}

export async function decideAccessReviewItemAction(itemId: string, input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    await withTenant(c.ctx.orgId, (db) => decideAccessReviewItem(db, c.ctx, z.string().uuid().parse(itemId), input));
    revalidatePath("/agents/access-reviews");
  });
}

export async function completeAccessReviewAction(reviewId: string) {
  return act(async () => {
    const c = await getConsoleContext();
    await withTenant(c.ctx.orgId, (db) => completeAccessReview(db, c.ctx, z.string().uuid().parse(reviewId)));
    revalidatePath("/agents/access-reviews");
  });
}
