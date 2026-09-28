import type { Prisma } from "@prisma/client";
import type { Ctx } from "@/server/context";

const SENSITIVE = ["WELLBEING", "SAFEGUARDING"] as const;

/**
 * Which requests the member can list.
 * - Students: their own, plus non-sensitive requests about them in services open to students.
 * - Parents: their own, plus non-sensitive requests about their children in services open to parents.
 * - Staff: everything with requests.view_all (except sensitive ones they are not part of),
 *   otherwise what they submitted, are assigned, or must act on.
 */
export function requestWhere(ctx: Ctx): Prisma.RequestWhereInput {
  const me = ctx.membershipId;
  if (ctx.isStudent) {
    const sid = ctx.membership.student?.id ?? "none";
    return {
      orgId: ctx.orgId,
      OR: [
        { requesterId: me },
        { studentId: sid, sensitivity: { notIn: [...SENSITIVE] }, service: { audience: { has: "student" } } },
      ],
    };
  }
  if (ctx.isParent) {
    const kids = ctx.membership.guardian?.links.map((l) => l.studentId) ?? [];
    return {
      orgId: ctx.orgId,
      OR: [
        { requesterId: me },
        { studentId: { in: kids }, sensitivity: { notIn: [...SENSITIVE] }, service: { audience: { has: "parent" } } },
        { approvals: { some: { assignees: { some: { membershipId: me } } } } },
      ],
    };
  }
  const involved: Prisma.RequestWhereInput[] = [
    { requesterId: me },
    { assigneeId: me },
    { approvals: { some: { assignees: { some: { membershipId: me } } } } },
    { case: { assigneeId: me } },
  ];
  if (ctx.can("requests.view_all")) {
    return { orgId: ctx.orgId, OR: [{ sensitivity: { notIn: [...SENSITIVE] } }, ...involved] };
  }
  return { orgId: ctx.orgId, OR: involved };
}

/** A referrer of a sensitive request only sees that it was received and is being handled. */
export function isRestrictedForViewer(ctx: Ctx, r: { sensitivity: string; requesterId: string; assigneeId: string | null }) {
  if (!SENSITIVE.includes(r.sensitivity as (typeof SENSITIVE)[number])) return false;
  if (r.assigneeId === ctx.membershipId) return false;
  if (r.sensitivity === "SAFEGUARDING" && ctx.can("safeguarding.view")) return false;
  if (r.sensitivity === "WELLBEING" && ctx.can("cases.wellbeing")) return false;
  return true;
}
