import { getTranslations } from "next-intl/server";
import type { Ctx } from "@/server/context";
import { gradeLabel } from "@/lib/grade-levels";
import { personName, pick, userName } from "@/lib/i18n-data";
import type { PickerOption } from "@/components/forms/picker-combobox";
import { visibleStudentIds } from "@/server/access/student-access";
import type { FormSchema, PrefillKey } from "./schema";
import { allFields } from "./logic";

/**
 * Options for picker fields. Families get their own children. Staff who can see every student search them on the
 * server (`studentSearch`), so a form never ships a whole school; `students` then holds only `selectedStudentId`.
 */
export async function loadPickerOptions(ctx: Ctx, schema: FormSchema | null, opts: { selectedStudentId?: string | null } = {}) {
  const types = new Set(schema ? allFields(schema).map((f) => f.type) : []);
  const { db, orgId, locale } = ctx;
  const ids = await visibleStudentIds(ctx);
  const studentSearch = ids === null;
  const tg = await getTranslations("gradeLevel");
  const [students, staff, subjects] = await Promise.all([
    studentSearch
      ? opts.selectedStudentId
        ? db.student.findMany({ where: { orgId, id: opts.selectedStudentId } })
        : Promise.resolve([])
      : db.student.findMany({ where: { orgId, status: "ACTIVE", id: { in: ids } }, orderBy: [{ gradeLevel: "asc" }, { firstNameEn: "asc" }] }),
    types.has("staff_picker")
      ? db.membership.findMany({ where: { orgId, status: "ACTIVE", staffProfile: { isNot: null } }, include: { user: true, staffProfile: true } })
      : Promise.resolve([]),
    db.subject.findMany({ where: { orgId }, orderBy: { nameEn: "asc" } }),
  ]);
  const studentOptions: PickerOption[] = students.map((s) => ({
    value: s.id,
    label: personName(s, locale),
    hint: gradeLabel(tg, s.gradeLevel, s.section, { short: true }),
    keywords: `${s.firstNameEn} ${s.lastNameEn} ${s.firstNameAr} ${s.lastNameAr} ${s.studentNo}`,
  }));
  const staffOptions: PickerOption[] = staff
    .map((m) => ({ value: m.id, label: userName(m.user, locale), hint: pick(locale, m.staffProfile?.jobTitleEn, m.staffProfile?.jobTitleAr), keywords: `${m.user.nameEn} ${m.user.nameAr ?? ""}` }))
    .sort((a, b) => a.label.localeCompare(b.label));
  // Subjects taught this year (offered or with a class). Courses that only run next year (course
  // selection) are left out; a school that has not set up offerings or classes sees every subject.
  const year = await db.academicYear.findFirst({ where: { orgId, isCurrent: true }, select: { id: true } });
  const taught = year
    ? new Set([
        ...(await db.subjectOffering.findMany({ where: { orgId, academicYearId: year.id }, select: { subjectId: true }, distinct: ["subjectId"] })).map((o) => o.subjectId),
        ...(await db.schoolClass.findMany({ where: { orgId, academicYearId: year.id, subjectId: { not: null } }, select: { subjectId: true }, distinct: ["subjectId"] })).map((c) => c.subjectId!),
      ])
    : new Set<string>();
  const listed = taught.size ? subjects.filter((s) => taught.has(s.id)) : subjects;
  const subjectOptions: PickerOption[] = listed.map((s) => ({ value: s.code, label: pick(locale, s.nameEn, s.nameAr), keywords: `${s.nameEn} ${s.nameAr} ${s.code}` }));
  return { students: studentOptions, staff: staffOptions, subjects: subjectOptions, studentSearch };
}

/** Values for fields marked with `prefill`, computed on the server from the member and the student. */
export async function prefillValues(ctx: Ctx, schema: FormSchema | null, studentId: string | null) {
  if (!schema) return {};
  const { db, locale } = ctx;
  const student = studentId ? await db.student.findUnique({ where: { id: studentId } }) : null;
  const homeroom = student
    ? await db.enrollment.findFirst({ where: { studentId: student.id, class: { isHomeroom: true } }, include: { class: true } })
    : null;
  const guardian = ctx.membership.guardian;
  const values: Record<string, unknown> = {};
  const source: Record<PrefillKey, unknown> = {
    "student.fullName": student ? personName(student, locale) : undefined,
    "student.grade": student ? gradeLabel(await getTranslations("gradeLevel"), student.gradeLevel) : undefined,
    "student.studentNo": student?.studentNo,
    "student.homeroom": homeroom ? pick(locale, homeroom.class.nameEn, homeroom.class.nameAr) : undefined,
    "requester.name": userName(ctx.user, locale),
    "requester.email": ctx.user.email,
    "requester.phone": ctx.membership.staffProfile?.phone ?? guardian?.phone ?? undefined,
    "guardian.name": guardian ? personName(guardian, locale) : undefined,
    today: new Date().toISOString().slice(0, 10),
  };
  for (const f of allFields(schema)) {
    if (f.prefill && source[f.prefill] !== undefined) values[f.id] = source[f.prefill];
    if (f.type === "student_picker" && student) values[f.id] = student.id;
  }
  return values;
}
