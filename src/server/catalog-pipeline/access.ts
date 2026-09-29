import "server-only";
import type { Ctx } from "@/server/context";
import { catalogWriteDenial, type CatalogActor, type CatalogDenial } from "@/server/platform/catalog-db";

export function actorFromCtx(ctx: Ctx): CatalogActor {
  return {
    orgId: ctx.orgId,
    orgIsDemo: ctx.org.isDemo,
    email: ctx.user.email ?? null,
    canReview: ctx.can("catalog.review"),
    membershipId: ctx.membershipId,
    userId: ctx.user.id,
  };
}

export type CatalogUiState = {
  /** Why publishing controls are disabled, or null when they work. */
  writeDenial: CatalogDenial | null;
  /** Why "Check now" is disabled, or null. */
  checkDenial: CatalogDenial | "no_redis" | null;
  scorecardDenial: CatalogDenial | "no_api_key" | null;
  aiAvailable: boolean;
};

export function catalogUiState(ctx: Ctx): CatalogUiState {
  const writeDenial = catalogWriteDenial(actorFromCtx(ctx));
  const redis = !!process.env.REDIS_URL;
  return {
    writeDenial,
    checkDenial: writeDenial ?? (redis ? null : "no_redis"),
    scorecardDenial: writeDenial ?? (process.env.COLLEGE_SCORECARD_API_KEY ? null : "no_api_key"),
    aiAvailable: !!process.env.ANTHROPIC_API_KEY,
  };
}
