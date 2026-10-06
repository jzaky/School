// The single access module for cases (CLAUDE.md rule 6).
// WELLBEING and SAFEGUARDING cases are only visible through the rules below, and every view of a
// sensitive case writes an AuditEvent. Global search, dashboards and analytics call `listableCaseWhere`
// with a surface, which excludes sensitive cases unless this module allows that surface.
import type { Prisma, Sensitivity } from "@prisma/client";
import type { Ctx } from "@/server/context";
import { audit } from "@/server/audit/audit";

export const SENSITIVE: Sensitivity[] = ["WELLBEING", "SAFEGUARDING"];

type CaseLike = { id: string; orgId: string; sensitivity: Sensitivity; assigneeId: string | null; referrerId: string | null; departmentId: string | null };

export type CaseAccess =
  | { level: "full"; via: "role" | "assignee" | "participant" | "grant" | "break_glass" | "referrer" | "department" }
  | { level: "status_only"; via: "referrer" }
  | { level: "none"; canBreakGlass: boolean };

async function activeGrant(ctx: Ctx, caseId: string) {
  const now = new Date();
  const [grant, glass] = await Promise.all([
    ctx.db.caseAccessGrant.findFirst({ where: { caseId, membershipId: ctx.membershipId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } }),
    ctx.db.breakGlassAccess.findFirst({ where: { caseId, membershipId: ctx.membershipId, expiresAt: { gt: now } } }),
  ]);
  return { grant, glass };
}

export async function caseAccess(ctx: Ctx, c: CaseLike): Promise<CaseAccess> {
  if (c.orgId !== ctx.orgId || !ctx.isStaff) return { level: "none", canBreakGlass: false };
  const me = ctx.membershipId;
  const isAssignee = c.assigneeId === me;
  const participant = await ctx.db.caseParticipant.findFirst({ where: { caseId: c.id, membershipId: me, role: { in: ["ASSIGNEE", "TEAM"] } } });
  const { grant, glass } = await activeGrant(ctx, c.id);

  if (c.sensitivity === "SAFEGUARDING") {
    if (ctx.can("safeguarding.view")) return { level: "full", via: "role" };
    if (isAssignee) return { level: "full", via: "assignee" };
    if (grant) return { level: "full", via: "grant" };
    if (glass) return { level: "full", via: "break_glass" };
    if (c.referrerId === me) return { level: "status_only", via: "referrer" };
    return { level: "none", canBreakGlass: ctx.can("safeguarding.break_glass") };
  }
  if (c.sensitivity === "WELLBEING") {
    if (isAssignee) return { level: "full", via: "assignee" };
    if (participant) return { level: "full", via: "participant" };
    if (ctx.can("cases.wellbeing")) return { level: "full", via: "role" };
    if (grant) return { level: "full", via: "grant" };
    if (glass) return { level: "full", via: "break_glass" };
    if (c.referrerId === me) return { level: "status_only", via: "referrer" };
    return { level: "none", canBreakGlass: ctx.can("safeguarding.break_glass") };
  }
  // STANDARD, CONFIDENTIAL, MEDICAL
  if (isAssignee) return { level: "full", via: "assignee" };
  if (participant) return { level: "full", via: "participant" };
  if (ctx.can("cases.view_all")) return { level: "full", via: "role" };
  if (grant) return { level: "full", via: "grant" };
  if (c.referrerId === me) return { level: "full", via: "referrer" };
  if (c.departmentId) {
    const dept = await ctx.db.department.findUnique({ where: { id: c.departmentId } });
    if (dept?.headMembershipId === me) return { level: "full", via: "department" };
  }
  if (ctx.can("cases.manage") && c.sensitivity === "STANDARD") return { level: "full", via: "role" };
  return { level: "none", canBreakGlass: false };
}

/** Check access and, for sensitive cases, record the view in the audit log. */
export async function canViewCase(ctx: Ctx, c: CaseLike, opts: { audit?: boolean; action?: string } = {}) {
  const access = await caseAccess(ctx, c);
  const full = access.level === "full";
  if (full && opts.audit !== false && (SENSITIVE.includes(c.sensitivity) || c.sensitivity === "CONFIDENTIAL")) {
    await audit(ctx.db, ctx.orgId, {
      actorId: ctx.membershipId,
      actorUserId: ctx.user.id,
      action: opts.action ?? "case.view",
      entityType: "Case",
      entityId: c.id,
      sensitivity: c.sensitivity,
      reason: access.via === "break_glass" ? "Emergency access" : access.via === "grant" ? "Access granted" : ctx.roles.includes("principal") && c.sensitivity === "SAFEGUARDING" ? "Principal oversight" : null,
      meta: { via: access.via },
    });
  }
  return full;
}

export type CaseSurface = "worklist" | "dashboard" | "search" | "analytics" | "safeguarding";

/**
 * Prisma filter for cases the member may list on a surface.
 * - search and analytics never include WELLBEING or SAFEGUARDING cases.
 * - dashboard and worklist include WELLBEING cases the member works on, never SAFEGUARDING.
 * - safeguarding lists SAFEGUARDING cases only for DSL, deputy, and explicitly granted staff.
 */
export function listableCaseWhere(ctx: Ctx, surface: CaseSurface): Prisma.CaseWhereInput {
  const me = ctx.membershipId;
  const now = new Date();
  const orgId = ctx.orgId;
  if (!ctx.isStaff) return { id: "none" };
  const involvement: Prisma.CaseWhereInput[] = [
    { assigneeId: me },
    { participants: { some: { membershipId: me, role: { in: ["ASSIGNEE", "TEAM"] } } } },
    { grants: { some: { membershipId: me, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } } },
  ];
  if (surface === "safeguarding") {
    if (ctx.can("safeguarding.view")) return { orgId, sensitivity: "SAFEGUARDING" };
    return { orgId, sensitivity: "SAFEGUARDING", OR: [{ assigneeId: me }, { grants: { some: { membershipId: me, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } } }] };
  }
  const standard: Prisma.CaseWhereInput = ctx.can("cases.view_all")
    ? { sensitivity: { in: ["STANDARD", "CONFIDENTIAL", "MEDICAL"] } }
    : { sensitivity: { in: ["STANDARD", "CONFIDENTIAL", "MEDICAL"] }, OR: [...involvement, { referrerId: me }, { department: { headMembershipId: me } }] };
  if (surface === "search" || surface === "analytics") return { orgId, ...standard };
  const wellbeing: Prisma.CaseWhereInput = { sensitivity: "WELLBEING", OR: involvement };
  return { orgId, OR: [standard, wellbeing] };
}

/** Parents are never notified automatically about sensitive cases (rule 7). */
export function familyMayBeAutoNotified(sensitivity: Sensitivity) {
  return !SENSITIVE.includes(sensitivity);
}

/**
 * Inspection evidence pack (src/server/inspection). Members who may view the pack see sensitive cases
 * only as aggregate counts and timings, never as a list.
 */
export function inspectionAggregatesAllowed(ctx: Pick<Ctx, "isStaff" | "can">): boolean {
  return ctx.isStaff && ctx.can("inspection.view");
}

/**
 * Cases whose reference (number, status and dates; never names, summaries or notes) the member may see in
 * the evidence pack. Mirrors caseAccess full access through role, assignment, team membership or an active
 * grant. Break-glass and referrer status-only access do not extend to the evidence pack.
 */
export function inspectionReferenceWhere(ctx: Pick<Ctx, "isStaff" | "can" | "membershipId" | "orgId">, sensitivity: "WELLBEING" | "SAFEGUARDING"): Prisma.CaseWhereInput {
  if (!ctx.isStaff || !ctx.can("inspection.view")) return { id: "none" };
  const me = ctx.membershipId;
  const now = new Date();
  const grant: Prisma.CaseWhereInput = { grants: { some: { membershipId: me, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } } };
  if (sensitivity === "SAFEGUARDING") {
    if (ctx.can("safeguarding.view")) return { orgId: ctx.orgId, sensitivity };
    return { orgId: ctx.orgId, sensitivity, OR: [{ assigneeId: me }, grant] };
  }
  if (ctx.can("cases.wellbeing")) return { orgId: ctx.orgId, sensitivity };
  return { orgId: ctx.orgId, sensitivity, OR: [{ assigneeId: me }, { participants: { some: { membershipId: me, role: { in: ["ASSIGNEE", "TEAM"] } } } }, grant] };
}
