import "server-only";
import type { Ctx } from "@/server/context";

/** A workflow must keep DSL routing when any safeguarding service uses it. */
export async function isSafeguardingWorkflow(ctx: Ctx, workflowId: string) {
  const n = await ctx.db.serviceDefinition.count({ where: { orgId: ctx.orgId, workflowId, sensitivity: "SAFEGUARDING" } });
  return n > 0;
}
