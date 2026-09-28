import type { Prisma } from "@prisma/client";
import type { Ctx } from "@/server/context";
import { SENSITIVE } from "@/server/access/case-access";

export type AuditFilters = { q?: string; entity?: string; sens?: string; days?: string; actor?: string };

/** Audit log filters shared by the page and the CSV export. */
export function auditWhere(ctx: Ctx, f: AuditFilters): Prisma.AuditEventWhereInput {
  const days = Number(f.days ?? 30);
  const and: Prisma.AuditEventWhereInput[] = [{ orgId: ctx.orgId }];
  if (days > 0) and.push({ createdAt: { gte: new Date(Date.now() - days * 86400_000) } });
  if (f.q) and.push({ action: { contains: f.q.trim(), mode: "insensitive" } });
  if (f.entity) and.push({ entityType: f.entity });
  if (f.actor) and.push({ actorId: f.actor });
  if (f.sens === "sensitive") and.push({ sensitivity: { not: "STANDARD" } });
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
