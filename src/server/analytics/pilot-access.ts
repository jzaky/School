import type { Ctx } from "@/server/context";

/** Pilot measures are for school leadership: the principal and the school administrator. */
export function canSeePilotMeasures(ctx: Pick<Ctx, "roles" | "can">) {
  return ctx.can("analytics.view") && (ctx.roles.includes("principal") || ctx.roles.includes("school_admin"));
}
