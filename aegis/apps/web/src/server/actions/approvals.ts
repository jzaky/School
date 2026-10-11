"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@aegis/db";
import { decideApproval, decideSchema, forbidden, provideApprovalInfo } from "@aegis/core";
import { getConsoleContext } from "@/server/session";
import { act } from "./util";

const uuid = z.string().uuid();

function revalidateApproval(id: string, requestId?: string) {
  revalidatePath("/approvals");
  revalidatePath(`/approvals/${id}`);
  revalidatePath("/gateway");
  if (requestId) revalidatePath(`/gateway/${requestId}`);
  revalidatePath("/overview");
  revalidatePath("/", "layout");
}

export interface DecisionOutcome {
  status: string;
  executed: boolean;
  approvalsSoFar?: number;
  receipt?: { status: string; downstreamSystem: string; reference: string | null; summary: Record<string, unknown> };
  grantIssued?: boolean;
}

export async function decideApprovalAction(approvalId: string, input: unknown) {
  return act(async (): Promise<DecisionOutcome> => {
    const c = await getConsoleContext();
    if (!c.can("approvals:decide")) throw forbidden("Missing permission approvals:decide");
    const id = uuid.parse(approvalId);
    const data = decideSchema.parse(input);
    const r = await withTenant(c.ctx.orgId, async (db) => {
      const out = await decideApproval(db, c.ctx, id, data);
      const a = await db.approvalRequest.findUnique({ where: { id }, select: { actionRequestId: true } });
      return { out, requestId: a?.actionRequestId };
    });
    revalidateApproval(id, r.requestId);
    const out = r.out as DecisionOutcome & { grantToken?: string };
    // The grant token is for the agent, never for the console.
    return { status: out.status, executed: out.executed, approvalsSoFar: out.approvalsSoFar, receipt: out.receipt, grantIssued: !!out.grantToken };
  });
}

export async function provideApprovalInfoAction(approvalId: string, info: string) {
  return act(async () => {
    const c = await getConsoleContext();
    const id = uuid.parse(approvalId);
    await withTenant(c.ctx.orgId, (db) => provideApprovalInfo(db, c.ctx, id, z.string().min(3).max(2000).parse(info)));
    revalidateApproval(id);
  });
}
