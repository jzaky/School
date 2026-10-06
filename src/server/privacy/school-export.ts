// School exit export: every tenant table as CSV grouped by area, plus stored files, in one ZIP.
// Built by the worker (queue "privacy", job "school.export"), idempotent per DataExport row: the row is
// claimed with a conditional status change, the ZIP is written to a fixed storage path, and a second
// run of the same job does nothing. The download link expires after EXPORT_TTL_HOURS.
// No "server-only" marker: the worker imports this module.
import type { Prisma } from "@prisma/client";
import { tenantDb, tenantTx } from "@/lib/tenant-db";
import { createZip, type ZipEntry } from "@/lib/zip";
import { toCsv } from "@/lib/csv-out";
import { deleteObject, getObject, isStoredKey, putObjectAt } from "@/server/documents/storage-core";
import { delegate, scrubRow, tenantModels } from "./subject";
import { exportLabel } from "./labels";

export const EXPORT_TTL_HOURS = 24;
export const PRIVACY_QUEUE = "privacy";
export const SCHOOL_EXPORT_JOB = "school.export";
const STALE_MS = 30 * 60_000;
const PAGE = 5000;
const SENSITIVE = ["WELLBEING", "SAFEGUARDING"];

/** Tables that are bookkeeping for this feature or the platform and are not part of the school's data. */
const SKIP = new Set(["DataExport", "JobRun", "DemoPersona"]);

const AREA_OF: Array<[RegExp, string]> = [
  [/^(Membership|MembershipRole|Role|StaffProfile|Student|Guardian|GuardianLink|StudentMedical|Invitation|JoinRequest|Department|Campus)$/, "people"],
  [/^(AttendanceRecord|Enrollment|SchoolClass|Subject|AcademicYear|Term|Grade|GradeBand|Assessment|SubjectOffering|SubjectRegistration|BellPeriod|TimetableSlot|TeacherSubject|ExamSitting|StaffAbsence|CoverAssignment|Trip|TripParticipant|CalendarEvent)$/, "academics"],
  [/^(Curriculum|LessonPlan)/, "curriculum"],
  [/^(Case|ActionPlan|ExternalReferral|ParentNotificationDecision|BreakGlassAccess|Task|SavedView)/, "cases"],
  [/^(Service|Form|Submission|Request|TimelineEvent|Sequence|Workflow|Approval)/, "services"],
  [/^(Appointment|Availability)/, "meetings"],
  [/^Document/, "documents"],
  [/^(Career|Aptitude|Shortlist|University|Program|Student(Subject|Test|Course)|SchoolCourse|Transcript|Requirement|Language|Test|Additional|Subject Requirement|SubjectRequirement|CourseImpact|Application|CanonicalSubject|FieldOfStudy)/, "career"],
  [/^(Message|Notification|Announcement|OutboundMessage)/, "communications"],
  [/^(ProcessingPurpose|ConsentRecord|DataSubjectRequest|BreachLog|RetentionPolicy|CrossBorderTransfer|AuditEvent|AiInteraction)$/, "compliance"],
];
export const areaOf = (model: string) => AREA_OF.find(([re]) => re.test(model))?.[1] ?? "settings";

export type SchoolExportSummary = { tables: Array<{ model: string; area: string; rows: number }>; restrictedRows: number; restrictedIncluded: boolean; files: number; missingFiles: number };

/** Create (or return the open) school export request. Safe to call twice: one open export at a time. */
export async function requestSchoolExport(orgId: string, input: { requestedById: string; includeRestricted: boolean; now?: Date }) {
  const now = input.now ?? new Date();
  const db = tenantDb(orgId);
  const open = await db.dataExport.findFirst({ where: { orgId, kind: "SCHOOL", status: { in: ["QUEUED", "RUNNING"] } }, orderBy: { createdAt: "desc" } });
  if (open) return { export: open, created: false };
  const key = `school:${now.toISOString().slice(0, 16)}`;
  await db.dataExport.createMany({
    data: [{ orgId, kind: "SCHOOL", status: "QUEUED", idempotencyKey: key, requestedById: input.requestedById, summary: { includeRestricted: input.includeRestricted } }],
    skipDuplicates: true,
  });
  const row = await db.dataExport.findUniqueOrThrow({ where: { orgId_idempotencyKey: { orgId, idempotencyKey: key } } });
  return { export: row, created: true };
}

export type SchoolExportJob = { orgId: string; exportId: string };

async function claim(orgId: string, exportId: string, now: Date): Promise<"claimed" | "done" | "busy" | "missing"> {
  const db = tenantDb(orgId);
  const res = await db.dataExport.updateMany({
    where: { orgId, id: exportId, OR: [{ status: { in: ["QUEUED", "FAILED"] } }, { status: "RUNNING", startedAt: { lt: new Date(now.getTime() - STALE_MS) } }] },
    data: { status: "RUNNING", startedAt: now, error: null },
  });
  if (res.count === 1) return "claimed";
  const row = await db.dataExport.findFirst({ where: { orgId, id: exportId }, select: { status: true } });
  if (!row) return "missing";
  return row.status === "RUNNING" ? "busy" : "done";
}

async function allRows(orgId: string, model: string): Promise<Array<Record<string, unknown>>> {
  const d = delegate(tenantDb(orgId), model);
  const out: Array<Record<string, unknown>> = [];
  for (let skip = 0; ; skip += PAGE) {
    // Shared catalog tables: only the school's own rows, never the global catalog.
    const page = await d.findMany({ where: { orgId }, orderBy: { id: "asc" }, skip, take: PAGE });
    out.push(...page);
    if (page.length < PAGE) break;
  }
  return out;
}

/** Build the ZIP for one export request. Returns "duplicate" when it was already built or is being built. */
export async function runSchoolExport(job: SchoolExportJob, opts: { now?: Date } = {}): Promise<"ready" | "duplicate" | "missing"> {
  const now = opts.now ?? new Date();
  const { orgId, exportId } = job;
  const state = await claim(orgId, exportId, now);
  if (state === "missing") return "missing";
  if (state !== "claimed") return "duplicate";
  const db = tenantDb(orgId);
  try {
    const exp = await db.dataExport.findUniqueOrThrow({ where: { id: exportId } });
    const includeRestricted = Boolean((exp.summary as { includeRestricted?: boolean } | null)?.includeRestricted);
    const org = await db.organization.findUniqueOrThrow({ where: { id: orgId } });

    // Which rows are restricted: wellbeing and safeguarding cases and everything attached to them.
    const sensitiveCases = new Set((await db.case.findMany({ where: { orgId, sensitivity: { in: ["WELLBEING", "SAFEGUARDING"] } }, select: { id: true } })).map((c) => c.id));
    const sensitiveNotes = new Set((await db.caseNote.findMany({ where: { orgId, caseId: { in: [...sensitiveCases] } }, select: { id: true } })).map((n) => n.id));
    const sensitivePlans = new Set((await db.actionPlan.findMany({ where: { orgId, caseId: { in: [...sensitiveCases] } }, select: { id: true } })).map((p) => p.id));
    const isRestricted = (model: string, r: Record<string, unknown>) =>
      (model === "Case" && sensitiveCases.has(r.id as string)) ||
      (typeof r.caseId === "string" && sensitiveCases.has(r.caseId)) ||
      (typeof r.sensitivity === "string" && SENSITIVE.includes(r.sensitivity)) ||
      (model === "CaseNoteVersion" && sensitiveNotes.has(r.noteId as string)) ||
      (model === "ActionPlanItem" && sensitivePlans.has(r.planId as string));

    const entries: ZipEntry[] = [];
    const tables: SchoolExportSummary["tables"] = [];
    let restrictedRows = 0;
    let rowCount = 0;
    const restrictedDocs = new Set<string>();
    for (const { model } of tenantModels()) {
      if (SKIP.has(model)) continue;
      const rows = await allRows(orgId, model);
      const open: Array<Record<string, unknown>> = [];
      const restricted: Array<Record<string, unknown>> = [];
      for (const r of rows) {
        if (isRestricted(model, r)) {
          restricted.push(scrubRow(r));
          if (model === "Document") restrictedDocs.add(r.id as string);
        } else open.push(scrubRow(r));
      }
      restrictedRows += restricted.length;
      const area = areaOf(model);
      if (open.length) entries.push({ name: `${area}/${model}.csv`, data: toCsv(open), date: now });
      if (includeRestricted && restricted.length) entries.push({ name: `restricted/${area}/${model}.csv`, data: toCsv(restricted), date: now });
      const n = open.length + (includeRestricted ? restricted.length : 0);
      rowCount += n;
      tables.push({ model, area, rows: n });
    }
    // Sign-in identities of the school's members (no password hashes or tokens).
    const members = await db.membership.findMany({ where: { orgId }, include: { user: { select: { id: true, email: true, nameEn: true, nameAr: true, locale: true, createdAt: true } } } });
    entries.push({ name: "people/User.csv", data: toCsv(members.map((m) => ({ membershipId: m.id, ...m.user }))), date: now });
    entries.push({ name: "settings/Organization.csv", data: toCsv([scrubRow(org as unknown as Record<string, unknown>)]), date: now });

    // Stored files.
    let files = 0;
    let missingFiles = 0;
    const versions = await db.documentVersion.findMany({ where: { orgId }, select: { documentId: true, version: true, fileName: true, storageKey: true, createdAt: true } });
    for (const v of versions) {
      if (!isStoredKey(v.storageKey)) continue;
      if (restrictedDocs.has(v.documentId) && !includeRestricted) continue;
      const body = await getObject(v.storageKey);
      if (!body) {
        missingFiles++;
        continue;
      }
      const folder = restrictedDocs.has(v.documentId) ? "restricted/files" : "files";
      entries.push({ name: `${folder}/${v.documentId}/v${v.version}-${v.fileName.replace(/[^\w.\-]+/g, "_")}`, data: body, date: v.createdAt });
      files++;
    }
    if (org.logoUrl && isStoredKey(org.logoUrl)) {
      const logo = await getObject(org.logoUrl);
      if (logo) {
        entries.push({ name: "files/school-logo", data: logo, date: now });
        files++;
      }
    }

    const summary: SchoolExportSummary = { tables, restrictedRows, restrictedIncluded: includeRestricted, files, missingFiles };
    const readme = [
      exportLabel("en", "school.readmeTitle", { school: org.nameEn }),
      exportLabel("en", "generated", { date: now.toISOString() }),
      "",
      exportLabel("en", "school.readmeBody"),
      includeRestricted ? exportLabel("en", "school.restrictedIncluded") : exportLabel("en", "school.restrictedExcluded", { n: restrictedRows }),
      "",
      exportLabel("ar", "school.readmeTitle", { school: org.nameAr }),
      exportLabel("ar", "generated", { date: now.toISOString() }),
      "",
      exportLabel("ar", "school.readmeBody"),
      includeRestricted ? exportLabel("ar", "school.restrictedIncluded") : exportLabel("ar", "school.restrictedExcluded", { n: restrictedRows }),
      "",
    ].join("\n");
    entries.unshift({ name: "README.txt", data: readme, date: now }, { name: "manifest.json", data: JSON.stringify({ generatedAt: now.toISOString(), school: org.slug, ...summary }, null, 2), date: now });

    const zip = createZip(entries);
    const storageKey = await putObjectAt(`${orgId}/exports/school-${exportId}.zip`, zip, "application/zip");
    await tenantTx(orgId, async (tx) => {
      await tx.dataExport.update({
        where: { id: exportId },
        data: { status: "READY", storageKey, sizeBytes: zip.length, fileCount: files, rowCount, summary: { ...summary, includeRestricted } as unknown as Prisma.InputJsonValue, finishedAt: now, expiresAt: new Date(now.getTime() + EXPORT_TTL_HOURS * 3600_000) },
      });
      await tx.jobRun.createMany({ data: [{ orgId, queue: PRIVACY_QUEUE, name: SCHOOL_EXPORT_JOB, idempotencyKey: `school-export:${exportId}`, status: "COMPLETED", finishedAt: now, result: { rows: rowCount, files } }], skipDuplicates: true });
      await tx.auditEvent.create({ data: { orgId, actorId: null, action: "school_export.ready", entityType: "DataExport", entityId: exportId, sensitivity: "CONFIDENTIAL", meta: { rows: rowCount, files, bytes: zip.length, restrictedIncluded: includeRestricted } } });
    });
    return "ready";
  } catch (err) {
    await db.dataExport.update({ where: { id: exportId }, data: { status: "FAILED", error: err instanceof Error ? err.name : "Error" } }).catch(() => undefined);
    throw err;
  }
}

/** Remove expired export files. Runs with the daily retention sweep. */
export async function expireSchoolExports(orgId: string, now = new Date()) {
  const db = tenantDb(orgId);
  const expired = await db.dataExport.findMany({ where: { orgId, status: "READY", expiresAt: { lt: now } } });
  for (const e of expired) {
    if (e.storageKey) await deleteObject(e.storageKey);
    await db.dataExport.update({ where: { id: e.id }, data: { status: "EXPIRED", storageKey: null } });
  }
  return expired.length;
}
