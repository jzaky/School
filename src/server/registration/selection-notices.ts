// Course selection notices: when a window opens, 3 days and 1 day before it closes (only for students who
// have not finished, and their parents), and a summary of what was recorded when it closes. Also the
// staff "remind those not finished" button. Idempotent: one JobRun ledger key per window, notice and
// person (per day for the staff button), claimed before anything is sent. Preferences apply through
// notify() under the "course_selection" kind. Never logs names.
import type { Prisma } from "@prisma/client";
import { tenantTx } from "@/lib/tenant-db";
import { execCtx, type Effect, type ExecCtx } from "@/server/db";
import { notify } from "@/server/notify/notify";
import { flushEffects } from "@/server/queue-core";
import { dueReminder, windowState } from "@/lib/selection-window";
import { dubaiDayKey } from "@/lib/format";
import { dateText, guardianMembers, windowCohort } from "./selection";
import { ensureSelectionTemplates } from "./selection-templates";
import { registrationYear } from "./service";

type Tx = Prisma.TransactionClient;
export const NOTICE_QUEUE = "course_selection";
/** Closing summaries are only sent within a week of closing (a window found later is history). */
const SUMMARY_DAYS = 7;

type Notice = "open" | "remind72" | "remind24" | "closed" | "nudge";

async function claim(tx: Tx, orgId: string, key: string, name: Notice, now: Date) {
  const res = await tx.jobRun.createMany({ data: [{ orgId, queue: NOTICE_QUEUE, name, idempotencyKey: key, status: "COMPLETED", finishedAt: now, createdAt: now }], skipDuplicates: true });
  return res.count === 1;
}

type CohortStudent = Awaited<ReturnType<typeof windowCohort>>[number];
const studentName = (s: CohortStudent) => ({ en: `${s.firstNameEn} ${s.lastNameEn}`, ar: `${s.firstNameAr} ${s.lastNameAr}` });
const finished = (s: CohortStudent) => s.progress.status === "submitted" || s.progress.status === "signed_off";

/** The student and their guardians who receive updates, each claimed once for this key. */
async function familyOf(tx: Tx, orgId: string, s: CohortStudent) {
  const guardians = (await guardianMembers(tx, orgId, s.id)).filter((g) => g.receivesUpdates);
  return [s.membershipId, ...guardians.map((g) => g.membershipId)].filter((x): x is string => !!x);
}

async function sendTo(ec: ExecCtx, recipients: string[], key: string, name: Notice, input: Omit<Parameters<typeof notify>[1], "recipients" | "idempotencyBase">) {
  const claimed: string[] = [];
  for (const r of recipients) if (await claim(ec.tx, ec.orgId, `${key}:${r}`, name, ec.now)) claimed.push(r);
  if (!claimed.length) return 0;
  await notify(ec, { ...input, recipients: claimed, idempotencyBase: key });
  return claimed.length;
}

/** Everything due for the school's windows at `now`. Safe to run any number of times. */
export async function selectionNoticesTx(ec: ExecCtx): Promise<{ open: number; reminders: number; summaries: number }> {
  const { tx, orgId, now } = ec;
  const counts = { open: 0, reminders: 0, summaries: 0 };
  const windows = await tx.courseSelectionWindow.findMany({ where: { orgId, opensAt: { lte: now }, closesAt: { gt: new Date(now.getTime() - SUMMARY_DAYS * 86_400_000) } } });
  if (!windows.length) return counts;
  await ensureSelectionTemplates(tx, orgId);
  for (const w of windows) {
    const target = await registrationYear(tx, orgId, w.academicYearId);
    if (!target) continue;
    const year = { en: target.year.nameEn, ar: target.year.nameAr };
    const closes = dateText(w.closesAt);
    const state = windowState(w, now);
    const cohort = await windowCohort(tx, orgId, w);
    const href = `/subjects?year=${target.next ? "next" : "current"}`;
    if (state === "open") {
      for (const s of cohort) {
        counts.open += await sendTo(ec, await familyOf(tx, orgId, s), `cswin:${w.id}:open:${s.id}`, "open", { templateKey: "course_selection_open", kind: "course_selection", vars: { student: studentName(s), year, closes }, href });
      }
      const due = dueReminder(w, now);
      if (due) {
        const when = due === 72 ? { en: "in 3 days", ar: "خلال 3 أيام" } : { en: "tomorrow", ar: "غدًا" };
        for (const s of cohort.filter((x) => !finished(x))) {
          counts.reminders += await sendTo(ec, await familyOf(tx, orgId, s), `cswin:${w.id}:remind${due}:${s.id}`, due === 72 ? "remind72" : "remind24", { templateKey: "course_selection_reminder", kind: "course_selection", vars: { student: studentName(s), year, closes, when }, href });
        }
      }
    } else if (state === "closed") {
      const regs = await tx.subjectRegistration.findMany({
        where: { orgId, academicYearId: w.academicYearId, studentId: { in: cohort.map((s) => s.id) }, status: { in: ["REQUESTED", "ALLOCATED", "WAITLISTED"] } },
        select: { studentId: true, subjectId: true },
      });
      const offerings = await tx.subjectOffering.findMany({ where: { orgId, academicYearId: w.academicYearId, kind: "OPTION" }, select: { subjectId: true } });
      const optionIds = new Set(offerings.map((o) => o.subjectId));
      const names = new Map((await tx.subject.findMany({ where: { orgId, id: { in: [...optionIds] } }, select: { id: true, nameEn: true, nameAr: true } })).map((s) => [s.id, s]));
      for (const s of cohort) {
        const mine = regs.filter((r) => r.studentId === s.id && optionIds.has(r.subjectId) && names.has(r.subjectId)).map((r) => names.get(r.subjectId)!);
        const choices = mine.length
          ? { en: mine.map((r) => r.nameEn).join(", "), ar: mine.map((r) => r.nameAr).join("، ") }
          : { en: "no options were chosen", ar: "لم يتم اختيار أي مادة اختيارية" };
        counts.summaries += await sendTo(ec, await familyOf(tx, orgId, s), `cswin:${w.id}:closed:${s.id}`, "closed", { templateKey: "course_selection_closed", kind: "course_selection", vars: { student: studentName(s), year, choices }, href });
      }
    }
  }
  return counts;
}

/** Worker entry: one school, in its own transaction, effects flushed after commit. */
export async function runSelectionNotices(orgId: string, opts: { now?: Date; flush?: (e: Effect[]) => Promise<void> } = {}) {
  const now = opts.now ?? new Date();
  const effects: Effect[] = [];
  const counts = await tenantTx(orgId, (tx) => selectionNoticesTx(execCtx(tx, orgId, { now, effects })), { timeout: 120_000 });
  await (opts.flush ?? flushEffects)(effects);
  return counts;
}

/**
 * Staff button: remind every student in a window who has not finished, and their parents. At most once
 * per student per Dubai day, however often it is pressed.
 */
export async function remindUnfinished(ec: ExecCtx, windowId: string, opts: { studentIds?: string[] } = {}) {
  const { tx, orgId, now } = ec;
  const w = await tx.courseSelectionWindow.findFirst({ where: { orgId, id: windowId } });
  if (!w) return { ok: false as const, error: "NOT_FOUND" };
  if (windowState(w, now) !== "open") return { ok: false as const, error: "NOT_OPEN" };
  const target = await registrationYear(tx, orgId, w.academicYearId);
  if (!target) return { ok: false as const, error: "NO_YEAR" };
  await ensureSelectionTemplates(tx, orgId);
  const day = dubaiDayKey(now);
  const cohort = (await windowCohort(tx, orgId, w)).filter((s) => !finished(s) && (!opts.studentIds || opts.studentIds.includes(s.id)));
  const year = { en: target.year.nameEn, ar: target.year.nameAr };
  const closes = dateText(w.closesAt);
  const hours = Math.max(1, Math.round((w.closesAt.getTime() - now.getTime()) / 3_600_000));
  const when = hours >= 48 ? { en: `in ${Math.round(hours / 24)} days`, ar: `خلال ${Math.round(hours / 24)} أيام` } : hours >= 24 ? { en: "tomorrow", ar: "غدًا" } : { en: "today", ar: "اليوم" };
  let students = 0;
  let people = 0;
  for (const s of cohort) {
    const sent = await sendTo(ec, await familyOf(tx, orgId, s), `cswin:${w.id}:nudge:${day}:${s.id}`, "nudge", { templateKey: "course_selection_reminder", kind: "course_selection", vars: { student: studentName(s), year, closes, when }, href: `/subjects?year=${target.next ? "next" : "current"}` });
    if (sent) students++;
    people += sent;
  }
  return { ok: true as const, students, people, unfinished: cohort.length };
}
