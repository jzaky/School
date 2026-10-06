// REST API v1 handlers. Every query runs through tenantDb for the key's school. Upserts go through the same
// Import center services as a spreadsheet upload (src/server/imports), so validation, matching (student
// number, email, class code) and idempotency are identical, and each call shows up in the import history.
// Error messages are fixed texts per code: they never contain a submitted value.
import { tenantDb, tenantTx } from "@/lib/tenant-db";
import { normCode, normStudentNo } from "@/lib/imports/classes";
import { MAX_BATCH, PayloadError, itemsOf, studentPasses, toApiIssues, toCell, toRecords, unknownFields, type ApiIssue, type UpsertKind } from "@/lib/integrations/api-records";
import type { ImportSummary, RowIssue } from "@/lib/imports/types";
import { importStaff } from "@/server/imports/staff";
import { importClasses, importEnrollments } from "@/server/imports/classes";
import { importStudents } from "@/server/imports/reuse";
import { ImportError, type ImportActor } from "@/server/imports/access";
import { flushEffects } from "@/server/queue-core";
import { audit } from "@/server/audit/audit";
import { STAFF_ROLE_KEYS } from "@/server/identity/permissions";

export const API_ERROR_MESSAGES = {
  UNAUTHORIZED: "A valid API key is required in the Authorization header (Bearer).",
  KEY_REVOKED: "This API key has been revoked.",
  KEY_OWNER_INACTIVE: "The person who created this API key no longer has access to integrations. Create a new key.",
  FORBIDDEN_SCOPE: "This API key does not have the scope this request needs.",
  RATE_LIMITED: "Too many requests for this API key. Wait and try again.",
  NOT_FOUND: "Unknown resource.",
  METHOD_NOT_ALLOWED: "This method is not supported on this resource.",
  INVALID_BODY: "The request body must be JSON with an array of items.",
  EMPTY: "The request has no items.",
  TOO_MANY_ITEMS: "Too many items in one request. Send smaller batches.",
  TOO_LARGE: "The request body is too large.",
  INVALID_QUERY: "A query parameter is not valid.",
  FORBIDDEN: "The person who created this API key may not change this data.",
  NO_YEAR: "The school has no current academic year.",
  UNAVAILABLE: "The API is not available on this server right now.",
  INTERNAL: "Something went wrong. Try again later.",
} as const;
export type ApiErrorCode = keyof typeof API_ERROR_MESSAGES;

export class ApiError extends Error {
  constructor(public status: number, public code: ApiErrorCode) {
    super(`api:${code}`);
  }
}

export type UpsertResult = {
  import_id: string | null;
  total: number;
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
  errors: ApiIssue[];
  unknown_fields: string[];
};

function asApiError(e: unknown): never {
  if (e instanceof PayloadError) throw new ApiError(e.code === "TOO_MANY_ITEMS" ? 413 : 400, e.code);
  if (e instanceof ImportError) {
    if (e.code === "NO_YEAR") throw new ApiError(409, "NO_YEAR");
    if (e.code === "TOO_MANY_ROWS") throw new ApiError(413, "TOO_MANY_ITEMS");
    if (e.code === "FORBIDDEN") throw new ApiError(403, "FORBIDDEN");
  }
  throw e;
}

const fromSummary = (s: ImportSummary, unknown: string[]): UpsertResult => ({
  import_id: s.importId,
  total: s.total,
  created: s.created,
  updated: s.updated,
  unchanged: s.unchanged,
  failed: s.failed,
  errors: toApiIssues(s.errors),
  unknown_fields: unknown,
});

/** Upsert a batch through the Import center services. `source` names the caller in the import history. */
export async function upsert(kind: UpsertKind, actor: ImportActor, body: unknown, source: string): Promise<UpsertResult> {
  try {
    const items = itemsOf(body, kind, MAX_BATCH[kind]);
    const unknown = unknownFields(items, kind);
    if (kind === "staff") {
      const res = await importStaff(actor, source, toRecords("staff", items), { invite: false });
      await flushEffects(res.effects);
      return fromSummary(res, unknown);
    }
    if (kind === "classes") return fromSummary(await importClasses(actor, source, toRecords("classes", items)), unknown);
    if (kind === "enrollments") return fromSummary(await importEnrollments(actor, source, toRecords("enrollments", items)), unknown);
    return await upsertStudents(actor, items, source, unknown);
  } catch (e) {
    asApiError(e);
  }
}

async function upsertStudents(actor: ImportActor, items: Array<Record<string, unknown>>, source: string, unknown: string[]): Promise<UpsertResult> {
  const passes = studentPasses(items);
  const first = await importStudents(actor, source, passes[0]);
  const failedIdx = new Set(first.errors.map((e) => e.row));
  const errors: ApiIssue[] = toApiIssues(first.errors);
  // Further guardians, only for students that were saved in the first pass.
  for (let p = 1; p < passes.length; p++) {
    const recs = passes[p].filter((r) => !failedIdx.has(r.row));
    if (!recs.length) continue;
    const res = await importStudents(actor, `${source} (${p + 1})`, recs);
    const issues: RowIssue[] = res.errors.filter((e) => e.field === "relationship" || e.field.startsWith("guardian_") || e.field === "row");
    errors.push(...toApiIssues(issues, p));
  }
  const failed = new Set(errors.map((e) => e.index)).size;
  return { import_id: first.importId, total: items.length, created: first.created, updated: first.updated, unchanged: 0, failed, errors: errors.sort((a, b) => a.index - b.index), unknown_fields: unknown };
}

// ---------------------------------------------------------------------------
// Attendance (no spreadsheet import exists for it): upsert by student number and date
// ---------------------------------------------------------------------------

const ATTENDANCE_STATUS = { present: "PRESENT", absent: "ABSENT", late: "LATE", excused: "EXCUSED" } as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function upsertAttendance(actor: ImportActor, body: unknown, source: string, now = new Date()): Promise<UpsertResult> {
  let items: Array<Record<string, unknown>>;
  try {
    items = itemsOf(body, "attendance", MAX_BATCH.attendance);
  } catch (e) {
    asApiError(e);
  }
  const errors: ApiIssue[] = [];
  const latest = now.getTime() + 86_400_000;
  type Row = { index: number; studentNo: string; date: Date; status: (typeof ATTENDANCE_STATUS)[keyof typeof ATTENDANCE_STATUS]; minutesLate: number | null };
  const rows: Row[] = [];
  const seen = new Set<string>();
  items.forEach((it, index) => {
    const studentNo = normStudentNo(toCell(it.student_no));
    const dateText = toCell(it.date);
    const statusText = toCell(it.status).toLowerCase() as keyof typeof ATTENDANCE_STATUS;
    const minutesText = toCell(it.minutes_late);
    const before = errors.length;
    if (!studentNo) errors.push({ index, field: "student_no", code: "required" });
    const date = DATE.test(dateText) ? new Date(`${dateText}T00:00:00Z`) : null;
    if (!date || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dateText || date.getTime() > latest) errors.push({ index, field: "date", code: dateText ? "date" : "required" });
    const status = ATTENDANCE_STATUS[statusText];
    if (!status) errors.push({ index, field: "status", code: statusText ? "status" : "required" });
    const minutes = minutesText ? Number(minutesText) : null;
    if (minutes !== null && (!Number.isInteger(minutes) || minutes < 0 || minutes > 600)) errors.push({ index, field: "minutes_late", code: "number" });
    const k = `${studentNo}|${dateText}`;
    if (errors.length === before && seen.has(k)) errors.push({ index, field: "date", code: "duplicate" });
    seen.add(k);
    if (errors.length === before) rows.push({ index, studentNo, date: date!, status: status!, minutesLate: status === "LATE" ? minutes : null });
  });
  const db = tenantDb(actor.orgId);
  const numbers = [...new Set(rows.map((r) => r.studentNo))];
  const students = numbers.length ? await db.student.findMany({ where: { studentNo: { in: numbers, mode: "insensitive" } }, select: { id: true, studentNo: true } }) : [];
  const idOf = new Map(students.map((s) => [normStudentNo(s.studentNo), s.id]));
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  const ready = rows.filter((r) => {
    if (idOf.has(r.studentNo)) return true;
    errors.push({ index: r.index, field: "student_no", code: "unknownStudent" });
    return false;
  });
  for (let i = 0; i < ready.length; i += 500) {
    const chunk = ready.slice(i, i + 500);
    try {
      const res = await tenantTx(
        actor.orgId,
        async (tx) => {
          const existing = await tx.attendanceRecord.findMany({ where: { OR: chunk.map((r) => ({ studentId: idOf.get(r.studentNo)!, date: r.date })) }, select: { id: true, studentId: true, date: true, status: true, minutesLate: true } });
          const byKey = new Map(existing.map((e) => [`${e.studentId}|${e.date.toISOString().slice(0, 10)}`, e]));
          const out = { created: 0, updated: 0, unchanged: 0 };
          for (const r of chunk) {
            const studentId = idOf.get(r.studentNo)!;
            const cur = byKey.get(`${studentId}|${r.date.toISOString().slice(0, 10)}`);
            if (!cur) {
              await tx.attendanceRecord.create({ data: { orgId: actor.orgId, studentId, date: r.date, status: r.status, minutesLate: r.minutesLate } });
              out.created++;
            } else if (cur.status !== r.status || (cur.minutesLate ?? null) !== r.minutesLate) {
              await tx.attendanceRecord.update({ where: { id: cur.id }, data: { status: r.status, minutesLate: r.minutesLate } });
              out.updated++;
            } else out.unchanged++;
          }
          return out;
        },
        { timeout: 60_000 },
      );
      created += res.created;
      updated += res.updated;
      unchanged += res.unchanged;
    } catch {
      for (const r of chunk) errors.push({ index: r.index, field: "row", code: "failed" });
    }
  }
  const failed = new Set(errors.map((e) => e.index)).size;
  await audit(db, actor.orgId, { actorId: actor.membershipId, actorUserId: actor.userId, action: "integrations.attendance_upsert", entityType: "AttendanceRecord", meta: { source, total: items.length, created, updated, unchanged, failed } });
  const known = new Set(["student_no", "date", "status", "minutes_late"]);
  const unknown = [...new Set(items.flatMap((it) => Object.keys(it).filter((k) => !known.has(k))))].slice(0, 30);
  return { import_id: null, total: items.length, created, updated, unchanged, failed, errors: errors.sort((a, b) => a.index - b.index), unknown_fields: unknown };
}

// ---------------------------------------------------------------------------
// Lists: cursor pagination by id
// ---------------------------------------------------------------------------

export type Page<T> = { data: T[]; next_cursor: string | null };

export function pageParams(sp: URLSearchParams): { limit: number; cursor: string | null } {
  const rawLimit = sp.get("limit");
  const limit = rawLimit === null ? 100 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new ApiError(400, "INVALID_QUERY");
  const cursor = sp.get("cursor");
  if (cursor !== null && !/^[A-Za-z0-9_-]{1,64}$/.test(cursor)) throw new ApiError(400, "INVALID_QUERY");
  return { limit, cursor };
}

function paged<T extends { id: string }>(rows: T[], limit: number): { rows: T[]; next: string | null } {
  const more = rows.length > limit;
  const page = more ? rows.slice(0, limit) : rows;
  return { rows: page, next: more ? page[page.length - 1].id : null };
}

const cursorArgs = (cursor: string | null) => (cursor ? { cursor: { id: cursor }, skip: 1 } : {});
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

export async function listStudents(orgId: string, sp: URLSearchParams) {
  const { limit, cursor } = pageParams(sp);
  const status = sp.get("status");
  if (status !== null && !["ACTIVE", "INACTIVE", "GRADUATED", "WITHDRAWN"].includes(status)) throw new ApiError(400, "INVALID_QUERY");
  const grade = sp.get("grade");
  if (grade !== null && !/^\d{1,2}$/.test(grade)) throw new ApiError(400, "INVALID_QUERY");
  const rows = await tenantDb(orgId).student.findMany({
    where: { ...(status ? { status: status as never } : {}), ...(grade ? { gradeLevel: Number(grade) } : {}) },
    orderBy: { id: "asc" },
    take: limit + 1,
    ...cursorArgs(cursor),
    select: {
      id: true,
      studentNo: true,
      firstNameEn: true,
      lastNameEn: true,
      firstNameAr: true,
      lastNameAr: true,
      gradeLevel: true,
      section: true,
      dateOfBirth: true,
      status: true,
      guardians: { select: { relationshipEn: true, isPrimary: true, guardian: { select: { id: true, firstNameEn: true, lastNameEn: true, firstNameAr: true, lastNameAr: true, email: true, phone: true } } } },
    },
  });
  const { rows: page, next } = paged(rows, limit);
  return {
    data: page.map((s) => ({
      id: s.id,
      student_no: s.studentNo,
      first_name_en: s.firstNameEn,
      last_name_en: s.lastNameEn,
      first_name_ar: s.firstNameAr,
      last_name_ar: s.lastNameAr,
      grade: s.gradeLevel,
      section: s.section,
      date_of_birth: iso(s.dateOfBirth),
      status: s.status,
      guardians: s.guardians.map((l) => ({
        id: l.guardian.id,
        first_name_en: l.guardian.firstNameEn,
        last_name_en: l.guardian.lastNameEn,
        first_name_ar: l.guardian.firstNameAr,
        last_name_ar: l.guardian.lastNameAr,
        email: l.guardian.email,
        phone: l.guardian.phone,
        relationship: l.relationshipEn.toLowerCase(),
        primary: l.isPrimary,
      })),
    })),
    next_cursor: next,
  };
}

export async function listStaff(orgId: string, sp: URLSearchParams) {
  const { limit, cursor } = pageParams(sp);
  const db = tenantDb(orgId);
  const rows = await db.membership.findMany({
    where: { student: { is: null }, guardian: { is: null }, staffProfile: { isNot: null }, roles: { some: { role: { key: { in: STAFF_ROLE_KEYS } } } } },
    orderBy: { id: "asc" },
    take: limit + 1,
    ...cursorArgs(cursor),
    select: {
      id: true,
      status: true,
      user: { select: { email: true, nameEn: true, nameAr: true } },
      roles: { select: { role: { select: { key: true } } } },
      staffProfile: { select: { jobTitleEn: true, jobTitleAr: true, gradeLevels: true, department: { select: { key: true } } } },
    },
  });
  const { rows: page, next } = paged(rows, limit);
  const quals = page.length ? await db.teacherSubject.findMany({ where: { membershipId: { in: page.map((m) => m.id) } }, select: { membershipId: true, subjectId: true } }) : [];
  const subjects = quals.length ? await db.subject.findMany({ where: { id: { in: [...new Set(quals.map((q) => q.subjectId))] } }, select: { id: true, code: true } }) : [];
  const codeOf = new Map(subjects.map((s) => [s.id, s.code]));
  return {
    data: page.map((m) => ({
      id: m.id,
      name_en: m.user.nameEn,
      name_ar: m.user.nameAr,
      email: m.user.email,
      status: m.status,
      roles: m.roles.map((r) => r.role.key),
      department: m.staffProfile?.department?.key ?? null,
      job_title_en: m.staffProfile?.jobTitleEn ?? null,
      job_title_ar: m.staffProfile?.jobTitleAr ?? null,
      subjects: quals.filter((q) => q.membershipId === m.id).map((q) => codeOf.get(q.subjectId)).filter(Boolean),
      grades: m.staffProfile?.gradeLevels ?? [],
    })),
    next_cursor: next,
  };
}

/** Class codes of the current year, from the Import center's records (see src/server/imports/classes.ts). */
async function classCodes(orgId: string, yearId: string): Promise<Map<string, string>> {
  const events = await tenantDb(orgId).auditEvent.findMany({
    where: { action: "imports.class", entityType: "SchoolClass", meta: { path: ["yearId"], equals: yearId } },
    orderBy: { createdAt: "asc" },
    select: { entityId: true, meta: true },
  });
  const out = new Map<string, string>();
  for (const e of events) {
    const code = normCode((e.meta as { code?: string } | null)?.code);
    if (code && e.entityId) out.set(e.entityId, code);
  }
  return out;
}

async function currentYearId(orgId: string): Promise<string> {
  const year = await tenantDb(orgId).academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } });
  if (!year) throw new ApiError(409, "NO_YEAR");
  return year.id;
}

export async function listClasses(orgId: string, sp: URLSearchParams) {
  const { limit, cursor } = pageParams(sp);
  const yearId = await currentYearId(orgId);
  const db = tenantDb(orgId);
  const rows = await db.schoolClass.findMany({
    where: { academicYearId: yearId },
    orderBy: { id: "asc" },
    take: limit + 1,
    ...cursorArgs(cursor),
    select: { id: true, nameEn: true, nameAr: true, gradeLevel: true, section: true, isHomeroom: true, room: true, capacity: true, optionBlock: true, teacherMembershipId: true, subject: { select: { code: true } }, _count: { select: { enrollments: true } } },
  });
  const { rows: page, next } = paged(rows, limit);
  const codes = await classCodes(orgId, yearId);
  const teacherIds = [...new Set(page.map((c) => c.teacherMembershipId).filter((x): x is string => !!x))];
  const teachers = teacherIds.length ? await db.membership.findMany({ where: { id: { in: teacherIds } }, select: { id: true, user: { select: { email: true } } } }) : [];
  const emailOf = new Map(teachers.map((t) => [t.id, t.user.email]));
  return {
    data: page.map((c) => ({
      id: c.id,
      class_code: codes.get(c.id) ?? null,
      name_en: c.nameEn,
      name_ar: c.nameAr,
      subject: c.subject?.code ?? null,
      grade: c.gradeLevel,
      section: c.section,
      teacher_email: c.teacherMembershipId ? (emailOf.get(c.teacherMembershipId) ?? null) : null,
      room: c.room,
      capacity: c.capacity,
      homeroom: c.isHomeroom,
      option_block: c.optionBlock,
      student_count: c._count.enrollments,
    })),
    next_cursor: next,
  };
}

export async function listEnrollments(orgId: string, sp: URLSearchParams) {
  const { limit, cursor } = pageParams(sp);
  const yearId = await currentYearId(orgId);
  const rows = await tenantDb(orgId).enrollment.findMany({
    where: { class: { academicYearId: yearId } },
    orderBy: { id: "asc" },
    take: limit + 1,
    ...cursorArgs(cursor),
    select: { id: true, classId: true, status: true, student: { select: { studentNo: true } } },
  });
  const { rows: page, next } = paged(rows, limit);
  const codes = await classCodes(orgId, yearId);
  return { data: page.map((e) => ({ id: e.id, class_id: e.classId, class_code: codes.get(e.classId) ?? null, student_no: e.student.studentNo, status: e.status })), next_cursor: next };
}

export async function listAttendance(orgId: string, sp: URLSearchParams, now = new Date()) {
  const { limit, cursor } = pageParams(sp);
  const from = sp.get("from") ?? new Date(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
  const to = sp.get("to") ?? now.toISOString().slice(0, 10);
  if (!DATE.test(from) || !DATE.test(to) || from > to) throw new ApiError(400, "INVALID_QUERY");
  const studentNo = sp.get("student_no");
  if (studentNo !== null && (studentNo.length < 1 || studentNo.length > 40)) throw new ApiError(400, "INVALID_QUERY");
  const rows = await tenantDb(orgId).attendanceRecord.findMany({
    where: { date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) }, ...(studentNo ? { student: { studentNo: { equals: studentNo, mode: "insensitive" } } } : {}) },
    orderBy: { id: "asc" },
    take: limit + 1,
    ...cursorArgs(cursor),
    select: { id: true, date: true, status: true, minutesLate: true, student: { select: { studentNo: true } } },
  });
  const { rows: page, next } = paged(rows, limit);
  return { data: page.map((r) => ({ id: r.id, student_no: r.student.studentNo, date: iso(r.date), status: r.status.toLowerCase(), minutes_late: r.minutesLate })), next_cursor: next };
}
