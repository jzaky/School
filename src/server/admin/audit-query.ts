import type { Prisma } from "@prisma/client";
import type { Ctx } from "@/server/context";
import { SENSITIVE } from "@/server/access/case-access";

export type AuditFilters = { q?: string; entity?: string; sens?: string; days?: string; actor?: string; preset?: string };

/**
 * "Access changes": every change to roles, role permissions, who holds which role and until when, access
 * exports, refused attempts to raise one's own access, and emergency (break-glass) use.
 */
export const ACCESS_CHANGE_PREFIXES = ["roles.", "access."];
export const ACCESS_CHANGE_ACTIONS = [
  "people.roles_change",
  "people.role_end_change",
  "people.role_expired",
  "people.staff_add",
  "people.staff_update",
  "people.staff_import",
  "people.member_suspend",
  "people.member_activate",
  "invite.link_create",
  "join.invite_accept",
  "join.approve",
  "case.break_glass",
  "audit.export",
];

export function accessChangesWhere(): Prisma.AuditEventWhereInput {
  return { OR: [...ACCESS_CHANGE_PREFIXES.map((p) => ({ action: { startsWith: p } })), { action: { in: ACCESS_CHANGE_ACTIONS } }] };
}

/** Audit log filters shared by the page and the CSV export. */
export function auditWhere(ctx: Ctx, f: AuditFilters): Prisma.AuditEventWhereInput {
  const days = Number(f.days ?? 30);
  const and: Prisma.AuditEventWhereInput[] = [{ orgId: ctx.orgId }];
  if (days > 0) and.push({ createdAt: { gte: new Date(Date.now() - days * 86400_000) } });
  if (f.q) and.push({ action: { contains: f.q.trim(), mode: "insensitive" } });
  if (f.entity) and.push({ entityType: f.entity });
  if (f.actor) and.push({ actorId: f.actor });
  if (f.sens === "sensitive") and.push({ sensitivity: { not: "STANDARD" } });
  if (f.preset === "access") and.push(accessChangesWhere());
  // Safeguarding and wellbeing entries are only listed for people who hold those roles.
  if (!ctx.can("safeguarding.view")) and.push({ sensitivity: { not: "SAFEGUARDING" } });
  if (!ctx.can("safeguarding.view") && !ctx.can("cases.wellbeing")) and.push({ sensitivity: { notIn: SENSITIVE } });
  return { AND: and };
}

export function entityHref(type: string, id: string | null) {
  if (!id) return null;
  switch (type) {
    case "Case":
      return `/cases/${id}`;
    case "Request":
      return `/requests/${id}`;
    case "Student":
      return `/students/${id}`;
    case "Appointment":
      return `/meetings/${id}`;
    default:
      return null;
  }
}
