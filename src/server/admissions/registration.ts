// Government registration of learners. In Sharjah every learner in a private (non-MoE) school must be registered in
// SPEA's DALEEL system and may not attend until SPEA approves (policy SPEA-8.1-01.0); transfers, withdrawals and
// re-enrolment also go through DALEEL. MoE-curriculum schools use the Ministry's Al Manhal system, Dubai schools
// KHDA and Abu Dhabi schools ADEK. None of these offers a public API, so the school records each step by hand:
// not submitted, submitted, approved (with the authority's reference and the approval date) or rejected (with a note).
// A registration-ready sheet (en and ar) and a CSV give staff the details they type into the authority's system.
import type { Prisma, Regulator } from "@prisma/client";
import type { ExecCtx, Tx } from "@/server/db";
import { audit } from "@/server/audit/audit";
import { AdmissionError } from "./access";
import type { Actor } from "./service";

export const AUTHORITIES = ["SPEA_DALEEL", "MOE_MANHAL", "KHDA", "ADEK", "OTHER"] as const;
export type Authority = (typeof AUTHORITIES)[number];
export const REG_STATUSES = ["NOT_SUBMITTED", "SUBMITTED", "APPROVED", "REJECTED"] as const;
export type RegStatus = (typeof REG_STATUSES)[number];

export function defaultAuthority(regulator: Regulator | string | null | undefined): Authority {
  switch (regulator) {
    case "SPEA":
      return "SPEA_DALEEL";
    case "MOE":
      return "MOE_MANHAL";
    case "KHDA":
      return "KHDA";
    case "ADEK":
      return "ADEK";
    default:
      return "OTHER";
  }
}

export const isAuthority = (v: unknown): v is Authority => typeof v === "string" && (AUTHORITIES as readonly string[]).includes(v);

/** The school's authority: its own choice on Admissions settings, or the default for its regulator. */
export function schoolAuthority(settingsRow: { authority: string | null; authorityLabelEn: string | null; authorityLabelAr: string | null } | null, regulator: Regulator | string | null): { key: Authority; labelEn: string | null; labelAr: string | null } {
  const key = isAuthority(settingsRow?.authority) ? settingsRow!.authority as Authority : defaultAuthority(regulator);
  return { key, labelEn: settingsRow?.authorityLabelEn ?? null, labelAr: settingsRow?.authorityLabelAr ?? null };
}

/** Allowed status changes. An approved registration keeps its status; staff may still correct the reference or date. */
export function canSetStatus(from: string, to: RegStatus): boolean {
  if (from === to) return to === "APPROVED" || to === "SUBMITTED";
  switch (to) {
    case "SUBMITTED":
      return from === "NOT_SUBMITTED" || from === "REJECTED";
    case "APPROVED":
    case "REJECTED":
      return from === "SUBMITTED";
    case "NOT_SUBMITTED":
      return from === "SUBMITTED";
  }
}

export async function createRegistration(tx: Tx, orgId: string, input: { studentId: string; kind: "ENROLLMENT" | "WITHDRAWAL"; authority: Authority; applicationId?: string | null; withdrawalId?: string | null; at: Date }) {
  // One open registration per student and kind: re-enrolling or withdrawing again reuses an unfinished row.
  const open = await tx.govRegistration.findFirst({ where: { orgId, studentId: input.studentId, kind: input.kind, status: { in: ["NOT_SUBMITTED", "REJECTED"] } } });
  if (open) return tx.govRegistration.update({ where: { id: open.id }, data: { applicationId: input.applicationId ?? open.applicationId, withdrawalId: input.withdrawalId ?? open.withdrawalId } });
  return tx.govRegistration.create({ data: { orgId, studentId: input.studentId, kind: input.kind, authority: input.authority, applicationId: input.applicationId ?? null, withdrawalId: input.withdrawalId ?? null, createdAt: input.at } });
}

export async function updateRegistration(ec: ExecCtx, actor: Actor, id: string, input: { status: RegStatus; reference: string | null; date: Date | null; note: string | null }) {
  const { tx, orgId, now } = ec;
  const r = await tx.govRegistration.findFirst({ where: { id, orgId } });
  if (!r) throw new AdmissionError("NOT_FOUND");
  if (!canSetStatus(r.status, input.status)) throw new AdmissionError("INVALID");
  const reference = (input.reference ?? "").trim().slice(0, 60) || null;
  const note = (input.note ?? "").trim().slice(0, 500) || null;
  if (input.status === "APPROVED" && (!reference || !input.date)) throw new AdmissionError("REFERENCE");
  if (input.status === "REJECTED" && !note) throw new AdmissionError("NOTE");
  if (input.date && input.date.getTime() > now.getTime() + 86_400_000) throw new AdmissionError("DATE");
  const data: Prisma.GovRegistrationUpdateInput = {
    status: input.status,
    reference: reference ?? r.reference,
    note: input.status === "REJECTED" ? note : (note ?? r.note),
    updatedById: actor.membershipId,
    ...(input.status === "SUBMITTED" ? { submittedAt: input.date ?? r.submittedAt ?? now, decidedAt: null } : {}),
    ...(input.status === "APPROVED" || input.status === "REJECTED" ? { decidedAt: input.date ?? now } : {}),
    ...(input.status === "NOT_SUBMITTED" ? { submittedAt: null, decidedAt: null } : {}),
  };
  await tx.govRegistration.update({ where: { id: r.id }, data });
  await audit(tx, orgId, { actorId: actor.membershipId, actorUserId: actor.userId, action: "student.gov_registration", entityType: "Student", entityId: r.studentId, meta: { registrationId: r.id, kind: r.kind, authority: r.authority, from: r.status, to: input.status, hasReference: Boolean(reference ?? r.reference) } });
}

/** Students (from the given ids) whose enrollment registration is not approved yet. */
export async function awaitingApproval(tx: Tx, orgId: string, studentIds: string[]): Promise<Set<string>> {
  if (!studentIds.length) return new Set();
  const rows = await tx.govRegistration.findMany({ where: { orgId, kind: "ENROLLMENT", studentId: { in: studentIds }, status: { not: "APPROVED" } }, select: { studentId: true } });
  return new Set(rows.map((r) => r.studentId));
}
