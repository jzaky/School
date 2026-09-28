import type { Ctx } from "@/server/context";
import { personName, pick, userName } from "@/lib/i18n-data";
import type { PickerOption } from "@/components/forms/picker-combobox";
import { visibleStudentIds } from "@/server/access/student-access";
import type { FormSchema, PrefillKey } from "./schema";
import { allFields } from "./logic";

export async function loadPickerOptions(ctx: Ctx, schema: FormSchema | null) {
  const types = new Set(schema ? allFields(schema).map((f) => f.type) : []);
  const { db, orgId, locale } = ctx;
  const ids = await visibleStudentIds(ctx);
  const [students, staff, subjects] = await Promise.all([
    db.student.findMany({ where: { orgId, status: "ACTIVE", ...(ids ? { id: { in: ids } } : {}) }, orderBy: [{ gradeLevel: "asc" }, { firstNameEn: "asc" }] }),
    types.has("staff_picker")
      ? db.membership.findMany({ where: { orgId, status: "ACTIVE", staffProfile: { isNot: null } }, include: { user: true, staffProfile: true } })
      : Promise.resolve([]),
    db.subject.findMany({ where: { orgId }, orderBy: { nameEn: "asc" } }),
  ]);
  const studentOptions: PickerOption[] = students.map((s) => ({
    value: s.id,
    label: personName(s, locale),
    hint: `${s.gradeLevel}${s.section ?? ""}`,
    keywords: `${s.firstNameEn} ${s.lastNameEn} ${s.firstNameAr} ${s.lastNameAr} ${s.studentNo}`,
  }));
  const staffOptions: PickerOption[] = staff
    .map((m) => ({ value: m.id, label: userName(m.user, locale), hint: pick(locale, m.staffProfile?.jobTitleEn, m.staffProfile?.jobTitleAr), keywords: `${m.user.nameEn} ${m.user.nameAr ?? ""}` }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const subjectOptions: PickerOption[] = subjects.map((s) => ({ value: s.code, label: pick(locale, s.nameEn, s.nameAr), keywords: `${s.nameEn} ${s.nameAr} ${s.code}` }));
  return { students: studentOptions, staff: staffOptions, subjects: subjectOptions, studentRows: students };
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
    "student.grade": student ? String(student.gradeLevel) : undefined,
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
