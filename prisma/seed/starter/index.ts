// Starter template: the complete working configuration a new school gets, without any people.
// Roles, service catalog with forms and workflows, message and letter templates, departments and subjects,
// the current academic year with terms and UAE holidays, a bell schedule, grade bands, career catalogs,
// compliance defaults and (optionally) a course catalog for the school's curricula.
//
// Idempotent: every section only adds what is missing, so running it twice changes nothing, and running it on
// a school that edited its setup never overwrites those edits. All dates are relative to `now`.
// Runs with an owner client (seed scripts, platform sign-up) or a tenant transaction client.
import { createHash, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient, SchoolCurriculum } from "@prisma/client";
import { SYSTEM_ROLES, STAFF_ROLE_KEYS } from "@/server/identity/permissions";
import type { Tx } from "@/server/db";
import { proposeUaeHolidays } from "@/server/calendar/uae-holidays";
import { addDays, dayKey, instant } from "@/server/exams/schedule";
import { buildPreset, UAE_PRESET } from "@/server/timetable/bell";
import { ensureCoverTemplates } from "@/server/timetable/cover";
import { ensureCalendarTemplates } from "@/server/trips/templates";
import { ensurePlanTemplates } from "@/server/curriculum/review";
import { ensureGradeTemplate } from "@/server/grades/service";
import { ensureTemplates as ensureApplicationTemplates } from "@/server/applications/service";
import { ensureCareerEventTemplates } from "@/server/career-events/templates";
import { ensureInspectionMapping } from "@/server/inspection/seed";
import { SERVICES, SERVICE_CATEGORIES } from "../data/services";
import { FORM_TEMPLATES } from "../data/forms";
import { WORKFLOW_TEMPLATES } from "../data/workflows";
import { APPOINTMENT_TYPES } from "../data/scheduling";
import { DOCUMENT_CATEGORIES, DOCUMENT_TEMPLATES } from "../data/documents";
import { MESSAGE_TEMPLATES } from "../data/notifications";
import { CAREERS } from "../data/careers";
import { APTITUDE_QUESTIONS } from "../data/aptitude";
import { bandsFor, rebrand, STARTER_DEPARTMENTS, STARTER_PURPOSES, STARTER_RETENTION, STARTER_SUBJECTS, STARTER_TRANSFERS, subjectCodeForCourse, VERIFY_EMAIL_TEMPLATE } from "./data";

type Db = PrismaClient | Prisma.TransactionClient;

export type StarterOptions = {
  curricula: SchoolCurriculum[];
  locale: "en" | "ar";
  now: Date;
  /** Install SchoolCourse rows for the curricula from the global course catalog (default true). */
  installCourses?: boolean;
  /** Backdate catalog rows (the demo school looks like it has used them for months). */
  backdate?: boolean;
};

export type StarterSummary = Record<string, number>;

const DAY = 86_400_000;
const rid = () => randomUUID().replace(/-/g, "").slice(0, 25);

/** Stable id for rows the demo calendar seed also creates, so neither adds a duplicate. */
const stableId = (...parts: string[]) => "d" + createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 24);

/** Start year of the academic year that contains `now` (UAE years start in late August). */
export function academicStartYear(now: Date) {
  const shifted = new Date(now.getTime() + 4 * 3600_000);
  return shifted.getUTCMonth() >= 7 ? shifted.getUTCFullYear() : shifted.getUTCFullYear() - 1;
}

export async function installStarterTemplate(db: Db, orgId: string, opts: StarterOptions): Promise<StarterSummary> {
  const { now } = opts;
  const summary: StarterSummary = {};
  const created = (k: string, n: number) => (summary[k] = (summary[k] ?? 0) + n);
  const past = (days: number) => (opts.backdate ? new Date(now.getTime() - days * DAY) : now);
  const tx = db as unknown as Tx;

  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId } });

  // --- Roles ------------------------------------------------------------------------------
  const existingRoles = new Set((await db.role.findMany({ where: { orgId }, select: { key: true } })).map((r) => r.key));
  const newRoles = SYSTEM_ROLES.filter((r) => !existingRoles.has(r.key));
  if (newRoles.length) {
    await db.role.createMany({
      data: newRoles.map((r) => ({ orgId, key: r.key, nameEn: r.nameEn, nameAr: r.nameAr, descEn: r.descEn, descAr: r.descAr, permissions: r.permissions, isSystem: true })),
      skipDuplicates: true,
    });
  }
  created("roles", newRoles.length);

  // --- Departments and subjects ----------------------------------------------------------------
  const d = await db.department.createMany({ data: STARTER_DEPARTMENTS.map((x) => ({ orgId, key: x.key, nameEn: x.name.en, nameAr: x.name.ar })), skipDuplicates: true });
  created("departments", d.count);
  const deptIds = new Map((await db.department.findMany({ where: { orgId }, select: { id: true, key: true } })).map((x) => [x.key, x.id]));
  const s = await db.subject.createMany({ data: STARTER_SUBJECTS.map((x) => ({ orgId, code: x.code, nameEn: x.name.en, nameAr: x.name.ar, departmentId: deptIds.get(x.dept) ?? null })), skipDuplicates: true });
  created("subjects", s.count);

  // --- Campus ---------------------------------------------------------------------------------
  if ((await db.campus.count({ where: { orgId } })) === 0) {
    await db.campus.create({ data: { orgId, nameEn: "Main campus", nameAr: "الحرم الرئيسي", isMain: true } });
    created("campuses", 1);
  }

  // --- Academic year, terms, holidays and bell schedule ---------------------------------------------
  let year = await db.academicYear.findFirst({ where: { orgId, isCurrent: true } });
  if (!year) {
    const y = academicStartYear(now);
    const date = (yy: number, m: number, dd: number) => new Date(Date.UTC(yy, m - 1, dd));
    year = await db.academicYear.create({ data: { orgId, nameEn: `${y}-${y + 1}`, nameAr: `${y}-${y + 1}`, startsOn: date(y, 8, 24), endsOn: date(y + 1, 7, 2), isCurrent: true } });
    await db.term.createMany({
      data: [
        { orgId, academicYearId: year.id, nameEn: "Autumn term", nameAr: "الفصل الأول", startsOn: date(y, 8, 24), endsOn: date(y, 12, 12) },
        { orgId, academicYearId: year.id, nameEn: "Spring term", nameAr: "الفصل الثاني", startsOn: date(y + 1, 1, 5), endsOn: date(y + 1, 3, 27) },
        { orgId, academicYearId: year.id, nameEn: "Summer term", nameAr: "الفصل الثالث", startsOn: date(y + 1, 4, 13), endsOn: date(y + 1, 7, 2) },
      ],
    });
    created("academicYears", 1);
  }
  created("holidays", await installHolidays(db, orgId, year.id, past(40)));
  if ((await db.bellPeriod.count({ where: { orgId, academicYearId: year.id } })) === 0) {
    const rows = buildPreset({ ...UAE_PRESET, days: org.weekDays.length ? org.weekDays : UAE_PRESET.days });
    await db.bellPeriod.createMany({ data: rows.map((r) => ({ orgId, academicYearId: year.id, ...r })), skipDuplicates: true });
    created("bellPeriods", rows.length);
  }

  // --- Grade bands ----------------------------------------------------------------------------
  if ((await db.gradeBand.count({ where: { orgId } })) === 0) {
    const bands = bandsFor(opts.curricula.length ? opts.curricula : org.curricula);
    await db.gradeBand.createMany({ data: bands.map((b, i) => ({ orgId, label: b.label, minPercent: b.minPercent, sortOrder: i })), skipDuplicates: true });
    created("gradeBands", bands.length);
  }

  // --- Service catalog: categories, forms, workflows, appointment types, services -------------------------
  const cats = await db.serviceCategory.createMany({ data: SERVICE_CATEGORIES.map((c) => ({ orgId, key: c.key, nameEn: c.name.en, nameAr: c.name.ar, icon: c.icon, sortOrder: c.sortOrder })), skipDuplicates: true });
  created("serviceCategories", cats.count);

  const haveForms = new Set((await db.form.findMany({ where: { orgId }, select: { key: true } })).map((f) => f.key));
  const formRows: Prisma.FormCreateManyInput[] = [];
  const formVersionRows: Prisma.FormVersionCreateManyInput[] = [];
  for (const f of FORM_TEMPLATES) {
    if (haveForms.has(f.key)) continue;
    const formId = rid();
    const versionId = rid();
    formRows.push({ id: formId, orgId, key: f.key, nameEn: f.name.en, nameAr: f.name.ar, descEn: f.description.en, descAr: f.description.ar, categoryEn: f.category.en, categoryAr: f.category.ar, isTemplate: true, status: "PUBLISHED", draftSchema: f.schema as never, publishedVersionId: versionId, createdAt: past(200) });
    formVersionRows.push({ id: versionId, orgId, formId, version: 1, schema: f.schema as never, publishedAt: past(190) });
  }
  if (formRows.length) {
    await db.form.createMany({ data: formRows });
    await db.formVersion.createMany({ data: formVersionRows });
  }
  created("forms", formRows.length);

  const haveWorkflows = new Set((await db.workflow.findMany({ where: { orgId }, select: { key: true } })).map((w) => w.key));
  const wfRows: Prisma.WorkflowCreateManyInput[] = [];
  const wfvRows: Prisma.WorkflowVersionCreateManyInput[] = [];
  for (const w of WORKFLOW_TEMPLATES) {
    if (haveWorkflows.has(w.key)) continue;
    const workflowId = rid();
    const versionId = rid();
    wfRows.push({ id: workflowId, orgId, key: w.key, nameEn: w.name.en, nameAr: w.name.ar, descEn: w.description.en, descAr: w.description.ar, isTemplate: true, status: "PUBLISHED", draftGraph: w.graph as never, publishedVersionId: versionId, createdAt: past(200) });
    wfvRows.push({ id: versionId, orgId, workflowId, version: 1, graph: w.graph as never, publishedAt: past(190) });
  }
  if (wfRows.length) {
    await db.workflow.createMany({ data: wfRows });
    await db.workflowVersion.createMany({ data: wfvRows });
  }
  created("workflows", wfRows.length);

  const formIds = new Map((await db.form.findMany({ where: { orgId }, select: { id: true, key: true } })).map((f) => [f.key, f.id]));
  const workflowIds = new Map((await db.workflow.findMany({ where: { orgId }, select: { id: true, key: true } })).map((w) => [w.key, w.id]));
  const appt = await db.appointmentType.createMany({
    data: APPOINTMENT_TYPES.map((t) => ({
      orgId,
      key: t.key,
      nameEn: t.name.en,
      nameAr: t.name.ar,
      descEn: t.description.en,
      descAr: t.description.ar,
      durationMin: t.durationMin,
      bufferBeforeMin: t.bufferBeforeMin,
      bufferAfterMin: t.bufferAfterMin,
      minNoticeMin: t.minNoticeMin,
      dailyMax: t.dailyMax,
      locationType: t.locationType,
      locationEn: t.location.en,
      locationAr: t.location.ar,
      intakeFormId: t.intakeFormKey ? (formIds.get(t.intakeFormKey) ?? null) : null,
      hostMode: t.hostMode,
      audience: t.audience,
      color: t.color,
    })),
    skipDuplicates: true,
  });
  created("appointmentTypes", appt.count);

  const catIds = new Map((await db.serviceCategory.findMany({ where: { orgId }, select: { id: true, key: true } })).map((c) => [c.key, c.id]));
  const apptIds = new Map((await db.appointmentType.findMany({ where: { orgId }, select: { id: true, key: true } })).map((a) => [a.key, a.id]));
  const svc = await db.serviceDefinition.createMany({
    data: SERVICES.map((sv) => ({
      orgId,
      key: sv.key,
      categoryId: catIds.get(sv.category)!,
      nameEn: sv.name.en,
      nameAr: sv.name.ar,
      descEn: sv.description.en,
      descAr: sv.description.ar,
      icon: sv.icon,
      audience: [...new Set(sv.audience.flatMap((a) => (a === "staff" ? STAFF_ROLE_KEYS : [a])))],
      formId: sv.formKey ? (formIds.get(sv.formKey) ?? null) : null,
      workflowId: sv.workflowKey ? (workflowIds.get(sv.workflowKey) ?? null) : null,
      appointmentTypeId: sv.appointmentTypeKey ? (apptIds.get(sv.appointmentTypeKey) ?? null) : null,
      slaHours: sv.slaHours,
      sensitivity: sv.sensitivity,
      requestPrefix: sv.requestPrefix,
      requiresStudent: sv.requiresStudent,
      createsCase: sv.createsCase,
      caseType: sv.caseType,
      isActive: true,
      isFeatured: sv.featured,
      sortOrder: sv.sortOrder,
      createdAt: past(200),
    })),
    skipDuplicates: true,
  });
  created("services", svc.count);

  // --- Documents and message templates --------------------------------------------------------------
  const dc = await db.documentCategory.createMany({ data: DOCUMENT_CATEGORIES.map((c) => ({ orgId, key: c.key, nameEn: c.name.en, nameAr: c.name.ar, sensitivity: c.sensitivity })), skipDuplicates: true });
  created("documentCategories", dc.count);
  const dt = await db.documentTemplate.createMany({
    data: DOCUMENT_TEMPLATES.map((t) => ({ orgId, key: t.key, nameEn: t.name.en, nameAr: t.name.ar, descEn: t.description.en, descAr: t.description.ar, bodyEn: t.bodyEn, bodyAr: t.bodyAr, output: t.output, mergeFields: t.mergeFields, signatoryEn: t.signatory.en, signatoryAr: t.signatory.ar })),
    skipDuplicates: true,
  });
  created("documentTemplates", dt.count);
  const mt = await db.messageTemplate.createMany({
    data: [
      ...MESSAGE_TEMPLATES.flatMap((t) => [
        { orgId, key: t.key, channel: "EMAIL" as const, subjectEn: t.subject.en, subjectAr: t.subject.ar, bodyEn: t.body.en, bodyAr: t.body.ar },
        ...(t.sms ? [{ orgId, key: t.key, channel: "SMS" as const, subjectEn: null, subjectAr: null, bodyEn: t.sms.en, bodyAr: t.sms.ar }] : []),
      ]),
      { orgId, key: VERIFY_EMAIL_TEMPLATE.key, channel: "EMAIL" as const, subjectEn: VERIFY_EMAIL_TEMPLATE.subjectEn, subjectAr: VERIFY_EMAIL_TEMPLATE.subjectAr, bodyEn: VERIFY_EMAIL_TEMPLATE.bodyEn, bodyAr: VERIFY_EMAIL_TEMPLATE.bodyAr },
    ],
    skipDuplicates: true,
  });
  created("messageTemplates", mt.count);
  // Module templates (grades, cover, trips, lesson plans, applications), created here so admins can edit them before first use.
  await ensureGradeTemplate(tx, orgId);
  await ensureCoverTemplates(tx, orgId);
  await ensureCalendarTemplates(tx, orgId);
  await ensurePlanTemplates(tx, orgId);
  await ensureApplicationTemplates(tx, orgId);
  await ensureCareerEventTemplates(tx, orgId);

  // --- Career catalogs ------------------------------------------------------------------------------
  if ((await db.aptitudeQuestion.count({ where: { orgId } })) === 0) {
    await db.aptitudeQuestion.createMany({ data: APTITUDE_QUESTIONS.map((q, i) => ({ orgId, dimension: q.dimension, textEn: q.text.en, textAr: q.text.ar, order: i + 1, reverse: Boolean(q.reverse) })) });
    created("aptitudeQuestions", APTITUDE_QUESTIONS.length);
  }
  const car = await db.career.createMany({
    data: CAREERS.map((c) => ({
      orgId,
      key: c.key,
      titleEn: c.title.en,
      titleAr: c.title.ar,
      clusterEn: c.cluster.en,
      clusterAr: c.cluster.ar,
      summaryEn: c.summary.en,
      summaryAr: c.summary.ar,
      dayInLifeEn: c.dayInLife.en,
      dayInLifeAr: c.dayInLife.ar,
      weights: c.weights as never,
      subjects: c.subjects,
      skillsEn: c.skills.en,
      skillsAr: c.skills.ar,
      educationEn: c.education.en,
      educationAr: c.education.ar,
      salaryMinAed: c.salaryMinAed,
      salaryMaxAed: c.salaryMaxAed,
      outlook: c.outlook,
      uaeDemand: c.uaeDemand,
    })),
    skipDuplicates: true,
  });
  created("careers", car.count);

  // --- Compliance defaults ---------------------------------------------------------------------------
  const pp = await db.processingPurpose.createMany({
    data: STARTER_PURPOSES.map((p) => ({ orgId, key: p.key, nameEn: p.en, nameAr: p.ar, descEn: p.descEn, descAr: p.descAr, lawfulBasis: p.basis, dataCategories: p.cats, requiresConsent: p.consent })),
    skipDuplicates: true,
  });
  created("processingPurposes", pp.count);
  const rp = await db.retentionPolicy.createMany({ data: STARTER_RETENTION.map((p) => ({ orgId, recordType: p.type, nameEn: p.en, nameAr: p.ar, retentionDays: p.days, action: p.action })), skipDuplicates: true });
  created("retentionPolicies", rp.count);
  if ((await db.crossBorderTransfer.count({ where: { orgId } })) === 0) {
    await db.crossBorderTransfer.createMany({ data: STARTER_TRANSFERS.map((t) => ({ orgId, ...t, approved: false })) });
    created("crossBorderTransfers", STARTER_TRANSFERS.length);
  }
  // Inspection evidence mapping (suggested defaults the school checks against its current framework).
  created("inspectionMapping", await ensureInspectionMapping(db, orgId));

  // --- Curricula and course catalog ----------------------------------------------------------------
  if (opts.curricula.length && org.curricula.length === 0) await db.organization.update({ where: { id: orgId }, data: { curricula: opts.curricula } });
  if (opts.installCourses !== false && opts.curricula.length) created("schoolCourses", await installCourseCatalog(db, orgId, opts.curricula));

  // --- A new school's texts carry its own name, not the demo school's ----------------------------------------
  if (!org.isDemo) created("rebranded", await rebrandTemplates(db, orgId, { nameEn: org.nameEn, nameAr: org.nameAr, shortEn: org.shortNameEn || org.nameEn, shortAr: org.shortNameAr || org.nameAr }));

  return summary;
}

/** UAE public holidays for the academic year, plus the breaks between terms. Stable ids, so it never adds duplicates. */
export async function installHolidays(db: Db, orgId: string, yearId: string, createdAt = new Date()) {
  const year = await db.academicYear.findUniqueOrThrow({ where: { id: yearId }, include: { terms: { orderBy: { startsOn: "asc" } } } });
  const rows: Prisma.CalendarEventCreateManyInput[] = [];
  const existing = await db.calendarEvent.findMany({ where: { orgId, kind: "HOLIDAY" }, select: { id: true, startsAt: true, endsAt: true } });
  for (const h of proposeUaeHolidays(dayKey(year.startsOn), dayKey(year.endsOn))) {
    const startsAt = instant(h.startKey, 0);
    const endsAt = instant(addDays(h.startKey, h.days), 0);
    const id = stableId(orgId, "holiday", h.key);
    const near = existing.some((e) => e.id !== id && e.startsAt.getTime() < endsAt.getTime() + 2 * DAY && e.endsAt.getTime() > startsAt.getTime() - 2 * DAY);
    if (near) continue;
    rows.push({
      id,
      orgId,
      kind: "HOLIDAY",
      titleEn: h.titleEn,
      titleAr: h.titleAr,
      descEn: h.estimated ? "Estimated date. The final date depends on the moon sighting and the official announcement." : "UAE public holiday. School closed.",
      descAr: h.estimated ? "تاريخ تقديري. يعتمد التاريخ النهائي على رؤية الهلال والإعلان الرسمي." : "عطلة رسمية في دولة الإمارات. المدرسة مغلقة.",
      startsAt,
      endsAt,
      allDay: true,
      audience: ["staff", "student", "parent"],
      gradeLevels: [],
      published: true,
      createdAt,
    });
  }
  for (let i = 1; i < year.terms.length; i++) {
    const from = addDays(dayKey(year.terms[i - 1].endsOn), 1);
    const to = dayKey(year.terms[i].startsOn);
    if (to <= from) continue;
    rows.push({
      id: stableId(orgId, "break", year.terms[i].id),
      orgId,
      kind: "HOLIDAY",
      titleEn: i === 1 ? "Winter break" : "Spring break",
      titleAr: i === 1 ? "عطلة الشتاء" : "عطلة الربيع",
      descEn: "School closed for students and staff.",
      descAr: "المدرسة مغلقة للطلاب والموظفين.",
      startsAt: instant(from, 0),
      endsAt: instant(to, 0),
      allDay: true,
      audience: ["staff", "student", "parent"],
      gradeLevels: [],
      published: true,
      createdAt,
    });
  }
  if (!rows.length) return 0;
  const res = await db.calendarEvent.createMany({ data: rows, skipDuplicates: true });
  return res.count;
}

/** SchoolCourse rows for every global course of the chosen curricula. Keeps rows the school already has. */
export async function installCourseCatalog(db: Db, orgId: string, curricula: SchoolCurriculum[]) {
  if (!curricula.length) return 0;
  const global = await db.curriculumCourse.findMany({ where: { orgId: null, curriculum: { in: curricula } }, select: { id: true, code: true, nameEn: true, gradeLevel: true } });
  const subjects = new Map((await db.subject.findMany({ where: { orgId }, select: { id: true, code: true } })).map((x) => [x.code, x.id]));
  const res = await db.schoolCourse.createMany({
    data: global.map((c) => {
      const code = subjectCodeForCourse(c.code, c.nameEn);
      return { orgId, courseId: c.id, subjectId: code ? (subjects.get(code) ?? null) : null, gradeLevels: c.gradeLevel ? [c.gradeLevel] : [9, 10, 11, 12] };
    }),
    skipDuplicates: true,
  });
  return res.count;
}

/** Replace the demo school's name in message and letter templates and service texts with the school's own. */
export async function rebrandTemplates(db: Db, orgId: string, names: { nameEn: string; nameAr: string; shortEn: string; shortAr: string }) {
  let n = 0;
  const changed = <T extends Record<string, string | null>>(fields: T) => {
    const next = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v ? rebrand(v, names) : v])) as T;
    return Object.keys(fields).some((k) => next[k] !== fields[k]) ? next : null;
  };
  for (const t of await db.messageTemplate.findMany({ where: { orgId } })) {
    const next = changed({ subjectEn: t.subjectEn, subjectAr: t.subjectAr, bodyEn: t.bodyEn, bodyAr: t.bodyAr });
    if (!next) continue;
    await db.messageTemplate.update({ where: { id: t.id }, data: { ...next, bodyEn: next.bodyEn ?? t.bodyEn, bodyAr: next.bodyAr ?? t.bodyAr } });
    n++;
  }
  for (const t of await db.documentTemplate.findMany({ where: { orgId } })) {
    const next = changed({ bodyEn: t.bodyEn, bodyAr: t.bodyAr, signatoryEn: t.signatoryEn, signatoryAr: t.signatoryAr, descEn: t.descEn, descAr: t.descAr });
    if (!next) continue;
    await db.documentTemplate.update({ where: { id: t.id }, data: { ...next, bodyEn: next.bodyEn ?? t.bodyEn, bodyAr: next.bodyAr ?? t.bodyAr } });
    n++;
  }
  for (const t of await db.serviceDefinition.findMany({ where: { orgId }, select: { id: true, descEn: true, descAr: true } })) {
    const next = changed({ descEn: t.descEn, descAr: t.descAr });
    if (!next) continue;
    await db.serviceDefinition.update({ where: { id: t.id }, data: { descEn: next.descEn ?? t.descEn, descAr: next.descAr ?? t.descAr } });
    n++;
  }
  return n;
}
