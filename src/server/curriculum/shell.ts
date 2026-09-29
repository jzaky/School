import "server-only";
import type { Ctx } from "@/server/context";
import { reviewScope, reviewScopeWhere } from "./access";

/** Which curriculum tabs the member sees and how many plans wait for their review. */
export async function curriculumShell(ctx: Ctx) {
  const tabs: Array<"coverage" | "plans" | "review" | "frameworks"> = ["coverage"];
  if (ctx.can("curriculum.plan") || ctx.can("curriculum.review")) tabs.push("plans");
  let reviewCount = 0;
  if (ctx.can("curriculum.review")) {
    tabs.push("review");
    const scope = await reviewScope(ctx);
    reviewCount = await ctx.db.lessonPlan.count({ where: { AND: [reviewScopeWhere(scope), { status: "SUBMITTED", authorId: { not: ctx.membershipId } }] } });
  }
  if (ctx.can("curriculum.manage")) tabs.push("frameworks");
  return { tabs, reviewCount };
}
