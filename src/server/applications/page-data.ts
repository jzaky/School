import "server-only";
import type { Prisma } from "@prisma/client";
import type { Ctx } from "@/server/context";
import type { FormatPrefs } from "@/lib/format";
import { fmtDate } from "@/lib/format";
import { tenantTx } from "@/lib/tenant-db";
import { personName, pick, userName } from "@/lib/i18n-data";
import { deadlinesFor } from "./service";
import { isSubmissionKind, urgencyFor, type ResolvedDeadline } from "./deadlines";
import { itemComplete, type Urgency } from "./types";

export type DeadlineView = { kind: string; date: string; iso: string; source: string; confirm: boolean; bucket: Urgency; days: number | null };

export type AppCard = {
  id: string;
  studentId: string;
  studentName: string;
  grade: number;
  university: string;
  program: string | null;
  countryCode: string;
  route: string;
  stage: string;
  intakeYear: number;
  counselorId: string | null;
  counselorName: string | null;
  next: DeadlineView | null;
  done: number;
  total: number;
  /** Open items overdue or due within 14 days. */
  dueSoon: number;
  submittedOn: string | null;
  decidedOn: string | null;
};

export const PRE_SUBMISSION_STAGES = ["RESEARCHING", "SHORTLISTED", "PREPARING"];

/** The deadline to show next: the submission deadline before submitting, afterwards the next dated milestone (if any). */
export function nextDeadline(stage: string, all: ResolvedDeadline[], primary: ResolvedDeadline | null, now: Date) {
  if (PRE_SUBMISSION_STAGES.includes(stage)) return primary;
  const start = now.getTime() - 86_400_000;
  return all.filter((d) => !isSubmissionKind(d.kind) && d.date.getTime() >= start).sort((a, b) => a.date.getTime() - b.date.getTime())[0] ?? null;
}

export function deadlineView(d: ResolvedDeadline, prefs: FormatPrefs, now: Date): DeadlineView {
  const u = urgencyFor(d.date, now);
  return { kind: d.kind, date: fmtDate(prefs, d.date), iso: d.date.toISOString(), source: d.source, confirm: d.confirm, bucket: u.bucket, days: u.days };
}

export async function loadCards(ctx: Ctx, prefs: FormatPrefs, where: Prisma.ApplicationWhereInput, now = new Date()): Promise<AppCard[]> {
  const { db, orgId, locale } = ctx;
  const apps = await db.application.findMany({ where: { orgId, ...where }, include: { items: { select: { status: true, dueAt: true } } }, orderBy: { createdAt: "asc" }, take: 500 });
  if (!apps.length) return [];
  const [students, unis, programs, counselors, dl] = await Promise.all([
    db.student.findMany({ where: { id: { in: [...new Set(apps.map((a) => a.studentId))] } } }),
    db.university.findMany({ where: { id: { in: [...new Set(apps.map((a) => a.universityId))] } }, select: { id: true, nameEn: true, nameAr: true, countryCode: true } }),
    db.universityProgram.findMany({ where: { id: { in: apps.map((a) => a.programId).filter(Boolean) as string[] } }, select: { id: true, nameEn: true, nameAr: true } }),
    db.membership.findMany({ where: { id: { in: apps.map((a) => a.counselorId).filter(Boolean) as string[] } }, include: { user: true } }),
    tenantTx(orgId, (tx) => deadlinesFor(tx, apps, now)),
  ]);
  const soon = now.getTime() + 14 * 86_400_000;
  return apps.map((a) => {
    const s = students.find((x) => x.id === a.studentId);
    const u = unis.find((x) => x.id === a.universityId);
    const p = programs.find((x) => x.id === a.programId);
    const c = counselors.find((x) => x.id === a.counselorId);
    const d = dl.get(a.id);
    const primary = d ? nextDeadline(a.stage, d.all, d.primary, now) : null;
    return {
      id: a.id,
      studentId: a.studentId,
      studentName: s ? personName(s, locale) : "",
      grade: s?.gradeLevel ?? 0,
      university: u ? pick(locale, u.nameEn, u.nameAr) : "",
      program: p ? pick(locale, p.nameEn, p.nameAr) : null,
      countryCode: u?.countryCode ?? "",
      route: a.route ?? "DIRECT",
      stage: a.stage,
      intakeYear: a.intakeYear,
      counselorId: a.counselorId,
      counselorName: c ? userName(c.user, locale) : null,
      next: primary ? deadlineView(primary, prefs, now) : null,
      done: a.items.filter((i) => itemComplete(i.status)).length,
      total: a.items.length,
      submittedOn: a.submittedAt ? fmtDate(prefs, a.submittedAt) : null,
      decidedOn: a.decidedAt ? fmtDate(prefs, a.decidedAt) : null,
      dueSoon: a.items.filter((i) => !itemComplete(i.status) && i.dueAt && i.dueAt.getTime() <= soon).length,
    };
  });
}
