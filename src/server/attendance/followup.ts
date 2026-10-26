// Unexplained absences: the automatic guardian message, the attendance office's call and message log, and
// explaining an absence. No "server-only" marker: the worker runs the job.
//
// - From the school's follow-up time (for example 09:30) on a school day, guardians of each student marked
//   "absent, reason not known yet" on the daily register, with no absence report, get one message through notify().
//   One AttendanceFollowUp row per student and day is the idempotency anchor: the message is claimed by setting
//   notifiedAt, so a retried or repeated job never sends twice. notify() applies each guardian's preferences.
// - Rule 7: when the student has an open WELLBEING or SAFEGUARDING case or request (asked through
//   src/server/access/case-access.ts, which returns ids only), no automatic message is sent. The follow-up is
//   marked HELD and the attendance office is asked to contact the family by hand. A staff message to a held family
//   needs a recorded reason.
import type { Effect } from "@/server/db";
import { execCtx } from "@/server/db";
import { tenantDb, tenantTx, type TenantTx } from "@/lib/tenant-db";
import { notify } from "@/server/notify/notify";
import { audit } from "@/server/audit/audit";
import { studentsHeldFromAutoContact } from "@/server/access/case-access";
import { keyToDate } from "@/server/timetable/cover";
import { isUnexplained, resolveCode, statusOf, type Code } from "./codes";
import { holidayKeys, loadCodes, loadSettings, localClock, toMin } from "./settings";
import { canManage, RegisterError, seesReasons, type AttViewer } from "./registers";

export const FOLLOWUP_TEMPLATES = [
  {
    key: "attendance_unexplained",
    subject: { en: "{{student}} is marked absent today", ar: "{{student}} مسجّل/ة غائبًا اليوم" },
    body: {
      en: "{{student}} was marked absent at school today, {{date}}, and we have no absence report. If you know why, please report the absence in Horizon or contact the school office. If you believe {{student}} is at school, please call the school office now.",
      ar: "سُجّل {{student}} غائبًا عن المدرسة اليوم، {{date}}، ولم يصلنا بلاغ غياب. إذا كنتم تعرفون السبب، يُرجى الإبلاغ عن الغياب في منصة هورايزن أو التواصل مع مكتب المدرسة. وإذا كنتم تعتقدون أن {{student}} في المدرسة، يُرجى الاتصال بمكتب المدرسة فورًا.",
    },
  },
  {
    key: "attendance_office_message",
    subject: { en: "A message from the attendance office about {{student}}", ar: "رسالة من مكتب الحضور بشأن {{student}}" },
    body: { en: "{{message}}", ar: "{{message}}" },
  },
  {
    key: "attendance_contact_by_hand",
    subject: { en: "Please contact a family by hand: {{student}}", ar: "يُرجى التواصل مع الأسرة مباشرة: {{student}}" },
    body: {
      en: "{{student}} is absent today without a report. The school asked that this family is not messaged automatically. Please contact them yourself and log the call in the attendance office.",
      ar: "{{student}} غائب/ة اليوم دون بلاغ غياب. طلبت المدرسة عدم مراسلة هذه الأسرة تلقائيًا. يُرجى التواصل معها بنفسك وتسجيل الاتصال في مكتب الحضور.",
    },
  },
  {
    key: "attendance_persistent",
    subject: { en: "Attendance below {{threshold}}%: {{student}}", ar: "نسبة الحضور أقل من {{threshold}}%: {{student}}" },
    body: {
      en: "{{student}}'s attendance this term is {{pct}}%, below the school's threshold of {{threshold}}%. Open the attendance report to see the pattern and plan support. Reasons for absence are not shown here.",
      ar: "نسبة حضور {{student}} في هذا الفصل {{pct}}%، وهي أقل من الحد الذي حددته المدرسة ({{threshold}}%). افتح تقرير الحضور للاطلاع على النمط والتخطيط للدعم. لا تظهر أسباب الغياب هنا.",
    },
  },
  {
    key: "attendance_limit_warning",
    subject: { en: "Nearing the absence limit: {{student}}", ar: "اقتراب من حد الغياب: {{student}}" },
    body: {
      en: "{{student}} has {{total}} school days of unexcused absence this year, with at most {{consecutive}} in a row. The limit the school follows is {{limitConsecutive}} days in a row or {{limitTotal}} days in total. Reasons for absence are not shown here.",
      ar: "لدى {{student}} {{total}} يومًا دراسيًا من الغياب بدون عذر هذا العام، أطولها {{consecutive}} أيام متتالية. الحد الذي تتبعه المدرسة {{limitConsecutive}} أيام متتالية أو {{limitTotal}} يومًا إجمالًا. لا تظهر أسباب الغياب هنا.",
    },
  },
  {
    key: "attendance_limit_reached",
    subject: { en: "Absence limit reached: {{student}}", ar: "بلوغ حد الغياب: {{student}}" },
    body: {
      en: "{{student}} has reached the absence limit the school follows: {{total}} school days of unexcused absence this year, with at most {{consecutive}} in a row (limit {{limitConsecutive}} in a row or {{limitTotal}} in total). Check the record and follow the school's procedure with the regulator. Reasons for absence are not shown here.",
      ar: "بلغ {{student}} حد الغياب الذي تتبعه المدرسة: {{total}} يومًا دراسيًا من الغياب بدون عذر هذا العام، أطولها {{consecutive}} أيام متتالية (الحد {{limitConsecutive}} أيام متتالية أو {{limitTotal}} يومًا إجمالًا). راجع السجل واتبع إجراءات المدرسة مع الجهة التنظيمية. لا تظهر أسباب الغياب هنا.",
    },
  },
] as const;

export async function ensureFollowUpTemplates(tx: TenantTx, orgId: string) {
  const have = await tx.messageTemplate.findMany({ where: { orgId, channel: "EMAIL", key: { in: FOLLOWUP_TEMPLATES.map((t) => t.key as string) } }, select: { key: true } });
  const missing = FOLLOWUP_TEMPLATES.filter((t) => !have.some((h) => h.key === t.key));
  if (missing.length)
    await tx.messageTemplate.createMany({
      data: missing.map((t) => ({ orgId, key: t.key, channel: "EMAIL" as const, subjectEn: t.subject.en, subjectAr: t.subject.ar, bodyEn: t.body.en, bodyAr: t.body.ar })),
      skipDuplicates: true,
    });
}

const bilingualDate = (k: string) => ({
  en: new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(keyToDate(k)),
  ar: new Intl.DateTimeFormat("ar-AE-u-nu-latn", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(keyToDate(k)),
});
const nameOf = (s: { firstNameEn: string; lastNameEn: string; firstNameAr: string; lastNameAr: string }) => ({ en: `${s.firstNameEn} ${s.lastNameEn}`, ar: `${s.firstNameAr || s.firstNameEn} ${s.lastNameAr || s.lastNameEn}` });

/** Create follow-ups for daily marks that are unexplained absences (no report). Safe to repeat. */
export async function ensureFollowUps(tx: TenantTx, orgId: string, date: Date, codes: Code[]) {
  const absent = await tx.attendanceRecord.findMany({ where: { orgId, date, status: "ABSENT", requestId: null }, select: { studentId: true, code: true, status: true } });
  const ids = absent.filter((r) => {
    const c = resolveCode(codes, r.code, r.status);
    return c && isUnexplained(c);
  });
  if (ids.length) await tx.attendanceFollowUp.createMany({ data: ids.map((r) => ({ orgId, studentId: r.studentId, date })), skipDuplicates: true });
  return ids.length;
}

export type FollowUpRun = { skipped?: string; created: number; notified: number; held: number; off: number; noGuardian: number };

/**
 * The unexplained absence job for one school. Runs every few minutes from the worker; does nothing before the
 * school's follow-up time, on weekends and holidays. Each student and day is messaged at most once.
 */
export async function runFollowUp(orgId: string, opts: { now?: Date; flush?: (effects: Effect[]) => Promise<void>; /** The office's "Send now": skip the time-of-day wait. */ force?: boolean } = {}): Promise<FollowUpRun> {
  const now = opts.now ?? new Date();
  const db = tenantDb(orgId);
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { timezone: true, weekDays: true } });
  if (!org) return { skipped: "noOrg", created: 0, notified: 0, held: 0, off: 0, noGuardian: 0 };
  const settings = await loadSettings(db);
  const clock = localClock(now, org.timezone || "Asia/Dubai");
  const weekDays = org.weekDays.length ? org.weekDays : [1, 2, 3, 4, 5];
  const out: FollowUpRun = { created: 0, notified: 0, held: 0, off: 0, noGuardian: 0 };
  if (!weekDays.includes(clock.weekday)) return { ...out, skipped: "weekend" };
  if (clock.minute < toMin(settings.followUpTime) && !opts.force) return { ...out, skipped: "early" };
  const date = keyToDate(clock.dateKey);
  if ((await holidayKeys(db, clock.dateKey, clock.dateKey, org.timezone || "Asia/Dubai")).has(clock.dateKey)) return { ...out, skipped: "holiday" };
  const { codes } = await loadCodes(db);
  const effects: Effect[] = [];

  await tenantTx(
    orgId,
    async (tx) => {
      out.created = await ensureFollowUps(tx, orgId, date, codes);
      const pending = await tx.attendanceFollowUp.findMany({ where: { orgId, date, status: { not: "EXPLAINED" }, notifiedAt: null, heldReason: null } });
      if (!pending.length) return;
      // Only students still marked as an unexplained absence (a teacher may have corrected the mark since).
      const records = await tx.attendanceRecord.findMany({ where: { orgId, date, studentId: { in: pending.map((p) => p.studentId) } }, select: { studentId: true, code: true, status: true, requestId: true } });
      const still = pending.filter((p) => {
        const r = records.find((x) => x.studentId === p.studentId);
        const c = r ? resolveCode(codes, r.code, r.status) : undefined;
        return r && !r.requestId && c && isUnexplained(c);
      });
      if (!still.length) return;
      await ensureFollowUpTemplates(tx, orgId);
      const held = await studentsHeldFromAutoContact(tx, orgId, still.map((p) => p.studentId));
      const students = await tx.student.findMany({
        where: { orgId, id: { in: still.map((p) => p.studentId) } },
        select: { id: true, firstNameEn: true, lastNameEn: true, firstNameAr: true, lastNameAr: true, guardians: { where: { receivesUpdates: true }, select: { guardian: { select: { membershipId: true } } } } },
      });
      const office = await tx.membership.findMany({ where: { orgId, status: "ACTIVE", roles: { some: { role: { permissions: { has: "attendance.manage" } } } } }, select: { id: true } });
      const ec = execCtx(tx, orgId, { now, effects });
      for (const f of still) {
        const s = students.find((x) => x.id === f.studentId);
        if (!s) continue;
        const guardians = s.guardians.map((g) => g.guardian.membershipId).filter(Boolean) as string[];
        const reason = held.has(f.studentId) ? "HELD" : !settings.autoNotify ? "OFF" : !guardians.length ? "NO_GUARDIAN" : null;
        if (reason) {
          // Claim the decision once: concurrent runs cannot both route it.
          const claim = await tx.attendanceFollowUp.updateMany({ where: { id: f.id, heldReason: null, notifiedAt: null }, data: { heldReason: reason } });
          if (claim.count !== 1) continue;
          if (reason === "HELD") {
            out.held++;
            await notify(ec, {
              recipients: office.map((o) => o.id),
              templateKey: "attendance_contact_by_hand",
              kind: "attendance_contact_by_hand",
              vars: { student: nameOf(s) },
              href: `/attendance/office?date=${clock.dateKey}`,
              channels: ["IN_APP"],
              idempotencyBase: `att-held:${f.studentId}:${clock.dateKey}`,
            });
          } else if (reason === "OFF") out.off++;
          else out.noGuardian++;
          continue;
        }
        const claim = await tx.attendanceFollowUp.updateMany({ where: { id: f.id, notifiedAt: null, heldReason: null }, data: { notifiedAt: now } });
        if (claim.count !== 1) continue;
        await notify(ec, {
          recipients: guardians,
          templateKey: "attendance_unexplained",
          kind: "attendance_unexplained",
          vars: { student: nameOf(s), date: bilingualDate(clock.dateKey) },
          href: `/children/${s.id}`,
          idempotencyBase: `att-unexplained:${f.studentId}:${clock.dateKey}`,
        });
        await tx.attendanceContact.create({ data: { orgId, followUpId: f.id, kind: "AUTO_MESSAGE", createdAt: now } });
        out.notified++;
      }
      if (out.notified || out.held) await audit(tx, orgId, { action: "attendance.followup_run", entityType: "AttendanceFollowUp", meta: { date: clock.dateKey, notified: out.notified, held: out.held, off: out.off, noGuardian: out.noGuardian } });
    },
    { timeout: 60_000 },
  );
  if (effects.length) {
    const flush = opts.flush ?? (async (e: Effect[]) => (await import("@/server/queue-core")).flushEffects(e));
    await flush(effects);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Attendance office
// ---------------------------------------------------------------------------

export const PAGE_SIZE = 40;

export type OfficeRow = {
  id: string;
  student: { id: string; firstNameEn: string; lastNameEn: string; firstNameAr: string; lastNameAr: string; studentNo: string; gradeLevel: number; section: string | null };
  status: "OPEN" | "CONTACTED" | "EXPLAINED";
  notifiedAt: Date | null;
  heldReason: string | null;
  explainedCode: string | null;
  homeroom: { id: string; en: string; ar: string } | null;
  guardians: Array<{ name: { en: string; ar: string }; phone: string | null; relationship: { en: string; ar: string } }>;
  contacts: Array<{ id: string; kind: string; outcome: string | null; note: string | null; reason: string | null; by: string | null; at: Date }>;
};

/** Follow-ups for a day, for the attendance office (attendance.manage). Paginated; notes only for reason holders. */
export async function officeDay(v: AttViewer, dateKey: string, opts: { status?: "OPEN" | "CONTACTED" | "EXPLAINED" | "ACTIVE"; page?: number } = {}) {
  if (!canManage(v)) throw new RegisterError("forbidden");
  const date = keyToDate(dateKey);
  const where = { date, ...(opts.status === "ACTIVE" ? { status: { in: ["OPEN" as const, "CONTACTED" as const] } } : opts.status ? { status: opts.status } : {}) };
  const page = Math.max(1, Math.min(500, opts.page ?? 1));
  const [rows, total, counts] = await Promise.all([
    v.db.attendanceFollowUp.findMany({ where, orderBy: [{ status: "asc" }, { createdAt: "asc" }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: { contacts: { orderBy: { createdAt: "asc" } } } }),
    v.db.attendanceFollowUp.count({ where }),
    v.db.attendanceFollowUp.groupBy({ by: ["status"], where: { date }, _count: { _all: true } }),
  ]);
  const ids = rows.map((r) => r.studentId);
  const [students, homerooms] = await Promise.all([
    v.db.student.findMany({
      where: { id: { in: ids } },
      select: {
        id: true, firstNameEn: true, lastNameEn: true, firstNameAr: true, lastNameAr: true, studentNo: true, gradeLevel: true, section: true,
        guardians: { orderBy: { isPrimary: "desc" }, select: { relationshipEn: true, relationshipAr: true, guardian: { select: { firstNameEn: true, lastNameEn: true, firstNameAr: true, lastNameAr: true, phone: true } } } },
      },
    }),
    v.db.enrollment.findMany({ where: { studentId: { in: ids }, status: "ACTIVE", class: { isHomeroom: true, academicYear: { isCurrent: true } } }, select: { studentId: true, class: { select: { id: true, nameEn: true, nameAr: true } } } }),
  ]);
  const staffIds = [...new Set(rows.flatMap((r) => r.contacts.map((c) => c.byId)).filter(Boolean) as string[])];
  const staff = staffIds.length ? await v.db.membership.findMany({ where: { id: { in: staffIds } }, select: { id: true, user: { select: { nameEn: true, nameAr: true } } } }) : [];
  const reasons = seesReasons(v);
  const out: OfficeRow[] = rows
    .map((r) => {
      const s = students.find((x) => x.id === r.studentId);
      if (!s) return null;
      const h = homerooms.find((x) => x.studentId === r.studentId);
      return {
        id: r.id,
        student: { id: s.id, firstNameEn: s.firstNameEn, lastNameEn: s.lastNameEn, firstNameAr: s.firstNameAr, lastNameAr: s.lastNameAr, studentNo: s.studentNo, gradeLevel: s.gradeLevel, section: s.section },
        status: r.status,
        notifiedAt: r.notifiedAt,
        heldReason: r.heldReason,
        explainedCode: r.explainedCode,
        homeroom: h ? { id: h.class.id, en: h.class.nameEn, ar: h.class.nameAr } : null,
        guardians: s.guardians.map((g) => ({ name: nameOf(g.guardian), phone: g.guardian.phone, relationship: { en: g.relationshipEn, ar: g.relationshipAr } })),
        contacts: r.contacts.map((c) => {
          const by = staff.find((m) => m.id === c.byId);
          // What a family said can be a reason for the absence: only the attendance team and the author read it.
          const mayRead = reasons || c.byId === v.membershipId;
          return { id: c.id, kind: c.kind, outcome: c.outcome, note: mayRead ? c.note : c.note ? "" : null, reason: mayRead ? c.reason : c.reason ? "" : null, by: by ? by.user.nameEn + "|" + (by.user.nameAr ?? by.user.nameEn) : null, at: c.createdAt };
        }),
      } satisfies OfficeRow;
    })
    .filter((x): x is OfficeRow => !!x);
  const count = (s: string) => counts.find((c) => c.status === s)?._count._all ?? 0;
  return { rows: out, total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), counts: { OPEN: count("OPEN"), CONTACTED: count("CONTACTED"), EXPLAINED: count("EXPLAINED") } };
}

async function followUpFor(tx: TenantTx, orgId: string, id: string) {
  const f = await tx.attendanceFollowUp.findFirst({ where: { orgId, id } });
  if (!f) throw new RegisterError("notFound");
  return f;
}

/** Log a call or a note on a follow-up. */
export async function logContact(v: AttViewer, followUpId: string, input: { kind: "CALL" | "NOTE"; outcome?: "REACHED" | "NO_ANSWER" | "VOICEMAIL" | null; note?: string | null }, now = new Date()) {
  if (!canManage(v)) throw new RegisterError("forbidden");
  if (!["CALL", "NOTE"].includes(input.kind)) throw new RegisterError("invalid");
  if (input.kind === "CALL" && !["REACHED", "NO_ANSWER", "VOICEMAIL"].includes(String(input.outcome))) throw new RegisterError("invalid");
  const note = input.note?.trim().slice(0, 1000) || null;
  if (input.kind === "NOTE" && !note) throw new RegisterError("invalid");
  return tenantTx(v.orgId, async (tx) => {
    const f = await followUpFor(tx, v.orgId, followUpId);
    const c = await tx.attendanceContact.create({ data: { orgId: v.orgId, followUpId: f.id, kind: input.kind, outcome: input.kind === "CALL" ? input.outcome! : null, note, byId: v.membershipId, createdAt: now } });
    if (f.status === "OPEN" && input.kind === "CALL") await tx.attendanceFollowUp.update({ where: { id: f.id }, data: { status: "CONTACTED" } });
    // The note text is not copied into the audit log.
    await audit(tx, v.orgId, { actorId: v.membershipId, action: "attendance.followup_contact", entityType: "AttendanceFollowUp", entityId: f.id, meta: { kind: input.kind, outcome: c.outcome, note: Boolean(note) } });
    return c;
  });
}

/**
 * Staff message to the student's guardians. When the automatic message was held (rule 7) the message is a
 * staff decision and needs a reason, which is recorded with it.
 */
export async function messageFamily(v: AttViewer, followUpId: string, input: { message: string; reason?: string | null }, now = new Date()): Promise<{ effects: Effect[]; sent: number }> {
  if (!canManage(v)) throw new RegisterError("forbidden");
  const message = input.message.trim();
  if (message.length < 5 || message.length > 1000) throw new RegisterError("invalid");
  const effects: Effect[] = [];
  const sent = await tenantTx(v.orgId, async (tx) => {
    const f = await followUpFor(tx, v.orgId, followUpId);
    const reason = input.reason?.trim().slice(0, 500) || null;
    if (f.heldReason === "HELD" && !reason) throw new RegisterError("reasonRequired");
    const s = await tx.student.findFirst({ where: { orgId: v.orgId, id: f.studentId }, select: { id: true, firstNameEn: true, lastNameEn: true, firstNameAr: true, lastNameAr: true, guardians: { where: { receivesUpdates: true }, select: { guardian: { select: { membershipId: true } } } } } });
    if (!s) throw new RegisterError("notFound");
    const recipients = s.guardians.map((g) => g.guardian.membershipId).filter(Boolean) as string[];
    if (!recipients.length) throw new RegisterError("noGuardian");
    await ensureFollowUpTemplates(tx, v.orgId);
    const c = await tx.attendanceContact.create({ data: { orgId: v.orgId, followUpId: f.id, kind: "MESSAGE", note: message, reason, byId: v.membershipId, createdAt: now } });
    const res = await notify(execCtx(tx, v.orgId, { now, effects, actorId: v.membershipId }), {
      recipients,
      templateKey: "attendance_office_message",
      kind: "parent_update",
      vars: { student: nameOf(s), message },
      href: `/children/${s.id}`,
      idempotencyBase: `att-office-msg:${c.id}`,
    });
    if (f.status === "OPEN") await tx.attendanceFollowUp.update({ where: { id: f.id }, data: { status: "CONTACTED" } });
    await audit(tx, v.orgId, {
      actorId: v.membershipId,
      action: f.heldReason === "HELD" ? "attendance.family_message_decision" : "attendance.family_message",
      entityType: "AttendanceFollowUp",
      entityId: f.id,
      reason,
      meta: { recipients: recipients.length },
    });
    return res.inApp;
  });
  return { effects, sent };
}

/** Explain an absence: recode the day (and the day's unexplained lesson marks) and close the follow-up. Audited with old and new code. */
export async function explainAbsence(v: AttViewer, followUpId: string, code: string, now = new Date()) {
  if (!canManage(v)) throw new RegisterError("forbidden");
  const { codes } = await loadCodes(v.db);
  const target = codes.find((c) => c.code === code && c.active);
  if (!target || isUnexplained(target)) throw new RegisterError("code");
  if (target.private && !seesReasons(v)) throw new RegisterError("code");
  return tenantTx(v.orgId, async (tx) => {
    const f = await followUpFor(tx, v.orgId, followUpId);
    const rec = await tx.attendanceRecord.findUnique({ where: { studentId_date: { studentId: f.studentId, date: f.date } } });
    const status = statusOf(target);
    const from = rec ? (resolveCode(codes, rec.code, rec.status)?.code ?? null) : null;
    if (rec) await tx.attendanceRecord.update({ where: { id: rec.id }, data: { code: target.code, status, minutesLate: target.late ? (rec.minutesLate ?? 1) : null, source: rec.requestId ? rec.source : "OFFICE", markedById: v.membershipId } });
    else await tx.attendanceRecord.create({ data: { orgId: v.orgId, studentId: f.studentId, date: f.date, code: target.code, status, minutesLate: target.late ? 1 : null, source: "OFFICE", markedById: v.membershipId } });
    const unexplained = codes.filter((c) => isUnexplained(c)).map((c) => c.code);
    if (target.countsAs !== "PRESENT") await tx.attendanceLessonMark.updateMany({ where: { orgId: v.orgId, studentId: f.studentId, date: f.date, code: { in: unexplained } }, data: { code: target.code, status, source: "OFFICE", markedById: v.membershipId } });
    await tx.attendanceFollowUp.update({ where: { id: f.id }, data: { status: "EXPLAINED", explainedCode: target.code, explainedById: v.membershipId, explainedAt: now } });
    await audit(tx, v.orgId, { actorId: v.membershipId, action: "attendance.absence_explained", entityType: "AttendanceFollowUp", entityId: f.id, meta: { studentId: f.studentId, date: f.date.toISOString().slice(0, 10), from, to: target.code } });
    return { from, to: target.code };
  });
}
