"use server";

import { revalidatePath } from "next/cache";
import { getCtx, type Ctx } from "@/server/context";
import { tenantTx } from "@/lib/tenant-db";
import { execCtx, type Effect } from "@/server/db";
import { flushEffects } from "@/server/queue";
import { audit } from "@/server/audit/audit";
import { canManageTrip } from "./access";
import { cancelTrip, completeTrip, decideConsent, publishTrip, remindPending, TripError } from "./service";

type Result = { ok: true; id?: string; count?: number; alreadySentToday?: boolean } | { ok: false; error: string };
const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

function dubai(key: string, time = "00:00") {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, Number(time.slice(0, 2)), Number(time.slice(3, 5)) - 240));
}


async function run<T>(ctx: Ctx, fn: (ec: ReturnType<typeof execCtx>) => Promise<T>): Promise<T> {
  const effects: Effect[] = [];
  const out = await tenantTx(ctx.orgId, (tx) => fn(execCtx(tx, ctx.orgId, { effects, actorId: ctx.membershipId })), { timeout: 120000 });
  await flushEffects(effects);
  return out;
}

function fail(e: unknown): Result {
  if (e instanceof TripError) return { ok: false, error: e.code };
  throw e;
}

function done(r: Result = { ok: true }): Result {
  revalidatePath("/", "layout");
  return r;
}

export type TripInput = {
  id?: string | null;
  titleEn: string;
  titleAr: string;
  descEn: string;
  descAr: string;
  destinationEn: string;
  destinationAr: string;
  date: string;
  endDate: string;
  startTime: string;
  endTime: string;
  costAed: number | null;
  consentDeadline: string;
  gradeLevels: number[];
  classIds: string[];
};

export async function saveTripAction(input: TripInput): Promise<Result> {
  const ctx = await getCtx();
  if (!ctx.can("trips.manage")) return { ok: false, error: "FORBIDDEN" };
  if (!input.titleEn.trim() || !input.destinationEn.trim()) return { ok: false, error: "TITLE_REQUIRED" };
  if (!KEY_RE.test(input.date) || !KEY_RE.test(input.endDate) || !TIME_RE.test(input.startTime) || !TIME_RE.test(input.endTime)) return { ok: false, error: "INVALID_DATES" };
  const startsAt = dubai(input.date, input.startTime);
  const endsAt = dubai(input.endDate, input.endTime);
  if (endsAt <= startsAt) return { ok: false, error: "INVALID_DATES" };
  if (startsAt <= new Date()) return { ok: false, error: "IN_PAST" };
  if (!KEY_RE.test(input.consentDeadline)) return { ok: false, error: "DEADLINE_REQUIRED" };
  const consentDeadline = dubai(input.consentDeadline, "23:59");
  if (consentDeadline > startsAt) return { ok: false, error: "DEADLINE_AFTER_TRIP" };
  const grades = [...new Set(input.gradeLevels.filter((g) => Number.isInteger(g) && g >= 1 && g <= 13))];
  const classes = input.classIds.length ? await ctx.db.schoolClass.findMany({ where: { id: { in: input.classIds } }, select: { id: true } }) : [];
  if (!grades.length && !classes.length) return { ok: false, error: "AUDIENCE_REQUIRED" };
  const cost = input.costAed != null && Number.isFinite(input.costAed) ? Math.max(0, Math.round(input.costAed)) : null;
  const data = {
    titleEn: input.titleEn.trim(),
    titleAr: input.titleAr.trim() || input.titleEn.trim(),
    descEn: input.descEn.trim() || null,
    descAr: input.descAr.trim() || null,
    destinationEn: input.destinationEn.trim(),
    destinationAr: input.destinationAr.trim() || input.destinationEn.trim(),
    startsAt,
    endsAt,
    costAed: cost,
    consentDeadline,
    gradeLevels: grades,
    classIds: classes.map((c) => c.id),
  };
  if (input.id) {
    const trip = await ctx.db.trip.findUnique({ where: { id: input.id } });
    if (!trip) return { ok: false, error: "NOT_FOUND" };
    if (!canManageTrip(ctx, trip)) return { ok: false, error: "FORBIDDEN" };
    if (trip.status !== "DRAFT") return { ok: false, error: "NOT_EDITABLE" };
    await tenantTx(ctx.orgId, async (tx) => {
      await tx.trip.update({ where: { id: trip.id }, data });
      await audit(tx, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "trip.update", entityType: "Trip", entityId: trip.id });
    });
    return done({ ok: true, id: trip.id });
  }
  const id = await tenantTx(ctx.orgId, async (tx) => {
    const trip = await tx.trip.create({ data: { orgId: ctx.orgId, ...data, organizerId: ctx.membershipId } });
    await audit(tx, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "trip.create", entityType: "Trip", entityId: trip.id });
    return trip.id;
  });
  return done({ ok: true, id });
}

async function managed(id: string) {
  const ctx = await getCtx();
  const trip = await ctx.db.trip.findUnique({ where: { id } });
  if (!trip || !canManageTrip(ctx, trip)) return null;
  return { ctx, trip };
}

export async function publishTripAction(id: string): Promise<Result> {
  const m = await managed(id);
  if (!m) return { ok: false, error: "FORBIDDEN" };
  if (m.trip.startsAt <= new Date()) return { ok: false, error: "IN_PAST" };
  try {
    const r = await run(m.ctx, (ec) => publishTrip(ec, { tripId: id, actorId: m.ctx.membershipId }));
    return done({ ok: true, count: r.notified });
  } catch (e) {
    return fail(e);
  }
}

export async function remindTripAction(id: string): Promise<Result> {
  const m = await managed(id);
  if (!m) return { ok: false, error: "FORBIDDEN" };
  try {
    const r = await run(m.ctx, (ec) => remindPending(ec, { tripId: id, actorId: m.ctx.membershipId }));
    return done({ ok: true, count: r.sent, alreadySentToday: r.alreadySentToday });
  } catch (e) {
    return fail(e);
  }
}

export async function cancelTripAction(id: string, reasonEn: string, reasonAr: string): Promise<Result> {
  const m = await managed(id);
  if (!m) return { ok: false, error: "FORBIDDEN" };
  try {
    const r = await run(m.ctx, (ec) => cancelTrip(ec, { tripId: id, actorId: m.ctx.membershipId, reasonEn, reasonAr }));
    return done({ ok: true, count: r.notified });
  } catch (e) {
    return fail(e);
  }
}

export async function completeTripAction(id: string): Promise<Result> {
  const m = await managed(id);
  if (!m) return { ok: false, error: "FORBIDDEN" };
  try {
    await run(m.ctx, (ec) => completeTrip(ec, { tripId: id, actorId: m.ctx.membershipId }));
    return done();
  } catch (e) {
    return fail(e);
  }
}

export async function deleteDraftTripAction(id: string): Promise<Result> {
  const m = await managed(id);
  if (!m) return { ok: false, error: "FORBIDDEN" };
  if (m.trip.status !== "DRAFT") return { ok: false, error: "NOT_EDITABLE" };
  await tenantTx(m.ctx.orgId, async (tx) => {
    await tx.trip.delete({ where: { id } });
    await audit(tx, m.ctx.orgId, { actorId: m.ctx.membershipId, actorUserId: m.ctx.user.id, action: "trip.delete", entityType: "Trip", entityId: id });
  });
  return done();
}

/** A parent grants or declines consent in one tap, with an optional note. */
export async function consentAction(input: { participantId: string; decision: "GRANTED" | "DECLINED"; note?: string }): Promise<Result> {
  const ctx = await getCtx();
  if (!ctx.can("trips.consent") || !ctx.isParent) return { ok: false, error: "FORBIDDEN" };
  if (input.decision !== "GRANTED" && input.decision !== "DECLINED") return { ok: false, error: "INVALID" };
  try {
    await run(ctx, (ec) => decideConsent(ec, { participantId: input.participantId, deciderMembershipId: ctx.membershipId, decision: input.decision, note: input.note }));
    return done();
  } catch (e) {
    return fail(e);
  }
}
