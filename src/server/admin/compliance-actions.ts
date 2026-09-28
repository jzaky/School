"use server";

import { revalidatePath } from "next/cache";
import type { DsrStatus, IdPolicy, RetentionAction } from "@prisma/client";
import { getCtx } from "@/server/context";
import { audit } from "@/server/audit/audit";

async function managerCtx() {
  const ctx = await getCtx();
  return ctx.can("compliance.manage") ? ctx : null;
}

const done = () => revalidatePath("/[locale]/admin/compliance", "page");

/** AI and identity-document settings. Turning on sensitive AI processing requires a recorded reason. */
export async function updateDataSettingsAction(input: {
  aiEnabled?: boolean;
  aiSensitiveDataEnabled?: boolean;
  crossBorderAllowed?: boolean;
  emiratesIdPolicy?: IdPolicy;
  passportPolicy?: IdPolicy;
  reason?: string;
}) {
  const ctx = await managerCtx();
  if (!ctx) return { ok: false as const, error: "FORBIDDEN" };
  if (input.aiSensitiveDataEnabled === true && (input.reason ?? "").trim().length < 10) return { ok: false as const, error: "REASON" };
  const policies: IdPolicy[] = ["OFF", "OPTIONAL", "REQUIRED"];
  const data: Record<string, unknown> = {};
  if (typeof input.aiEnabled === "boolean") data.aiEnabled = input.aiEnabled;
  if (typeof input.aiSensitiveDataEnabled === "boolean") data.aiSensitiveDataEnabled = input.aiSensitiveDataEnabled;
  if (typeof input.crossBorderAllowed === "boolean") data.crossBorderAllowed = input.crossBorderAllowed;
  if (input.emiratesIdPolicy && policies.includes(input.emiratesIdPolicy)) data.emiratesIdPolicy = input.emiratesIdPolicy;
  if (input.passportPolicy && policies.includes(input.passportPolicy)) data.passportPolicy = input.passportPolicy;
  if (!Object.keys(data).length) return { ok: false as const, error: "NOTHING" };
  await ctx.db.organization.update({ where: { id: ctx.orgId }, data });
  const aiChange = "aiEnabled" in data || "aiSensitiveDataEnabled" in data;
  await audit(ctx.db, ctx.orgId, {
    actorId: ctx.membershipId,
    actorUserId: ctx.user.id,
    action: aiChange ? "ai_settings.update" : "org.update",
    entityType: "Organization",
    entityId: ctx.orgId,
    sensitivity: input.aiSensitiveDataEnabled ? "CONFIDENTIAL" : "STANDARD",
    reason: input.reason?.trim() || null,
    meta: data,
  });
  done();
  return { ok: true as const };
}

export async function updateRetentionAction(input: { id: string; retentionDays: number; action: RetentionAction }) {
  const ctx = await managerCtx();
  if (!ctx) return { ok: false as const, error: "FORBIDDEN" };
  const days = Math.round(input.retentionDays);
  if (!Number.isFinite(days) || days < 30 || days > 365 * 100) return { ok: false as const, error: "DAYS" };
  if (!["REVIEW", "ANONYMIZE", "DELETE"].includes(input.action)) return { ok: false as const, error: "ACTION" };
  const policy = await ctx.db.retentionPolicy.findUnique({ where: { id: input.id } });
  if (!policy) return { ok: false as const, error: "NOT_FOUND" };
  // Safeguarding records are never deleted automatically.
  if (policy.recordType === "case_safeguarding" && input.action !== "REVIEW") return { ok: false as const, error: "SAFEGUARDING" };
  await ctx.db.retentionPolicy.update({ where: { id: policy.id }, data: { retentionDays: days, action: input.action } });
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "retention.update", entityType: "RetentionPolicy", entityId: policy.id, meta: { recordType: policy.recordType, from: { days: policy.retentionDays, action: policy.action }, to: { days, action: input.action } } });
  done();
  return { ok: true as const };
}

export async function setTransferApprovalAction(input: { id: string; approved: boolean }) {
  const ctx = await managerCtx();
  if (!ctx) return { ok: false as const, error: "FORBIDDEN" };
  const row = await ctx.db.crossBorderTransfer.findUnique({ where: { id: input.id } });
  if (!row) return { ok: false as const, error: "NOT_FOUND" };
  await ctx.db.crossBorderTransfer.update({ where: { id: row.id }, data: { approved: input.approved, approvedAt: input.approved ? new Date() : null } });
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "org.update", entityType: "Organization", entityId: ctx.orgId, meta: { transfer: row.providerName, approved: input.approved } });
  done();
  return { ok: true as const };
}

export async function updateDsrAction(input: { id: string; status: DsrStatus; resolution?: string }) {
  const ctx = await managerCtx();
  if (!ctx) return { ok: false as const, error: "FORBIDDEN" };
  const statuses: DsrStatus[] = ["RECEIVED", "VERIFYING", "IN_PROGRESS", "COMPLETED", "REJECTED"];
  if (!statuses.includes(input.status)) return { ok: false as const, error: "STATUS" };
  const row = await ctx.db.dataSubjectRequest.findUnique({ where: { id: input.id } });
  if (!row) return { ok: false as const, error: "NOT_FOUND" };
  const closing = input.status === "COMPLETED" || input.status === "REJECTED";
  if (closing && !(input.resolution ?? row.resolution ?? "").trim()) return { ok: false as const, error: "RESOLUTION" };
  await ctx.db.dataSubjectRequest.update({
    where: { id: row.id },
    data: { status: input.status, handledById: ctx.membershipId, completedAt: closing ? new Date() : null, resolution: input.resolution?.trim() || row.resolution },
  });
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "dsr.update", entityType: "DataSubjectRequest", entityId: row.id, sensitivity: "CONFIDENTIAL", meta: { from: row.status, to: input.status } });
  done();
  return { ok: true as const };
}
