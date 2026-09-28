import type { Tx } from "@/server/db";
import { addDaysKey, computeSlots, dubaiDateKey, dubaiInstant, type HostInput } from "./slots";

export async function loadHostInputs(tx: Tx, orgId: string, hostIds: string[], fromKey: string, days: number): Promise<HostInput[]> {
  const from = dubaiInstant(fromKey, 0);
  const to = dubaiInstant(addDaysKey(fromKey, days + 1), 0);
  const [rules, overrides, appts] = await Promise.all([
    tx.availabilityRule.findMany({ where: { orgId, membershipId: { in: hostIds } } }),
    tx.availabilityOverride.findMany({ where: { orgId, membershipId: { in: hostIds }, date: { gte: new Date(`${fromKey}T00:00:00Z`), lte: new Date(`${addDaysKey(fromKey, days + 1)}T00:00:00Z`) } } }),
    tx.appointment.findMany({ where: { orgId, hostId: { in: hostIds }, status: { in: ["SCHEDULED", "CONFIRMED"] }, startsAt: { lt: to }, endsAt: { gt: from } } }),
  ]);
  return hostIds.map((id) => ({
    id,
    rules: rules.filter((r) => r.membershipId === id),
    overrides: overrides.filter((o) => o.membershipId === id).map((o) => ({ date: o.date.toISOString().slice(0, 10), isUnavailable: o.isUnavailable, startMinute: o.startMinute, endMinute: o.endMinute })),
    busy: appts.filter((a) => a.hostId === id).map((a) => ({ start: a.startsAt, end: a.endsAt, typeId: a.typeId })),
  }));
}

export async function availableSlots(tx: Tx, orgId: string, typeId: string, hostIds: string[], opts: { now?: Date; fromKey?: string; days?: number; ignoreAppointmentId?: string } = {}) {
  const type = await tx.appointmentType.findUnique({ where: { id: typeId } });
  if (!type) return new Map();
  const org = await tx.organization.findUnique({ where: { id: orgId }, select: { weekDays: true } });
  const now = opts.now ?? new Date();
  const fromKey = opts.fromKey ?? dubaiDateKey(now);
  const days = opts.days ?? 14;
  let hosts = await loadHostInputs(tx, orgId, hostIds, fromKey, days);
  if (opts.ignoreAppointmentId) {
    const ignore = await tx.appointment.findUnique({ where: { id: opts.ignoreAppointmentId } });
    if (ignore) hosts = hosts.map((h) => ({ ...h, busy: h.busy.filter((b) => b.start.getTime() !== ignore.startsAt.getTime() || h.id !== ignore.hostId) }));
  }
  return computeSlots({ type, hosts, now, fromKey, days, weekDays: org?.weekDays ?? [1, 2, 3, 4, 5] });
}
