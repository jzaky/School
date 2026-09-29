// Staff absence and automatic cover. Takes an ExecCtx (transaction scoped to one organization).
// On a new absence, every lesson the teacher has in the range gets a CoverAssignment: a free substitute
// when there is one (see cover-picker.ts), otherwise UNCOVERED. Substitutes are notified with an
// idempotency key per cover assignment and substitute; the head of department gets a summary.
import type { CoverStatus } from "@prisma/client";
import type { ExecCtx, Tx } from "@/server/db";
import { notify } from "@/server/notify/notify";
import { busyKey, pickSubstitutes, rankCandidates, type CoverCandidate, type CoverLesson } from "./cover-picker";
import { bellRows, currentYear } from "./service";
import { lessonNumbers } from "./bell";
import { dubaiDateKey } from "@/server/appointments/slots";

export const COVER_TEMPLATES = [
  {
    key: "cover_assigned",
    subject: { en: "Cover: {{class}}, {{date}} lesson {{lesson}}", ar: "حصة احتياط: {{class}}، {{date}} الحصة {{lesson}}" },
    body: {
      en: "Please cover {{class}} for {{teacher}} on {{date}}, lesson {{lesson}} ({{time}}) in room {{room}}. {{notes}}",
      ar: "يرجى تغطية حصة {{class}} بدلًا من {{teacher}} يوم {{date}}، الحصة {{lesson}} ({{time}}) في القاعة {{room}}. {{notes}}",
    },
  },
  {
    key: "cover_absence_summary",
    subject: { en: "{{teacher}} is absent: {{covered}} of {{total}} lessons covered", ar: "غياب {{teacher}}: تمت تغطية {{covered}} من {{total}} حصص" },
    body: {
      en: "{{teacher}} is absent {{dates}}. {{covered}} of {{total}} lessons have cover. {{uncovered}} still need someone. Open the cover board to review.",
      ar: "{{teacher}} غائب/ة {{dates}}. تمت تغطية {{covered}} من {{total}} حصص، و{{uncovered}} ما زالت بحاجة إلى معلم. افتح لوحة الاحتياط للمراجعة.",
    },
  },
  {
    key: "cover_uncovered",
    subject: { en: "Cover needed: {{class}}, {{date}} lesson {{lesson}}", ar: "مطلوب احتياط: {{class}}، {{date}} الحصة {{lesson}}" },
    body: {
      en: "Nobody is free to cover {{class}} on {{date}}, lesson {{lesson}}. {{why}}",
      ar: "لا يوجد معلم متاح لتغطية {{class}} يوم {{date}}، الحصة {{lesson}}. {{why}}",
    },
  },
  {
    key: "cover_cancelled",
    subject: { en: "Cover cancelled: {{class}}, {{date}} lesson {{lesson}}", ar: "إلغاء حصة الاحتياط: {{class}}، {{date}} الحصة {{lesson}}" },
    body: { en: "You no longer need to cover {{class}} on {{date}}, lesson {{lesson}}.", ar: "لم تعد مطالبًا بتغطية {{class}} يوم {{date}}، الحصة {{lesson}}." },
  },
] as const;

/** Create the cover message templates for an organization if they are missing. Admins can edit them later. */
export async function ensureCoverTemplates(tx: Tx, orgId: string) {
  const have = await tx.messageTemplate.findMany({ where: { orgId, key: { in: COVER_TEMPLATES.map((t) => t.key) }, channel: "EMAIL" }, select: { key: true } });
  const missing = COVER_TEMPLATES.filter((t) => !have.some((h) => h.key === t.key));
  if (missing.length)
    await tx.messageTemplate.createMany({
      data: missing.map((t) => ({ orgId, key: t.key, channel: "EMAIL" as const, subjectEn: t.subject.en, subjectAr: t.subject.ar, bodyEn: t.body.en, bodyAr: t.body.ar })),
      skipDuplicates: true,
    });
}

// --- Dates ------------------------------------------------------------------------------

export const dateKey = (d: Date) => d.toISOString().slice(0, 10);
export const keyToDate = (k: string) => new Date(`${k}T00:00:00.000Z`);
export const weekdayOfKey = (k: string) => keyToDate(k).getUTCDay();
export function addDays(k: string, n: number) {
  const d = keyToDate(k);
  d.setUTCDate(d.getUTCDate() + n);
  return dateKey(d);
}
export function mondayOf(k: string) {
  return addDays(k, -((weekdayOfKey(k) + 6) % 7));
}
export function daysBetween(from: string, to: string) {
  const out: string[] = [];
  for (let k = from; k <= to && out.length < 400; k = addDays(k, 1)) out.push(k);
  return out;
}

function bilingualDate(k: string) {
  const d = keyToDate(k);
  const en = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(d);
  const ar = new Intl.DateTimeFormat("ar-AE-u-nu-latn", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(d);
  return { en, ar };
}

// --- Loading the world for cover decisions -----------------------------------------------

async function memberNames(tx: Tx, orgId: string, ids: string[]) {
  const rows = await tx.membership.findMany({ where: { orgId, id: { in: [...new Set(ids)] } }, select: { id: true, user: { select: { nameEn: true, nameAr: true } } } });
  return new Map(rows.map((r) => [r.id, { en: r.user.nameEn, ar: r.user.nameAr || r.user.nameEn }]));
}

/** Everyone who can cover (teaching staff), with their qualifications and weekly teaching load. */
export async function coverCandidates(tx: Tx, orgId: string, yearId: string): Promise<CoverCandidate[]> {
  const [quals, slots] = await Promise.all([
    tx.teacherSubject.findMany({ where: { orgId } }),
    tx.timetableSlot.groupBy({ by: ["teacherMembershipId"], where: { orgId, academicYearId: yearId, teacherMembershipId: { not: null } }, _count: { _all: true } }),
  ]);
  const ids = [...new Set([...quals.map((q) => q.membershipId), ...slots.map((s) => s.teacherMembershipId!)])];
  const members = await tx.membership.findMany({ where: { orgId, id: { in: ids }, status: "ACTIVE" }, select: { id: true, staffProfile: { select: { departmentId: true } } } });
  return members
    .map((m) => {
      const mine = quals.filter((q) => q.membershipId === m.id);
      return {
        id: m.id,
        departmentId: m.staffProfile?.departmentId ?? null,
        qualifications: mine.map((q) => ({ subjectId: q.subjectId, gradeLevels: q.gradeLevels })),
        maxPeriodsPerWeek: mine.length ? Math.max(...mine.map((q) => q.maxPeriodsPerWeek)) : 24,
        teachingPeriods: slots.find((s) => s.teacherMembershipId === m.id)?._count._all ?? 0,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

const ACTIVE_COVER: CoverStatus[] = ["ASSIGNED", "DONE"];

/** Who is busy on the given dates: teaching (by weekday), absent, or already covering. */
async function busyOn(tx: Tx, orgId: string, yearId: string, dates: string[], exceptCoverIds: string[] = []) {
  const busy = new Set<string>();
  if (!dates.length) return busy;
  const weekdays = [...new Set(dates.map(weekdayOfKey))];
  const [slots, absences, covers, bell] = await Promise.all([
    tx.timetableSlot.findMany({ where: { orgId, academicYearId: yearId, dayOfWeek: { in: weekdays }, teacherMembershipId: { not: null } }, select: { teacherMembershipId: true, dayOfWeek: true, periodNo: true } }),
    tx.staffAbsence.findMany({ where: { orgId, status: { not: "CANCELLED" }, startsOn: { lte: keyToDate(dates[dates.length - 1]) }, endsOn: { gte: keyToDate(dates[0]) } } }),
    tx.coverAssignment.findMany({ where: { orgId, date: { in: dates.map(keyToDate) }, status: { in: ACTIVE_COVER }, substituteId: { not: null }, id: { notIn: exceptCoverIds } }, select: { date: true, periodNo: true, substituteId: true } }),
    bellRows(tx, orgId, yearId),
  ]);
  for (const d of dates) {
    const wd = weekdayOfKey(d);
    for (const s of slots) if (s.dayOfWeek === wd) busy.add(busyKey(d, s.periodNo, s.teacherMembershipId!));
    for (const a of absences) {
      if (d < dateKey(a.startsOn) || d > dateKey(a.endsOn)) continue;
      for (const b of bell.filter((x) => x.dayOfWeek === wd)) {
        if (a.allDay || ((a.fromPeriod ?? 0) <= b.periodNo && b.periodNo <= (a.toPeriod ?? 99))) busy.add(busyKey(d, b.periodNo, a.membershipId));
      }
    }
  }
  for (const c of covers) busy.add(busyKey(dateKey(c.date), c.periodNo, c.substituteId!));
  return busy;
}

/** Cover already given in the weeks that contain these dates, per substitute. */
async function weekCoverCounts(tx: Tx, orgId: string, dates: string[], exceptCoverIds: string[] = []) {
  if (!dates.length) return {};
  const from = mondayOf(dates[0]);
  const to = addDays(mondayOf(dates[dates.length - 1]), 6);
  const rows = await tx.coverAssignment.groupBy({
    by: ["substituteId"],
    where: { orgId, date: { gte: keyToDate(from), lte: keyToDate(to) }, status: { in: ACTIVE_COVER }, substituteId: { not: null }, id: { notIn: exceptCoverIds } },
    _count: { _all: true },
  });
  return Object.fromEntries(rows.map((r) => [r.substituteId!, r._count._all])) as Record<string, number>;
}

// --- Notifications ----------------------------------------------------------------------

type LessonInfo = { classId: string; date: string; periodNo: number; room: string | null };

async function lessonVars(tx: Tx, orgId: string, yearId: string, l: LessonInfo) {
  const [cls, bell] = await Promise.all([tx.schoolClass.findFirst({ where: { orgId, id: l.classId } }), bellRows(tx, orgId, yearId)]);
  const wd = weekdayOfKey(l.date);
  const row = bell.find((b) => b.dayOfWeek === wd && b.periodNo === l.periodNo);
  const lesson = lessonNumbers(bell, wd).get(l.periodNo) ?? l.periodNo;
  return {
    class: { en: cls?.nameEn ?? "", ar: cls?.nameAr ?? cls?.nameEn ?? "" },
    date: bilingualDate(l.date),
    lesson: String(lesson),
    time: row ? `${row.startTime} - ${row.endTime}` : "",
    room: { en: l.room ?? cls?.room ?? "TBC", ar: l.room ?? cls?.room ?? "يُحدد لاحقًا" },
  };
}

async function notifySubstitute(ec: ExecCtx, yearId: string, coverId: string) {
  const { tx, orgId } = ec;
  const c = await tx.coverAssignment.findFirst({ where: { orgId, id: coverId }, include: { absence: true } });
  if (!c?.substituteId) return;
  const slot = await tx.timetableSlot.findFirst({ where: { orgId, id: c.slotId }, select: { room: true } });
  const names = await memberNames(tx, orgId, [c.originalTeacherId]);
  const vars = await lessonVars(tx, orgId, yearId, { classId: c.classId, date: dateKey(c.date), periodNo: c.periodNo, room: slot?.room ?? null });
  const notes = c.absence.reasonEn?.trim();
  await notify(ec, {
    recipients: [c.substituteId],
    templateKey: "cover_assigned",
    vars: { ...vars, teacher: names.get(c.originalTeacherId) ?? { en: "", ar: "" }, notes: notes ? { en: `Notes: ${notes}`, ar: `ملاحظات: ${notes}` } : "" },
    href: "/timetable",
    kind: "cover_assigned",
    idempotencyBase: `cover:${c.id}:${c.substituteId}`,
  });
  await tx.coverAssignment.update({ where: { id: c.id }, data: { notifiedAt: ec.now } });
}

/** Heads of the absent teacher's department, or the principal and cover managers when there is none. */
async function managersFor(tx: Tx, orgId: string, absentId: string) {
  const profile = await tx.staffProfile.findFirst({ where: { orgId, membershipId: absentId }, include: { department: true } });
  const head = profile?.department?.headMembershipId;
  if (head && head !== absentId) return [head];
  const principals = await tx.membership.findMany({ where: { orgId, status: "ACTIVE", id: { not: absentId }, roles: { some: { role: { key: "principal" } } } }, select: { id: true } });
  return principals.map((p) => p.id);
}

// --- Main flows -------------------------------------------------------------------------

export type AbsenceInput = {
  membershipId: string;
  startsOn: string; // YYYY-MM-DD
  endsOn: string;
  allDay: boolean;
  fromPeriod?: number | null;
  toPeriod?: number | null;
  notes?: string | null;
  reportedById: string;
};

export class AbsenceError extends Error {}

/** Record an absence and arrange cover for it. */
export async function reportAbsence(ec: ExecCtx, input: AbsenceInput) {
  const { tx, orgId } = ec;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startsOn) || !/^\d{4}-\d{2}-\d{2}$/.test(input.endsOn)) throw new AbsenceError("BAD_DATE");
  if (input.endsOn < input.startsOn) throw new AbsenceError("END_BEFORE_START");
  if (daysBetween(input.startsOn, input.endsOn).length > 31) throw new AbsenceError("TOO_LONG");
  if (!input.allDay && (input.fromPeriod == null || input.toPeriod == null || input.toPeriod < input.fromPeriod)) throw new AbsenceError("BAD_PERIODS");
  const overlap = await tx.staffAbsence.findFirst({
    where: { orgId, membershipId: input.membershipId, status: { not: "CANCELLED" }, startsOn: { lte: keyToDate(input.endsOn) }, endsOn: { gte: keyToDate(input.startsOn) } },
  });
  if (overlap) throw new AbsenceError("OVERLAP");
  const absence = await tx.staffAbsence.create({
    data: {
      orgId,
      membershipId: input.membershipId,
      startsOn: keyToDate(input.startsOn),
      endsOn: keyToDate(input.endsOn),
      allDay: input.allDay,
      fromPeriod: input.allDay ? null : input.fromPeriod,
      toPeriod: input.allDay ? null : input.toPeriod,
      reasonEn: input.notes?.trim() || null,
      reportedById: input.reportedById,
      createdAt: ec.now,
    },
  });
  await tx.auditEvent.create({ data: { orgId, actorId: input.reportedById, action: "absence.report", entityType: "StaffAbsence", entityId: absence.id, meta: { membershipId: input.membershipId, startsOn: input.startsOn, endsOn: input.endsOn, allDay: input.allDay } as never } });
  const result = await arrangeCover(ec, absence.id);
  return { absence, ...result };
}

/** Lessons of an absence: every timetable slot of the teacher on the absent school days and periods. */
async function absenceLessons(tx: Tx, orgId: string, yearId: string, absence: { membershipId: string; startsOn: Date; endsOn: Date; allDay: boolean; fromPeriod: number | null; toPeriod: number | null }) {
  const org = await tx.organization.findUnique({ where: { id: orgId }, select: { weekDays: true } });
  const weekDays = org?.weekDays?.length ? org.weekDays : [1, 2, 3, 4, 5];
  const dates = daysBetween(dateKey(absence.startsOn), dateKey(absence.endsOn)).filter((d) => weekDays.includes(weekdayOfKey(d)));
  const slots = await tx.timetableSlot.findMany({ where: { orgId, academicYearId: yearId, teacherMembershipId: absence.membershipId } });
  const classes = await tx.schoolClass.findMany({ where: { orgId, id: { in: [...new Set(slots.map((s) => s.classId))] } }, include: { subject: true } });
  const profile = await tx.staffProfile.findFirst({ where: { orgId, membershipId: absence.membershipId }, select: { departmentId: true } });
  const out: Array<CoverLesson & { slotId: string; classId: string; room: string | null }> = [];
  for (const d of dates) {
    const wd = weekdayOfKey(d);
    for (const s of slots.filter((x) => x.dayOfWeek === wd).sort((a, b) => a.periodNo - b.periodNo)) {
      if (!absence.allDay && (s.periodNo < (absence.fromPeriod ?? 0) || s.periodNo > (absence.toPeriod ?? 99))) continue;
      const c = classes.find((x) => x.id === s.classId);
      out.push({
        key: `${s.id}|${d}`,
        slotId: s.id,
        classId: s.classId,
        room: s.room,
        date: d,
        periodNo: s.periodNo,
        subjectId: c?.subjectId ?? null,
        gradeLevel: c?.gradeLevel ?? 0,
        departmentId: c?.subject?.departmentId ?? profile?.departmentId ?? null,
      });
    }
  }
  return { dates, lessons: out };
}

/** Create cover for every lesson of the absence that has none yet. Safe to run again. */
export async function arrangeCover(ec: ExecCtx, absenceId: string) {
  const { tx, orgId } = ec;
  await ensureCoverTemplates(tx, orgId);
  const absence = await tx.staffAbsence.findFirst({ where: { orgId, id: absenceId }, include: { covers: true } });
  const year = await currentYear(tx, orgId);
  if (!absence || !year || absence.status === "CANCELLED") return { created: 0, covered: 0, uncovered: 0 };
  const { dates, lessons } = await absenceLessons(tx, orgId, year.id, absence);
  const todo = lessons.filter((l) => !absence.covers.some((c) => c.slotId === l.slotId && dateKey(c.date) === l.date));
  const candidates = (await coverCandidates(tx, orgId, year.id)).filter((c) => c.id !== absence.membershipId);
  const busy = await busyOn(tx, orgId, year.id, dates);
  const picks = pickSubstitutes({ lessons: todo, candidates, busy, coverCount: await weekCoverCounts(tx, orgId, dates) });
  let covered = 0;
  let uncovered = 0;
  const createdIds: string[] = [];
  for (const p of picks) {
    const l = todo.find((x) => x.key === p.key)!;
    const row = await tx.coverAssignment.create({
      data: {
        orgId,
        absenceId: absence.id,
        slotId: l.slotId,
        date: keyToDate(l.date),
        periodNo: l.periodNo,
        classId: l.classId,
        originalTeacherId: absence.membershipId,
        substituteId: p.substituteId,
        status: p.substituteId ? "ASSIGNED" : "UNCOVERED",
        createdAt: ec.now,
      },
    });
    createdIds.push(row.id);
    if (p.substituteId) covered++;
    else uncovered++;
  }
  for (const id of createdIds) await notifySubstitute(ec, year.id, id);
  await refreshAbsenceStatus(tx, orgId, absence.id);

  if (createdIds.length) {
    const all = await tx.coverAssignment.findMany({ where: { orgId, absenceId: absence.id } });
    const names = await memberNames(tx, orgId, [absence.membershipId]);
    const range = dateKey(absence.startsOn) === dateKey(absence.endsOn) ? bilingualDate(dateKey(absence.startsOn)) : { en: `${bilingualDate(dateKey(absence.startsOn)).en} to ${bilingualDate(dateKey(absence.endsOn)).en}`, ar: `من ${bilingualDate(dateKey(absence.startsOn)).ar} إلى ${bilingualDate(dateKey(absence.endsOn)).ar}` };
    const ok = all.filter((c) => c.status === "ASSIGNED" || c.status === "DONE").length;
    await notify(ec, {
      recipients: await managersFor(tx, orgId, absence.membershipId),
      templateKey: "cover_absence_summary",
      vars: { teacher: names.get(absence.membershipId) ?? { en: "", ar: "" }, dates: range, covered: String(ok), total: String(all.length), uncovered: String(all.length - ok) },
      href: "/admin/cover",
      kind: "cover_summary",
      idempotencyBase: `absence:${absence.id}:summary:${all.length}:${ok}`,
    });
  }
  return { created: createdIds.length, covered, uncovered };
}

export async function refreshAbsenceStatus(tx: Tx, orgId: string, absenceId: string) {
  const a = await tx.staffAbsence.findFirst({ where: { orgId, id: absenceId }, include: { covers: true } });
  if (!a || a.status === "CANCELLED") return;
  const total = a.covers.length;
  const ok = a.covers.filter((c) => c.status === "ASSIGNED" || c.status === "DONE").length;
  const status = total === 0 ? "REPORTED" : ok === total ? "COVERED" : "PARTLY_COVERED";
  if (status !== a.status) await tx.staffAbsence.update({ where: { id: a.id }, data: { status } });
}

/** People who declined this cover (from the audit trail). */
async function decliners(tx: Tx, orgId: string, coverId: string) {
  const rows = await tx.auditEvent.findMany({ where: { orgId, action: "cover.decline", entityType: "CoverAssignment", entityId: coverId }, select: { actorId: true } });
  return rows.map((r) => r.actorId).filter(Boolean) as string[];
}

/** Ranked free substitutes for one cover, for the manual reassign picker. */
export async function freeSubstitutes(tx: Tx, orgId: string, coverId: string) {
  const c = await tx.coverAssignment.findFirst({ where: { orgId, id: coverId } });
  const year = await currentYear(tx, orgId);
  if (!c || !year) return [];
  const d = dateKey(c.date);
  const [cls, profile] = await Promise.all([
    tx.schoolClass.findFirst({ where: { orgId, id: c.classId }, include: { subject: true } }),
    tx.staffProfile.findFirst({ where: { orgId, membershipId: c.originalTeacherId }, select: { departmentId: true } }),
  ]);
  const lesson: CoverLesson = { key: c.id, date: d, periodNo: c.periodNo, subjectId: cls?.subjectId ?? null, gradeLevel: cls?.gradeLevel ?? 0, departmentId: cls?.subject?.departmentId ?? profile?.departmentId ?? null };
  const candidates = (await coverCandidates(tx, orgId, year.id)).filter((x) => x.id !== c.originalTeacherId);
  const busy = await busyOn(tx, orgId, year.id, [d], [c.id]);
  return rankCandidates(lesson, candidates, busy, await weekCoverCounts(tx, orgId, [d], [c.id]), {}, await decliners(tx, orgId, c.id));
}

async function cancelNotice(ec: ExecCtx, yearId: string, c: { id: string; substituteId: string | null; classId: string; date: Date; periodNo: number; slotId: string }) {
  if (!c.substituteId) return;
  const slot = await ec.tx.timetableSlot.findFirst({ where: { orgId: ec.orgId, id: c.slotId }, select: { room: true } });
  const vars = await lessonVars(ec.tx, ec.orgId, yearId, { classId: c.classId, date: dateKey(c.date), periodNo: c.periodNo, room: slot?.room ?? null });
  await notify(ec, { recipients: [c.substituteId], templateKey: "cover_cancelled", vars, href: "/timetable", kind: "cover_cancelled", channels: ["IN_APP"], idempotencyBase: `cover:${c.id}:${c.substituteId}:cancelled` });
}

/**
 * Give a cover to someone else. substituteId null picks the best free person automatically.
 * Returns the new substitute, or null when nobody is free (the cover is then UNCOVERED or DECLINED).
 */
export async function reassignCover(ec: ExecCtx, coverId: string, opts: { substituteId?: string | null; actorId: string; afterDecline?: boolean }) {
  const { tx, orgId } = ec;
  await ensureCoverTemplates(tx, orgId);
  const c = await tx.coverAssignment.findFirst({ where: { orgId, id: coverId } });
  const year = await currentYear(tx, orgId);
  if (!c || !year) throw new AbsenceError("NOT_FOUND");
  const ranked = await freeSubstitutes(tx, orgId, coverId);
  let next: string | null = null;
  if (opts.substituteId) {
    if (!ranked.some((r) => r.id === opts.substituteId)) throw new AbsenceError("NOT_FREE");
    next = opts.substituteId;
  } else next = ranked[0]?.id ?? null;
  if (c.substituteId && c.substituteId !== next && c.status === "ASSIGNED") await cancelNotice(ec, year.id, c);
  const status: CoverStatus = next ? "ASSIGNED" : opts.afterDecline ? "DECLINED" : "UNCOVERED";
  await tx.coverAssignment.update({ where: { id: c.id }, data: { substituteId: next ?? (opts.afterDecline ? c.substituteId : null), status, notifiedAt: null } });
  await tx.auditEvent.create({ data: { orgId, actorId: opts.actorId, action: "cover.reassign", entityType: "CoverAssignment", entityId: c.id, meta: { from: c.substituteId, to: next, auto: !opts.substituteId } as never } });
  if (next) await notifySubstitute(ec, year.id, c.id);
  else {
    const vars = await lessonVars(tx, orgId, year.id, { classId: c.classId, date: dateKey(c.date), periodNo: c.periodNo, room: null });
    await notify(ec, {
      recipients: await managersFor(tx, orgId, c.originalTeacherId),
      templateKey: "cover_uncovered",
      vars: { ...vars, why: opts.afterDecline ? { en: "The substitute declined and nobody else is free.", ar: "اعتذر المعلم البديل ولا يوجد معلم آخر متاح." } : { en: "Please arrange cover.", ar: "يرجى ترتيب البديل." } },
      href: "/admin/cover",
      kind: "cover_uncovered",
      idempotencyBase: `cover:${c.id}:uncovered:${ec.now.getTime()}`,
    });
  }
  await refreshAbsenceStatus(tx, orgId, c.absenceId);
  return next;
}

/** A substitute declines a cover with a reason; the system tries the next best free person. */
export async function declineCover(ec: ExecCtx, coverId: string, byMemberId: string, reason: string) {
  const { tx, orgId } = ec;
  const c = await tx.coverAssignment.findFirst({ where: { orgId, id: coverId } });
  if (!c || c.substituteId !== byMemberId || c.status !== "ASSIGNED") throw new AbsenceError("NOT_YOURS");
  if (!reason.trim()) throw new AbsenceError("REASON_REQUIRED");
  await tx.coverAssignment.update({ where: { id: c.id }, data: { status: "DECLINED", reasonEn: reason.trim().slice(0, 500) } });
  await tx.auditEvent.create({ data: { orgId, actorId: byMemberId, action: "cover.decline", entityType: "CoverAssignment", entityId: c.id, reason: reason.trim().slice(0, 500) } });
  return reassignCover(ec, coverId, { actorId: byMemberId, afterDecline: true });
}

/** Cancel an absence: upcoming covers are removed and their substitutes told. */
export async function cancelAbsence(ec: ExecCtx, absenceId: string, actorId: string) {
  const { tx, orgId } = ec;
  const a = await tx.staffAbsence.findFirst({ where: { orgId, id: absenceId }, include: { covers: true } });
  const year = await currentYear(tx, orgId);
  if (!a || !year) throw new AbsenceError("NOT_FOUND");
  if (a.status === "CANCELLED") return;
  await ensureCoverTemplates(tx, orgId);
  const today = dubaiDateKey(ec.now);
  for (const c of a.covers.filter((x) => dateKey(x.date) >= today)) {
    if (c.status === "ASSIGNED") await cancelNotice(ec, year.id, c);
    await tx.coverAssignment.delete({ where: { id: c.id } });
  }
  await tx.staffAbsence.update({ where: { id: a.id }, data: { status: "CANCELLED" } });
  await tx.auditEvent.create({ data: { orgId, actorId, action: "absence.cancel", entityType: "StaffAbsence", entityId: a.id } });
}
