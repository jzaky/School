// Leavers: a planned withdrawal (leaving date, reason, destination), completed by staff with admissions.enroll,
// which marks the student withdrawn, ends their class enrollments and issues a numbered transfer certificate that
// is filed in the student's documents. A family's "leaving" answer in re-enrollment creates a planned withdrawal.
import type { ExecCtx } from "@/server/db";
import { audit } from "@/server/audit/audit";
import { nextSequence } from "@/server/common/sequence";
import { AdmissionError } from "./access";
import { LEAVING_REASONS } from "./config";
import { tcMergeData } from "./pdf";
import type { Actor } from "./service";
import { ensureAdmissionSetup, TC_TEMPLATE_KEY } from "./templates";
import { createRegistration, schoolAuthority } from "./registration";

export type WithdrawalInput = { studentId: string; leavingDate: Date; reasonKey: string; reasonNote: string | null; destination: string | null };

export async function planWithdrawal(ec: ExecCtx, actor: Actor, input: WithdrawalInput, opts: { source?: "STAFF" | "REENROLLMENT" } = {}) {
  const { tx, orgId, now } = ec;
  if (!(LEAVING_REASONS as readonly string[]).includes(input.reasonKey)) throw new AdmissionError("REASON");
  if (Number.isNaN(input.leavingDate.getTime())) throw new AdmissionError("DATE");
  const student = await tx.student.findFirst({ where: { id: input.studentId, orgId } });
  if (!student) throw new AdmissionError("NOT_FOUND");
  if (student.status === "WITHDRAWN" || student.status === "GRADUATED") throw new AdmissionError("ALREADY_LEFT");
  const open = await tx.studentWithdrawal.findFirst({ where: { orgId, studentId: student.id, status: "PLANNED" } });
  if (open) throw new AdmissionError("ALREADY_PLANNED");
  const w = await tx.studentWithdrawal.create({
    data: {
      orgId,
      studentId: student.id,
      leavingDate: input.leavingDate,
      reasonKey: input.reasonKey,
      reasonNote: (input.reasonNote ?? "").trim().slice(0, 500) || null,
      destination: (input.destination ?? "").trim().slice(0, 160) || null,
      source: opts.source ?? "STAFF",
      createdById: actor.membershipId,
      createdAt: now,
    },
  });
  await audit(tx, orgId, { actorId: actor.membershipId, actorUserId: actor.userId, action: "student.withdrawal_plan", entityType: "Student", entityId: student.id, meta: { withdrawalId: w.id, reason: input.reasonKey, source: opts.source ?? "STAFF" } });
  return w;
}

export async function cancelWithdrawal(ec: ExecCtx, actor: Actor, id: string) {
  const { tx, orgId } = ec;
  const w = await tx.studentWithdrawal.findFirst({ where: { id, orgId } });
  if (!w) throw new AdmissionError("NOT_FOUND");
  if (w.status !== "PLANNED") throw new AdmissionError("INVALID");
  await tx.studentWithdrawal.update({ where: { id: w.id }, data: { status: "CANCELLED" } });
  await audit(tx, orgId, { actorId: actor.membershipId, actorUserId: actor.userId, action: "student.withdrawal_cancel", entityType: "Student", entityId: w.studentId, meta: { withdrawalId: w.id } });
}

/** Complete a withdrawal: the student is marked withdrawn and gets a numbered transfer certificate. */
export async function completeWithdrawal(ec: ExecCtx, actor: Actor, id: string) {
  const { tx, orgId, now } = ec;
  const w = await tx.studentWithdrawal.findFirst({ where: { id, orgId } });
  if (!w) throw new AdmissionError("NOT_FOUND");
  if (w.status !== "PLANNED") throw new AdmissionError("INVALID");
  const year = new Date(w.leavingDate.getTime() + 4 * 3600_000).getUTCFullYear();
  const tcNumber = `TC-${year}-${String(await nextSequence(tx, orgId, `TC-${year}`)).padStart(4, "0")}`;
  await tx.student.update({ where: { id: w.studentId }, data: { status: "WITHDRAWN" } });
  await tx.enrollment.updateMany({ where: { orgId, studentId: w.studentId, status: "ACTIVE" }, data: { status: "WITHDRAWN" } });
  const updated = await tx.studentWithdrawal.update({ where: { id: w.id }, data: { status: "COMPLETED", completedAt: now, completedById: actor.membershipId, tcNumber, tcIssuedAt: now } });
  // File the certificate in the student's documents, rendered from the template on download.
  await ensureAdmissionSetup(tx, orgId);
  const template = await tx.documentTemplate.findUnique({ where: { orgId_key: { orgId, key: TC_TEMPLATE_KEY } } });
  const category = await tx.documentCategory.findUnique({ where: { orgId_key: { orgId, key: "official_letters" } }, select: { id: true } });
  let documentId: string | null = null;
  if (template) {
    const doc = await tx.document.create({ data: { orgId, categoryId: category?.id ?? null, titleEn: template.nameEn, titleAr: template.nameAr, studentId: w.studentId, sensitivity: "STANDARD", source: "GENERATED", templateId: template.id, uploadedById: actor.membershipId, visibleToFamily: true, createdAt: now } });
    const v = await tx.documentVersion.create({ data: { orgId, documentId: doc.id, version: 1, storageKey: `render:${TC_TEMPLATE_KEY}`, fileName: `${tcNumber}.pdf`, mimeType: "application/pdf", sizeBytes: 0, renderData: (await tcMergeData(tx, orgId, updated)) as never, output: "BILINGUAL", createdById: actor.membershipId, createdAt: now } });
    await tx.document.update({ where: { id: doc.id }, data: { currentVersionId: v.id } });
    documentId = doc.id;
    await tx.studentWithdrawal.update({ where: { id: w.id }, data: { tcDocumentId: doc.id } });
  }
  // Withdrawals go through the authority too (for example DALEEL in Sharjah).
  const [settings, org] = await Promise.all([tx.admissionSettings.findUnique({ where: { orgId } }), tx.organization.findUnique({ where: { id: orgId }, select: { regulator: true } })]);
  await createRegistration(tx, orgId, { studentId: w.studentId, kind: "WITHDRAWAL", authority: schoolAuthority(settings, org?.regulator ?? null).key, withdrawalId: w.id, at: now });
  await audit(tx, orgId, { actorId: actor.membershipId, actorUserId: actor.userId, action: "student.withdraw", entityType: "Student", entityId: w.studentId, meta: { withdrawalId: w.id, tcNumber, reason: w.reasonKey } });
  return { tcNumber, documentId };
}
