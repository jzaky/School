"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@aegis/db";
import { decideApprovalAndExecute, decideSchema, forbidden, provideApprovalInfo } from "@aegis/core";
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
    const out = await decideApprovalAndExecute((fn) => withTenant(c.ctx.orgId, fn), c.ctx, id, data);
    const a = await withTenant(c.ctx.orgId, (db) => db.approvalRequest.findUnique({ where: { id }, select: { actionRequestId: true, request: { select: { context: true } } } }), { readOnly: true });
    revalidateApproval(id, a?.actionRequestId);
    const agentMode = ((a?.request.context as { executionMode?: string } | null) ?? {}).executionMode === "agent";
    const receipt = "receipt" in out && out.receipt ? { status: out.receipt.status, downstreamSystem: out.receipt.downstreamSystem, reference: out.receipt.reference, summary: out.receipt.summary } : undefined;
    return { status: out.status, executed: out.executed, approvalsSoFar: "approvalsSoFar" in out ? out.approvalsSoFar : undefined, receipt, grantIssued: out.status === "approved" && agentMode };
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
