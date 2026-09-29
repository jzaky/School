// Application lifecycle: start, checklist, deadlines, stage changes, task generation and recommendation letters.
// Every function takes a tenant transaction (tenantTx) or, in seeds, the owner client, and never logs personal data.
// Idempotency: generated tasks are recorded in JobRun ledger rows (queue "applications") keyed per
// (application, item, cycle, role), so running generation again never creates duplicates.
import type { ApplicationStage, Prisma, Priority } from "@prisma/client";
import type { Tx, ExecCtx } from "@/server/db";
import { audit } from "@/server/audit/audit";
import { notify } from "@/server/notify/notify";
import { personName } from "@/lib/i18n-data";
import type { ProgramRequirements, EnglishReq } from "@/server/pathways/types";
import { buildChecklist, type RequirementRows } from "./checklist";
import { primaryDeadline, resolveDeadlines, type ResolvedDeadline } from "./deadlines";
import { generatePlan, reconcile, type ExistingTask, type PlannedTask } from "./planner";
import { CLOSED_STAGES, DECISION_STAGES, canTransition, intakeYearFor, itemComplete, routeFor, type AppRoute, type ItemKind, type ItemStatus, type Stage } from "./types";

export const LEDGER_QUEUE = "applications";
export const LEDGER_TASK = "task";
export const LEDGER_LETTER = "letter";
export const LETTERS_HREF = "/career/applications/letters";
export const appHref = (id: string) => `/career/applications/${id}`;

type LedgerResult = { taskId: string; itemId: string; role: string; generatedDueAt: string | null; dateLocked: boolean; archivedReason: string | null };

// ---------------------------------------------------------------------------
// Catalog lookups (school rows and global catalog rows are both readable)
// ---------------------------------------------------------------------------

const OXBRIDGE = ["oxford", "cambridge"];

async function programAndUniversity(tx: Tx, programId: string | null, universityId: string | null) {
  const program = programId ? await tx.universityProgram.findFirst({ where: { id: programId } }) : null;
  const uniId = program?.universityId ?? universityId;
  const university = uniId ? await tx.university.findFirst({ where: { id: uniId } }) : null;
  return { program, university };
}

function isOxbridgeOrMedicine(uniKey: string | undefined, program: { field: string; fieldKeys: string[] } | null) {
  return OXBRIDGE.includes(uniKey ?? "") || program?.field === "medicine" || !!program?.fieldKeys.includes("medicine");
}

async function currentRequirementRows(tx: Tx, programId: string, curriculum: string): Promise<RequirementRows | null> {
  const rows = await tx.programRequirement.findMany({
    where: { programId, isCurrent: true, OR: [{ curriculum: null }, { curriculum: curriculum as never }] },
    include: { tests: true, languages: true, additional: true },
  });
  if (!rows.length) return null;
  return {
    tests: rows.flatMap((r) => r.tests.map((t) => ({ test: t.test, policy: t.policy, minScore: t.minScore }))),
    languages: rows.flatMap((r) => r.languages.map((l) => ({ test: l.test, minOverall: l.minOverall }))),
    additional: rows.flatMap((r) => r.additional.map((a) => ({ kind: a.kind, required: a.required, noteEn: a.noteEn, noteAr: a.noteAr }))),
  };
}

/** Find the programme a shortlist entry refers to: its programId, or the same university and programme name. */
export async function programForEntry(tx: Tx, entry: { programId: string | null; universityId: string; programEn: string }) {
  if (entry.programId) {
    const p = await tx.universityProgram.findFirst({ where: { id: entry.programId } });
    if (p) return p;
  }
  return tx.universityProgram.findFirst({ where: { universityId: entry.universityId, nameEn: entry.programEn } });
}

// ---------------------------------------------------------------------------
// Start an application
// ---------------------------------------------------------------------------

export type StartInput = {
  studentId: string;
  programId?: string | null;
  universityId?: string | null;
  shortlistEntryId?: string | null;
  actorId: string | null;
  counselorId?: string | null;
  decisionPlan?: string | null;
  stage?: Stage;
  /** Defaults to the student's next intake as of now. */
  intakeYear?: number;
  now?: Date;
};
export type StartResult = { ok: true; applicationId: string; created: boolean } | { ok: false; error: "not_found" };

export async function startApplication(tx: Tx, orgId: string, input: StartInput): Promise<StartResult> {
  const now = input.now ?? new Date();
  const student = await tx.student.findFirst({ where: { id: input.studentId, orgId } });
  if (!student) return { ok: false, error: "not_found" };
  let programId = input.programId ?? null;
  let universityId = input.universityId ?? null;
  let entryId: string | null = null;
  if (input.shortlistEntryId) {
    const entry = await tx.shortlistEntry.findFirst({ where: { id: input.shortlistEntryId, orgId, studentId: student.id } });
    if (!entry) return { ok: false, error: "not_found" };
    entryId = entry.id;
    universityId = entry.universityId;
    const p = await programForEntry(tx, entry);
    programId = p?.id ?? null;
    if (p && entry.programId !== p.id) await tx.shortlistEntry.update({ where: { id: entry.id }, data: { programId: p.id } });
  }
  const { program, university } = await programAndUniversity(tx, programId, universityId);
  if (!university || (programId && !program)) return { ok: false, error: "not_found" };
  const intakeYear = input.intakeYear ?? intakeYearFor(student.gradeLevel, now);
  const existing = await tx.application.findFirst({ where: { orgId, studentId: student.id, universityId: university.id, programId: program?.id ?? null, intakeYear } });
  if (existing) return { ok: true, applicationId: existing.id, created: false };

  const req = (program?.requirements ?? {}) as ProgramRequirements;
  const route = routeFor(req.route?.via ?? university.applyVia, university.countryCode);
  const counselorId = input.counselorId ?? (await tx.careerProfile.findFirst({ where: { orgId, studentId: student.id }, select: { advisorId: true } }))?.advisorId ?? null;
  const app = await tx.application.create({
    data: {
      orgId,
      studentId: student.id,
      programId: program?.id ?? null,
      universityId: university.id,
      intakeYear,
      stage: input.stage ?? "PREPARING",
      route,
      decisionPlan: input.decisionPlan ?? null,
      counselorId,
      createdAt: now,
    },
  });
  await syncChecklist(tx, orgId, app.id);
  if (entryId) await tx.shortlistEntry.update({ where: { id: entryId }, data: { status: shortlistStatus(app.stage) } });
  await audit(tx, orgId, { actorId: input.actorId, action: "applications.start", entityType: "Application", entityId: app.id, meta: { studentId: student.id, programId: program?.id ?? null, universityId: university.id, route, fromShortlist: !!entryId } });
  return { ok: true, applicationId: app.id, created: true };
}

/** Add any checklist items the route and programme ask for that the application does not have yet. */
export async function syncChecklist(tx: Tx, orgId: string, applicationId: string) {
  const app = await tx.application.findFirst({ where: { id: applicationId, orgId }, include: { items: true } });
  if (!app) return { added: 0 };
  const [{ program, university }, student] = await Promise.all([programAndUniversity(tx, app.programId, app.universityId), tx.student.findFirst({ where: { id: app.studentId }, select: { curriculum: true } })]);
  const req = (program?.requirements ?? {}) as ProgramRequirements;
  const english = (program?.englishReq ?? null) as EnglishReq | null;
  const current = program ? await currentRequirementRows(tx, program.id, student?.curriculum ?? "OTHER") : null;
  const items = buildChecklist({
    route: (app.route ?? "DIRECT") as AppRoute,
    oxbridgeOrMedicine: isOxbridgeOrMedicine(university?.key, program),
    current,
    legacy: { admissionsTests: req.admissionsTests, ielts: english?.ielts ?? null, toefl: english?.toefl ?? null, testPolicy: req.AMERICAN?.testPolicy ?? null },
  });
  const missing = items.filter((i) => !app.items.some((x) => x.kind === i.kind && x.titleEn === i.titleEn));
  if (missing.length) await tx.applicationRequirement.createMany({ data: missing.map((i) => ({ orgId, applicationId: app.id, kind: i.kind, titleEn: i.titleEn, titleAr: i.titleAr })) });
  return { added: missing.length };
}

// ---------------------------------------------------------------------------
// Deadlines
// ---------------------------------------------------------------------------

export async function applicationDeadlines(tx: Tx, app: { programId: string | null; universityId: string; intakeYear: number; route: string | null; decisionPlan: string | null }, today = new Date()) {
  const { program, university } = await programAndUniversity(tx, app.programId, app.universityId);
  const rows = await tx.applicationDeadline.findMany({
    where: { intakeYear: app.intakeYear, OR: [...(app.programId ? [{ programId: app.programId }] : []), { universityId: app.universityId, programId: null }] },
  });
  const all = resolveDeadlines({ programId: app.programId, universityId: app.universityId, intakeYear: app.intakeYear, route: (app.route ?? "DIRECT") as AppRoute, oxbridgeOrMedicine: isOxbridgeOrMedicine(university?.key, program), rows });
  return { all, primary: primaryDeadline(all, app.decisionPlan, today) };
}

/** Deadlines for many applications at once (board and list pages). */
export async function deadlinesFor(tx: Tx, apps: Array<{ id: string; programId: string | null; universityId: string; intakeYear: number; route: string | null; decisionPlan: string | null }>, today = new Date()) {
  const out = new Map<string, { all: ResolvedDeadline[]; primary: ResolvedDeadline | null }>();
  if (!apps.length) return out;
  const programIds = [...new Set(apps.map((a) => a.programId).filter(Boolean))] as string[];
  const uniIds = [...new Set(apps.map((a) => a.universityId))];
  const [rows, programs, unis] = await Promise.all([
    tx.applicationDeadline.findMany({ where: { OR: [{ programId: { in: programIds } }, { universityId: { in: uniIds }, programId: null }] } }),
    tx.universityProgram.findMany({ where: { id: { in: programIds } }, select: { id: true, field: true, fieldKeys: true } }),
    tx.university.findMany({ where: { id: { in: uniIds } }, select: { id: true, key: true } }),
  ]);
  for (const a of apps) {
    const p = programs.find((x) => x.id === a.programId) ?? null;
    const u = unis.find((x) => x.id === a.universityId);
    const all = resolveDeadlines({ programId: a.programId, universityId: a.universityId, intakeYear: a.intakeYear, route: (a.route ?? "DIRECT") as AppRoute, oxbridgeOrMedicine: isOxbridgeOrMedicine(u?.key, p), rows });
    out.set(a.id, { all, primary: primaryDeadline(all, a.decisionPlan, today) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Stage changes
// ---------------------------------------------------------------------------

export function shortlistStatus(stage: ApplicationStage) {
  switch (stage) {
    case "RESEARCHING":
    case "SHORTLISTED":
      return "RESEARCHING" as const;
    case "PREPARING":
      return "PREPARING" as const;
    case "OFFER":
      return "OFFER" as const;
    case "ACCEPTED":
    case "ENROLLED":
      return "ACCEPTED" as const;
    case "REJECTED":
      return "REJECTED" as const;
    default:
      return "SUBMITTED" as const;
  }
}

export type StageResult = { ok: true } | { ok: false; error: "not_found" | "invalid_transition" };

export async function changeStage(tx: Tx, orgId: string, input: { applicationId: string; to: Stage; actor: "student" | "staff"; actorId: string | null; now?: Date }): Promise<StageResult> {
  const now = input.now ?? new Date();
  const app = await tx.application.findFirst({ where: { id: input.applicationId, orgId } });
  if (!app) return { ok: false, error: "not_found" };
  const from = app.stage as Stage;
  if (!canTransition(from, input.to, input.actor)) return { ok: false, error: "invalid_transition" };
  const data: Prisma.ApplicationUpdateInput = { stage: input.to };
  if (input.to === "SUBMITTED" && !app.submittedAt) data.submittedAt = now;
  if (DECISION_STAGES.includes(input.to)) data.decidedAt = now;
  await tx.application.update({ where: { id: app.id }, data });
  if (input.to === "SUBMITTED") await tx.applicationRequirement.updateMany({ where: { orgId, applicationId: app.id, kind: "FORM", status: { in: ["TODO", "IN_PROGRESS"] } }, data: { status: "DONE" } });
  if (app.programId) await tx.shortlistEntry.updateMany({ where: { orgId, studentId: app.studentId, programId: app.programId }, data: { status: shortlistStatus(input.to) } });
  await audit(tx, orgId, { actorId: input.actorId, action: "applications.stage", entityType: "Application", entityId: app.id, meta: { from, to: input.to } });
  // Closing an application archives its open tasks; moving on refreshes the plan.
  if (await hasLedger(tx, orgId, app.id)) await generateTasks(tx, orgId, app.id, { now, actorId: input.actorId });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Task generation
// ---------------------------------------------------------------------------

async function hasLedger(tx: Tx, orgId: string, applicationId: string) {
  return (await tx.jobRun.count({ where: { orgId, queue: LEDGER_QUEUE, name: LEDGER_TASK, idempotencyKey: { startsWith: `app:${applicationId}:` } } })) > 0;
}

async function ledgerFor(tx: Tx, orgId: string, applicationId: string) {
  const rows = await tx.jobRun.findMany({ where: { orgId, queue: LEDGER_QUEUE, name: LEDGER_TASK, idempotencyKey: { startsWith: `app:${applicationId}:` } } });
  const ids = rows.map((r) => (r.result as LedgerResult | null)?.taskId).filter(Boolean) as string[];
  const tasks = ids.length ? await tx.task.findMany({ where: { id: { in: ids } } }) : [];
  const existing: ExistingTask[] = [];
  for (const r of rows) {
    const res = r.result as LedgerResult | null;
    const task = res && tasks.find((t) => t.id === res.taskId);
    if (!res || !task) continue;
    existing.push({ key: r.idempotencyKey, taskId: task.id, status: task.status, dueAt: task.dueAt, generatedDueAt: res.generatedDueAt ? new Date(res.generatedDueAt) : null, dateLocked: !!res.dateLocked, archivedReason: res.archivedReason ?? null });
  }
  return { rows, existing };
}

async function writeLedger(tx: Tx, orgId: string, key: string, patch: Partial<LedgerResult>) {
  const row = await tx.jobRun.findUnique({ where: { orgId_idempotencyKey: { orgId, idempotencyKey: key } } });
  const result = { ...((row?.result as LedgerResult | null) ?? {}), ...patch };
  await tx.jobRun.update({ where: { orgId_idempotencyKey: { orgId, idempotencyKey: key } }, data: { result: result as Prisma.InputJsonValue, status: "COMPLETED", finishedAt: new Date() } });
}

export type GenerateResult = { created: number; updated: number; archived: number; kept: number; deadline: ResolvedDeadline | null };

/**
 * Generate or refresh the application's tasks. Safe to run any number of times: tasks are keyed per
 * (application, item, cycle, role); completed tasks, hand-edited and locked dates are kept, and tasks that no
 * longer apply are archived (cancelled) with a reason.
 */
export async function generateTasks(tx: Tx, orgId: string, applicationId: string, opts: { now?: Date; actorId?: string | null; audit?: boolean } = {}): Promise<GenerateResult> {
  const now = opts.now ?? new Date();
  const app = await tx.application.findFirst({ where: { id: applicationId, orgId }, include: { items: true } });
  if (!app) return { created: 0, updated: 0, archived: 0, kept: 0, deadline: null };
  const student = await tx.student.findFirst({ where: { id: app.studentId }, select: { membershipId: true } });
  const { primary } = await applicationDeadlines(tx, app, now);
  const closed = CLOSED_STAGES.includes(app.stage as Stage);
  const submitted = !["RESEARCHING", "SHORTLISTED", "PREPARING"].includes(app.stage);

  let plan: PlannedTask[] = closed
    ? []
    : generatePlan({
        applicationId: app.id,
        cycle: app.intakeYear,
        items: app.items.map((i) => ({ id: i.id, kind: i.kind as ItemKind, titleEn: i.titleEn, titleAr: i.titleAr, status: i.status, assigned: i.kind === "RECOMMENDATION" && !!i.taskId })),
        deadline: primary?.date ?? null,
        today: now,
      });
  // Nobody to own it: no counselor assigned, or the student has no account.
  plan = plan.filter((t) => (t.role === "counselor" ? !!app.counselorId : !!student?.membershipId));
  // After submission, pre-submission work that was never ticked off is no longer useful as a reminder.
  if (submitted) plan = plan.filter((t) => t.offsetDays > 0);
  const { existing } = await ledgerFor(tx, orgId, app.id);
  const reason = closed ? "Application closed" : submitted ? "Application submitted" : "No longer applicable after the checklist changed";
  const diff = reconcile(plan, existing, reason);

  const assignee = (t: { role: string }) => (t.role === "counselor" ? app.counselorId : student?.membershipId ?? null);
  const descEn = primary ? `Deadline source: ${primary.source === "PROGRAM" ? "programme" : primary.source === "UNIVERSITY" ? "university" : "route default, confirm with the university"}.` : "No deadline date yet.";
  const descAr = primary ? `مصدر الموعد: ${primary.source === "PROGRAM" ? "البرنامج" : primary.source === "UNIVERSITY" ? "الجامعة" : "موعد افتراضي للمسار، يرجى التأكد من الجامعة"}.` : "لا يوجد موعد نهائي بعد.";

  for (const t of diff.create) {
    // Claim the key first: a concurrent run waits on the unique index and then skips.
    const claim = await tx.jobRun.createMany({ data: [{ orgId, queue: LEDGER_QUEUE, name: LEDGER_TASK, idempotencyKey: t.key, status: "RUNNING" }], skipDuplicates: true });
    if (claim.count !== 1) continue;
    const task = await tx.task.create({
      data: { orgId, titleEn: t.titleEn, titleAr: t.titleAr, descEn, descAr, dueAt: t.dueDate, priority: t.priority as Priority, assigneeId: assignee(t), createdById: opts.actorId ?? null, studentId: app.studentId, href: appHref(app.id), createdAt: now },
    });
    await writeLedger(tx, orgId, t.key, { taskId: task.id, itemId: t.itemId, role: t.role, generatedDueAt: t.dueDate?.toISOString() ?? null, dateLocked: false, archivedReason: null });
  }
  for (const u of diff.update) {
    await tx.task.update({
      where: { id: u.taskId },
      data: { titleEn: u.titleEn, titleAr: u.titleAr, priority: u.priority as Priority, dueAt: u.dueAt, ...(u.status ? { status: u.status, completedAt: u.status === "DONE" ? now : null } : {}) },
    });
    await writeLedger(tx, orgId, u.key, { generatedDueAt: u.generatedDueAt?.toISOString() ?? null, dateLocked: u.dateLocked, archivedReason: null });
  }
  for (const a of diff.archive) {
    await tx.task.update({ where: { id: a.taskId }, data: { status: "CANCELLED" } });
    await writeLedger(tx, orgId, a.key, { archivedReason: a.reason });
  }
  // Item due dates follow their task (unless the item is finished or a person locked the date).
  const lockedKeys = new Set(diff.update.filter((u) => u.dateLocked).map((u) => u.key));
  for (const t of plan) {
    const item = app.items.find((i) => i.id === t.itemId);
    if (!item || itemComplete(item.status) || lockedKeys.has(t.key) || (item.kind === "RECOMMENDATION" && item.taskId)) continue;
    const due = t.dueDate;
    if ((item.dueAt?.getTime() ?? null) !== (due?.getTime() ?? null)) await tx.applicationRequirement.update({ where: { id: item.id }, data: { dueAt: due } });
  }
  const result = { created: diff.create.length, updated: diff.update.length, archived: diff.archive.length, kept: diff.keep.length, deadline: primary };
  if (opts.audit !== false && (result.created || result.archived)) {
    await audit(tx, orgId, { actorId: opts.actorId ?? null, action: "applications.tasks.generate", entityType: "Application", entityId: app.id, meta: { created: result.created, updated: result.updated, archived: result.archived, kept: result.kept } });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Checklist items
// ---------------------------------------------------------------------------

export async function setItemStatus(tx: Tx, orgId: string, input: { itemId: string; status: ItemStatus; actorId: string | null; now?: Date }) {
  const now = input.now ?? new Date();
  const item = await tx.applicationRequirement.findFirst({ where: { id: input.itemId, orgId } });
  if (!item) return { ok: false as const, error: "not_found" as const };
  await tx.applicationRequirement.update({ where: { id: item.id }, data: { status: input.status } });
  // Finishing an item completes the tasks generated for it.
  if (itemComplete(input.status)) {
    const rows = await tx.jobRun.findMany({ where: { orgId, queue: LEDGER_QUEUE, name: LEDGER_TASK, idempotencyKey: { startsWith: `app:${item.applicationId}:${item.id}:` } } });
    const ids = rows.map((r) => (r.result as LedgerResult | null)?.taskId).filter(Boolean) as string[];
    if (ids.length) await tx.task.updateMany({ where: { id: { in: ids }, status: { in: ["TODO", "IN_PROGRESS"] } }, data: { status: "DONE", completedAt: now } });
  }
  await audit(tx, orgId, { actorId: input.actorId, action: "applications.item.status", entityType: "Application", entityId: item.applicationId, meta: { itemId: item.id, kind: item.kind, from: item.status, to: input.status } });
  return { ok: true as const, applicationId: item.applicationId };
}

/** Set an item's due date by hand. The date is locked: regeneration keeps it. */
export async function setItemDue(tx: Tx, orgId: string, input: { itemId: string; dueAt: Date | null; actorId: string | null }) {
  const item = await tx.applicationRequirement.findFirst({ where: { id: input.itemId, orgId } });
  if (!item) return { ok: false as const };
  await tx.applicationRequirement.update({ where: { id: item.id }, data: { dueAt: input.dueAt } });
  const rows = await tx.jobRun.findMany({ where: { orgId, queue: LEDGER_QUEUE, name: LEDGER_TASK, idempotencyKey: { startsWith: `app:${item.applicationId}:${item.id}:` } } });
  for (const r of rows) {
    const res = r.result as LedgerResult | null;
    if (!res?.taskId) continue;
    await tx.task.updateMany({ where: { id: res.taskId, status: { in: ["TODO", "IN_PROGRESS"] } }, data: { dueAt: input.dueAt } });
    await writeLedger(tx, orgId, r.idempotencyKey, { dateLocked: true });
  }
  await audit(tx, orgId, { actorId: input.actorId, action: "applications.item.due", entityType: "Application", entityId: item.applicationId, meta: { itemId: item.id, locked: true } });
  return { ok: true as const, applicationId: item.applicationId };
}

// ---------------------------------------------------------------------------
// Recommendation letters
// ---------------------------------------------------------------------------

export const letterKey = (applicationId: string, itemId: string, teacherId: string) => `app:${applicationId}:${itemId}:letter:${teacherId}`;

/**
 * Ask a teacher for a recommendation letter. Creates one Task for the teacher (idempotent per item and teacher)
 * and notifies them. Letter content never passes through the platform, so students never see it.
 */
export async function assignRecommendation(ec: ExecCtx, input: { itemId: string; teacherId: string; dueAt?: Date | null; actorId: string | null }) {
  const { tx, orgId, now } = ec;
  const item = await tx.applicationRequirement.findFirst({ where: { id: input.itemId, orgId, kind: "RECOMMENDATION" }, include: { application: true } });
  if (!item) return { ok: false as const, error: "not_found" as const };
  const teacher = await tx.membership.findFirst({ where: { id: input.teacherId, orgId, status: "ACTIVE", staffProfile: { isNot: null } } });
  if (!teacher) return { ok: false as const, error: "not_staff" as const };
  const app = item.application;
  const key = letterKey(app.id, item.id, teacher.id);
  const claim = await tx.jobRun.createMany({ data: [{ orgId, queue: LEDGER_QUEUE, name: LEDGER_LETTER, idempotencyKey: key, status: "RUNNING" }], skipDuplicates: true });
  if (claim.count !== 1) {
    const row = await tx.jobRun.findUnique({ where: { orgId_idempotencyKey: { orgId, idempotencyKey: key } } });
    const taskId = (row?.result as LedgerResult | null)?.taskId ?? null;
    if (taskId && item.taskId !== taskId) await tx.applicationRequirement.update({ where: { id: item.id }, data: { taskId, status: "IN_PROGRESS" } });
    return { ok: true as const, taskId, created: false };
  }
  // Reassigning: the previous teacher's open request is cancelled.
  if (item.taskId) await tx.task.updateMany({ where: { id: item.taskId, status: { in: ["TODO", "IN_PROGRESS"] } }, data: { status: "CANCELLED" } });
  const [student, uni] = await Promise.all([tx.student.findFirst({ where: { id: app.studentId } }), tx.university.findFirst({ where: { id: app.universityId } })]);
  const due = input.dueAt ?? item.dueAt ?? (await applicationDeadlines(tx, app, now)).primary?.date ?? null;
  const letterDue = due ? new Date(Math.max(now.getTime(), due.getTime() - 14 * 86_400_000)) : null;
  const nameEn = student ? personName(student, "en") : "";
  const nameAr = student ? personName(student, "ar") : "";
  const task = await tx.task.create({
    data: {
      orgId,
      titleEn: `Recommendation letter: ${nameEn}, ${uni?.nameEn ?? ""}`,
      titleAr: `خطاب توصية: ${nameAr}، ${uni?.nameAr ?? ""}`,
      descEn: `${item.titleEn}. Submit the letter through the university or application portal, then mark this task done.`,
      descAr: `${item.titleAr}. أرسل الخطاب عبر بوابة الجامعة أو بوابة التقديم، ثم علّم هذه المهمة كمنجزة.`,
      dueAt: letterDue,
      priority: "HIGH",
      assigneeId: teacher.id,
      createdById: input.actorId,
      studentId: app.studentId,
      href: LETTERS_HREF,
      createdAt: now,
    },
  });
  await writeLedger(tx, orgId, key, { taskId: task.id, itemId: item.id, role: "teacher", generatedDueAt: letterDue?.toISOString() ?? null, dateLocked: false, archivedReason: null });
  await tx.applicationRequirement.update({ where: { id: item.id }, data: { taskId: task.id, status: "IN_PROGRESS", dueAt: letterDue } });
  await ensureTemplates(tx, orgId);
  await notify(ec, {
    recipients: [teacher.id],
    templateKey: "application_letter_request",
    kind: "task_assigned",
    vars: { student: { en: nameEn, ar: nameAr }, university: { en: uni?.nameEn ?? "", ar: uni?.nameAr ?? uni?.nameEn ?? "" } },
    href: LETTERS_HREF,
    idempotencyBase: `${key}:notify`,
  });
  await audit(tx, orgId, { actorId: input.actorId, action: "applications.letter.assign", entityType: "Application", entityId: app.id, meta: { itemId: item.id, teacherId: teacher.id, taskId: task.id } });
  return { ok: true as const, taskId: task.id, created: true };
}

/** A letter task was completed (by the teacher, from the letters page or the task list): the checklist item is done. */
export async function syncLetterTask(tx: Tx, orgId: string, taskId: string, status: string) {
  const item = await tx.applicationRequirement.findFirst({ where: { orgId, taskId, kind: "RECOMMENDATION" } });
  if (!item) return false;
  const next = status === "DONE" ? "DONE" : "IN_PROGRESS";
  if (item.status !== next) await tx.applicationRequirement.update({ where: { id: item.id }, data: { status: next } });
  return true;
}

// ---------------------------------------------------------------------------
// Notes, counselor and decision plan
// ---------------------------------------------------------------------------

export async function saveNotes(tx: Tx, orgId: string, input: { applicationId: string; notes: string; actorId: string | null }) {
  const app = await tx.application.findFirst({ where: { id: input.applicationId, orgId } });
  if (!app) return { ok: false as const };
  await tx.application.update({ where: { id: app.id }, data: { notes: input.notes.slice(0, 4000) || null } });
  // The note text stays on the application; the audit row only records that it changed.
  await audit(tx, orgId, { actorId: input.actorId, action: "applications.notes", entityType: "Application", entityId: app.id, meta: { length: input.notes.length } });
  return { ok: true as const };
}

export async function setDecisionPlan(tx: Tx, orgId: string, input: { applicationId: string; decisionPlan: string | null; actorId: string | null; now?: Date }) {
  const app = await tx.application.findFirst({ where: { id: input.applicationId, orgId } });
  if (!app) return { ok: false as const };
  await tx.application.update({ where: { id: app.id }, data: { decisionPlan: input.decisionPlan } });
  await audit(tx, orgId, { actorId: input.actorId, action: "applications.plan", entityType: "Application", entityId: app.id, meta: { from: app.decisionPlan, to: input.decisionPlan } });
  if (await hasLedger(tx, orgId, app.id)) await generateTasks(tx, orgId, app.id, { now: input.now, actorId: input.actorId, audit: false });
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// Message templates this module sends (created on first use, per school)
// ---------------------------------------------------------------------------

const TEMPLATES = [
  {
    key: "application_letter_request",
    subjectEn: "Recommendation letter requested: {{student}}",
    subjectAr: "طلب خطاب توصية: {{student}}",
    bodyEn: "Please write a recommendation letter for {{student}} ({{university}}). Open Horizon to see the due date.",
    bodyAr: "يرجى كتابة خطاب توصية للطالب {{student}} ({{university}}). افتح Horizon لمعرفة الموعد النهائي.",
  },
  {
    key: "application_reminder",
    subjectEn: "Application step due {{when}}: {{title}}",
    subjectAr: "خطوة في طلب الالتحاق مستحقة {{when}}: {{title}}",
    bodyEn: "{{title}} is due {{when}}. Open your applications to see the checklist.",
    bodyAr: "{{title}} مستحقة {{when}}. افتح طلبات الالتحاق لعرض قائمة المتطلبات.",
  },
  {
    key: "application_digest",
    subjectEn: "{{count}} application steps need attention",
    subjectAr: "{{count}} من خطوات طلبات الالتحاق تحتاج إلى متابعة",
    bodyEn: "{{count}} application steps for your students are overdue or due within 14 days.",
    bodyAr: "{{count}} من خطوات طلبات الالتحاق لطلابك متأخرة أو مستحقة خلال 14 يوما.",
  },
];

export async function ensureTemplates(tx: Tx, orgId: string) {
  const have = await tx.messageTemplate.findMany({ where: { orgId, key: { in: TEMPLATES.map((t) => t.key) }, channel: "EMAIL" }, select: { key: true } });
  const missing = TEMPLATES.filter((t) => !have.some((h) => h.key === t.key));
  if (missing.length) await tx.messageTemplate.createMany({ data: missing.map((t) => ({ orgId, channel: "EMAIL" as const, ...t })), skipDuplicates: true });
}
