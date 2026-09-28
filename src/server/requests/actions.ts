"use server";

import { revalidatePath } from "next/cache";
import { getCtx } from "@/server/context";
import { tenantTx } from "@/lib/tenant-db";
import { execCtx, type Effect } from "@/server/db";
import { flushEffects } from "@/server/queue";
import { decideApproval, ApprovalError } from "@/server/workflows/approvals";
import { submitRequest, SubmitError } from "@/server/services/submit";
import { canSeeStudent } from "@/server/access/student-access";

export async function decideApprovalAction(input: { assigneeRowId: string; decision: "APPROVED" | "REJECTED"; comment?: string; signatureName?: string }) {
  const ctx = await getCtx();
  if (!ctx.can("approvals.decide")) return { ok: false as const, error: "FORBIDDEN" };
  const effects: Effect[] = [];
  try {
    await tenantTx(ctx.orgId, async (tx) => {
      await decideApproval(execCtx(tx, ctx.orgId, { effects, actorId: ctx.membershipId }), {
        assigneeRowId: input.assigneeRowId,
        deciderMembershipId: ctx.membershipId,
        decision: input.decision,
        comment: input.comment,
        signatureName: input.signatureName,
      });
    }, { timeout: 30000 });
  } catch (e) {
    if (e instanceof ApprovalError) return { ok: false as const, error: e.message };
    throw e;
  }
  await flushEffects(effects);
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function submitServiceAction(input: { serviceId: string; studentId?: string | null; data: Record<string, unknown>; appointmentId?: string | null }) {
  const ctx = await getCtx();
  if (!ctx.can("services.use")) return { ok: false as const, error: "FORBIDDEN" };
  const service = await ctx.db.serviceDefinition.findUnique({ where: { id: input.serviceId } });
  if (!service || !service.audience.some((a) => ctx.roles.includes(a))) return { ok: false as const, error: "FORBIDDEN" };
  let studentId = input.studentId ?? null;
  if (ctx.isStudent) studentId = ctx.membership.student?.id ?? null;
  if (studentId && !(await canSeeStudent(ctx, studentId))) return { ok: false as const, error: "FORBIDDEN" };
  const effects: Effect[] = [];
  try {
    const req = await tenantTx(
      ctx.orgId,
      (tx) =>
        submitRequest(execCtx(tx, ctx.orgId, { effects, actorId: ctx.membershipId }), {
          serviceId: service.id,
          requesterId: ctx.membershipId,
          studentId,
          data: input.data,
          appointmentId: input.appointmentId ?? null,
        }),
      { timeout: 30000 },
    );
    await ctx.db.formDraft.deleteMany({ where: { membershipId: ctx.membershipId, serviceId: service.id } });
    await flushEffects(effects);
    revalidatePath("/", "layout");
    return { ok: true as const, requestId: req.id, number: req.number, sensitivity: req.sensitivity };
  } catch (e) {
    if (e instanceof SubmitError) return { ok: false as const, error: e.message, fieldErrors: e.fieldErrors };
    throw e;
  }
}

export async function saveDraftAction(input: { serviceId: string; formVersionId: string; data: Record<string, unknown>; step: number; studentId?: string | null }) {
  const ctx = await getCtx();
  await ctx.db.formDraft.upsert({
    where: { formVersionId_membershipId_serviceId: { formVersionId: input.formVersionId, membershipId: ctx.membershipId, serviceId: input.serviceId } },
    create: { orgId: ctx.orgId, formVersionId: input.formVersionId, membershipId: ctx.membershipId, serviceId: input.serviceId, data: input.data as never, step: input.step, studentId: input.studentId ?? null },
    update: { data: input.data as never, step: input.step, studentId: input.studentId ?? null },
  });
  return { ok: true, savedAt: new Date().toISOString() };
}

export async function cancelRequestAction(requestId: string) {
  const ctx = await getCtx();
  const req = await ctx.db.request.findUnique({ where: { id: requestId } });
  if (!req || req.requesterId !== ctx.membershipId) return { ok: false };
  if (["COMPLETED", "REJECTED", "CANCELLED"].includes(req.status)) return { ok: false };
  await tenantTx(ctx.orgId, async (tx) => {
    await tx.request.update({ where: { id: requestId }, data: { status: "CANCELLED", completedAt: new Date(), currentStepEn: "Cancelled by requester", currentStepAr: "ألغاه مقدم الطلب" } });
    await tx.workflowRun.updateMany({ where: { requestId, status: { in: ["RUNNING", "WAITING"] } }, data: { status: "CANCELLED" } });
    await tx.approvalRequest.updateMany({ where: { requestId, status: "PENDING" }, data: { status: "CANCELLED" } });
    await tx.timelineEvent.create({ data: { orgId: ctx.orgId, requestId, studentId: req.studentId, actorId: ctx.membershipId, kind: "rejected", titleEn: "Cancelled by the requester", titleAr: "ألغى مقدم الطلب الطلب" } });
    await tx.auditEvent.create({ data: { orgId: ctx.orgId, actorId: ctx.membershipId, action: "request.cancel", entityType: "Request", entityId: requestId } });
  });
  revalidatePath("/", "layout");
  return { ok: true };
}
