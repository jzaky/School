import type { Prisma } from "@prisma/client";
import type { Ctx } from "@/server/context";

/** Appointments the member hosts, attends, or (for parents) that concern their children. */
export function appointmentWhere(ctx: Ctx): Prisma.AppointmentWhereInput {
  const kids = ctx.isParent ? ctx.membership.guardian?.links.map((l) => l.studentId) ?? [] : [];
  return {
    orgId: ctx.orgId,
    OR: [
      { hostId: ctx.membershipId },
      { bookedById: ctx.membershipId },
      { attendees: { some: { membershipId: ctx.membershipId } } },
      ...(kids.length ? [{ studentId: { in: kids } }] : []),
    ],
  };
}
