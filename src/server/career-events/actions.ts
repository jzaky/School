"use server";

import { revalidatePath } from "next/cache";
import type { CareerEventKind } from "@prisma/client";
import { getCtx, type Ctx } from "@/server/context";
import { tenantTx } from "@/lib/tenant-db";
import { execCtx, type Effect } from "@/server/db";
import { flushEffects } from "@/server/queue";
import { dubaiMidnight } from "@/server/inspection/range";
import { canActFor, canManageEvents } from "./access";
import { cancelEvent, cancelRegistration, CareerEventError, markAttendance, registerStudent, saveEvent } from "./service";

type Result = { ok: true; id?: string; already?: boolean } | { ok: false; error: string };
const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

const at = (key: string, time: string) => new Date(dubaiMidnight(key).getTime() + (Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))) * 60_000);

async function run<T>(ctx: Ctx, fn: (ec: ReturnType<typeof execCtx>) => Promise<T>): Promise<T> {
  const effects: Effect[] = [];
  const out = await tenantTx(ctx.orgId, (tx) => fn(execCtx(tx, ctx.orgId, { effects, actorId: ctx.membershipId })), { timeout: 60_000 });
  await flushEffects(effects);
  return out;
}

function fail(e: unknown): Result {
  if (e instanceof CareerEventError) return { ok: false, error: e.code };
  throw e;
}

function done(r: Result = { ok: true }): Result {
  revalidatePath("/", "layout");
  return r;
}

export type CareerEventFormInput = {
  id?: string | null;
  kind: CareerEventKind;
  titleEn: string;
  titleAr: string;
  descEn: string;
  descAr: string;
  universityIds: string[];
  otherUniversities: string;
  date: string;
  startTime: string;
  endTime: string;
  locationEn: string;
  locationAr: string;
  onlineUrl: string;
  gradeLevels: number[];
  capacity: number | null;
  deadline: string;
};

export async function saveCareerEventAction(input: CareerEventFormInput): Promise<Result> {
  const ctx = await getCtx();
  if (!canManageEvents(ctx)) return { ok: false, error: "FORBIDDEN" };
  if (!KEY_RE.test(input.date) || !TIME_RE.test(input.startTime) || !TIME_RE.test(input.endTime)) return { ok: false, error: "INVALID_DATES" };
  if (input.deadline && !KEY_RE.test(input.deadline)) return { ok: false, error: "INVALID_DATES" };
  // Only universities this school can see (global catalog or its own) are kept.
  const unis = input.universityIds.length ? await ctx.db.university.findMany({ where: { id: { in: input.universityIds.slice(0, 60) } }, select: { id: true } }) : [];
  try {
    const res = await run(ctx, (ec) =>
      saveEvent(
        ec,
        {
          id: input.id ?? null,
          kind: input.kind,
          titleEn: input.titleEn,
          titleAr: input.titleAr,
          descEn: input.descEn,
          descAr: input.descAr,
          universityIds: unis.map((u) => u.id),
          otherUniversities: input.otherUniversities.split(/[\n,،]/),
          startsAt: at(input.date, input.startTime),
          endsAt: at(input.date, input.endTime),
          locationEn: input.locationEn,
          locationAr: input.locationAr,
          onlineUrl: input.onlineUrl,
          gradeLevels: input.gradeLevels,
          capacity: input.capacity,
          registrationDeadline: input.deadline ? at(input.deadline, "23:59") : null,
        },
        ctx.membershipId,
      ),
    );
    return done({ ok: true, id: res.event.id });
  } catch (e) {
    return fail(e);
  }
}

export async function cancelCareerEventAction(eventId: string): Promise<Result> {
  const ctx = await getCtx();
  if (!canManageEvents(ctx)) return { ok: false, error: "FORBIDDEN" };
  try {
    await run(ctx, (ec) => cancelEvent(ec, { eventId, actorId: ctx.membershipId }));
    return done();
  } catch (e) {
    return fail(e);
  }
}

export async function registerForEventAction(eventId: string, studentId: string): Promise<Result> {
  const ctx = await getCtx();
  if (!canActFor(ctx, studentId)) return { ok: false, error: "FORBIDDEN" };
  try {
    const res = await run(ctx, (ec) => registerStudent(ec, { eventId, studentId, actorId: ctx.membershipId }));
    return done({ ok: true, already: res.already });
  } catch (e) {
    return fail(e);
  }
}

export async function cancelEventRegistrationAction(eventId: string, studentId: string): Promise<Result> {
  const ctx = await getCtx();
  if (!canActFor(ctx, studentId)) return { ok: false, error: "FORBIDDEN" };
  try {
    await run(ctx, (ec) => cancelRegistration(ec, { eventId, studentId, actorId: ctx.membershipId }));
    return done();
  } catch (e) {
    return fail(e);
  }
}

export async function markEventAttendanceAction(eventId: string, studentId: string, attended: boolean): Promise<Result> {
  const ctx = await getCtx();
  if (!canManageEvents(ctx)) return { ok: false, error: "FORBIDDEN" };
  try {
    await run(ctx, (ec) => markAttendance(ec, { eventId, studentId, attended, actorId: ctx.membershipId }));
    return done();
  } catch (e) {
    return fail(e);
  }
}
