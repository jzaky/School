// Re-enrollment for next year: the school opens a window, families confirm per child whether they return (or leave,
// with a reason), staff follow the answers on a dashboard, and families who have not answered get reminders.
// Reminders are idempotent: each (window, parent, round) is claimed once in the JobRun ledger, so running the
// daily job or pressing "Send reminders" twice never sends twice. A "leaving" answer creates a planned withdrawal.
import { Prisma } from "@prisma/client";
import type { ExecCtx, Tx } from "@/server/db";
import { audit } from "@/server/audit/audit";
import { notify } from "@/server/notify/notify";
import { MAX_GRADE_LEVEL } from "@/lib/grade-levels";
import { AdmissionError } from "./access";
import { LEAVING_REASONS } from "./config";
import { dateBoth } from "./labels";
import type { Actor } from "./service";
import { ensureAdmissionSetup } from "./templates";
import { cancelWithdrawal, planWithdrawal } from "./withdrawals";
import { rawQuery } from "./sql";

export const LEDGER_QUEUE = "admissions";

export type WindowState = "scheduled" | "open" | "closed";
export function windowState(w: { opensAt: Date; closesAt: Date; closedAt: Date | null }, now: Date): WindowState {
  if (w.closedAt || w.closesAt.getTime() < now.getTime()) return "closed";
  if (w.opensAt.getTime() > now.getTime()) return "scheduled";
  return "open";
}

/** Students asked to confirm: active students below the final grade (Grade 12 students graduate). */
export const eligibleWhere = (orgId: string): Prisma.StudentWhereInput => ({ orgId, status: "ACTIVE", gradeLevel: { lt: MAX_GRADE_LEVEL } });

export async function openWindow(ec: ExecCtx, actor: Actor, input: { academicYearId: string; opensAt: Date; closesAt: Date; messageEn: string | null; messageAr: string | null; reminderDays: number[] }) {
  const { tx, orgId, now } = ec;
  const year = await tx.academicYear.findFirst({ where: { id: input.academicYearId, orgId, isCurrent: false } });
  const current = await tx.academicYear.findFirst({ where: { orgId, isCurrent: true } });
  if (!year || (current && year.startsOn.getTime() <= current.startsOn.getTime())) throw new AdmissionError("YEAR");
  if (!(input.closesAt.getTime() > input.opensAt.getTime()) || input.closesAt.getTime() <= now.getTime()) throw new AdmissionError("DATES");
  const existing = await tx.reenrollmentWindow.findFirst({ where: { orgId, academicYearId: year.id, closedAt: null, closesAt: { gt: now } } });
  if (existing) throw new AdmissionError("WINDOW_EXISTS");
  const days = [...new Set(input.reminderDays.filter((d) => Number.isInteger(d) && d >= 1 && d <= 30))].sort((a, b) => b - a).slice(0, 4);
  const w = await tx.reenrollmentWindow.create({
    data: { orgId, academicYearId: year.id, opensAt: input.opensAt, closesAt: input.closesAt, messageEn: (input.messageEn ?? "").trim().slice(0, 1000) || null, messageAr: (input.messageAr ?? "").trim().slice(0, 1000) || null, reminderDays: days, createdById: actor.membershipId, createdAt: now },
  });
  await audit(tx, orgId, { actorId: actor.membershipId, actorUserId: actor.userId, action: "reenrollment.open", entityType: "ReenrollmentWindow", entityId: w.id, meta: { opensAt: w.opensAt.toISOString(), closesAt: w.closesAt.toISOString() } });
  if (windowState(w, now) === "open") await sendWindowNotices(ec, w.id, "open");
  return w;
}

export async function updateWindow(ec: ExecCtx, actor: Actor, id: string, input: { closesAt?: Date; close?: boolean }) {
  const { tx, orgId, now } = ec;
  const w = await tx.reenrollmentWindow.findFirst({ where: { id, orgId } });
  if (!w) throw new AdmissionError("NOT_FOUND");
  if (w.closedAt) throw new AdmissionError("CLOSED");
  if (input.closesAt && (input.closesAt.getTime() <= now.getTime() || input.closesAt.getTime() <= w.opensAt.getTime())) throw new AdmissionError("DATES");
  const data = { ...(input.closesAt ? { closesAt: input.closesAt } : {}), ...(input.close ? { closedAt: now } : {}) };
  await tx.reenrollmentWindow.update({ where: { id: w.id }, data });
  await audit(tx, orgId, { actorId: actor.membershipId, actorUserId: actor.userId, action: input.close ? "reenrollment.close" : "reenrollment.extend", entityType: "ReenrollmentWindow", entityId: w.id, meta: { before: w.closesAt.toISOString(), after: (input.closesAt ?? w.closesAt).toISOString() } });
}

export type Respondent = { membershipId: string; userId: string; staff: boolean };

/** A family's (or staff on the family's behalf) answer for one child. Parents may only answer for their own children. */
export async function respond(ec: ExecCtx, who: Respondent, input: { windowId: string; studentId: string; intent: "RETURNING" | "LEAVING"; reasonKey: string | null; reasonNote: string | null; leavingDate: Date | null }) {
  const { tx, orgId, now } = ec;
  const w = await tx.reenrollmentWindow.findFirst({ where: { id: input.windowId, orgId } });
  if (!w) throw new AdmissionError("NOT_FOUND");
  const state = windowState(w, now);
  if (state === "closed" || (state === "scheduled" && !who.staff)) throw new AdmissionError("WINDOW_CLOSED");
  const student = await tx.student.findFirst({ where: { ...eligibleWhere(orgId), id: input.studentId } });
  if (!student) throw new AdmissionError("NOT_ELIGIBLE");
  if (!who.staff) {
    const link = await tx.guardianLink.findFirst({ where: { orgId, studentId: student.id, guardian: { membershipId: who.membershipId } } });
    if (!link) throw new AdmissionError("FORBIDDEN");
  }
  if (input.intent === "LEAVING" && !(LEAVING_REASONS as readonly string[]).includes(input.reasonKey ?? "")) throw new AdmissionError("REASON");
  const before = await tx.reenrollmentResponse.findUnique({ where: { windowId_studentId: { windowId: w.id, studentId: student.id } } });
  const row = await tx.reenrollmentResponse.upsert({
    where: { windowId_studentId: { windowId: w.id, studentId: student.id } },
    create: { orgId, windowId: w.id, studentId: student.id, intent: input.intent, reasonKey: input.intent === "LEAVING" ? input.reasonKey : null, reasonNote: (input.reasonNote ?? "").trim().slice(0, 500) || null, leavingDate: input.leavingDate, respondedById: who.membershipId, respondedAt: now },
    update: { intent: input.intent, reasonKey: input.intent === "LEAVING" ? input.reasonKey : null, reasonNote: (input.reasonNote ?? "").trim().slice(0, 500) || null, leavingDate: input.leavingDate, respondedById: who.membershipId, respondedAt: now },
  });
  const actor = { membershipId: who.membershipId, userId: who.userId };
  // Leavers flow into the withdrawal process; changing the answer back cancels the planned withdrawal.
  if (input.intent === "LEAVING" && !row.withdrawalId) {
    const current = await tx.academicYear.findFirst({ where: { orgId, isCurrent: true } });
    const leaving = input.leavingDate ?? current?.endsOn ?? w.closesAt;
    const existing = await tx.studentWithdrawal.findFirst({ where: { orgId, studentId: student.id, status: "PLANNED" } });
    const wd = existing ?? (await planWithdrawal(ec, actor, { studentId: student.id, leavingDate: leaving, reasonKey: input.reasonKey!, reasonNote: input.reasonNote, destination: null }, { source: "REENROLLMENT" }));
    await tx.reenrollmentResponse.update({ where: { id: row.id }, data: { withdrawalId: wd.id } });
  } else if (input.intent === "RETURNING" && row.withdrawalId) {
    const wd = await tx.studentWithdrawal.findFirst({ where: { id: row.withdrawalId, orgId } });
    if (wd?.status === "PLANNED" && wd.source === "REENROLLMENT") await cancelWithdrawal(ec, actor, wd.id);
    await tx.reenrollmentResponse.update({ where: { id: row.id }, data: { withdrawalId: null } });
  }
  await audit(tx, orgId, { actorId: who.membershipId, actorUserId: who.userId, action: "reenrollment.respond", entityType: "Student", entityId: student.id, meta: { windowId: w.id, intent: input.intent, before: before?.intent ?? null, onBehalf: who.staff } });
  return row;
}

/** Guardians (members) of eligible students who have not answered yet. */
async function nonResponderGuardians(tx: Tx, orgId: string, windowId: string) {
  const rows = await rawQuery<Array<{ membershipId: string }>>(tx, orgId, Prisma.sql`
    SELECT DISTINCT g."membershipId" AS "membershipId"
    FROM "Student" s
    JOIN "GuardianLink" l ON l."studentId" = s.id AND l."receivesUpdates" = true
    JOIN "Guardian" g ON g.id = l."guardianId" AND g."membershipId" IS NOT NULL
    JOIN "Membership" m ON m.id = g."membershipId" AND m.status = 'ACTIVE'
    WHERE s."orgId" = ${orgId} AND s.status = 'ACTIVE' AND s."gradeLevel" < ${MAX_GRADE_LEVEL}
      AND NOT EXISTS (SELECT 1 FROM "ReenrollmentResponse" r WHERE r."windowId" = ${windowId} AND r."studentId" = s.id)`);
  return rows.map((r) => r.membershipId);
}

async function allEligibleGuardians(tx: Tx, orgId: string) {
  const rows = await rawQuery<Array<{ membershipId: string }>>(tx, orgId, Prisma.sql`
    SELECT DISTINCT g."membershipId" AS "membershipId"
    FROM "Student" s
    JOIN "GuardianLink" l ON l."studentId" = s.id AND l."receivesUpdates" = true
    JOIN "Guardian" g ON g.id = l."guardianId" AND g."membershipId" IS NOT NULL
    JOIN "Membership" m ON m.id = g."membershipId" AND m.status = 'ACTIVE'
    WHERE s."orgId" = ${orgId} AND s.status = 'ACTIVE' AND s."gradeLevel" < ${MAX_GRADE_LEVEL}`);
  return rows.map((r) => r.membershipId);
}

/**
 * "open": tell every family the window is open. Otherwise a reminder round to families who have not answered.
 * Each parent is claimed once per (window, round) in the JobRun ledger; returns how many were notified this time.
 */
export async function sendWindowNotices(ec: ExecCtx, windowId: string, round: string): Promise<number> {
  const { tx, orgId, now } = ec;
  const w = await tx.reenrollmentWindow.findFirst({ where: { id: windowId, orgId } });
  if (!w || windowState(w, now) !== "open") return 0;
  await ensureAdmissionSetup(tx, orgId);
  const year = await tx.academicYear.findUnique({ where: { id: w.academicYearId }, select: { nameEn: true, nameAr: true } });
  const recipients = round === "open" ? await allEligibleGuardians(tx, orgId) : await nonResponderGuardians(tx, orgId, w.id);
  let sent = 0;
  for (const membershipId of recipients) {
    const key = `reenrol:${w.id}:${round}:${membershipId}`;
    const claim = await tx.jobRun.createMany({ data: [{ orgId, queue: LEDGER_QUEUE, name: round === "open" ? "reenrollment.open" : "reenrollment.reminder", idempotencyKey: key, status: "COMPLETED", finishedAt: now }], skipDuplicates: true });
    if (claim.count !== 1) continue;
    await notify(ec, {
      recipients: [membershipId],
      templateKey: round === "open" ? "reenrollment_open" : "reenrollment_reminder",
      kind: round === "open" ? "reenrollment_open" : "reenrollment_reminder",
      vars: { year: { en: year?.nameEn ?? "", ar: year?.nameAr ?? "" }, closes: dateBoth(w.closesAt) },
      href: "/reenrollment",
      channels: ["IN_APP", "EMAIL"],
      idempotencyBase: key,
    });
    sent++;
  }
  return sent;
}

/** Manual "Send reminders now": one round per day, so pressing it twice the same day sends nothing new. */
export async function sendRemindersNow(ec: ExecCtx, actor: Actor, windowId: string) {
  const sent = await sendWindowNotices(ec, windowId, `manual-${ec.now.toISOString().slice(0, 10)}`);
  await audit(ec.tx, ec.orgId, { actorId: actor.membershipId, actorUserId: actor.userId, action: "reenrollment.remind", entityType: "ReenrollmentWindow", entityId: windowId, meta: { sent } });
  return sent;
}

/** Per-grade answers for a window, as SQL aggregates (grade is this year's grade). */
export async function windowSummary(tx: Tx, orgId: string, windowId: string) {
  const rows = await rawQuery<Array<{ grade: number; eligible: bigint; returning: bigint; leaving: bigint }>>(tx, orgId, Prisma.sql`
    SELECT s."gradeLevel" AS grade,
           count(*) AS eligible,
           count(*) FILTER (WHERE r.intent = 'RETURNING') AS returning,
           count(*) FILTER (WHERE r.intent = 'LEAVING') AS leaving
    FROM "Student" s
    LEFT JOIN "ReenrollmentResponse" r ON r."studentId" = s.id AND r."windowId" = ${windowId}
    WHERE s."orgId" = ${orgId} AND s.status = 'ACTIVE' AND s."gradeLevel" < ${MAX_GRADE_LEVEL}
    GROUP BY s."gradeLevel" ORDER BY s."gradeLevel"`);
  return rows.map((r) => ({ grade: r.grade, eligible: Number(r.eligible), returning: Number(r.returning), leaving: Number(r.leaving), pending: Number(r.eligible) - Number(r.returning) - Number(r.leaving) }));
}

/** Leaving reasons for a window (counts only). */
export async function leavingReasons(tx: Tx, orgId: string, windowId: string) {
  const rows = await tx.reenrollmentResponse.groupBy({ by: ["reasonKey"], where: { orgId, windowId, intent: "LEAVING" }, _count: { _all: true } });
  return rows.map((r) => ({ reason: r.reasonKey ?? "other", n: r._count._all })).sort((a, b) => b.n - a.n);
}

export type ResponseFilter = "pending" | "returning" | "leaving" | "all";

/** Students and their answers for a window, one page at a time. */
export async function windowStudents(tx: Tx, orgId: string, windowId: string, filter: ResponseFilter, opts: { grade: number | null; q: string | null; page: number; perPage: number }) {
  const where: Prisma.StudentWhereInput = {
    ...eligibleWhere(orgId),
    ...(opts.grade !== null ? { gradeLevel: opts.grade } : {}),
    ...(opts.q ? { OR: [{ firstNameEn: { contains: opts.q, mode: "insensitive" } }, { lastNameEn: { contains: opts.q, mode: "insensitive" } }, { firstNameAr: { contains: opts.q } }, { lastNameAr: { contains: opts.q } }, { studentNo: { contains: opts.q, mode: "insensitive" } }] } : {}),
    ...(filter === "pending" ? { NOT: { id: { in: (await tx.reenrollmentResponse.findMany({ where: { orgId, windowId }, select: { studentId: true } })).map((r) => r.studentId) } } } : {}),
  };
  if (filter === "returning" || filter === "leaving") {
    const ids = (await tx.reenrollmentResponse.findMany({ where: { orgId, windowId, intent: filter === "returning" ? "RETURNING" : "LEAVING" }, select: { studentId: true } })).map((r) => r.studentId);
    where.id = { in: ids };
  }
  const [total, students] = await Promise.all([
    tx.student.count({ where }),
    tx.student.findMany({ where, orderBy: [{ gradeLevel: "asc" }, { section: "asc" }, { lastNameEn: "asc" }], skip: (opts.page - 1) * opts.perPage, take: opts.perPage, select: { id: true, studentNo: true, firstNameEn: true, lastNameEn: true, firstNameAr: true, lastNameAr: true, gradeLevel: true, section: true } }),
  ]);
  const responses = await tx.reenrollmentResponse.findMany({ where: { orgId, windowId, studentId: { in: students.map((s) => s.id) } } });
  return { total, rows: students.map((s) => ({ ...s, response: responses.find((r) => r.studentId === s.id) ?? null })) };
}
