// Changes in government reporting: creating returns, principal sign-off, logging submissions, the due date
// calendar, and the two fixes a return's checks lead to (a student's identity details and a registration
// reference). Each runs in the caller's tenant transaction and writes the audit trail. Values of identifiers are
// never written to the audit log, only which fields changed.
import type { GovReturn, Prisma } from "@prisma/client";
import type { ExecCtx } from "@/server/db";
import type { TenantDb } from "@/lib/tenant-db";
import { encryptField } from "@/lib/crypto";
import { audit } from "@/server/audit/audit";
import { eidDigits } from "@/server/admissions/rules";
import { createRegistration, schoolAuthority, updateRegistration } from "@/server/admissions/registration";
import { loadSettings as loadAdmissionSettings } from "@/server/admissions/settings";
import { signerOf } from "./signer";
import { dateKey, keyToDate } from "@/server/timetable/cover";
import { GovError } from "./access";
import { buildReturn } from "./build";
import { metaOf, specOf, versionFor } from "./export";
import { isDueKind, isReturnKind, todayKey, type DueKind, type ReturnKind } from "./kinds";
import { nationalityOf } from "./nationality";
import { dataHash } from "./table";

export type Actor = { membershipId: string; userId: string };
const DAY = 86_400_000;
const KEY = /^\d{4}-\d{2}-\d{2}$/;

/** A calendar date from YYYY-MM-DD, or an error. */
function day(k: string | null | undefined, code = "DATE"): Date {
  if (!k || !KEY.test(k)) throw new GovError(code);
  const d = keyToDate(k);
  if (Number.isNaN(d.getTime()) || dateKey(d) !== k) throw new GovError(code);
  return d;
}

export { todayKey };

// ---------------------------------------------------------------------------
// Returns
// ---------------------------------------------------------------------------

export type NewReturn = { kind: string; asOf: string; periodFrom?: string | null; label?: string | null; dueDateId?: string | null };

export async function createReturn(ec: ExecCtx, actor: Actor, input: NewReturn, org: { regulator: string }) {
  const { tx, orgId, now } = ec;
  if (!isReturnKind(input.kind)) throw new GovError("KIND");
  const kind: ReturnKind = input.kind;
  const asOf = day(input.asOf);
  if (asOf.getTime() > keyToDate(todayKey(now)).getTime() + 366 * DAY) throw new GovError("DATE_FUTURE");
  let periodFrom: Date | null = null;
  if (kind !== "STAFF" && input.periodFrom) {
    periodFrom = day(input.periodFrom, "PERIOD");
    if (periodFrom.getTime() > asOf.getTime()) throw new GovError("PERIOD");
    if (asOf.getTime() - periodFrom.getTime() > 400 * DAY) throw new GovError("PERIOD_LONG");
  }
  let dueDateId: string | null = null;
  if (input.dueDateId) {
    const due = await tx.govDueDate.findFirst({ where: { id: input.dueDateId, orgId } });
    if (!due) throw new GovError("NOT_FOUND");
    dueDateId = due.id;
  }
  const settings = await loadAdmissionSettings(tx, orgId);
  const authority = schoolAuthority(settings.row, org.regulator).key;
  const label = (input.label ?? "").trim().slice(0, 80) || null;
  const r = await tx.govReturn.create({ data: { orgId, kind, authority, asOf, periodFrom, label, dueDateId, createdById: actor.membershipId, createdAt: now } });
  await audit(tx, orgId, { actorId: actor.membershipId, actorUserId: actor.userId, action: "government.return_create", entityType: "GovReturn", entityId: r.id, meta: { kind, asOf: dateKey(asOf), from: periodFrom ? dateKey(periodFrom) : null, authority } });
  return r;
}

/** A draft no file was ever generated from can be removed (the export and submission logs are permanent). */
export async function deleteReturn(ec: ExecCtx, actor: Actor, id: string) {
  const { tx, orgId } = ec;
  const r = await tx.govReturn.findFirst({ where: { id, orgId }, include: { _count: { select: { exports: true, submissions: true } } } });
  if (!r) throw new GovError("NOT_FOUND");
  if (r._count.exports || r._count.submissions || r.status !== "DRAFT") throw new GovError("HAS_FILES");
  await tx.govReturn.delete({ where: { id: r.id } });
  await audit(tx, orgId, { actorId: actor.membershipId, actorUserId: actor.userId, action: "government.return_delete", entityType: "GovReturn", entityId: r.id, meta: { kind: r.kind, asOf: dateKey(r.asOf) } });
}

/**
 * The principal signs off the return as it stands now: their name, title and date, and the data checksum. If the
 * data changes afterwards, the sign-off is shown as out of date until they sign again.
 */
export async function signOff(ec: ExecCtx, db: TenantDb, actor: Actor, id: string) {
  const { tx, orgId, now } = ec;
  const r = await tx.govReturn.findFirst({ where: { id, orgId } });
  if (!r) throw new GovError("NOT_FOUND");
  const signer = await signerOf(db, actor.membershipId);
  const data = await buildReturn(db, orgId, specOf(r));
  const hash = dataHash(metaOf(r), data.tables);
  const version = await versionFor(db, r.id, hash);
  await tx.govReturn.update({
    where: { id: r.id },
    data: { signedOffById: actor.membershipId, signedOffName: signer.name.en, signedOffTitle: signer.title?.en ?? null, signedOffAt: now, signedDataHash: hash, signedVersion: version, status: r.status === "SUBMITTED" ? "SUBMITTED" : "SIGNED_OFF" },
  });
  await audit(tx, orgId, { actorId: actor.membershipId, actorUserId: actor.userId, action: "government.sign_off", entityType: "GovReturn", entityId: r.id, meta: { kind: r.kind, version, dataSha256: hash, problems: data.problems.filter((p) => p.severity !== "note").length } });
  return { version };
}

export type SubmissionInput = { exportId: string; submittedOn: string; reference: string; note?: string | null };

/** Record that a generated file was sent to the authority, with the authority's reference. */
export async function logSubmission(ec: ExecCtx, actor: Actor, returnId: string, input: SubmissionInput) {
  const { tx, orgId, now } = ec;
  const r = await tx.govReturn.findFirst({ where: { id: returnId, orgId } });
  if (!r) throw new GovError("NOT_FOUND");
  const file = await tx.govReturnExport.findFirst({ where: { id: input.exportId, orgId, returnId: r.id } });
  if (!file) throw new GovError("EXPORT");
  const on = day(input.submittedOn);
  if (on.getTime() > keyToDate(todayKey(now)).getTime()) throw new GovError("DATE_FUTURE");
  const reference = input.reference.trim().slice(0, 80);
  if (!reference) throw new GovError("REFERENCE");
  const note = (input.note ?? "").trim().slice(0, 500) || null;
  const s = await tx.govSubmission.create({ data: { orgId, returnId: r.id, exportId: file.id, submittedOn: on, reference, note, recordedById: actor.membershipId, createdAt: now } });
  await tx.govReturn.update({ where: { id: r.id }, data: { status: "SUBMITTED" } });
  if (r.dueDateId) await tx.govDueDate.updateMany({ where: { id: r.dueDateId, orgId, doneAt: null }, data: { doneAt: now } });
  await audit(tx, orgId, { actorId: actor.membershipId, actorUserId: actor.userId, action: "government.submission", entityType: "GovReturn", entityId: r.id, meta: { kind: r.kind, submissionId: s.id, exportId: file.id, version: file.version, fileSha256: file.fileSha256, submittedOn: dateKey(on), hasReference: true } });
  return s;
}

// ---------------------------------------------------------------------------
// Due dates
// ---------------------------------------------------------------------------

export type DueInput = { titleEn: string; titleAr: string; kind: string; dueOn: string; notes?: string | null };

function dueData(input: DueInput) {
  const titleEn = input.titleEn.trim().slice(0, 120);
  const titleAr = input.titleAr.trim().slice(0, 120);
  if (!titleEn && !titleAr) throw new GovError("TITLE");
  if (!isDueKind(input.kind)) throw new GovError("KIND");
  return { titleEn: titleEn || titleAr, titleAr: titleAr || titleEn, kind: input.kind as DueKind, dueOn: day(input.dueOn), notes: (input.notes ?? "").trim().slice(0, 500) || null };
}

export async function createDueDate(ec: ExecCtx, actor: Actor, input: DueInput) {
  const { tx, orgId, now } = ec;
  const d = await tx.govDueDate.create({ data: { orgId, ...dueData(input), createdById: actor.membershipId, createdAt: now } });
  await audit(tx, orgId, { actorId: actor.membershipId, actorUserId: actor.userId, action: "government.due_create", entityType: "GovDueDate", entityId: d.id, meta: { kind: d.kind, dueOn: dateKey(d.dueOn) } });
  return d;
}

export async function updateDueDate(ec: ExecCtx, actor: Actor, id: string, input: DueInput) {
  const { tx, orgId } = ec;
  const d = await tx.govDueDate.findFirst({ where: { id, orgId } });
  if (!d) throw new GovError("NOT_FOUND");
  const next = dueData(input);
  await tx.govDueDate.update({ where: { id: d.id }, data: next });
  await audit(tx, orgId, { actorId: actor.membershipId, actorUserId: actor.userId, action: "government.due_update", entityType: "GovDueDate", entityId: d.id, meta: { kind: next.kind, from: dateKey(d.dueOn), to: dateKey(next.dueOn) } });
}

export async function setDueDone(ec: ExecCtx, actor: Actor, id: string, done: boolean) {
  const { tx, orgId, now } = ec;
  const d = await tx.govDueDate.findFirst({ where: { id, orgId } });
  if (!d) throw new GovError("NOT_FOUND");
  await tx.govDueDate.update({ where: { id: d.id }, data: { doneAt: done ? now : null } });
  await audit(tx, orgId, { actorId: actor.membershipId, actorUserId: actor.userId, action: done ? "government.due_done" : "government.due_reopen", entityType: "GovDueDate", entityId: d.id });
}

export async function deleteDueDate(ec: ExecCtx, actor: Actor, id: string) {
  const { tx, orgId } = ec;
  const d = await tx.govDueDate.findFirst({ where: { id, orgId } });
  if (!d) throw new GovError("NOT_FOUND");
  await tx.govReturn.updateMany({ where: { orgId, dueDateId: d.id }, data: { dueDateId: null } });
  await tx.govDueDate.delete({ where: { id: d.id } });
  await audit(tx, orgId, { actorId: actor.membershipId, actorUserId: actor.userId, action: "government.due_delete", entityType: "GovDueDate", entityId: d.id, meta: { kind: d.kind, dueOn: dateKey(d.dueOn) } });
}

// ---------------------------------------------------------------------------
// Fixes
// ---------------------------------------------------------------------------

export type IdentityFix = { dateOfBirth?: string | null; gender?: string | null; nationality?: string | null; emiratesId?: string | null };

/** Fill in a student's missing details. Only the given fields change; the audit names the fields, not the values. */
export async function fixStudentIdentity(ec: ExecCtx, actor: Actor, studentId: string, input: IdentityFix) {
  const { tx, orgId, now } = ec;
  const s = await tx.student.findFirst({ where: { id: studentId, orgId }, select: { id: true } });
  if (!s) throw new GovError("NOT_FOUND");
  const data: Prisma.StudentUpdateInput = {};
  const fields: string[] = [];
  if (input.dateOfBirth) {
    const dob = day(input.dateOfBirth, "DOB");
    const years = (now.getTime() - dob.getTime()) / (365.25 * DAY);
    if (years < 2 || years > 25) throw new GovError("DOB");
    data.dateOfBirth = dob;
    fields.push("dateOfBirth");
  }
  if (input.gender) {
    if (input.gender !== "M" && input.gender !== "F") throw new GovError("GENDER");
    data.gender = input.gender;
    fields.push("gender");
  }
  if (input.nationality) {
    const n = nationalityOf(input.nationality, null);
    if (!n?.code) throw new GovError("NATIONALITY");
    data.nationalityEn = n.en;
    data.nationalityAr = n.ar;
    fields.push("nationality");
  }
  if (input.emiratesId) {
    const digits = eidDigits(input.emiratesId);
    if (!digits) throw new GovError("EID");
    data.emiratesIdEnc = encryptField(digits);
    data.emiratesIdLast4 = digits.slice(-4);
    fields.push("emiratesId");
  }
  if (!fields.length) throw new GovError("NOTHING");
  await tx.student.update({ where: { id: s.id }, data });
  await audit(tx, orgId, { actorId: actor.membershipId, actorUserId: actor.userId, action: "student.identity_update", entityType: "Student", entityId: s.id, sensitivity: fields.includes("emiratesId") ? "CONFIDENTIAL" : "STANDARD", meta: { fields, source: "government_reporting" } });
  return fields;
}

/**
 * Record the reference the authority gave for a student's enrollment registration: as submitted, or as approved.
 * Uses the admissions registration record (and its rules); a student enrolled before Horizon gets one now.
 */
export async function recordReference(ec: ExecCtx, actor: Actor, studentId: string, input: { status: "SUBMITTED" | "APPROVED"; reference: string; date: string }, org: { regulator: string }) {
  const { tx, orgId } = ec;
  const s = await tx.student.findFirst({ where: { id: studentId, orgId }, select: { id: true } });
  if (!s) throw new GovError("NOT_FOUND");
  const reference = input.reference.trim().slice(0, 60);
  if (!reference) throw new GovError("REFERENCE");
  const date = day(input.date);
  let reg = await tx.govRegistration.findFirst({ where: { orgId, studentId: s.id, kind: "ENROLLMENT" }, orderBy: { createdAt: "desc" } });
  if (!reg) {
    const settings = await loadAdmissionSettings(tx, orgId);
    reg = await createRegistration(tx, orgId, { studentId: s.id, kind: "ENROLLMENT", authority: schoolAuthority(settings.row, org.regulator).key, at: ec.now });
  }
  // The admissions rules allow approval only after submission: an unsubmitted registration is submitted first,
  // on the same date, then approved.
  if (input.status === "APPROVED" && reg.status !== "SUBMITTED" && reg.status !== "APPROVED") await updateRegistration(ec, actor, reg.id, { status: "SUBMITTED", reference, date, note: null });
  await updateRegistration(ec, actor, reg.id, { status: input.status, reference, date, note: null });
}

export type { GovReturn };
