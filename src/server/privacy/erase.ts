// Erasure for one person (PDPL deletion requests).
// planErasure works out, per area, what will be deleted, anonymised or kept, using the school's
// retention settings: records the school must keep (academic record, cases, medical, the request
// register, consent evidence, the audit log) stay, linked to an anonymised person. Everything else
// that points at the person is deleted, with their stored files. applyErasure recomputes the same plan
// inside one transaction and executes it, so the preview and the result always match.
import { createHash } from "node:crypto";
import { Prisma, type RetentionAction, type Sensitivity } from "@prisma/client";
import type { TenantDb, TenantTx } from "@/lib/tenant-db";
import { collectSubjectRows, delegate, type Subject } from "./subject";

// One client type keeps Prisma's overloads callable; a TenantDb is passed in as a transaction client.
type AnyDb = TenantTx;
type Row = Record<string, unknown>;

export type ErasureAction = "delete" | "anonymise" | "retain";
export type ErasureReason =
  | "no_legal_basis" // nothing requires the school to keep it
  | "retention_period" // inside the retention period of a policy
  | "retention_expired" // retention period over and the policy says delete
  | "safeguarding_never" // safeguarding records are never deleted
  | "linked_case" // part of a case that is kept
  | "request_register" // kept anonymised in the request register
  | "evidence" // consent and approval evidence
  | "audit_log" // append-only audit trail
  | "no_policy" // no retention policy found: kept for review
  | "unclassified"; // area not classified yet: kept for review

export type ErasureItem = { model: string; action: ErasureAction; reason: ErasureReason; policy: string | null; count: number };
export type ErasurePlan = {
  subject: Pick<Subject, "kind" | "id" | "reference" | "name">;
  items: ErasureItem[];
  files: number;
  /** What happens to the person's own record. */
  person: "anonymise";
  /** The sign-in account: anonymised when it is not used at another school. Decided when applying. */
  account: "membership" | "none";
  hash: string;
};

type Op = { model: string; action: ErasureAction; reason: ErasureReason; policy: string | null; ids: string[] };
type Policy = { recordType: string; retentionDays: number; action: RetentionAction };

const ACADEMIC = new Set(["Enrollment", "AttendanceRecord", "Grade", "StudentSubjectResult", "StudentTestScore", "SubjectRegistration", "StudentCourse", "TranscriptImport"]);
const EVIDENCE = new Set(["ConsentRecord", "ApprovalAssignee", "CaseAccessGrant", "BreakGlassAccess"]);
const DELETE = new Set([
  "MembershipRole",
  "FormDraft",
  "Notification",
  "NotificationPreference",
  "SavedView",
  "AiInteraction",
  "Invitation",
  "JoinRequest",
  "CareerProfile",
  "AptitudeAssessment",
  "CareerRecommendation",
  "ShortlistEntry",
  "Application",
  "StudentCoursePlan",
  "RequirementMatch",
  "CourseImpactAnalysis",
  "TripParticipant",
  "GuardianLink",
  "TeacherSubject",
  "AvailabilityRule",
  "AvailabilityOverride",
  "AppointmentTypeHost",
  "StaffAbsence",
  "Appointment",
  "AppointmentAttendee",
  "Task",
  "TimelineEvent",
  "Message",
  "Document",
  "Submission",
]);

const caseType = (s: Sensitivity) => (s === "SAFEGUARDING" ? "case_safeguarding" : s === "WELLBEING" ? "case_wellbeing" : "case_standard");

function lastTouched(r: Row): Date {
  const dates = ["closedAt", "completedAt", "updatedAt", "createdAt", "date", "decidedAt"].map((k) => r[k]).filter((v): v is Date => v instanceof Date);
  return dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : new Date();
}

/** Decide keep or delete for a record governed by a retention policy. */
export function retentionDecision(policy: Policy | undefined, touched: Date, now: Date, opts: { safeguarding?: boolean; openCase?: boolean } = {}): { action: "retain" | "delete"; reason: ErasureReason } {
  if (opts.safeguarding) return { action: "retain", reason: "safeguarding_never" };
  if (!policy) return { action: "retain", reason: "no_policy" };
  if (opts.openCase) return { action: "retain", reason: "retention_period" };
  const expired = touched.getTime() + policy.retentionDays * 86_400_000 < now.getTime();
  if (expired && policy.action === "DELETE") return { action: "delete", reason: "retention_expired" };
  return { action: "retain", reason: "retention_period" };
}

async function computeOps(db: AnyDb, orgId: string, subject: Subject, now: Date) {
  const policies = new Map((await db.retentionPolicy.findMany({ where: { orgId } })).map((p) => [p.recordType, p as Policy]));
  const rows = await collectSubjectRows(db, orgId, subject);

  // Cases the person is part of: their own (student) or ones they take part in.
  const caseIds = new Set<string>();
  for (const [model, list] of rows) for (const r of list) {
    if (model === "Case") caseIds.add(r.id as string);
    else if (typeof r.caseId === "string") caseIds.add(r.caseId);
  }
  const cases = caseIds.size ? await db.case.findMany({ where: { orgId, id: { in: [...caseIds] } } }) : [];
  const caseKeep = new Map<string, { action: "retain" | "delete"; reason: ErasureReason; policy: string }>();
  for (const c of cases) {
    const type = caseType(c.sensitivity);
    caseKeep.set(c.id, { ...retentionDecision(policies.get(type), c.closedAt ?? c.updatedAt, now, { safeguarding: c.sensitivity === "SAFEGUARDING", openCase: c.status !== "CLOSED" }), policy: type });
  }
  // Requests: kept anonymised in the register unless their retention is over and the policy deletes.
  const requestRows = rows.get("Request") ?? [];
  const requestPolicy = policies.get("request");
  const requestFate = new Map<string, "anonymise" | "delete">();
  for (const r of requestRows) {
    if (typeof r.caseId === "string" && caseKeep.get(r.caseId)?.action === "retain") continue;
    const d = retentionDecision(requestPolicy, lastTouched(r), now);
    requestFate.set(r.id as string, d.action === "delete" ? "delete" : "anonymise");
  }
  const requestSubmissionIds = new Map(
    (await db.request.findMany({ where: { orgId, submissionId: { in: (rows.get("Submission") ?? []).map((s) => s.id as string) } }, select: { id: true, submissionId: true, caseId: true } })).map((r) => [r.submissionId!, r]),
  );
  const caseAppointmentIds = new Set(
    (await db.appointment.findMany({ where: { orgId, id: { in: (rows.get("AppointmentAttendee") ?? []).map((a) => a.appointmentId as string) }, caseId: { not: null } }, select: { id: true } })).map((a) => a.id),
  );

  const ops = new Map<string, Op>();
  const add = (model: string, action: ErasureAction, reason: ErasureReason, policy: string | null, id: string) => {
    const key = `${model}|${action}|${reason}|${policy ?? ""}`;
    const op = ops.get(key) ?? { model, action, reason, policy, ids: [] };
    op.ids.push(id);
    ops.set(key, op);
  };

  for (const [model, list] of rows) {
    for (const r of list) {
      const id = r.id as string;
      // Anything inside a case follows the case.
      const caseId = model === "Case" ? id : typeof r.caseId === "string" ? r.caseId : null;
      if (caseId && caseKeep.has(caseId)) {
        const k = caseKeep.get(caseId)!;
        if (model === "Request" && k.action === "retain") add(model, "anonymise", "linked_case", k.policy, id);
        else add(model, k.action, model === "Case" ? k.reason : k.action === "retain" ? "linked_case" : k.reason, k.policy, id);
        continue;
      }
      if (model === "Request") {
        const fate = requestFate.get(id) ?? "anonymise";
        add(model, fate, fate === "delete" ? "retention_expired" : "request_register", "request", id);
      } else if (model === "Submission") {
        const req = requestSubmissionIds.get(id);
        const fate = req ? (requestFate.get(req.id) ?? "anonymise") : "delete";
        add(model, fate, fate === "anonymise" ? "request_register" : req ? "retention_expired" : "no_legal_basis", req ? "request" : null, id);
      } else if (model === "TimelineEvent" && typeof r.requestId === "string" && requestFate.get(r.requestId) !== "delete") {
        add(model, "anonymise", "request_register", "request", id);
      } else if (model === "AppointmentAttendee" && caseAppointmentIds.has(r.appointmentId as string)) {
        add(model, "retain", "linked_case", null, id);
      } else if (model === "StudentMedical") {
        const d = retentionDecision(policies.get("medical"), lastTouched(r), now);
        add(model, d.action, d.reason, "medical", id);
      } else if (ACADEMIC.has(model)) {
        const d = retentionDecision(policies.get("student_record"), lastTouched(r), now);
        add(model, d.action, d.reason, "student_record", id);
      } else if (model === "Document" && r.source === "GENERATED") {
        // Letters and report cards the school issued are part of the student record.
        const d = retentionDecision(policies.get("student_record"), lastTouched(r), now);
        add(model, d.action, d.reason, "student_record", id);
      } else if (model === "StaffProfile") {
        add(model, "anonymise", "no_legal_basis", null, id);
      } else if (EVIDENCE.has(model)) {
        add(model, "retain", "evidence", null, id);
      } else if (DELETE.has(model)) {
        add(model, "delete", "no_legal_basis", null, id);
      } else {
        add(model, "retain", "unclassified", null, id);
      }
    }
  }

  // The request register keeps an anonymised entry for every request about this person.
  const dsrWhere = subject.kind === "student" ? { studentId: subject.id } : subject.kind === "guardian" ? { guardianId: subject.id } : { membershipId: subject.id };
  for (const d of await db.dataSubjectRequest.findMany({ where: { orgId, ...dsrWhere }, select: { id: true } })) add("DataSubjectRequest", "anonymise", "request_register", null, d.id);

  const opList = [...ops.values()].sort((a, b) => a.model.localeCompare(b.model) || a.action.localeCompare(b.action));
  for (const o of opList) o.ids.sort();

  // Stored files that go with deleted documents, plus the student's photo.
  const deletedDocs = opList.filter((o) => o.model === "Document" && o.action === "delete").flatMap((o) => o.ids);
  const fileKeys: string[] = deletedDocs.length
    ? (await db.documentVersion.findMany({ where: { orgId, documentId: { in: deletedDocs } }, select: { storageKey: true } })).map((v) => v.storageKey).filter((k) => k.startsWith("r2:") || k.startsWith("local:"))
    : [];
  if (subject.kind === "student") {
    const s = await db.student.findFirst({ where: { id: subject.id, orgId }, select: { photoUrl: true } });
    if (s?.photoUrl && (s.photoUrl.startsWith("r2:") || s.photoUrl.startsWith("local:"))) fileKeys.push(s.photoUrl);
  }
  const auditCount = await db.auditEvent.count({ where: { orgId, OR: [{ entityId: subject.id }, ...(subject.membershipId ? [{ actorId: subject.membershipId }] : [])] } });
  return { ops: opList, fileKeys: fileKeys.sort(), auditCount };
}

function toPlan(subject: Subject, ops: Op[], fileKeys: string[], auditCount: number): ErasurePlan {
  const items: ErasureItem[] = ops.map((o) => ({ model: o.model, action: o.action, reason: o.reason, policy: o.policy, count: o.ids.length }));
  if (auditCount) items.push({ model: "AuditEvent", action: "retain", reason: "audit_log", policy: "audit", count: auditCount });
  const hash = createHash("sha256")
    .update(JSON.stringify({ s: subject.id, ops: ops.map((o) => [o.model, o.action, o.reason, o.ids]), f: fileKeys }))
    .digest("hex")
    .slice(0, 24);
  return {
    subject: { kind: subject.kind, id: subject.id, reference: subject.reference, name: subject.name },
    items,
    files: fileKeys.length,
    person: "anonymise",
    account: subject.membershipId ? "membership" : "none",
    hash,
  };
}

export async function planErasure(db: TenantDb | TenantTx, orgId: string, subject: Subject, now = new Date()): Promise<ErasurePlan> {
  const { ops, fileKeys, auditCount } = await computeOps(db as unknown as AnyDb, orgId, subject, now);
  return toPlan(subject, ops, fileKeys, auditCount);
}

export type ErasureResult = { plan: ErasurePlan; done: ErasureItem[]; fileKeys: string[] };

const ANON = {
  student: { firstNameEn: "Former", lastNameEn: "student", firstNameAr: "طالب", lastNameAr: "سابق" },
  guardian: { firstNameEn: "Former", lastNameEn: "guardian", firstNameAr: "ولي أمر", lastNameAr: "سابق" },
};

/**
 * Execute the erasure inside a tenant transaction. The plan is recomputed first; when `expectHash`
 * does not match (something changed since the preview) nothing is done and null is returned.
 * Stored files are returned for removal after the transaction commits.
 */
export async function applyErasure(tx: TenantTx, orgId: string, subject: Subject, opts: { now?: Date; expectHash?: string } = {}): Promise<ErasureResult | null> {
  const now = opts.now ?? new Date();
  const { ops, fileKeys, auditCount } = await computeOps(tx, orgId, subject, now);
  const plan = toPlan(subject, ops, fileKeys, auditCount);
  if (opts.expectHash && opts.expectHash !== plan.hash) return null;
  const done: ErasureItem[] = [];
  const record = (o: Op, count: number) => done.push({ model: o.model, action: o.action, reason: o.reason, policy: o.policy, count });

  // Anonymise first (they may point at rows deleted later), then delete children before parents.
  for (const o of ops.filter((x) => x.action === "anonymise")) {
    const where = { orgId, id: { in: o.ids } };
    let count = 0;
    if (o.model === "Request") {
      const reqs = await tx.request.findMany({ where, select: { id: true, service: { select: { nameEn: true, nameAr: true } } } });
      for (const r of reqs) {
        await tx.request.update({ where: { id: r.id }, data: { titleEn: r.service.nameEn, titleAr: r.service.nameAr } });
        count++;
      }
    } else if (o.model === "Submission") count = (await tx.submission.updateMany({ where, data: { data: {} } })).count;
    else if (o.model === "TimelineEvent") count = (await tx.timelineEvent.updateMany({ where, data: { bodyEn: null, bodyAr: null, data: Prisma.DbNull } })).count;
    else if (o.model === "StaffProfile") count = (await tx.staffProfile.updateMany({ where, data: { phone: null, bioEn: null, bioAr: null, officeEn: null, officeAr: null } })).count;
    else if (o.model === "DataSubjectRequest") count = (await tx.dataSubjectRequest.updateMany({ where, data: { subjectName: `Erased (${subject.reference})`, requesterName: "Erased", detailsEn: null } })).count;
    record(o, count);
  }
  const deleteOrder = ["AppointmentAttendee", "Appointment", "Task", "TimelineEvent", "Message", "Notification", "NotificationPreference", "SavedView", "FormDraft", "Submission", "Document"];
  const rank = (m: string) => (deleteOrder.includes(m) ? deleteOrder.indexOf(m) : deleteOrder.length);
  const deletes = ops.filter((x) => x.action === "delete").sort((a, b) => rank(a.model) - rank(b.model) || a.model.localeCompare(b.model));
  for (const o of deletes) record(o, (await delegate(tx, o.model).deleteMany({ where: { orgId, id: { in: o.ids } } })).count);
  for (const o of ops.filter((x) => x.action === "retain")) record(o, o.ids.length);
  if (auditCount) done.push({ model: "AuditEvent", action: "retain", reason: "audit_log", policy: "audit", count: auditCount });

  // The person's own record.
  if (subject.kind === "student") {
    const s = await tx.student.findFirstOrThrow({ where: { id: subject.id, orgId } });
    await tx.student.update({
      where: { id: s.id },
      data: {
        ...ANON.student,
        preferredName: null,
        dateOfBirth: null,
        gender: null,
        nationalityEn: null,
        nationalityAr: null,
        emiratesIdEnc: null,
        emiratesIdLast4: null,
        passportEnc: null,
        passportLast4: null,
        photoUrl: null,
        status: s.status === "ACTIVE" ? "WITHDRAWN" : s.status,
        anonymisedAt: now,
      },
    });
  } else if (subject.kind === "guardian") {
    await tx.guardian.update({ where: { id: subject.id }, data: { ...ANON.guardian, email: null, phone: null, occupation: null, anonymisedAt: now } });
  }
  if (subject.membershipId) {
    await tx.membership.update({ where: { id: subject.membershipId }, data: { status: "SUSPENDED", titleEn: null, titleAr: null, lastSeenAt: null, anonymisedAt: now } });
  }
  return { plan, done: done.sort((a, b) => a.model.localeCompare(b.model) || a.action.localeCompare(b.action)), fileKeys };
}

/**
 * The plan as shown to someone who may not see safeguarding records: case retention reasons are
 * folded together so the preview does not reveal that a safeguarding case exists (rule 6).
 */
export function displayPlan(plan: ErasurePlan, canSeeSafeguarding: boolean): ErasurePlan {
  if (canSeeSafeguarding) return plan;
  const merged = new Map<string, ErasureItem>();
  for (const i of plan.items) {
    const policy = i.policy?.startsWith("case_") ? "case" : i.policy;
    const reason: ErasureReason = i.reason === "safeguarding_never" ? "retention_period" : i.reason;
    const key = `${i.model}|${i.action}|${reason}|${policy ?? ""}`;
    const cur = merged.get(key) ?? { ...i, policy, reason, count: 0 };
    cur.count += i.count;
    merged.set(key, cur);
  }
  return { ...plan, items: [...merged.values()] };
}

/** Collapse items for display or comparison: model and action to count. */
export function summarise(items: ErasureItem[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of items) out[`${i.model}:${i.action}`] = (out[`${i.model}:${i.action}`] ?? 0) + i.count;
  return out;
}
