// Classes and enrollments import for the current academic year.
//
// Class codes: SchoolClass has no code column, so a class created by an import gets an id derived from the
// school, the year and the code (hash), which makes re-importing the same code update the same class with
// no stored mapping. A class that existed before (made by hand, by the demo or by registration allocation)
// is adopted when exactly one class of the year has the same grade, subject, section and homeroom flag; the
// adoption is recorded in an audit event ("imports.class", with the code), which is how that code finds the
// class next time. Enrolling a student moves them out of another section of the same subject (or another
// homeroom) in the same year, like a section move, and keeps their subject registration pointing at the class.
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { tenantTx, type TenantTx } from "@/lib/tenant-db";
import { pick } from "@/lib/i18n-data";
import { defaultClassName, normCode, normStudentNo, parseClassRecords, parseEnrollmentRecords, type ClassLookups, type ClassRow } from "@/lib/imports/classes";
import type { SheetRecord } from "@/lib/imports/table";
import { MAX_ROWS, finishPreview, type ImportPreview, type ImportSummary, type PreviewRow, type RowAction, type RowIssue } from "@/lib/imports/types";
import { audit } from "@/server/audit/audit";
import { importAccess, ImportError, type ImportActor } from "./access";
import { finishRecord, startRecord } from "./record";

const ID_PREFIX = "imp";

/** The id of the class an import creates for a code: stable per school, year and code. */
export function classIdFor(orgId: string, yearId: string, code: string): string {
  return ID_PREFIX + createHash("sha256").update(`${orgId}:${yearId}:${normCode(code)}`).digest("hex").slice(0, 22);
}
const isImportId = (id: string) => id.startsWith(ID_PREFIX) && id.length === 25;

type ClassRec = {
  id: string;
  nameEn: string;
  nameAr: string;
  subjectId: string | null;
  gradeLevel: number;
  section: string | null;
  isHomeroom: boolean;
  teacherMembershipId: string | null;
  room: string | null;
  capacity: number | null;
  optionBlock: string | null;
};
const CLASS_SELECT = { id: true, nameEn: true, nameAr: true, subjectId: true, gradeLevel: true, section: true, isHomeroom: true, teacherMembershipId: true, room: true, capacity: true, optionBlock: true } satisfies Prisma.SchoolClassSelect;

type Ctx = {
  yearId: string;
  campusId: string | null;
  lookups: ClassLookups;
  subjects: Map<string, { code: string; nameEn: string; nameAr: string }>;
  teacherNames: Map<string, { nameEn: string; nameAr: string | null }>;
  classes: Map<string, ClassRec>;
  /** code -> class id, for classes adopted by an earlier import. */
  mapped: Map<string, string>;
  /** studentId -> class ids this year. */
  enrolled: Map<string, Set<string>>;
};

async function loadContext(tx: TenantTx, orgId: string): Promise<Ctx> {
  const year = await tx.academicYear.findFirst({ where: { orgId, isCurrent: true }, select: { id: true } });
  if (!year) throw new ImportError("NO_YEAR");
  const [subjects, staff, students, classes, events, campus] = await Promise.all([
    tx.subject.findMany({ select: { id: true, code: true, nameEn: true, nameAr: true } }),
    tx.membership.findMany({
      where: { status: { in: ["ACTIVE", "INVITED"] }, staffProfile: { isNot: null }, student: { is: null }, guardian: { is: null } },
      select: { id: true, user: { select: { email: true, nameEn: true, nameAr: true } } },
    }),
    tx.student.findMany({ select: { id: true, studentNo: true, gradeLevel: true, status: true } }),
    tx.schoolClass.findMany({ where: { academicYearId: year.id }, select: CLASS_SELECT }),
    tx.auditEvent.findMany({ where: { action: "imports.class", entityType: "SchoolClass", meta: { path: ["yearId"], equals: year.id } }, orderBy: { createdAt: "asc" }, select: { entityId: true, meta: true } }),
    tx.campus.findFirst({ where: { isMain: true }, select: { id: true } }),
  ]);
  const classMap = new Map(classes.map((c) => [c.id, c]));
  const mapped = new Map<string, string>();
  for (const e of events) {
    const code = normCode((e.meta as { code?: string } | null)?.code);
    if (code && e.entityId && classMap.has(e.entityId) && !isImportId(e.entityId)) mapped.set(code, e.entityId);
  }
  const enrollments = classes.length ? await tx.enrollment.findMany({ where: { classId: { in: classes.map((c) => c.id) } }, select: { studentId: true, classId: true } }) : [];
  const enrolled = new Map<string, Set<string>>();
  for (const e of enrollments) enrolled.set(e.studentId, (enrolled.get(e.studentId) ?? new Set()).add(e.classId));
  return {
    yearId: year.id,
    campusId: campus?.id ?? null,
    lookups: {
      subjects,
      teachers: new Map(staff.map((m) => [m.user.email.toLowerCase(), m.id])),
      students: new Map(students.map((s) => [normStudentNo(s.studentNo), { id: s.id, gradeLevel: s.gradeLevel, active: s.status === "ACTIVE" }])),
    },
    subjects: new Map(subjects.map((s) => [s.id, s])),
    teacherNames: new Map(staff.map((m) => [m.id, { nameEn: m.user.nameEn, nameAr: m.user.nameAr }])),
    classes: classMap,
    mapped,
    enrolled,
  };
}

type Target = { id: string; existing: ClassRec | null; adopted: boolean };

/** Finds the class each code refers to (see the file comment). Reports codes that could mean several classes. */
function resolveTargets(orgId: string, ctx: Ctx, rows: ClassRow[]) {
  const targets = new Map<number, Target>();
  const errors: RowIssue[] = [];
  const claimed = new Set<string>();
  const mappedIds = new Set(ctx.mapped.values());
  for (const r of rows) {
    const derived = classIdFor(orgId, ctx.yearId, r.code);
    const direct = ctx.classes.get(derived) ?? (ctx.mapped.has(r.code) ? ctx.classes.get(ctx.mapped.get(r.code)!) : undefined);
    if (direct) {
      targets.set(r.row, { id: direct.id, existing: direct, adopted: false });
      claimed.add(direct.id);
      continue;
    }
    const candidates = [...ctx.classes.values()].filter(
      (c) =>
        !isImportId(c.id) &&
        !mappedIds.has(c.id) &&
        !claimed.has(c.id) &&
        c.isHomeroom === r.homeroom &&
        c.gradeLevel === r.gradeLevel &&
        (r.homeroom || c.subjectId === r.subjectId) &&
        (c.section ?? "").toUpperCase() === (r.section ?? ""),
    );
    if (candidates.length > 1) {
      errors.push({ row: r.row, field: "class_code", code: "ambiguousClass" });
      continue;
    }
    if (candidates.length === 1) {
      targets.set(r.row, { id: candidates[0].id, existing: candidates[0], adopted: true });
      claimed.add(candidates[0].id);
    } else targets.set(r.row, { id: derived, existing: null, adopted: false });
  }
  return { targets, errors };
}

type ClassPlan = { data: Prisma.SchoolClassUncheckedUpdateInput; changes: string[]; action: RowAction };

function planClass(r: ClassRow, t: Target, ctx: Ctx): ClassPlan {
  const subject = r.subjectId ? ctx.subjects.get(r.subjectId) ?? null : null;
  const def = defaultClassName(r, subject);
  const e = t.existing;
  const want: Record<string, unknown> = {
    nameEn: r.nameEn ?? (e ? undefined : def.en),
    nameAr: r.nameAr ?? (e ? undefined : r.nameEn && !subject ? r.nameEn : def.ar),
    subjectId: r.homeroom ? null : r.subjectId,
    gradeLevel: r.gradeLevel,
    section: r.section ?? (e ? undefined : null),
    isHomeroom: r.homeroom,
    teacherMembershipId: r.teacherId ?? undefined,
    room: r.room ?? undefined,
    capacity: r.capacity ?? undefined,
    optionBlock: r.optionBlock ?? undefined,
  };
  const data: Record<string, unknown> = {};
  const changes = new Set<string>();
  const label: Record<string, string> = { nameEn: "name", nameAr: "name", subjectId: "subject", gradeLevel: "grade", section: "section", isHomeroom: "homeroom", teacherMembershipId: "teacher", room: "room", capacity: "capacity", optionBlock: "block" };
  for (const [k, v] of Object.entries(want)) {
    if (v === undefined) continue;
    if (!e || (e as Record<string, unknown>)[k] !== v) {
      data[k] = v;
      if (e) changes.add(label[k]);
    }
  }
  return { data: data as Prisma.SchoolClassUncheckedUpdateInput, changes: [...changes], action: e ? (changes.size ? "update" : "unchanged") : "create" };
}

type Outcome = "create" | "update" | "unchanged";

/** What enrolling each student in the class does now: new, a move from another section, or already there. */
function enrollmentOutcome(ctx: Ctx, cls: { id: string; isHomeroom: boolean; subjectId: string | null }, studentId: string): Outcome {
  const mine = ctx.enrolled.get(studentId) ?? new Set();
  if (mine.has(cls.id)) return "unchanged";
  for (const id of mine) {
    const other = ctx.classes.get(id);
    if (other && (cls.isHomeroom ? other.isHomeroom : !other.isHomeroom && other.subjectId === cls.subjectId)) return "update";
  }
  return "create";
}

/** Enrolls students in a class, moving them out of another section of the same group. Returns each student's outcome. */
async function enrollStudents(tx: TenantTx, orgId: string, yearId: string, cls: { id: string; isHomeroom: boolean; subjectId: string | null }, studentIds: string[]) {
  const out = new Map<string, Outcome>();
  if (!studentIds.length) return out;
  const group: Prisma.SchoolClassWhereInput = cls.isHomeroom ? { academicYearId: yearId, isHomeroom: true } : { academicYearId: yearId, isHomeroom: false, subjectId: cls.subjectId };
  const current = await tx.enrollment.findMany({ where: { studentId: { in: studentIds }, class: group }, select: { id: true, studentId: true, classId: true, status: true } });
  const here = new Map(current.filter((e) => e.classId === cls.id).map((e) => [e.studentId, e]));
  const elsewhere = current.filter((e) => e.classId !== cls.id);
  const movedFrom = new Set(elsewhere.map((e) => e.studentId));
  if (elsewhere.length) await tx.enrollment.deleteMany({ where: { id: { in: elsewhere.map((e) => e.id) } } });
  const inactive = [...here.values()].filter((e) => e.status !== "ACTIVE").map((e) => e.id);
  if (inactive.length) await tx.enrollment.updateMany({ where: { id: { in: inactive } }, data: { status: "ACTIVE" } });
  const add = studentIds.filter((id) => !here.has(id));
  if (add.length) await tx.enrollment.createMany({ data: add.map((studentId) => ({ orgId, studentId, classId: cls.id, status: "ACTIVE" as const })), skipDuplicates: true });
  if (!cls.isHomeroom && cls.subjectId && add.length) {
    await tx.subjectRegistration.updateMany({ where: { academicYearId: yearId, subjectId: cls.subjectId, studentId: { in: add }, status: { not: "DROPPED" } }, data: { classId: cls.id, status: "ALLOCATED" } });
  }
  for (const id of studentIds) out.set(id, here.has(id) ? "unchanged" : movedFrom.has(id) ? "update" : "create");
  return out;
}

async function addQualification(tx: TenantTx, orgId: string, teacherId: string, subjectId: string, grade: number) {
  const q = await tx.teacherSubject.findUnique({ where: { membershipId_subjectId: { membershipId: teacherId, subjectId } } });
  if (!q) {
    await tx.teacherSubject.create({ data: { orgId, membershipId: teacherId, subjectId, gradeLevels: [grade] } });
    return 1;
  }
  if (q.gradeLevels.includes(grade)) return 0;
  await tx.teacherSubject.update({ where: { id: q.id }, data: { gradeLevels: [...q.gradeLevels, grade].sort((a, b) => a - b) } });
  return 1;
}

async function prepareClasses(actor: ImportActor, records: SheetRecord[]) {
  if (records.length > MAX_ROWS.classes) throw new ImportError("TOO_MANY_ROWS");
  if (!importAccess(actor.perms).center) throw new ImportError("FORBIDDEN");
  const ctx = await tenantTx(actor.orgId, (tx) => loadContext(tx, actor.orgId), { timeout: 60_000 });
  const parsed = parseClassRecords(records, ctx.lookups);
  const resolved = resolveTargets(actor.orgId, ctx, parsed.rows);
  return { ctx, parsed, resolved, errors: [...parsed.errors, ...resolved.errors] };
}

export async function previewClasses(actor: ImportActor, records: SheetRecord[], locale: string): Promise<ImportPreview> {
  const { ctx, parsed, resolved, errors } = await prepareClasses(actor, records);
  const byRow = new Map(parsed.rows.map((r) => [r.row, r]));
  const rows: PreviewRow[] = records.map((rec) => {
    const v = (k: string) => rec.values[k] ?? "";
    const r = byRow.get(rec.row);
    const t = resolved.targets.get(rec.row);
    const rowErrors = errors.filter((e) => e.row === rec.row);
    const warnings = parsed.warnings.filter((w) => w.row === rec.row);
    const plan = r && t ? planClass(r, t, ctx) : null;
    const cls = r && t ? { id: t.id, isHomeroom: r.homeroom, subjectId: r.homeroom ? null : r.subjectId } : null;
    const outcomes = r && cls ? r.studentIds.map((id) => enrollmentOutcome(ctx, cls, id)) : [];
    const newStudents = outcomes.filter((o) => o !== "unchanged").length;
    const changes = [...(plan?.changes ?? []), ...(newStudents ? ["students"] : [])];
    if (t?.adopted) warnings.push({ row: rec.row, field: "class_code", code: "adopted" });
    const subject = r?.subjectId ? ctx.subjects.get(r.subjectId) : null;
    const teacher = r?.teacherId ? ctx.teacherNames.get(r.teacherId) : null;
    const action: RowAction | null = rowErrors.length || !plan ? null : plan.action === "unchanged" && newStudents ? "update" : plan.action;
    return {
      row: rec.row,
      action,
      changes: action === "update" ? changes : undefined,
      errors: rowErrors,
      warnings,
      cells: [
        { text: v("class_code"), ltr: true, sub: pick(locale, v("name_en"), v("name_ar")) || undefined },
        { text: subject ? pick(locale, subject.nameEn, subject.nameAr) : v("subject"), chips: r?.homeroom ? ["homeroom"] : undefined },
        { text: [v("grade"), v("section")].filter(Boolean).join(" "), ltr: true },
        { text: teacher ? pick(locale, teacher.nameEn, teacher.nameAr) : v("teacher_email"), ltr: !teacher && !!v("teacher_email") },
        { text: v("room"), sub: v("capacity") || undefined, ltr: true },
        { text: r ? String(newStudents) : "" },
      ],
    };
  });
  return finishPreview("classes", rows);
}

export async function importClasses(actor: ImportActor, fileName: string, records: SheetRecord[]): Promise<ImportSummary> {
  const { ctx, parsed, resolved, errors: fileErrors } = await prepareClasses(actor, records);
  const record = await startRecord(actor, "classes", fileName, records.length);
  const errors: RowIssue[] = [...fileErrors];
  const failedRows = new Set(errors.map((e) => e.row));
  const counts = { created: 0, updated: 0, unchanged: 0 };
  const extra = { enrolled: 0, moved: 0, qualifications: 0, adopted: 0 };
  for (const r of parsed.rows) {
    const t = resolved.targets.get(r.row);
    if (!t || failedRows.has(r.row)) continue;
    try {
      const plan = planClass(r, t, ctx);
      const res = await tenantTx(
        actor.orgId,
        async (tx) => {
          if (!t.existing) {
            await tx.schoolClass.create({ data: { ...(plan.data as Prisma.SchoolClassUncheckedCreateInput), id: t.id, orgId: actor.orgId, academicYearId: ctx.yearId, campusId: ctx.campusId } });
          } else if (plan.changes.length) {
            await tx.schoolClass.update({ where: { id: t.id }, data: plan.data });
            if (plan.changes.includes("teacher")) await tx.timetableSlot.updateMany({ where: { classId: t.id, locked: false }, data: { teacherMembershipId: r.teacherId } });
          }
          const cls = { id: t.id, isHomeroom: r.homeroom, subjectId: r.homeroom ? null : r.subjectId };
          const outcomes = await enrollStudents(tx, actor.orgId, ctx.yearId, cls, r.studentIds);
          const quals = r.teacherId && cls.subjectId ? await addQualification(tx, actor.orgId, r.teacherId, cls.subjectId, r.gradeLevel) : 0;
          const enrolled = [...outcomes.values()].filter((o) => o !== "unchanged").length;
          const moved = [...outcomes.values()].filter((o) => o === "update").length;
          if (plan.action !== "unchanged" || enrolled || t.adopted) {
            await audit(tx, actor.orgId, {
              actorId: actor.membershipId,
              actorUserId: actor.userId,
              action: "imports.class",
              entityType: "SchoolClass",
              entityId: t.id,
              meta: { importId: record.id, code: r.code, yearId: ctx.yearId, created: !t.existing, adopted: t.adopted, changes: plan.changes, enrolled, moved },
            });
          }
          return { enrolled, moved, quals, action: plan.action === "unchanged" && enrolled ? ("update" as const) : plan.action };
        },
        { timeout: 60_000 },
      );
      counts[res.action === "create" ? "created" : res.action === "update" ? "updated" : "unchanged"]++;
      extra.enrolled += res.enrolled;
      extra.moved += res.moved;
      extra.qualifications += res.quals;
      if (t.adopted) extra.adopted++;
      // Later rows see this class and these enrollments.
      if (!t.existing) ctx.classes.set(t.id, { id: t.id, nameEn: "", nameAr: "", subjectId: r.homeroom ? null : r.subjectId, gradeLevel: r.gradeLevel, section: r.section, isHomeroom: r.homeroom, teacherMembershipId: r.teacherId, room: r.room, capacity: r.capacity, optionBlock: r.optionBlock });
    } catch {
      errors.push({ row: r.row, field: "row", code: "failed" });
      failedRows.add(r.row);
    }
  }
  return finishRecord(actor, record.id, "imports.classes", { total: records.length, failedRows, errors, counts, extra });
}

// ---------------------------------------------------------------------------
// Enrollments file: class code and student number per row
// ---------------------------------------------------------------------------

async function prepareEnrollments(actor: ImportActor, records: SheetRecord[]) {
  if (records.length > MAX_ROWS.enrollments) throw new ImportError("TOO_MANY_ROWS");
  if (!importAccess(actor.perms).center) throw new ImportError("FORBIDDEN");
  const ctx = await tenantTx(actor.orgId, (tx) => loadContext(tx, actor.orgId), { timeout: 60_000 });
  const classOf = (code: string) => ctx.classes.get(classIdFor(actor.orgId, ctx.yearId, code)) ?? (ctx.mapped.has(code) ? ctx.classes.get(ctx.mapped.get(code)!) : undefined);
  const parsed = parseEnrollmentRecords(records, ctx.lookups, (code) => !!classOf(code));
  return { ctx, parsed, classOf };
}

export async function previewEnrollments(actor: ImportActor, records: SheetRecord[], locale: string): Promise<ImportPreview> {
  const { ctx, parsed, classOf } = await prepareEnrollments(actor, records);
  const byRow = new Map(parsed.rows.map((r) => [r.row, r]));
  const rows: PreviewRow[] = records.map((rec) => {
    const r = byRow.get(rec.row);
    const cls = r ? classOf(r.code) : undefined;
    const errors = parsed.errors.filter((e) => e.row === rec.row);
    const warnings = parsed.warnings.filter((w) => w.row === rec.row);
    const action = r && cls ? enrollmentOutcome(ctx, cls, r.studentId) : null;
    return {
      row: rec.row,
      action: errors.length || warnings.length ? null : action,
      errors,
      warnings,
      changes: action === "update" ? ["moved"] : undefined,
      cells: [{ text: rec.values.class_code ?? "", ltr: true, sub: cls ? pick(locale, cls.nameEn, cls.nameAr) : undefined }, { text: rec.values.student_no ?? "", ltr: true }],
    };
  });
  return finishPreview("enrollments", rows);
}

export async function importEnrollments(actor: ImportActor, fileName: string, records: SheetRecord[]): Promise<ImportSummary> {
  const { ctx, parsed, classOf } = await prepareEnrollments(actor, records);
  const record = await startRecord(actor, "enrollments", fileName, records.length);
  const errors: RowIssue[] = [...parsed.errors];
  const failedRows = new Set(errors.map((e) => e.row));
  const counts = { created: 0, updated: 0, unchanged: 0 };
  const byClass = new Map<string, typeof parsed.rows>();
  for (const r of parsed.rows) {
    const cls = classOf(r.code)!;
    byClass.set(cls.id, [...(byClass.get(cls.id) ?? []), r]);
  }
  for (const [classId, rows] of byClass) {
    const cls = ctx.classes.get(classId)!;
    try {
      const outcomes = await tenantTx(actor.orgId, (tx) => enrollStudents(tx, actor.orgId, ctx.yearId, cls, [...new Set(rows.map((r) => r.studentId))]), { timeout: 60_000 });
      for (const r of rows) {
        const o = outcomes.get(r.studentId) ?? "unchanged";
        counts[o === "create" ? "created" : o === "update" ? "updated" : "unchanged"]++;
      }
    } catch {
      for (const r of rows) {
        errors.push({ row: r.row, field: "row", code: "failed" });
        failedRows.add(r.row);
      }
    }
  }
  return finishRecord(actor, record.id, "imports.enrollments", { total: records.length, failedRows, errors, counts, extra: { classes: byClass.size } });
}
