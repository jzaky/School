import type { Prisma } from "@prisma/client";
import type { Ctx } from "@/server/context";
import { SENSITIVE } from "@/server/access/case-access";

/**
 * Appointments the member hosts, books or attends, and for parents the ones that concern their children.
 * A parent only sees a child's meeting on a wellbeing or safeguarding case when they were invited to it.
 */
export async function appointmentWhere(ctx: Ctx): Promise<Prisma.AppointmentWhereInput> {
  const kids = ctx.isParent ? ctx.membership.guardian?.links.map((l) => l.studentId) ?? [] : [];
  const hidden = kids.length
    ? (await ctx.db.case.findMany({ where: { orgId: ctx.orgId, studentId: { in: kids }, sensitivity: { in: SENSITIVE } }, select: { id: true } })).map((c) => c.id)
    : [];
  return {
    orgId: ctx.orgId,
    OR: [
      { hostId: ctx.membershipId },
      { bookedById: ctx.membershipId },
      { attendees: { some: { membershipId: ctx.membershipId } } },
      ...(kids.length ? [{ studentId: { in: kids }, OR: [{ caseId: null }, { caseId: { notIn: hidden } }] }] : []),
    ],
  };
}
