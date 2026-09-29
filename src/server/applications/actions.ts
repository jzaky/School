"use server";

import { revalidatePath } from "next/cache";
import { getCtx } from "@/server/context";
import { tenantTx } from "@/lib/tenant-db";
import { execCtx, type Effect } from "@/server/db";
import { flushEffects } from "@/server/queue";
import { audit } from "@/server/audit/audit";
import { applicationStudentIds, canEditItems, readableApplication, viewerOf } from "./access";
import { assignRecommendation, changeStage, generateTasks, saveNotes, setDecisionPlan, setItemDue, setItemStatus, startApplication, syncLetterTask, LEDGER_LETTER, LEDGER_QUEUE } from "./service";
import { ITEM_STATUSES, STAGES, type ItemStatus, type Stage } from "./types";
import { SUBMISSION_KINDS } from "./deadlines";

type R = { ok: true; id?: string } | { ok: false; error: string };
const done = () => revalidatePath("/", "layout");

/** Start an application from a shortlist entry or directly from a programme. Students start their own; managers anyone's. */
export async function startApplicationAction(input: { shortlistEntryId?: string; programId?: string; studentId?: string }): Promise<R> {
  const ctx = await getCtx();
  const v = viewerOf(ctx);
  if (v !== "manager" && v !== "student") return { ok: false, error: "forbidden" };
  const studentId = v === "student" ? ctx.membership.student?.id : input.studentId;
  if (!studentId) return { ok: false, error: "not_found" };
  const res = await tenantTx(ctx.orgId, (tx) => startApplication(tx, ctx.orgId, { studentId, shortlistEntryId: input.shortlistEntryId ?? null, programId: input.programId ?? null, actorId: ctx.membershipId, counselorId: null }), { timeout: 30000 });
  if (!res.ok) return res;
  done();
  return { ok: true, id: res.applicationId };
}

export async function changeStageAction(input: { applicationId: string; stage: string }): Promise<R> {
  const ctx = await getCtx();
  if (!(STAGES as readonly string[]).includes(input.stage)) return { ok: false, error: "invalid" };
  const app = await readableApplication(ctx, input.applicationId);
  if (!app) return { ok: false, error: "not_found" };
  const v = viewerOf(ctx);
  if (v === "parent" || v === "none" || !(await canEditItems(ctx, app.studentId))) return { ok: false, error: "forbidden" };
  const res = await tenantTx(ctx.orgId, (tx) => changeStage(tx, ctx.orgId, { applicationId: app.id, to: input.stage as Stage, actor: v === "manager" ? "staff" : "student", actorId: ctx.membershipId }), { timeout: 30000 });
  if (!res.ok) return res;
  done();
  return { ok: true };
}

export async function setItemStatusAction(input: { itemId: string; status: string }): Promise<R> {
  const ctx = await getCtx();
  if (!(ITEM_STATUSES as readonly string[]).includes(input.status)) return { ok: false, error: "invalid" };
  const item = await ctx.db.applicationRequirement.findFirst({ where: { id: input.itemId, orgId: ctx.orgId } });
  const app = item ? await readableApplication(ctx, item.applicationId) : null;
  if (!item || !app || !(await canEditItems(ctx, app.studentId))) return { ok: false, error: "forbidden" };
  // Students cannot waive items or tick off a recommendation letter: those are the school's to record.
  if (viewerOf(ctx) !== "manager" && (input.status === "WAIVED" || item.kind === "RECOMMENDATION")) return { ok: false, error: "forbidden" };
  await tenantTx(ctx.orgId, (tx) => setItemStatus(tx, ctx.orgId, { itemId: item.id, status: input.status as ItemStatus, actorId: ctx.membershipId }));
  done();
  return { ok: true };
}

export async function setItemDueAction(input: { itemId: string; dueAt: string | null }): Promise<R> {
  const ctx = await getCtx();
  if (viewerOf(ctx) !== "manager") return { ok: false, error: "forbidden" };
  const due = input.dueAt ? new Date(`${input.dueAt}T12:00:00Z`) : null;
  if (due && Number.isNaN(due.getTime())) return { ok: false, error: "invalid" };
  const res = await tenantTx(ctx.orgId, (tx) => setItemDue(tx, ctx.orgId, { itemId: input.itemId, dueAt: due, actorId: ctx.membershipId }));
  if (!res.ok) return { ok: false, error: "not_found" };
  done();
  return { ok: true };
}

export async function assignRecommendationAction(input: { itemId: string; teacherId: string }): Promise<R> {
  const ctx = await getCtx();
  if (viewerOf(ctx) !== "manager") return { ok: false, error: "forbidden" };
  const effects: Effect[] = [];
  const res = await tenantTx(ctx.orgId, (tx) => assignRecommendation(execCtx(tx, ctx.orgId, { effects, actorId: ctx.membershipId }), { itemId: input.itemId, teacherId: input.teacherId, actorId: ctx.membershipId }), { timeout: 30000 });
  await flushEffects(effects);
  if (!res.ok) return res;
  done();
  return { ok: true };
}

/** Bulk or single "generate tasks". Managers only. */
export async function generateTasksAction(input: { applicationIds: string[] }): Promise<{ ok: true; created: number; archived: number } | { ok: false; error: string }> {
  const ctx = await getCtx();
  if (viewerOf(ctx) !== "manager") return { ok: false, error: "forbidden" };
  const ids = [...new Set(input.applicationIds)].slice(0, 200);
  let created = 0;
  let archived = 0;
  for (const id of ids) {
    const r = await tenantTx(ctx.orgId, (tx) => generateTasks(tx, ctx.orgId, id, { actorId: ctx.membershipId }), { timeout: 30000 });
    created += r.created;
    archived += r.archived;
  }
  done();
  return { ok: true, created, archived };
}

export async function saveNotesAction(input: { applicationId: string; notes: string }): Promise<R> {
  const ctx = await getCtx();
  if (viewerOf(ctx) !== "manager") return { ok: false, error: "forbidden" };
  const res = await tenantTx(ctx.orgId, (tx) => saveNotes(tx, ctx.orgId, { applicationId: input.applicationId, notes: input.notes, actorId: ctx.membershipId }));
  if (!res.ok) return { ok: false, error: "not_found" };
  done();
  return { ok: true };
}

export async function setDecisionPlanAction(input: { applicationId: string; decisionPlan: string | null }): Promise<R> {
  const ctx = await getCtx();
  if (viewerOf(ctx) !== "manager") return { ok: false, error: "forbidden" };
  if (input.decisionPlan && !(SUBMISSION_KINDS as readonly string[]).includes(input.decisionPlan)) return { ok: false, error: "invalid" };
  const res = await tenantTx(ctx.orgId, (tx) => setDecisionPlan(tx, ctx.orgId, { applicationId: input.applicationId, decisionPlan: input.decisionPlan, actorId: ctx.membershipId }), { timeout: 30000 });
  if (!res.ok) return { ok: false, error: "not_found" };
  done();
  return { ok: true };
}

export async function setCounselorAction(input: { applicationId: string; counselorId: string | null }): Promise<R> {
  const ctx = await getCtx();
  if (viewerOf(ctx) !== "manager") return { ok: false, error: "forbidden" };
  if ((await applicationStudentIds(ctx)) !== null) return { ok: false, error: "forbidden" };
  const app = await ctx.db.application.findFirst({ where: { id: input.applicationId, orgId: ctx.orgId } });
  if (!app) return { ok: false, error: "not_found" };
  if (input.counselorId && !(await ctx.db.membership.findFirst({ where: { id: input.counselorId, orgId: ctx.orgId, status: "ACTIVE", staffProfile: { isNot: null } } }))) return { ok: false, error: "invalid" };
  await tenantTx(ctx.orgId, async (tx) => {
    await tx.application.update({ where: { id: app.id }, data: { counselorId: input.counselorId } });
    await audit(tx, ctx.orgId, { actorId: ctx.membershipId, action: "applications.counselor", entityType: "Application", entityId: app.id, meta: { from: app.counselorId, to: input.counselorId } });
  });
  done();
  return { ok: true };
}

/** The teacher marks a requested letter as sent. Only the teacher the task is assigned to. */
export async function markLetterSentAction(input: { taskId: string }): Promise<R> {
  const ctx = await getCtx();
  const task = await ctx.db.task.findFirst({ where: { id: input.taskId, orgId: ctx.orgId, assigneeId: ctx.membershipId } });
  if (!task) return { ok: false, error: "not_found" };
  const isLetter = await ctx.db.jobRun.count({ where: { orgId: ctx.orgId, queue: LEDGER_QUEUE, name: LEDGER_LETTER, result: { path: ["taskId"], equals: task.id } } });
  if (!isLetter) return { ok: false, error: "not_found" };
  await tenantTx(ctx.orgId, async (tx) => {
    await tx.task.update({ where: { id: task.id }, data: { status: "DONE", completedAt: new Date() } });
    await syncLetterTask(tx, ctx.orgId, task.id, "DONE");
    const item = await tx.applicationRequirement.findFirst({ where: { orgId: ctx.orgId, taskId: task.id } });
    await audit(tx, ctx.orgId, { actorId: ctx.membershipId, action: "applications.letter.sent", entityType: "Application", entityId: item?.applicationId ?? null, meta: { taskId: task.id } });
  });
  done();
  return { ok: true };
}
