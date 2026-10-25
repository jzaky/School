// What happens when an absence request is approved.
// - A family absence report (service absence_request) marks every school day in its range as an excused absence
//   on the attendance register, with the source (parent or student) and a link to the request. The reason and
//   any doctor's note stay on the request, where only the family and the attendance team can read them (see
//   src/server/access/absence-access.ts). The homeroom teacher is told the student is away, without the reason.
// - An approved staff leave request (service staff_leave) becomes a StaffAbsence with cover arranged for the
//   lessons from today on. The leave type becomes the private reason; the cover plan becomes the cover notes.
// No "server-only" marker: the workflow engine runs in the seed and the worker too.
import type { AttendanceSource, StaffAbsenceReason } from "@prisma/client";
import type { ExecCtx, Tx } from "@/server/db";
import { notify } from "@/server/notify/notify";
import { dubaiDateKey } from "@/server/appointments/slots";
import { AbsenceError, addDays, daysBetween, keyToDate, reportAbsence, weekdayOfKey } from "@/server/timetable/cover";

const MAX_DAYS = 31;

export const ABSENCE_TEMPLATES = [
  {
    key: "absence_excused",
    subject: { en: "{{student}} is away: excused absence", ar: "غياب {{student}}: غياب بعذر" },
    body: {
      en: "{{student}} is absent {{dates}}. Excused absence, reported by {{reporter}}. The attendance register is updated.",
      ar: "{{student}} غائب/ة {{dates}}. غياب بعذر، أبلغ عنه {{reporter}}. تم تحديث سجل الحضور.",
    },
  },
] as const;

export async function ensureAbsenceTemplates(tx: Tx, orgId: string) {
  const have = await tx.messageTemplate.findMany({ where: { orgId, key: { in: ABSENCE_TEMPLATES.map((t) => t.key as string) }, channel: "EMAIL" }, select: { key: true } });
  const missing = ABSENCE_TEMPLATES.filter((t) => !have.some((h) => h.key === t.key));
  if (missing.length)
    await tx.messageTemplate.createMany({
      data: missing.map((t) => ({ orgId, key: t.key, channel: "EMAIL" as const, subjectEn: t.subject.en, subjectAr: t.subject.ar, bodyEn: t.body.en, bodyAr: t.body.ar })),
      skipDuplicates: true,
    });
}

const isKey = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** School days (YYYY-MM-DD) covered by a form's startDate and endDate, at most 31 calendar days. */
export function absenceDays(form: Record<string, unknown>, weekDays: number[]): string[] {
  const a = isKey(form.startDate) ? form.startDate : null;
  const b = isKey(form.endDate) ? form.endDate : a;
  if (!a || !b) return [];
  const [from, to] = a <= b ? [a, b] : [b, a];
  const last = to > addDays(from, MAX_DAYS - 1) ? addDays(from, MAX_DAYS - 1) : to;
  return daysBetween(from, last).filter((d) => weekDays.includes(weekdayOfKey(d)));
}

function bilingualRange(days: string[]) {
  const f = (k: string, loc: "en" | "ar") => new Intl.DateTimeFormat(loc === "ar" ? "ar-AE-u-nu-latn" : "en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(keyToDate(k));
  if (days.length === 1) return { en: `on ${f(days[0], "en")}`, ar: `يوم ${f(days[0], "ar")}` };
  return { en: `from ${f(days[0], "en")} to ${f(days[days.length - 1], "en")}`, ar: `من ${f(days[0], "ar")} إلى ${f(days[days.length - 1], "ar")}` };
}

async function sourceOf(tx: Tx, orgId: string, requesterId: string): Promise<AttendanceSource> {
  const roles = await tx.membershipRole.findMany({ where: { orgId, membershipId: requesterId }, select: { role: { select: { key: true } } } });
  const keys = roles.map((r) => r.role.key);
  return keys.includes("parent") ? "PARENT" : keys.includes("student") ? "STUDENT" : "OFFICE";
}

/** Mark the days of an approved family absence report as excused. Safe to run again (one record per student and day). */
export async function applyExcusedAbsence(ec: ExecCtx, request: { id: string; studentId: string | null; requesterId: string }, form: Record<string, unknown>) {
  const { tx, orgId } = ec;
  if (!request.studentId) return { days: 0 };
  const org = await tx.organization.findUnique({ where: { id: orgId }, select: { weekDays: true } });
  const days = absenceDays(form, org?.weekDays?.length ? org.weekDays : [1, 2, 3, 4, 5]);
  if (!days.length) return { days: 0 };
  const source = await sourceOf(tx, orgId, request.requesterId);
  for (const d of days) {
    const date = keyToDate(d);
    const existing = await tx.attendanceRecord.findFirst({ where: { orgId, studentId: request.studentId, date } });
    if (existing) await tx.attendanceRecord.update({ where: { id: existing.id }, data: { status: "EXCUSED", minutesLate: null, source, requestId: request.id } });
    else await tx.attendanceRecord.create({ data: { orgId, studentId: request.studentId, date, status: "EXCUSED", source, requestId: request.id } });
  }
  const n = days.length;
  await tx.timelineEvent.create({
    data: {
      orgId,
      requestId: request.id,
      studentId: request.studentId,
      actorId: ec.actorId ?? null,
      kind: "status",
      titleEn: n === 1 ? "Attendance register updated: 1 school day excused" : `Attendance register updated: ${n} school days excused`,
      titleAr:
        n === 1
          ? "تم تحديث سجل الحضور: يوم دراسي واحد بعذر"
          : n === 2
            ? "تم تحديث سجل الحضور: يومان دراسيان بعذر"
            : n <= 10
              ? `تم تحديث سجل الحضور: ${n} أيام دراسية بعذر`
              : `تم تحديث سجل الحضور: ${n} يومًا دراسيًا بعذر`,
      createdAt: ec.now,
    },
  });

  // The homeroom teacher is told the student is away, never why.
  const [student, homeroom] = await Promise.all([
    tx.student.findFirst({ where: { orgId, id: request.studentId } }),
    tx.enrollment.findFirst({ where: { orgId, studentId: request.studentId, class: { isHomeroom: true } }, include: { class: true } }),
  ]);
  const teacher = homeroom?.class.teacherMembershipId;
  if (student && teacher) {
    await ensureAbsenceTemplates(tx, orgId);
    const reporter = source === "PARENT" ? { en: "a parent", ar: "ولي الأمر" } : source === "STUDENT" ? { en: "the student", ar: "الطالب" } : { en: "the school office", ar: "مكتب المدرسة" };
    await notify(ec, {
      recipients: [teacher],
      templateKey: "absence_excused",
      kind: "absence_excused",
      vars: { student: { en: `${student.firstNameEn} ${student.lastNameEn}`, ar: `${student.firstNameAr} ${student.lastNameAr}` }, dates: bilingualRange(days), reporter },
      href: `/classes/${homeroom!.classId}?date=${days[0]}`,
      channels: ["IN_APP"],
      idempotencyBase: `absence:${request.id}:homeroom`,
    });
  }
  return { days: n };
}

const LEAVE_REASON: Record<string, StaffAbsenceReason> = {
  annual: "ANNUAL_LEAVE",
  sick: "SICK",
  compassionate: "FAMILY",
  maternity: "PARENTAL_LEAVE",
  hajj: "RELIGIOUS",
  study: "TRAINING",
  unpaid: "PERSONAL",
  other: "OTHER",
};

/**
 * Turn an approved leave request into a staff absence with cover, from today on. Past days are left alone
 * (nobody can cover a lesson that already happened). Returns why nothing was arranged, if so.
 */
export async function absenceFromLeave(ec: ExecCtx, request: { id: string; requesterId: string }, form: Record<string, unknown>): Promise<{ absenceId: string | null; skipped: string | null }> {
  const { tx, orgId } = ec;
  const already = await tx.staffAbsence.findFirst({ where: { orgId, requestId: request.id } });
  if (already) return { absenceId: already.id, skipped: null };
  const a = isKey(form.startDate) ? form.startDate : null;
  const b = isKey(form.endDate) ? form.endDate : a;
  if (!a || !b) return { absenceId: null, skipped: "NO_DATES" };
  const today = dubaiDateKey(ec.now);
  const from = a < today ? today : a;
  const to = b;
  if (to < from) return { absenceId: null, skipped: "IN_THE_PAST" };
  try {
    const res = await reportAbsence(ec, {
      membershipId: request.requesterId,
      startsOn: from,
      endsOn: to,
      allDay: true,
      notes: typeof form.coverPlan === "string" ? form.coverPlan.slice(0, 500) : null,
      reasonKind: LEAVE_REASON[String(form.leaveType ?? "")] ?? "OTHER",
      privateReason: null,
      reportedById: request.requesterId,
    });
    await tx.staffAbsence.update({ where: { id: res.absence.id }, data: { requestId: request.id } });
    return { absenceId: res.absence.id, skipped: null };
  } catch (e) {
    if (e instanceof AbsenceError) return { absenceId: null, skipped: e.message };
    throw e;
  }
}
