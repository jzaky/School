"use server";

import { revalidatePath } from "next/cache";
import { getCtx } from "@/server/context";
import { tenantTx } from "@/lib/tenant-db";
import { execCtx, type Effect } from "@/server/db";
import { flushEffects } from "@/server/queue";
import { canSeeStudent } from "@/server/access/student-access";
import { availableSlots } from "./availability";
import { BookingError, bookAppointment, cancelAppointment } from "./booking";

export type SlotDay = { key: string; slots: Array<{ start: string; hostIds: string[] }> };

export async function getSlotsAction(input: { typeId: string; hostId: string | null; fromKey?: string; days?: number; rescheduleOf?: string }): Promise<SlotDay[]> {
  const ctx = await getCtx();
  const type = await ctx.db.appointmentType.findUnique({ where: { id: input.typeId }, include: { hosts: true } });
  if (!type || !type.isActive) return [];
  const hostIds = input.hostId ? type.hosts.filter((h) => h.membershipId === input.hostId).map((h) => h.membershipId) : type.hosts.map((h) => h.membershipId);
  if (!hostIds.length) return [];
  const slots = await tenantTx(ctx.orgId, (tx) => availableSlots(tx, ctx.orgId, type.id, hostIds, { fromKey: input.fromKey, days: input.days ?? 14, ignoreAppointmentId: input.rescheduleOf }));
  return [...slots.entries()].map(([key, list]) => ({ key, slots: list.map((s: { start: Date; hostIds: string[] }) => ({ start: s.start.toISOString(), hostIds: s.hostIds })) }));
}

export async function bookAppointmentAction(input: { typeId: string; hostId: string | null; start: string; studentId: string | null; caseId?: string | null; notes?: string | null; rescheduleOf?: string | null }) {
  const ctx = await getCtx();
  if (!ctx.can("appointments.book")) return { ok: false as const, error: "FORBIDDEN" };
  let studentId = input.studentId;
  if (ctx.isStudent) studentId = ctx.membership.student?.id ?? null;
  if (studentId && !(await canSeeStudent(ctx, studentId))) return { ok: false as const, error: "FORBIDDEN" };
  if (input.rescheduleOf) {
    const prev = await ctx.db.appointment.findUnique({ where: { id: input.rescheduleOf }, include: { attendees: true } });
    if (!prev || !(prev.hostId === ctx.membershipId || prev.bookedById === ctx.membershipId || prev.attendees.some((a) => a.membershipId === ctx.membershipId))) {
      return { ok: false as const, error: "FORBIDDEN" };
    }
  }
  const effects: Effect[] = [];
  try {
    const appt = await tenantTx(
      ctx.orgId,
      (tx) =>
        bookAppointment(execCtx(tx, ctx.orgId, { effects, actorId: ctx.membershipId }), {
          typeId: input.typeId,
          hostId: input.hostId,
          start: new Date(input.start),
          bookedById: ctx.membershipId,
          studentId,
          caseId: input.caseId ?? null,
          notes: input.notes ?? null,
          rescheduleOf: input.rescheduleOf ?? null,
        }),
      { timeout: 30000 },
    );
    await flushEffects(effects);
    revalidatePath("/", "layout");
    return { ok: true as const, appointmentId: appt.id, hostId: appt.hostId, startsAt: appt.startsAt.toISOString() };
  } catch (e) {
    if (e instanceof BookingError) return { ok: false as const, error: e.message };
    throw e;
  }
}

export async function cancelAppointmentAction(input: { appointmentId: string; reason?: string }) {
  const ctx = await getCtx();
  const effects: Effect[] = [];
  try {
    await tenantTx(ctx.orgId, (tx) => cancelAppointment(execCtx(tx, ctx.orgId, { effects, actorId: ctx.membershipId }), { appointmentId: input.appointmentId, byId: ctx.membershipId, reason: input.reason }));
  } catch (e) {
    if (e instanceof BookingError) return { ok: false as const, error: e.message };
    throw e;
  }
  await flushEffects(effects);
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function completeAppointmentAction(input: { appointmentId: string; status: "COMPLETED" | "NO_SHOW" }) {
  const ctx = await getCtx();
  const appt = await ctx.db.appointment.findUnique({ where: { id: input.appointmentId } });
  if (!appt || appt.hostId !== ctx.membershipId) return { ok: false as const };
  await ctx.db.appointment.update({ where: { id: appt.id }, data: { status: input.status } });
  revalidatePath("/", "layout");
  return { ok: true as const };
}
