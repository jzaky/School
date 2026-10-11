"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@aegis/db";
import { forbidden, runBankingDemo, runRefundDemo, runSensitiveDataDemo, validation, type DemoRun } from "@aegis/core";
import { getConsoleContext } from "@/server/session";
import { act } from "./util";

const runSchema = z.object({ scenario: z.enum(["banking", "refunds", "sensitive-data"]), autoApprove: z.boolean().default(false) });

export interface DemoRunOutput extends DemoRun {
  approvals: Record<string, string>;
}

/**
 * Runs one demonstration scenario through the real gateway. Approvals, when auto-approved, are
 * decided as the signed-in user so evidence attributes the decision to a real actor.
 */
export async function runDemoAction(input: unknown) {
  return act(async (): Promise<DemoRunOutput> => {
    const c = await getConsoleContext();
    if (!c.can("gateway:read")) throw forbidden("Missing permission gateway:read");
    const data = runSchema.parse(input);
    if (data.autoApprove && !c.can("approvals:decide")) throw forbidden("Auto-approve requires approvals:decide");
    if (!c.org.demoMode) throw validation("Demo scenarios run only in organizations with demo mode enabled");
    const agentIds = await withTenant(c.ctx.orgId, async (db) => {
      const rows = await db.agent.findMany({ where: { orgId: c.ctx.orgId }, select: { slug: true, id: true } });
      return Object.fromEntries(rows.map((r) => [r.slug, r.id]));
    });
    const actors = { orgId: c.ctx.orgId, agentIds, approverCtx: c.ctx, autoApprove: data.autoApprove };
    const run = data.scenario === "banking" ? await runBankingDemo(actors, { decision: data.autoApprove ? "approve" : "leave" }) : data.scenario === "refunds" ? await runRefundDemo(actors) : await runSensitiveDataDemo(actors);
    const requestIds = [...new Set(run.steps.map((s) => s.requestId).filter((x): x is string => !!x))];
    const approvals = await withTenant(c.ctx.orgId, async (db) => {
      const rows = requestIds.length ? await db.approvalRequest.findMany({ where: { actionRequestId: { in: requestIds } }, select: { id: true, actionRequestId: true } }) : [];
      return Object.fromEntries(rows.map((r) => [r.actionRequestId, r.id]));
    });
    for (const p of ["/gateway", "/approvals", "/activity", "/overview", "/evidence", "/alerts"]) revalidatePath(p);
    revalidatePath("/", "layout");
    return { ...run, approvals };
  });
}
