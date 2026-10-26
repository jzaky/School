// Staff reads for admissions: the board (paged per column), the application list (paged), and one application.
// Health details are never loaded here; staff with medical access open them through revealHealthAction (audited).
import type { Prisma } from "@prisma/client";
import type { Ctx } from "@/server/context";
import { missingDocs } from "./config";
import { parseFlags } from "./dup";
import { ageFlag, priorityScore, type AgeFlag } from "./rules";
import { admissionYears, asTx, loadSettings, type Settings, type YearOption } from "./settings";
import { boardStages, type StageDef } from "./stages";

export const COLUMN_PAGE = 25;
export const LIST_PAGE = 50;

export type BoardFilters = { yearId: string; grade: number | null; q: string | null; flag: string | null };

export const FLAGS = ["duplicates", "siblings", "staff", "support", "expired"] as const;

export function filterWhere(orgId: string, f: BoardFilters, now = new Date()): Prisma.AdmissionApplicationWhereInput {
  const q = f.q?.trim();
  return {
    orgId,
    academicYearId: f.yearId,
    stage: { not: "DRAFT" },
    ...(f.grade !== null ? { gradeLevel: f.grade } : {}),
    ...(q
      ? {
          OR: [
            { number: { contains: q, mode: "insensitive" } },
            { firstNameEn: { contains: q, mode: "insensitive" } },
            { lastNameEn: { contains: q, mode: "insensitive" } },
            { firstNameAr: { contains: q } },
            { lastNameAr: { contains: q } },
          ],
        }
      : {}),
    ...(f.flag === "duplicates" ? { NOT: { duplicateFlags: { isEmpty: true } } } : {}),
    ...(f.flag === "siblings" ? { NOT: { siblingStudentIds: { isEmpty: true } } } : {}),
    ...(f.flag === "staff" ? { staffChild: true } : {}),
    ...(f.flag === "support" ? { hasSupport: true } : {}),
    ...(f.flag === "expired" ? { AND: [{ stage: "OFFER_MADE" }, { offerDeadline: { lt: now } }] } : {}),
  };
}

const CARD_SELECT = {
  id: true,
  number: true,
  firstNameEn: true,
  lastNameEn: true,
  firstNameAr: true,
  lastNameAr: true,
  gradeLevel: true,
  stage: true,
  submittedAt: true,
  stageChangedAt: true,
  dateOfBirth: true,
  nationality: true,
  duplicateFlags: true,
  siblingStudentIds: true,
  staffChild: true,
  staffChildVerified: true,
  priorityBoost: true,
  hasSupport: true,
  hasMedical: true,
  offerDeadline: true,
  seatPaidAt: true,
  assessmentOutcome: true,
  academicYearId: true,
} satisfies Prisma.AdmissionApplicationSelect;

type CardRow = Prisma.AdmissionApplicationGetPayload<{ select: typeof CARD_SELECT }>;

export type Card = {
  id: string;
  number: string;
  nameEn: string;
  nameAr: string;
  grade: number;
  stage: string;
  submittedAt: string | null;
  stageChangedAt: string;
  ageFlag: AgeFlag;
  duplicate: boolean;
  sibling: boolean;
  staffChild: boolean;
  support: boolean;
  missing: number;
  priority: number;
  offerDeadline: string | null;
  offerExpired: boolean;
  outcome: string | null;
};

async function toCards(ctx: Ctx, rows: CardRow[], s: Settings, year: YearOption | undefined, now: Date): Promise<Card[]> {
  const docs = rows.length ? await ctx.db.admissionDocument.findMany({ where: { orgId: ctx.orgId, applicationId: { in: rows.map((r) => r.id) } }, select: { applicationId: true, typeKey: true, status: true } }) : [];
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    nameEn: `${r.firstNameEn} ${r.lastNameEn}`.trim(),
    nameAr: r.firstNameAr ? `${r.firstNameAr} ${r.lastNameAr ?? ""}`.trim() : `${r.firstNameEn} ${r.lastNameEn}`.trim(),
    grade: r.gradeLevel,
    stage: r.stage,
    submittedAt: r.submittedAt?.toISOString() ?? null,
    stageChangedAt: r.stageChangedAt.toISOString(),
    ageFlag: year ? ageFlag(r.dateOfBirth, r.gradeLevel, year.entryYear, s.cutoff).flag : null,
    duplicate: r.duplicateFlags.length > 0,
    sibling: r.siblingStudentIds.length > 0,
    staffChild: r.staffChild,
    support: r.hasSupport,
    missing: missingDocs(s.docTypes, r.gradeLevel, r.nationality, docs.filter((d) => d.applicationId === r.id)).length,
    priority: priorityScore(r),
    offerDeadline: r.offerDeadline?.toISOString() ?? null,
    offerExpired: r.stage === "OFFER_MADE" && !!r.offerDeadline && r.offerDeadline.getTime() < now.getTime(),
    outcome: r.assessmentOutcome,
  }));
}

/** The board: every visible stage with its total and the first page of cards. */
export async function loadBoard(ctx: Ctx, f: BoardFilters) {
  const now = new Date();
  const [s, years] = await Promise.all([loadSettings(asTx(ctx.db), ctx.orgId), admissionYears(asTx(ctx.db), ctx.orgId)]);
  const year = years.find((y) => y.id === f.yearId);
  const where = filterWhere(ctx.orgId, f, now);
  const counts = await ctx.db.admissionApplication.groupBy({ by: ["stage"], where, _count: { _all: true } });
  const inUse = counts.map((c) => c.stage);
  const stages = boardStages(s.stages, inUse);
  const columns = await Promise.all(
    stages.map(async (st) => {
      const rows = await ctx.db.admissionApplication.findMany({ where: { ...where, stage: st.key }, orderBy: [{ stageChangedAt: "asc" }, { number: "asc" }], take: COLUMN_PAGE, select: CARD_SELECT });
      return { stage: st, total: counts.find((c) => c.stage === st.key)?._count._all ?? 0, cards: await toCards(ctx, rows, s, year, now) };
    }),
  );
  const drafts = await ctx.db.admissionApplication.count({ where: { orgId: ctx.orgId, academicYearId: f.yearId, stage: "DRAFT" } });
  return { settings: s, years, year, columns, drafts };
}

/** The next page of one column. */
export async function loadBoardColumn(ctx: Ctx, stage: string, f: BoardFilters, cursor: number) {
  const now = new Date();
  const [s, years] = await Promise.all([loadSettings(asTx(ctx.db), ctx.orgId), admissionYears(asTx(ctx.db), ctx.orgId)]);
  const rows = await ctx.db.admissionApplication.findMany({ where: { ...filterWhere(ctx.orgId, f, now), stage }, orderBy: [{ stageChangedAt: "asc" }, { number: "asc" }], skip: cursor, take: COLUMN_PAGE, select: CARD_SELECT });
  return { cards: await toCards(ctx, rows, s, years.find((y) => y.id === f.yearId), now), nextCursor: rows.length === COLUMN_PAGE ? cursor + COLUMN_PAGE : null };
}

/** The application list, one page at a time, with an optional stage filter. */
export async function listApplications(ctx: Ctx, f: BoardFilters & { stage: string | null }, page: number) {
  const now = new Date();
  const [s, years] = await Promise.all([loadSettings(asTx(ctx.db), ctx.orgId), admissionYears(asTx(ctx.db), ctx.orgId)]);
  const where = { ...filterWhere(ctx.orgId, f, now), ...(f.stage ? { stage: f.stage } : {}) };
  const [total, rows] = await Promise.all([
    ctx.db.admissionApplication.count({ where }),
    ctx.db.admissionApplication.findMany({ where, orderBy: [{ submittedAt: "desc" }, { number: "desc" }], skip: (page - 1) * LIST_PAGE, take: LIST_PAGE, select: CARD_SELECT }),
  ]);
  return { settings: s, years, total, cards: await toCards(ctx, rows, s, years.find((y) => y.id === f.yearId), now) };
}

/** One application for staff, with the people and options its actions need. */
export async function applicationDetail(ctx: Ctx, id: string) {
  const { db, orgId } = ctx;
  const app = await db.admissionApplication.findFirst({ where: { id, orgId } });
  if (!app || app.stage === "DRAFT") return null;
  const [s, years, documents, messages, events, appointment] = await Promise.all([
    loadSettings(asTx(db), orgId),
    admissionYears(asTx(db), orgId),
    db.admissionDocument.findMany({ where: { orgId, applicationId: app.id }, orderBy: { createdAt: "asc" } }),
    db.admissionMessage.findMany({ where: { orgId, applicationId: app.id }, orderBy: { createdAt: "asc" }, take: 300 }),
    db.admissionEvent.findMany({ where: { orgId, applicationId: app.id }, orderBy: { createdAt: "asc" }, take: 300 }),
    app.assessmentAppointmentId ? db.appointment.findFirst({ where: { id: app.assessmentAppointmentId, orgId } }) : null,
  ]);
  const year = years.find((y) => y.id === app.academicYearId);
  const flags = parseFlags(app.duplicateFlags);
  const memberIds = [...new Set([...messages.map((m) => m.authorMembershipId), ...events.map((e) => e.actorMembershipId), appointment?.hostId].filter(Boolean))] as string[];
  const [members, dupApps, dupStudents, siblings, capacity, homerooms, hosts] = await Promise.all([
    memberIds.length ? db.membership.findMany({ where: { id: { in: memberIds } }, select: { id: true, user: { select: { nameEn: true, nameAr: true } } } }) : [],
    db.admissionApplication.findMany({ where: { orgId, id: { in: flags.filter((f) => f.target === "application").map((f) => f.id) } }, select: { id: true, number: true, stage: true, firstNameEn: true, lastNameEn: true, firstNameAr: true, lastNameAr: true, gradeLevel: true } }),
    db.student.findMany({ where: { orgId, id: { in: flags.filter((f) => f.target === "student").map((f) => f.id) } }, select: { id: true, studentNo: true, status: true, firstNameEn: true, lastNameEn: true, firstNameAr: true, lastNameAr: true, gradeLevel: true } }),
    app.siblingStudentIds.length ? db.student.findMany({ where: { orgId, id: { in: app.siblingStudentIds } }, select: { id: true, studentNo: true, firstNameEn: true, lastNameEn: true, firstNameAr: true, lastNameAr: true, gradeLevel: true, section: true } }) : [],
    db.admissionCapacity.findUnique({ where: { orgId_academicYearId_gradeLevel: { orgId, academicYearId: app.academicYearId, gradeLevel: app.gradeLevel } } }),
    db.schoolClass.findMany({ where: { orgId, academicYearId: app.academicYearId, gradeLevel: app.gradeLevel, isHomeroom: true }, orderBy: { section: "asc" }, select: { id: true, nameEn: true, nameAr: true, section: true, capacity: true, _count: { select: { enrollments: true } } } }),
    db.membership.findMany({
      where: { orgId, status: "ACTIVE", staffProfile: { isNot: null }, roles: { some: { role: { permissions: { hasSome: ["admissions.manage", "appointments.host"] } } } } },
      select: { id: true, user: { select: { nameEn: true, nameAr: true } }, roles: { select: { role: { select: { permissions: true } } } } },
      orderBy: { user: { nameEn: "asc" } },
      take: 200,
    }),
  ]);
  return {
    app,
    settings: s,
    year,
    documents,
    messages,
    events,
    appointment,
    members,
    dupApps,
    dupStudents,
    flags,
    siblings,
    capacity,
    homerooms,
    // Assessors: the admissions team first, then other staff who host meetings.
    hosts: hosts
      .map((h) => ({ id: h.id, user: h.user, admissions: h.roles.some((r) => r.role.permissions.includes("admissions.manage")) }))
      .sort((a, b) => Number(b.admissions) - Number(a.admissions)),
    age: year ? ageFlag(app.dateOfBirth, app.gradeLevel, year.entryYear, s.cutoff) : null,
    missing: missingDocs(s.docTypes, app.gradeLevel, app.nationality, documents),
  };
}

export type { StageDef };
