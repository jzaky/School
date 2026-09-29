// Who may import transcripts and see or change a student's course record. Built on the pathway engine's
// EngineActor, so the same visible-student rules apply (students: themselves; parents: their children;
// staff with people.view: everyone).
import { canViewStudent, type EngineActor } from "@/server/pathway-engine/access";

/** Advising staff (pathways.manage) review imports, commit them and edit any course record. */
export const canManageRecord = (a: EngineActor, studentId: string) => a.isStaff && a.can("pathways.manage") && canViewStudent(a, studentId);

/** The course record is for the student and advising staff. Parents see results on the pathway pages instead. */
export const canViewRecord = (a: EngineActor, studentId: string) => !a.isParent && canViewStudent(a, studentId) && (a.isStudent || a.can("pathways.manage") || a.can("planner.approve"));

/** Students may upload their own transcript for a counselor to review; they never commit it. */
export const canUpload = (a: EngineActor, studentId: string) => canManageRecord(a, studentId) || (a.isStudent && canViewStudent(a, studentId));

/** Counselor dashboard: approvers and pathway managers. */
export const canUseDashboard = (a: EngineActor) => a.isStaff && (a.can("planner.approve") || a.can("pathways.manage"));
