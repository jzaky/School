"use server";

// Staff actions for government reporting. Each checks its permission, runs in one tenant transaction and writes
// the audit trail (in the service functions).
import { z } from "zod";
import { getCtx, type Ctx } from "@/server/context";
import { tenantTx } from "@/lib/tenant-db";
import { execCtx, type Effect } from "@/server/db";
import { flushEffects } from "@/server/queue";
import { AdmissionError } from "@/server/admissions/access";
import { canFixStudent, canPrepare, canRecordReference, canSignOff, GovError } from "./access";
import { createDueDate, createReturn, deleteDueDate, deleteReturn, fixStudentIdentity, logSubmission, recordReference, setDueDone, signOff, updateDueDate, type Actor } from "./service";

type Ok<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const actorOf = (ctx: Ctx): Actor => ({ membershipId: ctx.membershipId, userId: ctx.user.id });

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof GovError) return { ok: false, error: e.code };
  if (e instanceof AdmissionError) return { ok: false, error: e.code };
  if (e instanceof z.ZodError) return { ok: false, error: "INVALID" };
  throw e;
}

async function run<T>(ctx: Ctx, fn: (ec: ReturnType<typeof execCtx>) => Promise<T>): Promise<T> {
  const effects: Effect[] = [];
  const out = await tenantTx(ctx.orgId, (tx) => fn(execCtx(tx, ctx.orgId, { actorId: ctx.membershipId, effects })), { timeout: 60_000 });
  await flushEffects(effects);
  return out;
}

async function preparer() {
  const ctx = await getCtx();
  if (!canPrepare(ctx)) throw new GovError("FORBIDDEN");
  return ctx;
}

const id = z.string().min(5).max(40);
const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export async function createReturnAction(input: { kind: string; asOf: string; periodFrom?: string | null; label?: string | null; dueDateId?: string | null }): Promise<Ok<{ id: string }>> {
  try {
    const ctx = await preparer();
    const v = z.object({ kind: z.string().max(20), asOf: dateKey, periodFrom: dateKey.nullish(), label: z.string().max(80).nullish(), dueDateId: id.nullish() }).parse(input);
    const r = await run(ctx, (ec) => createReturn(ec, actorOf(ctx), v, ctx.org));
    return { ok: true, id: r.id };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteReturnAction(input: { returnId: string }): Promise<Ok> {
  try {
    const ctx = await preparer();
    const v = z.object({ returnId: id }).parse(input);
    await run(ctx, (ec) => deleteReturn(ec, actorOf(ctx), v.returnId));
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function signOffAction(input: { returnId: string; confirm: boolean }): Promise<Ok<{ version: number }>> {
  try {
    const ctx = await getCtx();
    if (!canSignOff(ctx)) throw new GovError("FORBIDDEN");
    const v = z.object({ returnId: id, confirm: z.literal(true) }).parse(input);
    const out = await run(ctx, (ec) => signOff(ec, ctx.db, actorOf(ctx), v.returnId));
    return { ok: true, version: out.version };
  } catch (e) {
    return fail(e);
  }
}

export async function logSubmissionAction(input: { returnId: string; exportId: string; submittedOn: string; reference: string; note?: string | null }): Promise<Ok> {
  try {
    const ctx = await preparer();
    const v = z.object({ returnId: id, exportId: id, submittedOn: dateKey, reference: z.string().min(1).max(80), note: z.string().max(500).nullish() }).parse(input);
    await run(ctx, (ec) => logSubmission(ec, actorOf(ctx), v.returnId, v));
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

const dueSchema = z.object({ titleEn: z.string().max(120), titleAr: z.string().max(120), kind: z.string().max(20), dueOn: dateKey, notes: z.string().max(500).nullish() });

export async function saveDueDateAction(input: { id?: string | null; titleEn: string; titleAr: string; kind: string; dueOn: string; notes?: string | null }): Promise<Ok> {
  try {
    const ctx = await preparer();
    const v = dueSchema.extend({ id: id.nullish() }).parse(input);
    await run(ctx, async (ec) => {
      if (v.id) await updateDueDate(ec, actorOf(ctx), v.id, v);
      else await createDueDate(ec, actorOf(ctx), v);
    });
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function setDueDoneAction(input: { id: string; done: boolean }): Promise<Ok> {
  try {
    const ctx = await preparer();
    const v = z.object({ id, done: z.boolean() }).parse(input);
    await run(ctx, (ec) => setDueDone(ec, actorOf(ctx), v.id, v.done));
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteDueDateAction(input: { id: string }): Promise<Ok> {
  try {
    const ctx = await preparer();
    const v = z.object({ id }).parse(input);
    await run(ctx, (ec) => deleteDueDate(ec, actorOf(ctx), v.id));
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function fixStudentAction(input: { studentId: string; dateOfBirth?: string | null; gender?: string | null; nationality?: string | null; emiratesId?: string | null }): Promise<Ok<{ fields: string[] }>> {
  try {
    const ctx = await getCtx();
    if (!canPrepare(ctx) || !canFixStudent(ctx)) throw new GovError("FORBIDDEN");
    const v = z.object({ studentId: id, dateOfBirth: dateKey.nullish(), gender: z.enum(["M", "F"]).nullish(), nationality: z.string().max(60).nullish(), emiratesId: z.string().max(30).nullish() }).parse(input);
    const fields = await run(ctx, (ec) => fixStudentIdentity(ec, actorOf(ctx), v.studentId, v));
    return { ok: true, fields };
  } catch (e) {
    return fail(e);
  }
}

export async function recordReferenceAction(input: { studentId: string; status: "SUBMITTED" | "APPROVED"; reference: string; date: string }): Promise<Ok> {
  try {
    const ctx = await getCtx();
    if (!canPrepare(ctx) || !canRecordReference(ctx)) throw new GovError("FORBIDDEN");
    const v = z.object({ studentId: id, status: z.enum(["SUBMITTED", "APPROVED"]), reference: z.string().min(1).max(60), date: dateKey }).parse(input);
    await run(ctx, (ec) => recordReference(ec, actorOf(ctx), v.studentId, v, ctx.org));
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
