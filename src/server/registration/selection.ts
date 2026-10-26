// Course selection rules against the database: windows per year and grade, late-change exceptions,
// class choosing sessions, assisted choosing (teachers and, when the school allows it, parents) and
// parent sign-off. Every function takes a transaction client already scoped to one organization
// (tenantTx in request code, the owner client in seeds) plus that organization's id.
//
// submitChoices is the only way request code changes a student's choices. It decides who is writing
// (the student, a parent, a helper or staff with registration.manage) and refuses students, parents
// and helpers outside an open window unless an exception or a class session is active.
import type { CourseSelectionHelper, CourseSelectionSession, CourseSelectionSubmission, CourseSelectionWindow, ParentChoiceMode, Prisma, RegistrationSource, SchoolCurriculum } from "@prisma/client";
import type { Permission } from "@/server/identity/permissions";
import { blocksOf, type ChoiceError } from "@/lib/registration";
import { activeUntil, pickWindow, windowState, type WindowState } from "@/lib/selection-window";
import { audit } from "@/server/audit/audit";
import { notify } from "@/server/notify/notify";
import type { ExecCtx } from "@/server/db";
import { currentYear, offeringsFor, registrationYear, saveRegistration, selectionYear, type AllocationSummary } from "./service";
import { ensureSelectionTemplates } from "./selection-templates";

type Tx = Prisma.TransactionClient;
const ACTIVE_REG = ["REQUESTED", "ALLOCATED", "WAITLISTED"] as const;
const DAY = 86_400_000;
/** Longest an exception or a helper grant may run. */
export const MAX_GRANT_DAYS = 120;
export const SESSION_MINUTES = [15, 30, 45, 60, 90, 120] as const;

// ---------------------------------------------------------------------------
// Who is acting
// ---------------------------------------------------------------------------

export type SelectionActor = {
  membershipId: string;
  userId: string | null;
  isStudent: boolean;
  isParent: boolean;
  isStaff: boolean;
  can: (p: Permission) => boolean;
  /** The student's own record (students only). */
  ownStudentId: string | null;
  /** Linked children (parents only). */
  childIds: string[];
};

export function selectionActorFromCtx(ctx: {
  membershipId: string;
  user: { id: string };
  isStudent: boolean;
  isParent: boolean;
  isStaff: boolean;
  can: (p: Permission) => boolean;
  membership: { student?: { id: string } | null; guardian?: { links: Array<{ studentId: string }> } | null };
}): SelectionActor {
  return {
    membershipId: ctx.membershipId,
    userId: ctx.user.id,
    isStudent: ctx.isStudent,
    isParent: ctx.isParent,
    isStaff: ctx.isStaff,
    can: ctx.can,
    ownStudentId: ctx.isStudent ? (ctx.membership.student?.id ?? null) : null,
    childIds: ctx.isParent ? (ctx.membership.guardian?.links.map((l) => l.studentId) ?? []) : [],
  };
}

const auditActor = (a: SelectionActor) => ({ actorId: a.membershipId, actorUserId: a.userId });

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export type SelectionSettings = { parentChoice: ParentChoiceMode; signOffRequired: boolean; parentChoiceSignsOff: boolean };
export const DEFAULT_SETTINGS: SelectionSettings = { parentChoice: "ALWAYS", signOffRequired: false, parentChoiceSignsOff: true };

export async function getSelectionSettings(tx: Tx, orgId: string): Promise<SelectionSettings> {
  const row = await tx.courseSelectionSettings.findUnique({ where: { orgId } });
  return row ? { parentChoice: row.parentChoice, signOffRequired: row.signOffRequired, parentChoiceSignsOff: row.parentChoiceSignsOff } : DEFAULT_SETTINGS;
}

export async function saveSelectionSettings(tx: Tx, orgId: string, actor: SelectionActor, input: SelectionSettings) {
  if (!actor.isStaff || !actor.can("registration.manage")) return { ok: false as const, error: "FORBIDDEN" };
  const before = await getSelectionSettings(tx, orgId);
  await tx.courseSelectionSettings.upsert({ where: { orgId }, create: { orgId, ...input, updatedById: actor.membershipId }, update: { ...input, updatedById: actor.membershipId } });
  await audit(tx, orgId, { ...auditActor(actor), action: "registration.settings", entityType: "CourseSelectionSettings", meta: { before, after: input } });
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

export async function windowsForYears(tx: Tx, orgId: string, yearIds: string[]) {
  if (!yearIds.length) return [];
  return tx.courseSelectionWindow.findMany({ where: { orgId, academicYearId: { in: yearIds } }, orderBy: [{ opensAt: "asc" }, { id: "asc" }] });
}

export type WindowInput = { id?: string | null; academicYearId: string; gradeLevels: number[]; opensAt: Date; closesAt: Date; roundEn?: string | null; roundAr?: string | null };
export type WindowError = "FORBIDDEN" | "NO_YEAR" | "INVALID" | "BAD_RANGE" | "NO_GRADES" | "OVERLAP" | "NOT_FOUND";

/** Calendar texts for a window's closing deadline, in both languages. */
export type WindowLabels = (w: { gradeLevels: number[]; roundEn: string | null; roundAr: string | null; yearEn: string; yearAr: string; opensAt: Date }) => { titleEn: string; titleAr: string; descEn: string; descAr: string };

/**
 * Create or edit a window. Rounds for the same year may follow each other but may not overlap for a
 * grade (two open windows for one student would be ambiguous). The closing deadline stays on the calendar.
 */
export async function saveWindow(tx: Tx, orgId: string, actor: SelectionActor, input: WindowInput, labels: WindowLabels): Promise<{ ok: true; id: string } | { ok: false; error: WindowError }> {
  if (!actor.isStaff || !actor.can("registration.manage")) return { ok: false, error: "FORBIDDEN" };
  const grades = [...new Set(input.gradeLevels)].sort((a, b) => a - b);
  if (!grades.length) return { ok: false, error: "NO_GRADES" };
  if (!(input.opensAt.getTime() < input.closesAt.getTime())) return { ok: false, error: "BAD_RANGE" };
  if (input.closesAt.getTime() - input.opensAt.getTime() > 365 * DAY) return { ok: false, error: "BAD_RANGE" };
  const year = await tx.academicYear.findFirst({ where: { orgId, id: input.academicYearId } });
  if (!year) return { ok: false, error: "NO_YEAR" };
  const existing = input.id ? await tx.courseSelectionWindow.findFirst({ where: { orgId, id: input.id } }) : null;
  if (input.id && !existing) return { ok: false, error: "NOT_FOUND" };
  const others = await tx.courseSelectionWindow.findMany({ where: { orgId, academicYearId: year.id, ...(existing ? { id: { not: existing.id } } : {}), gradeLevels: { hasSome: grades } } });
  const overlaps = others.some((o) => o.opensAt.getTime() < input.closesAt.getTime() && input.opensAt.getTime() < o.closesAt.getTime());
  if (overlaps) return { ok: false, error: "OVERLAP" };
  const roundEn = input.roundEn?.trim() || null;
  const roundAr = input.roundAr?.trim() || roundEn;
  const text = labels({ gradeLevels: grades, roundEn, roundAr, yearEn: year.nameEn, yearAr: year.nameAr, opensAt: input.opensAt });
  const event = {
    kind: "DEADLINE" as const,
    titleEn: text.titleEn,
    titleAr: text.titleAr,
    descEn: text.descEn,
    descAr: text.descAr,
    startsAt: input.closesAt,
    endsAt: new Date(input.closesAt.getTime() + 60 * 60_000),
    allDay: false,
    audience: ["student", "parent", "staff", "registration_window", `year:${year.id}`],
    gradeLevels: grades,
    ownerId: actor.membershipId,
  };
  const linked = existing?.calendarEventId ? await tx.calendarEvent.findFirst({ where: { orgId, id: existing.calendarEventId } }) : null;
  const ev = linked ? await tx.calendarEvent.update({ where: { id: linked.id }, data: event }) : await tx.calendarEvent.create({ data: { orgId, ...event } });
  const data = { academicYearId: year.id, gradeLevels: grades, opensAt: input.opensAt, closesAt: input.closesAt, roundEn, roundAr, calendarEventId: ev.id };
  const row = existing ? await tx.courseSelectionWindow.update({ where: { id: existing.id }, data }) : await tx.courseSelectionWindow.create({ data: { orgId, ...data, createdById: actor.membershipId } });
  await audit(tx, orgId, {
    ...auditActor(actor),
    action: existing ? "registration.window_update" : "registration.window_create",
    entityType: "CourseSelectionWindow",
    entityId: row.id,
    meta: { yearId: year.id, gradeLevels: grades, opensAt: input.opensAt.toISOString(), closesAt: input.closesAt.toISOString(), ...(existing ? { before: { opensAt: existing.opensAt.toISOString(), closesAt: existing.closesAt.toISOString(), gradeLevels: existing.gradeLevels } } : {}) },
  });
  return { ok: true, id: row.id };
}

/** Close a window now (it stays in the history, and on the calendar at the new closing time). */
export async function closeWindowNow(tx: Tx, orgId: string, actor: SelectionActor, windowId: string, now = new Date()) {
  if (!actor.isStaff || !actor.can("registration.manage")) return { ok: false as const, error: "FORBIDDEN" };
  const w = await tx.courseSelectionWindow.findFirst({ where: { orgId, id: windowId } });
  if (!w) return { ok: false as const, error: "NOT_FOUND" };
  if (windowState(w, now) === "closed") return { ok: false as const, error: "ALREADY_CLOSED" };
  const opensAt = w.opensAt.getTime() > now.getTime() ? now : w.opensAt;
  await tx.courseSelectionWindow.update({ where: { id: w.id }, data: { opensAt, closesAt: now } });
  if (w.calendarEventId) await tx.calendarEvent.updateMany({ where: { orgId, id: w.calendarEventId }, data: { startsAt: now, endsAt: new Date(now.getTime() + 60 * 60_000) } });
  await audit(tx, orgId, { ...auditActor(actor), action: "registration.window_close", entityType: "CourseSelectionWindow", entityId: w.id, meta: { closedAt: now.toISOString(), plannedClose: w.closesAt.toISOString() } });
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// The people around a student
// ---------------------------------------------------------------------------

export type ResponsibleRole = "homeroom" | "teacher" | "counselor" | "advisor";
export type Responsible = { membershipId: string; roles: ResponsibleRole[] };

/** Members holding a permission through their roles (only active members). */
export async function membersWith(tx: Tx, orgId: string, membershipIds: string[], permission: Permission): Promise<Set<string>> {
  if (!membershipIds.length) return new Set();
  const rows = await tx.membershipRole.findMany({ where: { orgId, membershipId: { in: membershipIds }, membership: { status: "ACTIVE" } }, select: { membershipId: true, role: { select: { permissions: true } } } });
  return new Set(rows.filter((r) => r.role.permissions.includes(permission)).map((r) => r.membershipId));
}

/** The student's homeroom class this year, if any. */
export async function homeroomOf(tx: Tx, orgId: string, studentId: string) {
  const year = await currentYear(tx, orgId);
  if (!year) return null;
  const e = await tx.enrollment.findFirst({ where: { orgId, studentId, class: { isHomeroom: true, academicYearId: year.id } }, include: { class: true } });
  return e?.class ?? null;
}

/**
 * Staff responsible for a student: their homeroom teacher and subject teachers this year, their career
 * advisor or application counselor, and counselors and career advisors who cover the student's grade.
 */
export async function responsibleStaff(tx: Tx, orgId: string, studentId: string): Promise<Responsible[]> {
  const student = await tx.student.findFirst({ where: { orgId, id: studentId }, select: { id: true, gradeLevel: true } });
  if (!student) return [];
  const year = await currentYear(tx, orgId);
  const out = new Map<string, Set<ResponsibleRole>>();
  const add = (id: string | null | undefined, role: ResponsibleRole) => {
    if (!id) return;
    if (!out.has(id)) out.set(id, new Set());
    out.get(id)!.add(role);
  };
  const [classes, profile, apps, covering] = await Promise.all([
    year ? tx.enrollment.findMany({ where: { orgId, studentId, class: { academicYearId: year.id, teacherMembershipId: { not: null } } }, select: { class: { select: { isHomeroom: true, teacherMembershipId: true } } } }) : [],
    tx.careerProfile.findFirst({ where: { orgId, studentId }, select: { advisorId: true } }),
    tx.application.findMany({ where: { orgId, studentId, counselorId: { not: null } }, select: { counselorId: true }, distinct: ["counselorId"] }),
    tx.membershipRole.findMany({
      where: { orgId, role: { key: { in: ["counselor", "career_advisor"] } }, membership: { status: "ACTIVE", staffProfile: { gradeLevels: { has: student.gradeLevel } } } },
      select: { membershipId: true, role: { select: { key: true } } },
    }),
  ]);
  for (const c of classes) add(c.class.teacherMembershipId, c.class.isHomeroom ? "homeroom" : "teacher");
  add(profile?.advisorId, "advisor");
  for (const a of apps) add(a.counselorId, "counselor");
  for (const r of covering) add(r.membershipId, r.role.key === "counselor" ? "counselor" : "advisor");
  const active = await tx.membership.findMany({ where: { orgId, id: { in: [...out.keys()] }, status: "ACTIVE" }, select: { id: true } });
  const keep = new Set(active.map((m) => m.id));
  const order: ResponsibleRole[] = ["homeroom", "counselor", "advisor", "teacher"];
  return [...out.entries()]
    .filter(([id]) => keep.has(id))
    .map(([membershipId, roles]) => ({ membershipId, roles: order.filter((r) => roles.has(r)) }))
    .sort((a, b) => order.indexOf(a.roles[0]) - order.indexOf(b.roles[0]));
}

export async function isResponsible(tx: Tx, orgId: string, membershipId: string, studentId: string) {
  return (await responsibleStaff(tx, orgId, studentId)).some((r) => r.membershipId === membershipId);
}

/** Students a staff member is responsible for (ids), plus students who asked them for help. Null: every student. */
export async function studentsOf(tx: Tx, orgId: string, actor: SelectionActor, now = new Date()): Promise<string[] | null> {
  if (actor.can("registration.manage")) return null;
  const year = await currentYear(tx, orgId);
  const me = actor.membershipId;
  const [taught, advised, apps, roles, staff, grants] = await Promise.all([
    year ? tx.enrollment.findMany({ where: { orgId, class: { academicYearId: year.id, teacherMembershipId: me } }, select: { studentId: true } }) : [],
    tx.careerProfile.findMany({ where: { orgId, advisorId: me }, select: { studentId: true } }),
    tx.application.findMany({ where: { orgId, counselorId: me }, select: { studentId: true } }),
    tx.membershipRole.findMany({ where: { orgId, membershipId: me, role: { key: { in: ["counselor", "career_advisor"] } } }, select: { id: true } }),
    tx.staffProfile.findFirst({ where: { orgId, membershipId: me }, select: { gradeLevels: true } }),
    tx.courseSelectionHelper.findMany({ where: { orgId, helperId: me, kind: "STAFF", revokedAt: null, until: { gt: now } }, select: { studentId: true } }),
  ]);
  const ids = new Set([...taught, ...advised, ...apps, ...grants].map((r) => r.studentId));
  if (roles.length && staff?.gradeLevels.length) {
    for (const s of await tx.student.findMany({ where: { orgId, status: "ACTIVE", gradeLevel: { in: staff.gradeLevels } }, select: { id: true } })) ids.add(s.id);
  }
  return [...ids];
}

/** Guardians linked to the student who have a parent account (the only guardians who can ever be allowed). */
export async function guardianMembers(tx: Tx, orgId: string, studentId: string) {
  const links = await tx.guardianLink.findMany({ where: { orgId, studentId, guardian: { membershipId: { not: null } } }, include: { guardian: true }, orderBy: { isPrimary: "desc" } });
  const ids = links.map((l) => l.guardian.membershipId!);
  const active = new Set((await tx.membership.findMany({ where: { orgId, id: { in: ids }, status: "ACTIVE", roles: { some: { role: { key: "parent" } } } }, select: { id: true } })).map((m) => m.id));
  return links.filter((l) => active.has(l.guardian.membershipId!)).map((l) => ({ membershipId: l.guardian.membershipId!, guardian: l.guardian, canApprove: l.canApprove, receivesUpdates: l.receivesUpdates, isPrimary: l.isPrimary }));
}

/** Staff who may manage exceptions and assisted choosing for a student: admins, or responsible staff with registration.assist. */
export async function canAssist(tx: Tx, orgId: string, actor: SelectionActor, studentId: string) {
  if (!actor.isStaff) return false;
  if (actor.can("registration.manage")) return true;
  return actor.can("registration.assist") && (await isResponsible(tx, orgId, actor.membershipId, studentId));
}

// ---------------------------------------------------------------------------
// Can choices change right now?
// ---------------------------------------------------------------------------

export type EditAccess = {
  window: CourseSelectionWindow | null;
  state: WindowState | "none";
  exception: { id: string; until: Date } | null;
  session: (CourseSelectionSession & { className: { en: string; ar: string } }) | null;
  open: boolean;
  via: "window" | "exception" | "session" | null;
  /** When the current way in ends. */
  until: Date | null;
};

/** Whether the student's choices for a year can change now, and through what. Staff with registration.manage are not limited by this. */
export async function editAccess(tx: Tx, orgId: string, student: { id: string; gradeLevel: number }, yearId: string, now = new Date()): Promise<EditAccess> {
  const windows = await tx.courseSelectionWindow.findMany({ where: { orgId, academicYearId: yearId, gradeLevels: { has: student.gradeLevel } } });
  const window = pickWindow(windows, yearId, student.gradeLevel, now);
  const state: EditAccess["state"] = window ? windowState(window, now) : "none";
  const exceptions = await tx.courseSelectionException.findMany({ where: { orgId, studentId: student.id, academicYearId: yearId, revokedAt: null, until: { gt: now } }, orderBy: { until: "desc" } });
  const exception = exceptions.find((e) => activeUntil(e, now)) ?? null;
  const homeroom = await homeroomOf(tx, orgId, student.id);
  const sessions = homeroom ? await tx.courseSelectionSession.findMany({ where: { orgId, classId: homeroom.id, academicYearId: yearId, endedAt: null, endsAt: { gt: now }, startsAt: { lte: now } }, orderBy: { endsAt: "desc" } }) : [];
  const s = sessions[0] ?? null;
  const session = s && homeroom ? { ...s, className: { en: homeroom.nameEn, ar: homeroom.nameAr } } : null;
  const ends: Array<{ via: EditAccess["via"]; at: Date }> = [];
  if (window && state === "open") ends.push({ via: "window", at: window.closesAt });
  if (exception) ends.push({ via: "exception", at: exception.until });
  if (session) ends.push({ via: "session", at: session.endsAt });
  ends.sort((a, b) => b.at.getTime() - a.at.getTime());
  // The window wins when it is open (it is what students expect to see); otherwise the longest other way in.
  const best = ends.find((e) => e.via === "window") ?? ends[0] ?? null;
  return { window, state, exception: exception ? { id: exception.id, until: exception.until } : null, session, open: !!best, via: best?.via ?? null, until: best?.at ?? null };
}

// ---------------------------------------------------------------------------
// Assisted choosing
// ---------------------------------------------------------------------------

export async function activeHelpers(tx: Tx, orgId: string, studentId: string, now = new Date()) {
  return tx.courseSelectionHelper.findMany({ where: { orgId, studentId, revokedAt: null, until: { gt: now } }, orderBy: { createdAt: "asc" } });
}

export async function activeGrantFor(tx: Tx, orgId: string, studentId: string, helperId: string, now = new Date()) {
  return tx.courseSelectionHelper.findFirst({ where: { orgId, studentId, helperId, revokedAt: null, until: { gt: now } }, orderBy: { until: "desc" } });
}

export type WriterRole = "manager" | "student" | "parent" | "helper";
export type Writer = { role: WriterRole; grant: CourseSelectionHelper | null } | { role: null; reason: "FORBIDDEN" | "PARENT_SIGN_OFF_ONLY" | "PARENT_NOT_ALLOWED" };

/** Who the actor is when changing this student's choices, before any window rule. */
export async function writerFor(tx: Tx, orgId: string, actor: SelectionActor, studentId: string, now = new Date()): Promise<Writer> {
  if (actor.isStaff && actor.can("registration.manage")) return { role: "manager", grant: null };
  if (actor.isStudent) return actor.can("registration.submit") && actor.ownStudentId === studentId ? { role: "student", grant: null } : { role: null, reason: "FORBIDDEN" };
  if (actor.isParent) {
    if (!actor.can("registration.submit") || !actor.childIds.includes(studentId)) return { role: null, reason: "FORBIDDEN" };
    const settings = await getSelectionSettings(tx, orgId);
    if (settings.parentChoice === "ALWAYS") return { role: "parent", grant: null };
    if (settings.parentChoice === "NEVER") return { role: null, reason: "PARENT_SIGN_OFF_ONLY" };
    const grant = await activeGrantFor(tx, orgId, studentId, actor.membershipId, now);
    if (grant?.kind !== "GUARDIAN") return { role: null, reason: "PARENT_NOT_ALLOWED" };
    // The grant only counts while this guardian is still linked to the student with a parent account.
    if (!(await guardianMembers(tx, orgId, studentId)).some((g) => g.membershipId === actor.membershipId)) return { role: null, reason: "FORBIDDEN" };
    return { role: "helper", grant };
  }
  if (actor.isStaff && actor.can("registration.assist")) {
    const grant = await activeGrantFor(tx, orgId, studentId, actor.membershipId, now);
    if (grant?.kind === "STAFF") return { role: "helper", grant };
  }
  return { role: null, reason: "FORBIDDEN" };
}

export type GrantInput = { studentId: string; helperId: string; until?: Date | null; reason?: string | null; yearId?: string | null };
export type GrantError = "FORBIDDEN" | "NOT_FOUND" | "NOT_ALLOWED_HELPER" | "PARENTS_CANNOT_CHOOSE" | "PARENTS_ALWAYS" | "BAD_DATE" | "NO_WINDOW" | "SELF";

/** The default end of a helper grant: the close of the window that is open now or opens next. */
async function defaultUntil(tx: Tx, orgId: string, student: { id: string; gradeLevel: number }, now: Date): Promise<Date | null> {
  const current = await currentYear(tx, orgId);
  const next = await selectionYear(tx, orgId);
  const ids = [next?.id, current?.id].filter(Boolean) as string[];
  const windows = (await windowsForYears(tx, orgId, ids)).filter((w) => w.gradeLevels.includes(student.gradeLevel) && windowState(w, now) !== "closed");
  windows.sort((a, b) => a.opensAt.getTime() - b.opensAt.getTime());
  const open = windows.find((w) => windowState(w, now) === "open");
  return (open ?? windows[0])?.closesAt ?? null;
}

/**
 * Allow someone to choose for a student. The student may allow one of their own teachers, counselor or
 * advisor, or (when the school lets parents choose only when allowed) a linked guardian. Responsible
 * staff with registration.assist, and admins, may allow the same people, for example in KG to Grade 5.
 */
export async function grantHelper(tx: Tx, orgId: string, actor: SelectionActor, input: GrantInput, ec: ExecCtx): Promise<{ ok: true; id: string } | { ok: false; error: GrantError }> {
  const now = ec.now;
  const student = await tx.student.findFirst({ where: { orgId, id: input.studentId, status: "ACTIVE" } });
  if (!student) return { ok: false, error: "NOT_FOUND" };
  const byStudent = actor.isStudent && actor.ownStudentId === student.id && actor.can("registration.submit");
  if (!byStudent && !(await canAssist(tx, orgId, actor, student.id))) return { ok: false, error: "FORBIDDEN" };
  if (input.helperId === actor.membershipId && byStudent) return { ok: false, error: "SELF" };
  const settings = await getSelectionSettings(tx, orgId);
  const guardians = await guardianMembers(tx, orgId, student.id);
  let kind: "STAFF" | "GUARDIAN";
  if (guardians.some((g) => g.membershipId === input.helperId)) {
    if (settings.parentChoice === "NEVER") return { ok: false, error: "PARENTS_CANNOT_CHOOSE" };
    if (settings.parentChoice === "ALWAYS") return { ok: false, error: "PARENTS_ALWAYS" };
    kind = "GUARDIAN";
  } else {
    const responsible = await responsibleStaff(tx, orgId, student.id);
    const allowedStaff = responsible.map((r) => r.membershipId);
    // Staff may also name themselves when they can assist (an admin helping a student without a phone).
    if (!byStudent && input.helperId === actor.membershipId && actor.can("registration.assist")) allowedStaff.push(actor.membershipId);
    if (!allowedStaff.includes(input.helperId)) return { ok: false, error: "NOT_ALLOWED_HELPER" };
    if (!(await membersWith(tx, orgId, [input.helperId], "registration.assist")).has(input.helperId)) return { ok: false, error: "NOT_ALLOWED_HELPER" };
    kind = "STAFF";
  }
  const until = input.until ?? (await defaultUntil(tx, orgId, student, now));
  if (!until) return { ok: false, error: "NO_WINDOW" };
  if (until.getTime() <= now.getTime() || until.getTime() > now.getTime() + MAX_GRANT_DAYS * DAY) return { ok: false, error: "BAD_DATE" };
  const reason = input.reason?.trim().slice(0, 500) || null;
  // A new grant for the same helper replaces the old one (kept as history).
  await tx.courseSelectionHelper.updateMany({ where: { orgId, studentId: student.id, helperId: input.helperId, revokedAt: null }, data: { revokedAt: now, revokedById: actor.membershipId } });
  const row = await tx.courseSelectionHelper.create({ data: { orgId, studentId: student.id, helperId: input.helperId, kind, until, reason, grantedById: actor.membershipId, byStudent, createdAt: now } });
  await audit(tx, orgId, { ...auditActor(actor), action: "registration.helper_grant", entityType: "CourseSelectionHelper", entityId: row.id, reason, meta: { studentId: student.id, helperId: input.helperId, kind, until: until.toISOString(), byStudent } });

  // Tell people. The student allowing someone tells that person; staff allowing someone tells the
  // student, every guardian and the helper.
  await ensureSelectionTemplates(tx, orgId);
  const names = await memberNames(tx, orgId, [input.helperId, actor.membershipId]);
  const helperName = names.get(input.helperId) ?? { en: "", ar: "" };
  const studentName = { en: `${student.firstNameEn} ${student.lastNameEn}`, ar: `${student.firstNameAr} ${student.lastNameAr}` };
  const untilText = dateText(until);
  const href = kind === "STAFF" ? `/subjects/help` : `/subjects?student=${student.id}`;
  if (input.helperId !== actor.membershipId) {
    await notify(ec, { recipients: [input.helperId], templateKey: "course_selection_helper_asked", kind: "course_selection", vars: { student: studentName, by: byStudent ? studentName : (names.get(actor.membershipId) ?? studentName), until: untilText }, href, idempotencyBase: `cshelper:${row.id}:helper` });
  }
  if (!byStudent) {
    const told = [student.membershipId, ...guardians.map((g) => g.membershipId)].filter((id): id is string => !!id && id !== input.helperId && id !== actor.membershipId);
    await notify(ec, { recipients: told, templateKey: "course_selection_helper_on", kind: "course_selection", vars: { student: studentName, helper: helperName, until: untilText }, href: `/subjects?student=${student.id}`, idempotencyBase: `cshelper:${row.id}:family` });
  }
  return { ok: true, id: row.id };
}

/** End a helper grant now. The student, the helper, whoever granted it, admins and responsible staff may do it. */
export async function revokeHelper(tx: Tx, orgId: string, actor: SelectionActor, grantId: string, ec: ExecCtx) {
  const g = await tx.courseSelectionHelper.findFirst({ where: { orgId, id: grantId } });
  if (!g) return { ok: false as const, error: "NOT_FOUND" };
  if (g.revokedAt || g.until.getTime() <= ec.now.getTime()) return { ok: true as const };
  const allowed =
    (actor.isStudent && actor.ownStudentId === g.studentId) ||
    actor.membershipId === g.helperId ||
    actor.membershipId === g.grantedById ||
    (await canAssist(tx, orgId, actor, g.studentId));
  if (!allowed) return { ok: false as const, error: "FORBIDDEN" };
  await tx.courseSelectionHelper.update({ where: { id: g.id }, data: { revokedAt: ec.now, revokedById: actor.membershipId } });
  await audit(tx, orgId, { ...auditActor(actor), action: "registration.helper_revoke", entityType: "CourseSelectionHelper", entityId: g.id, meta: { studentId: g.studentId, helperId: g.helperId, kind: g.kind } });
  if (actor.membershipId !== g.helperId) {
    await ensureSelectionTemplates(tx, orgId);
    const student = await tx.student.findFirst({ where: { orgId, id: g.studentId } });
    if (student) await notify(ec, { recipients: [g.helperId], templateKey: "course_selection_helper_off", kind: "course_selection", vars: { student: { en: `${student.firstNameEn} ${student.lastNameEn}`, ar: `${student.firstNameAr} ${student.lastNameAr}` } }, href: null, idempotencyBase: `cshelper:${g.id}:revoked` });
  }
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// Exceptions
// ---------------------------------------------------------------------------

export async function grantException(tx: Tx, orgId: string, actor: SelectionActor, input: { studentId: string; yearId: string; until: Date; reason: string }, ec: ExecCtx) {
  const now = ec.now;
  const student = await tx.student.findFirst({ where: { orgId, id: input.studentId, status: "ACTIVE" } });
  if (!student) return { ok: false as const, error: "NOT_FOUND" };
  if (!(await canAssist(tx, orgId, actor, student.id))) return { ok: false as const, error: "FORBIDDEN" };
  const target = await registrationYear(tx, orgId, input.yearId);
  if (!target) return { ok: false as const, error: "NO_YEAR" };
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 500) return { ok: false as const, error: "REASON_REQUIRED" };
  if (input.until.getTime() <= now.getTime() || input.until.getTime() > now.getTime() + MAX_GRANT_DAYS * DAY) return { ok: false as const, error: "BAD_DATE" };
  await tx.courseSelectionException.updateMany({ where: { orgId, studentId: student.id, academicYearId: target.year.id, revokedAt: null }, data: { revokedAt: now, revokedById: actor.membershipId } });
  const row = await tx.courseSelectionException.create({ data: { orgId, studentId: student.id, academicYearId: target.year.id, until: input.until, reason, grantedById: actor.membershipId, createdAt: now } });
  await audit(tx, orgId, { ...auditActor(actor), action: "registration.exception_grant", entityType: "CourseSelectionException", entityId: row.id, reason, meta: { studentId: student.id, yearId: target.year.id, until: input.until.toISOString() } });
  await ensureSelectionTemplates(tx, orgId);
  const guardians = await guardianMembers(tx, orgId, student.id);
  await notify(ec, {
    recipients: [student.membershipId, ...guardians.map((g) => g.membershipId)].filter((x): x is string => !!x),
    templateKey: "course_selection_exception",
    kind: "course_selection",
    vars: { student: { en: `${student.firstNameEn} ${student.lastNameEn}`, ar: `${student.firstNameAr} ${student.lastNameAr}` }, until: dateText(input.until), year: { en: target.year.nameEn, ar: target.year.nameAr } },
    href: `/subjects?student=${student.id}${target.next ? "&year=next" : "&year=current"}`,
    idempotencyBase: `csexception:${row.id}`,
  });
  return { ok: true as const, id: row.id };
}

export async function revokeException(tx: Tx, orgId: string, actor: SelectionActor, id: string, now = new Date()) {
  const e = await tx.courseSelectionException.findFirst({ where: { orgId, id } });
  if (!e) return { ok: false as const, error: "NOT_FOUND" };
  if (!(await canAssist(tx, orgId, actor, e.studentId))) return { ok: false as const, error: "FORBIDDEN" };
  if (e.revokedAt) return { ok: true as const };
  await tx.courseSelectionException.update({ where: { id: e.id }, data: { revokedAt: now, revokedById: actor.membershipId } });
  await audit(tx, orgId, { ...auditActor(actor), action: "registration.exception_revoke", entityType: "CourseSelectionException", entityId: e.id, meta: { studentId: e.studentId } });
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// Class choosing sessions
// ---------------------------------------------------------------------------

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function sessionCode() {
  let s = "";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  for (const b of bytes) s += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return s;
}

/** Homeroom classes this member may open a session for: their own homerooms, or every homeroom for admins. */
export async function sessionClasses(tx: Tx, orgId: string, actor: SelectionActor) {
  const year = await currentYear(tx, orgId);
  if (!year || !actor.isStaff) return [];
  const manager = actor.can("registration.manage");
  if (!manager && !actor.can("registration.assist")) return [];
  return tx.schoolClass.findMany({ where: { orgId, academicYearId: year.id, isHomeroom: true, ...(manager ? {} : { teacherMembershipId: actor.membershipId }) }, orderBy: [{ gradeLevel: "asc" }, { section: "asc" }] });
}

/** The year a class session chooses for: next year when its offerings exist for the class's grade, else this year. */
export async function sessionYearFor(tx: Tx, orgId: string, gradeLevel: number) {
  const next = await selectionYear(tx, orgId);
  if (next && (await tx.subjectOffering.count({ where: { orgId, academicYearId: next.id, gradeLevel: gradeLevel + 1 } }))) return next;
  return currentYear(tx, orgId);
}

export async function startSession(tx: Tx, orgId: string, actor: SelectionActor, input: { classId: string; minutes: number; yearId?: string | null }, now = new Date()) {
  if (!(SESSION_MINUTES as readonly number[]).includes(input.minutes)) return { ok: false as const, error: "INVALID" };
  const classes = await sessionClasses(tx, orgId, actor);
  const cls = classes.find((c) => c.id === input.classId);
  if (!cls) return { ok: false as const, error: "FORBIDDEN" };
  const year = input.yearId ? (await registrationYear(tx, orgId, input.yearId))?.year : await sessionYearFor(tx, orgId, cls.gradeLevel);
  if (!year) return { ok: false as const, error: "NO_YEAR" };
  // One session per class at a time: a new one replaces any that is still running.
  await tx.courseSelectionSession.updateMany({ where: { orgId, classId: cls.id, endedAt: null, endsAt: { gt: now } }, data: { endedAt: now, endedById: actor.membershipId } });
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = sessionCode();
    if (await tx.courseSelectionSession.findFirst({ where: { orgId, code }, select: { id: true } })) continue;
    const row = await tx.courseSelectionSession.create({ data: { orgId, classId: cls.id, academicYearId: year.id, code, startsAt: now, endsAt: new Date(now.getTime() + input.minutes * 60_000), startedById: actor.membershipId, createdAt: now } });
    await audit(tx, orgId, { ...auditActor(actor), action: "registration.session_start", entityType: "CourseSelectionSession", entityId: row.id, meta: { classId: cls.id, yearId: year.id, minutes: input.minutes, endsAt: row.endsAt.toISOString() } });
    return { ok: true as const, id: row.id, code };
  }
  return { ok: false as const, error: "INVALID" };
}

export async function endSession(tx: Tx, orgId: string, actor: SelectionActor, sessionId: string, now = new Date()) {
  const s = await tx.courseSelectionSession.findFirst({ where: { orgId, id: sessionId } });
  if (!s) return { ok: false as const, error: "NOT_FOUND" };
  const classes = await sessionClasses(tx, orgId, actor);
  if (!classes.some((c) => c.id === s.classId)) return { ok: false as const, error: "FORBIDDEN" };
  if (s.endedAt || s.endsAt.getTime() <= now.getTime()) return { ok: true as const };
  await tx.courseSelectionSession.update({ where: { id: s.id }, data: { endedAt: now, endedById: actor.membershipId } });
  await audit(tx, orgId, { ...auditActor(actor), action: "registration.session_end", entityType: "CourseSelectionSession", entityId: s.id, meta: { classId: s.classId, early: true } });
  return { ok: true as const };
}

export function sessionActive(s: Pick<CourseSelectionSession, "startsAt" | "endsAt" | "endedAt">, now: Date) {
  return activeUntil({ startsAt: s.startsAt, endsAt: s.endsAt, endedAt: s.endedAt }, now);
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export type ProgressStatus = "not_started" | "in_progress" | "submitted" | "signed_off";

export function statusOf(sub: Pick<CourseSelectionSubmission, "status"> | null | undefined, chosenBlocks: number, totalBlocks: number): ProgressStatus {
  if (sub?.status === "SIGNED_OFF") return "signed_off";
  if (sub?.status === "SUBMITTED") return "submitted";
  if (sub?.status === "DRAFT") return chosenBlocks > 0 ? "in_progress" : "not_started";
  // Choices from before submissions were recorded (imports, earlier registration): complete counts as submitted.
  if (chosenBlocks === 0) return "not_started";
  return chosenBlocks >= totalBlocks ? "submitted" : "in_progress";
}

export type ProgressRow = {
  studentId: string;
  status: ProgressStatus;
  chosen: number;
  blocks: number;
  submission: CourseSelectionSubmission | null;
};

/**
 * Progress for students choosing in a year. Students whose grade (plus one for next year) has no
 * offerings on their track have nothing to choose and are left out.
 */
export async function progressFor(tx: Tx, orgId: string, yearId: string, students: Array<{ id: string; gradeLevel: number; curriculum: SchoolCurriculum }>): Promise<Map<string, ProgressRow>> {
  const target = await registrationYear(tx, orgId, yearId);
  const out = new Map<string, ProgressRow>();
  if (!target || !students.length) return out;
  const offerings = await tx.subjectOffering.findMany({ where: { orgId, academicYearId: yearId }, select: { subjectId: true, gradeLevel: true, kind: true, optionBlock: true, curriculum: true } });
  const ids = students.map((s) => s.id);
  const [regs, subs] = await Promise.all([
    tx.subjectRegistration.findMany({ where: { orgId, academicYearId: yearId, studentId: { in: ids }, status: { in: [...ACTIVE_REG] } }, select: { studentId: true, subjectId: true } }),
    tx.courseSelectionSubmission.findMany({ where: { orgId, academicYearId: yearId, studentId: { in: ids } } }),
  ]);
  const regsBy = new Map<string, Set<string>>();
  for (const r of regs) regsBy.set(r.studentId, new Set([...(regsBy.get(r.studentId) ?? []), r.subjectId]));
  const subBy = new Map(subs.map((s) => [s.studentId, s]));
  for (const s of students) {
    const grade = s.gradeLevel + target.gradeOffset;
    const mine = offerings.filter((o) => o.gradeLevel === grade && (o.curriculum === null || o.curriculum === s.curriculum));
    if (!mine.length) continue;
    const blocks = blocksOf(mine.map((o) => ({ subjectId: o.subjectId, code: o.subjectId, kind: o.kind, optionBlock: o.optionBlock, prerequisites: [] })));
    const have = regsBy.get(s.id) ?? new Set<string>();
    const chosen = blocks.filter((b) => b.options.some((o) => have.has(o.subjectId))).length;
    const sub = subBy.get(s.id) ?? null;
    out.set(s.id, { studentId: s.id, status: statusOf(sub, chosen, blocks.length), chosen, blocks: blocks.length, submission: sub });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Submitting and signing off
// ---------------------------------------------------------------------------

export type SubmitError = "NO_YEAR" | "NOT_FOUND" | "NO_OFFERINGS" | "INVALID" | "CLOSED" | "FORBIDDEN" | "PARENT_SIGN_OFF_ONLY" | "PARENT_NOT_ALLOWED" | "DRAFT_THIS_YEAR";
export type SubmitResult = { ok: true; summary: AllocationSummary; status: CourseSelectionSubmission["status"]; changed: number } | { ok: false; error: SubmitError; errors?: ChoiceError[] };

/**
 * Save a student's choices. final: submit (every block chosen); otherwise save progress (next year only).
 * Students, parents and helpers need an open window, an active exception or an active class session.
 * Staff with registration.manage can always change choices; after closing, the change is labelled.
 */
export async function submitChoices(tx: Tx, orgId: string, actor: SelectionActor, input: { studentId: string; optionSubjectIds: string[]; yearId?: string | null; final?: boolean }, ec: ExecCtx): Promise<SubmitResult> {
  const now = ec.now;
  const final = input.final !== false;
  const target = await registrationYear(tx, orgId, input.yearId);
  if (!target) return { ok: false, error: "NO_YEAR" };
  if (!final && !target.next) return { ok: false, error: "DRAFT_THIS_YEAR" };
  const student = await tx.student.findFirst({ where: { orgId, id: input.studentId } });
  if (!student) return { ok: false, error: "NOT_FOUND" };
  const writer = await writerFor(tx, orgId, actor, student.id, now);
  if (!writer.role) return { ok: false, error: writer.reason };
  const access = await editAccess(tx, orgId, student, target.year.id, now);
  if (writer.role !== "manager" && !access.open) return { ok: false, error: "CLOSED" };
  const afterClose = writer.role === "manager" && !access.open && access.state === "closed";
  const source: RegistrationSource = writer.role === "student" ? "STUDENT" : writer.role === "parent" ? "PARENT" : writer.role === "helper" ? (writer.grant?.kind === "GUARDIAN" ? "PARENT" : "STAFF") : "STAFF";
  const res = await saveRegistration(tx, orgId, { studentId: student.id, optionSubjectIds: input.optionSubjectIds, source, actorId: actor.membershipId, academicYearId: target.year.id, requireAllBlocks: final, now });
  if (!res.ok) return { ok: false, error: res.error, errors: res.errors };

  const settings = await getSelectionSettings(tx, orgId);
  const before = await tx.courseSelectionSubmission.findUnique({ where: { academicYearId_studentId: { academicYearId: target.year.id, studentId: student.id } } });
  const byParent = source === "PARENT";
  const onBehalf = writer.role !== "student";
  let status: CourseSelectionSubmission["status"];
  if (!final) status = "DRAFT";
  else if (res.changed === 0 && before && before.status !== "DRAFT") status = before.status;
  else status = settings.signOffRequired && byParent && settings.parentChoiceSignsOff ? "SIGNED_OFF" : "SUBMITTED";
  const unchanged = res.changed === 0 && before?.status === status;
  if (!unchanged) {
    const signed = status === "SIGNED_OFF" && !(before?.status === "SIGNED_OFF" && res.changed === 0);
    const data = {
      status,
      lastById: actor.membershipId,
      lastSource: source,
      onBehalf,
      afterClose,
      lastAt: now,
      submittedAt: final ? now : null,
      ...(status === "SIGNED_OFF" ? (signed ? { signedOffAt: now, signedOffById: actor.membershipId } : {}) : { signedOffAt: null, signedOffById: null }),
    };
    await tx.courseSelectionSubmission.upsert({
      where: { academicYearId_studentId: { academicYearId: target.year.id, studentId: student.id } },
      create: { orgId, academicYearId: target.year.id, studentId: student.id, ...data, createdAt: now },
      update: data,
    });
  }
  await audit(tx, orgId, {
    ...auditActor(actor),
    action: target.next ? "registration.select_next_year" : "registration.submit",
    entityType: "Student",
    entityId: student.id,
    meta: { source, writer: writer.role, helperGrantId: writer.grant?.id ?? null, via: access.via, afterClose, final, status, yearId: target.year.id, options: input.optionSubjectIds.length, changed: res.changed, ...res.summary },
  });

  if (!unchanged && final) {
    await ensureSelectionTemplates(tx, orgId);
    const guardians = await guardianMembers(tx, orgId, student.id);
    const studentName = { en: `${student.firstNameEn} ${student.lastNameEn}`, ar: `${student.firstNameAr} ${student.lastNameAr}` };
    const by = (await memberNames(tx, orgId, [actor.membershipId])).get(actor.membershipId) ?? studentName;
    const href = `/subjects?student=${student.id}&year=${target.next ? "next" : "current"}`;
    const key = `cssubmit:${student.id}:${target.year.id}:${now.getTime()}`;
    if (onBehalf) {
      await notify(ec, {
        recipients: [student.membershipId, ...guardians.map((g) => g.membershipId)].filter((x): x is string => !!x && x !== actor.membershipId),
        templateKey: "course_selection_chosen_for",
        kind: "course_selection",
        vars: { student: studentName, by, year: { en: target.year.nameEn, ar: target.year.nameAr } },
        href,
        idempotencyBase: `${key}:onbehalf`,
      });
    }
    if (status === "SUBMITTED" && settings.signOffRequired) {
      // Who can confirm: the guardians (not the one who chose), or the student when a parent chose.
      const confirmers = guardians.filter((g) => g.canApprove && g.membershipId !== actor.membershipId).map((g) => g.membershipId);
      if (byParent && student.membershipId) confirmers.push(student.membershipId);
      await notify(ec, { recipients: confirmers, templateKey: "course_selection_sign_off", kind: "course_selection", vars: { student: studentName, year: { en: target.year.nameEn, ar: target.year.nameAr } }, href, idempotencyBase: `${key}:signoff` });
    }
  }
  return { ok: true, summary: res.summary, status, changed: res.changed };
}

export type SignOffError = "NOT_REQUIRED" | "NOTHING_TO_SIGN" | "FORBIDDEN" | "SAME_PARENT";

/** Who may confirm submitted choices: a linked guardian who did not make them, or the student when a parent did. */
export async function canSignOff(tx: Tx, orgId: string, actor: SelectionActor, studentId: string, sub: Pick<CourseSelectionSubmission, "lastById" | "lastSource"> | null): Promise<true | SignOffError> {
  if (actor.isParent && actor.childIds.includes(studentId) && actor.can("registration.submit")) {
    const g = (await guardianMembers(tx, orgId, studentId)).find((x) => x.membershipId === actor.membershipId);
    if (!g?.canApprove) return "FORBIDDEN";
    if (sub?.lastSource === "PARENT" && sub.lastById === actor.membershipId) return "SAME_PARENT";
    return true;
  }
  if (actor.isStudent && actor.ownStudentId === studentId) return sub?.lastSource === "PARENT" ? true : "FORBIDDEN";
  return "FORBIDDEN";
}

export async function signOffChoices(tx: Tx, orgId: string, actor: SelectionActor, input: { studentId: string; yearId: string }, ec: ExecCtx): Promise<{ ok: true } | { ok: false; error: SignOffError }> {
  const settings = await getSelectionSettings(tx, orgId);
  if (!settings.signOffRequired) return { ok: false, error: "NOT_REQUIRED" };
  const sub = await tx.courseSelectionSubmission.findFirst({ where: { orgId, studentId: input.studentId, academicYearId: input.yearId } });
  if (!sub || sub.status !== "SUBMITTED") return { ok: false, error: "NOTHING_TO_SIGN" };
  const allowed = await canSignOff(tx, orgId, actor, input.studentId, sub);
  if (allowed !== true) return { ok: false, error: allowed };
  await tx.courseSelectionSubmission.update({ where: { id: sub.id }, data: { status: "SIGNED_OFF", signedOffAt: ec.now, signedOffById: actor.membershipId } });
  await audit(tx, orgId, { ...auditActor(actor), action: "registration.sign_off", entityType: "Student", entityId: input.studentId, meta: { yearId: input.yearId, submissionId: sub.id } });
  const student = await tx.student.findFirst({ where: { orgId, id: input.studentId } });
  if (student) {
    await ensureSelectionTemplates(tx, orgId);
    const guardians = await guardianMembers(tx, orgId, student.id);
    const by = (await memberNames(tx, orgId, [actor.membershipId])).get(actor.membershipId) ?? { en: "", ar: "" };
    await notify(ec, {
      recipients: [student.membershipId, ...guardians.map((g) => g.membershipId), sub.lastById].filter((x): x is string => !!x && x !== actor.membershipId),
      templateKey: "course_selection_signed_off",
      kind: "course_selection",
      vars: { student: { en: `${student.firstNameEn} ${student.lastNameEn}`, ar: `${student.firstNameAr} ${student.lastNameAr}` }, by },
      href: `/subjects?student=${student.id}`,
      idempotencyBase: `cssignoff:${sub.id}:${ec.now.getTime()}`,
    });
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Display names of members in both languages (students and guardians by their record, staff by their user). */
export async function memberNames(tx: Tx, orgId: string, ids: string[]): Promise<Map<string, { en: string; ar: string }>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const rows = await tx.membership.findMany({ where: { orgId, id: { in: unique } }, include: { user: { select: { nameEn: true, nameAr: true } }, student: true, guardian: true } });
  const out = new Map<string, { en: string; ar: string }>();
  for (const m of rows) {
    const p = m.student ?? m.guardian;
    out.set(m.id, p ? { en: `${p.firstNameEn} ${p.lastNameEn}`, ar: `${p.firstNameAr} ${p.lastNameAr}` } : { en: m.user.nameEn, ar: m.user.nameAr || m.user.nameEn });
  }
  return out;
}

const AR_MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const EN_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** A date and time in Dubai for notification text, for example "3 November, 15:00". */
export function dateText(d: Date): { en: string; ar: string } {
  const local = new Date(d.getTime() + 4 * 3_600_000);
  const day = local.getUTCDate();
  const month = local.getUTCMonth();
  const hh = String(local.getUTCHours()).padStart(2, "0");
  const mm = String(local.getUTCMinutes()).padStart(2, "0");
  return { en: `${day} ${EN_MONTHS[month]}, ${hh}:${mm}`, ar: `${day} ${AR_MONTHS[month]}، الساعة ${hh}:${mm}` };
}

/** Students in a window's grades, active, with what they need for progress and notices. */
export async function windowCohort(tx: Tx, orgId: string, w: Pick<CourseSelectionWindow, "academicYearId" | "gradeLevels">) {
  const students = await tx.student.findMany({ where: { orgId, status: "ACTIVE", gradeLevel: { in: w.gradeLevels } }, select: { id: true, gradeLevel: true, curriculum: true, membershipId: true, firstNameEn: true, lastNameEn: true, firstNameAr: true, lastNameAr: true, studentNo: true, section: true } });
  const progress = await progressFor(tx, orgId, w.academicYearId, students);
  return students.filter((s) => progress.has(s.id)).map((s) => ({ ...s, progress: progress.get(s.id)! }));
}

/** For tests and seeds: offerings for a student and year exist. */
export async function hasOfferings(tx: Tx, orgId: string, student: { gradeLevel: number; curriculum: SchoolCurriculum }, yearId: string) {
  const target = await registrationYear(tx, orgId, yearId);
  if (!target) return false;
  return (await offeringsFor(tx, orgId, yearId, student.gradeLevel + target.gradeOffset, student.curriculum)).length > 0;
}
