// Who may see and change a student's pathway data. Built on src/server/access/student-access.ts.
import type { TenantDb } from "@/lib/tenant-db";
import type { Ctx } from "@/server/context";
import type { Permission } from "@/server/identity/permissions";
import { visibleStudentIds } from "@/server/access/student-access";

/** What the engine service needs to know about the caller. Built from a request Ctx, or by tests. */
export type EngineActor = {
  db: TenantDb;
  orgId: string;
  membershipId: string;
  isStudent: boolean;
  isParent: boolean;
  isStaff: boolean;
  can: (p: Permission) => boolean;
  /** Students this member may see; null means every student (staff with people.view). */
  visibleStudentIds: string[] | null;
};

export class EngineAccessError extends Error {
  constructor(public code: "forbidden" | "not_found" | "invalid" | "conflict") {
    super(code);
  }
}

export async function actorFromCtx(ctx: Ctx): Promise<EngineActor> {
  return {
    db: ctx.db,
    orgId: ctx.orgId,
    membershipId: ctx.membershipId,
    isStudent: ctx.isStudent,
    isParent: ctx.isParent,
    isStaff: ctx.isStaff,
    can: ctx.can,
    visibleStudentIds: await visibleStudentIds(ctx),
  };
}

/** Student sees self, parent sees own children, staff with pathways.view and people.view see everyone. */
export function canViewStudent(actor: EngineActor, studentId: string): boolean {
  if (!actor.can("pathways.view")) return false;
  if (actor.visibleStudentIds === null) return actor.isStaff;
  return actor.visibleStudentIds.includes(studentId);
}

/** Students edit their own draft plan; advising staff (pathways.manage) edit any plan. Parents only view. */
export function canEditPlan(actor: EngineActor, studentId: string): boolean {
  if (!canViewStudent(actor, studentId)) return false;
  if (actor.isStudent) return true;
  return actor.isStaff && actor.can("pathways.manage");
}

export const canApprovePlan = (actor: EngineActor, studentId: string) => actor.isStaff && actor.can("planner.approve") && canViewStudent(actor, studentId);

export function assertView(actor: EngineActor, studentId: string) {
  if (!canViewStudent(actor, studentId)) throw new EngineAccessError("forbidden");
}
