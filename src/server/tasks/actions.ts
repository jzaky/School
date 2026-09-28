"use server";

import { revalidatePath } from "next/cache";
import { getCtx } from "@/server/context";
import { tenantTx } from "@/lib/tenant-db";
import { execCtx, type Effect } from "@/server/db";
import { flushEffects } from "@/server/queue";
import { resumeRunsForTask } from "@/server/workflows/engine";

export async function setTaskStatusAction(taskId: string, status: "TODO" | "IN_PROGRESS" | "DONE") {
  const ctx = await getCtx();
  const task = await ctx.db.task.findUnique({ where: { id: taskId } });
  if (!task) return { ok: false };
  const mine = task.assigneeId === ctx.membershipId || task.createdById === ctx.membershipId;
  if (!mine && !ctx.can("cases.manage")) return { ok: false };
  const effects: Effect[] = [];
  await tenantTx(ctx.orgId, async (tx) => {
    await tx.task.update({ where: { id: taskId }, data: { status, completedAt: status === "DONE" ? new Date() : null } });
    if (status === "DONE") {
      if (task.caseId) {
        await tx.timelineEvent.create({ data: { orgId: ctx.orgId, caseId: task.caseId, studentId: task.studentId, actorId: ctx.membershipId, kind: "task", titleEn: `Task done: ${task.titleEn}`, titleAr: `تم إنجاز المهمة: ${task.titleAr}`, staffOnly: true, sensitivity: task.sensitivity } });
      }
      await resumeRunsForTask(execCtx(tx, ctx.orgId, { effects, actorId: ctx.membershipId }), taskId);
    }
  }, { timeout: 30000 });
  await flushEffects(effects);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function createTaskAction(input: { titleEn: string; dueAt?: string | null; assigneeId?: string | null; caseId?: string | null; studentId?: string | null; priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT" }) {
  const ctx = await getCtx();
  if (!ctx.can("tasks.use") || !input.titleEn.trim()) return { ok: false };
  const sensitivity = input.caseId ? (await ctx.db.case.findUnique({ where: { id: input.caseId } }))?.sensitivity ?? "STANDARD" : "STANDARD";
  await ctx.db.task.create({
    data: {
      orgId: ctx.orgId,
      titleEn: input.titleEn.trim(),
      titleAr: input.titleEn.trim(),
      dueAt: input.dueAt ? new Date(input.dueAt) : null,
      assigneeId: input.assigneeId ?? ctx.membershipId,
      createdById: ctx.membershipId,
      caseId: input.caseId ?? null,
      studentId: input.studentId ?? null,
      priority: input.priority ?? "MEDIUM",
      sensitivity,
      href: input.caseId ? `/cases/${input.caseId}` : null,
    },
  });
  revalidatePath("/", "layout");
  return { ok: true };
}
