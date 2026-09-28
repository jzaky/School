// Approval engine: sequential, parallel-all, parallel-any. Conditional approvers are filtered when the step starts.
import type { ExecCtx } from "@/server/db";
import { notify } from "@/server/notify/notify";
import { advanceRun } from "./engine";

export type Decision = "APPROVED" | "REJECTED";

export class ApprovalError extends Error {}

export async function decideApproval(
  ec: ExecCtx,
  input: { assigneeRowId: string; deciderMembershipId: string; decision: Decision; comment?: string | null; signatureName?: string | null },
) {
  const { tx, orgId } = ec;
  const row = await tx.approvalAssignee.findUnique({
    where: { id: input.assigneeRowId },
    include: { approval: { include: { assignees: { orderBy: { order: "asc" } }, request: true } } },
  });
  if (!row || row.orgId !== orgId) throw new ApprovalError("NOT_FOUND");
  if (row.membershipId !== input.deciderMembershipId) throw new ApprovalError("FORBIDDEN");
  if (row.status !== "PENDING" || row.approval.status !== "PENDING") throw new ApprovalError("ALREADY_DECIDED");
  if (row.requireSignature && input.decision === "APPROVED" && !input.signatureName?.trim()) throw new ApprovalError("SIGNATURE_REQUIRED");

  await tx.approvalAssignee.update({
    where: { id: row.id },
    data: {
      status: input.decision,
      comment: input.comment?.trim() || null,
      signatureName: input.signatureName?.trim() || null,
      decidedAt: ec.now,
      decidedById: input.deciderMembershipId,
    },
  });

  const approval = row.approval;
  const all = approval.assignees.map((a) => (a.id === row.id ? { ...a, status: input.decision } : a));
  let status: "PENDING" | "APPROVED" | "REJECTED" = "PENDING";
  let nextToNotify: string | null = null;

  if (approval.mode === "SEQUENTIAL") {
    if (input.decision === "REJECTED") status = "REJECTED";
    else {
      const next = all.find((a) => a.status === "WAITING");
      if (next) {
        await tx.approvalAssignee.update({ where: { id: next.id }, data: { status: "PENDING" } });
        nextToNotify = next.membershipId;
      } else status = "APPROVED";
    }
  } else if (approval.mode === "PARALLEL_ALL") {
    if (input.decision === "REJECTED") status = "REJECTED";
    else if (all.every((a) => a.status === "APPROVED")) status = "APPROVED";
  } else {
    if (input.decision === "APPROVED") status = "APPROVED";
    else if (all.every((a) => a.status === "REJECTED")) status = "REJECTED";
  }

  if (status !== "PENDING") {
    await tx.approvalRequest.update({ where: { id: approval.id }, data: { status, decidedAt: ec.now } });
    await tx.approvalAssignee.updateMany({
      where: { approvalRequestId: approval.id, status: { in: ["PENDING", "WAITING"] } },
      data: { status: "CANCELLED" },
    });
  }

  const decider = await tx.membership.findUnique({ where: { id: input.deciderMembershipId }, include: { user: true } });
  const nameEn = decider?.user.nameEn ?? "";
  const nameAr = decider?.user.nameAr ?? nameEn;
  if (approval.requestId) {
    const approved = input.decision === "APPROVED";
    await tx.timelineEvent.create({
      data: {
        orgId,
        requestId: approval.requestId,
        studentId: approval.request?.studentId ?? null,
        actorId: input.deciderMembershipId,
        kind: approved ? "approved" : "rejected",
        titleEn: `${approved ? "Approved" : "Not approved"} by ${nameEn} (${row.labelEn})`,
        titleAr: `${approved ? "وافق" : "لم يوافق"} ${nameAr} (${row.labelAr})`,
        bodyEn: input.comment?.trim() || null,
        bodyAr: input.comment?.trim() || null,
        data: { signed: Boolean(input.signatureName), signatureName: input.signatureName ?? null } as never,
        sensitivity: approval.request?.sensitivity ?? "STANDARD",
        createdAt: ec.now,
      },
    });
  }
  await tx.auditEvent.create({
    data: {
      orgId,
      actorId: input.deciderMembershipId,
      action: `approval.${input.decision.toLowerCase()}`,
      entityType: "ApprovalRequest",
      entityId: approval.id,
      meta: { signed: Boolean(input.signatureName) } as never,
      createdAt: ec.now,
    },
  });

  if (nextToNotify) {
    const next = all.find((a) => a.membershipId === nextToNotify);
    await notify(ec, {
      recipients: [nextToNotify],
      templateKey: "approval_needed",
      vars: { title: { en: approval.request?.titleEn ?? approval.titleEn, ar: approval.request?.titleAr ?? approval.titleAr } },
      href: "/approvals",
      idempotencyBase: `${approval.id}:${next?.id}`,
    });
    if (approval.requestId && next) {
      await tx.request.update({
        where: { id: approval.requestId },
        data: { currentStepEn: `Waiting for ${next.labelEn}`, currentStepAr: `بانتظار ${next.labelAr}` },
      });
      await tx.timelineEvent.create({
        data: {
          orgId,
          requestId: approval.requestId,
          studentId: approval.request?.studentId ?? null,
          kind: "approval_requested",
          titleEn: `Waiting for ${next.labelEn}`,
          titleAr: `بانتظار ${next.labelAr}`,
          createdAt: new Date(ec.now.getTime() + 1),
        },
      });
    }
  }

  if (status !== "PENDING" && approval.runId) await advanceRun(ec, approval.runId);
  return { status };
}
