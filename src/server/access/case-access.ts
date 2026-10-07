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

/**
 * What a school group (several schools, see src/server/groups) may count across its member schools.
 * Group users are not members of each school's student services team, so this module allows no case
 * figures at all at group level (not even counts of wellbeing or safeguarding cases), and only requests,
 * services and tasks of STANDARD sensitivity. Confidential and medical work is left out too, because a
 * small school's count alone can point at a child. The group dashboard reads this policy; it is never widened per group.
 */
export function groupAggregatePolicy(): { cases: false; requestSensitivities: Sensitivity[]; taskSensitivities: Sensitivity[] } {
  return { cases: false, requestSensitivities: ["STANDARD"], taskSensitivities: ["STANDARD"] };
}

// ---------------------------------------------------------------------------
// Data subject exports (PDPL access requests)
// ---------------------------------------------------------------------------

export type ExportWithheldReason = "no_request" | "request_type" | "protected" | "no_access" | "third_party";
export type ExportDecision = { include: true } | { include: false; reason: ExportWithheldReason };

/**
 * Whether a sensitive record may go into a data subject export run by `ctx`.
 * - Safeguarding content is never released through a subject export (protection of the child; the DSL
 *   handles any disclosure separately). It is listed as withheld ("protected"), without saying what it is.
 * - Wellbeing and medical content needs a recorded ACCESS request and full access for the exporter.
 *   Including a wellbeing case counts as a view and is audited ("case.export").
 * - Standard and confidential case content needs full access for the exporter.
 */
export async function subjectExportDecision(
  ctx: Ctx,
  input: { requestType: "ACCESS" | "CORRECTION" | "DELETION" | null; sensitivity: Sensitivity; caseRow?: CaseLike | null },
): Promise<ExportDecision> {
  const { requestType, sensitivity, caseRow } = input;
  if (sensitivity === "SAFEGUARDING") return { include: false, reason: "protected" };
  const sensitive = sensitivity === "WELLBEING" || sensitivity === "MEDICAL";
  if (sensitivity === "WELLBEING" || sensitivity === "MEDICAL") {
    if (!requestType) return { include: false, reason: "no_request" };
    if (requestType !== "ACCESS") return { include: false, reason: "request_type" };
  }
  if (caseRow) {
    const ok = await canViewCase(ctx, caseRow, { action: "case.export" });
    return ok ? { include: true } : { include: false, reason: sensitive ? "protected" : "no_access" };
  }
  if (sensitivity === "WELLBEING") return ctx.can("cases.wellbeing") ? { include: true } : { include: false, reason: "protected" };
  if (sensitivity === "MEDICAL") return ctx.can("people.medical") || ctx.can("cases.wellbeing") ? { include: true } : { include: false, reason: "protected" };
  return { include: true };
}

/** Parents are never notified automatically about sensitive cases (rule 7). */
export function familyMayBeAutoNotified(sensitivity: Sensitivity) {
  return !SENSITIVE.includes(sensitivity);
}
