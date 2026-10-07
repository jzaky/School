// Plain-language catalog of permissions for the roles screen: grouping by area, which audience a
// permission may be granted to, and which permissions are sensitive enough to need a typed confirmation.
// Labels and one-line explanations live in messages under access.perms.<area>.<action>.
import { PERMISSIONS, SYSTEM_ROLES, type Permission } from "@/server/identity/permissions";

export type Audience = "staff" | "parent" | "student";

export const PERMISSION_GROUPS: Array<{ key: string; permissions: Permission[] }> = [
  {
    key: "requests",
    permissions: ["services.use", "requests.view_all", "requests.process", "approvals.decide", "tasks.use", "services.manage", "forms.manage", "workflows.manage"],
  },
  { key: "cases", permissions: ["cases.view", "cases.view_all", "cases.manage", "cases.wellbeing"] },
  {
    key: "safeguarding",
    permissions: ["safeguarding.refer", "safeguarding.view", "safeguarding.manage", "safeguarding.export", "safeguarding.break_glass"],
  },
  { key: "people", permissions: ["people.view", "people.manage", "people.invite", "people.reveal_ids", "people.medical"] },
  { key: "grades", permissions: ["grades.view_own", "grades.enter", "grades.view_all", "registration.submit", "registration.manage"] },
  { key: "timetable", permissions: ["calendar.view", "calendar.manage", "timetable.manage", "absence.report", "cover.manage"] },
  { key: "meetings", permissions: ["appointments.book", "appointments.host", "appointments.manage"] },
  { key: "documents", permissions: ["documents.view", "documents.manage", "documents.sensitive", "documents.templates"] },
  {
    key: "university",
    permissions: ["career.use", "career.advise", "pathways.view", "pathways.manage", "planner.approve", "applications.manage", "catalog.review", "career.partners"],
  },
  { key: "teaching", permissions: ["curriculum.plan", "curriculum.review", "curriculum.manage", "trips.manage", "trips.consent", "comms.send"] },
  { key: "insights", permissions: ["analytics.view", "inspection.view", "ai.use", "ai.admin_insights"] },
  { key: "admin", permissions: ["admin.access", "school.manage", "roles.manage", "compliance.manage", "audit.view", "demo.reset", "integrations.manage"] },
  { key: "portals", permissions: ["family.portal", "student.portal"] },
];

/** Permissions that expose safeguarding, wellbeing, medical or identity data, or control access itself. */
export const SENSITIVE_PERMISSIONS: Permission[] = [
  "safeguarding.view",
  "safeguarding.manage",
  "safeguarding.export",
  "safeguarding.break_glass",
  "safeguarding.refer",
  "cases.wellbeing",
  "people.medical",
  "people.reveal_ids",
  "audit.view",
  "roles.manage",
  "integrations.manage",
];

export function isSensitivePermission(p: string): boolean {
  return (SENSITIVE_PERMISSIONS as string[]).includes(p) || p.startsWith("safeguarding.");
}

/**
 * Whether holding a role opens sensitive records. Raising a safeguarding concern is sensitive to grant
 * (it needs confirmation) but reveals nothing, and every staff role has it, so it does not count here.
 */
export function opensSensitiveRecords(permissions: string[]): boolean {
  return permissions.some((p) => p !== "safeguarding.refer" && isSensitivePermission(p));
}

const PARENT_PERMISSIONS: Permission[] = [
  "grades.view_own",
  "registration.submit",
  "trips.consent",
  "pathways.view",
  "family.portal",
  "services.use",
  "approvals.decide",
  "appointments.book",
  "calendar.view",
  "documents.view",
  "ai.use",
  "tasks.use",
  "career.use",
];

const STUDENT_PERMISSIONS: Permission[] = [
  "grades.view_own",
  "registration.submit",
  "pathways.view",
  "student.portal",
  "services.use",
  "tasks.use",
  "appointments.book",
  "calendar.view",
  "career.use",
  "documents.view",
  "ai.use",
];

/** Family-only permissions: they make no sense for staff and would change how the app treats them. */
const NOT_FOR_STAFF: Permission[] = ["family.portal", "student.portal", "trips.consent", "grades.view_own", "registration.submit", "career.use"];

/** Who a role is for. The built-in parent and student roles are the only family roles. */
export function audienceOfRole(key: string): Audience {
  if (key === "parent") return "parent";
  if (key === "student") return "student";
  return "staff";
}

export function permissionsForAudience(audience: Audience): Permission[] {
  if (audience === "parent") return [...PARENT_PERMISSIONS];
  if (audience === "student") return [...STUDENT_PERMISSIONS];
  return PERMISSIONS.filter((p) => !NOT_FOR_STAFF.includes(p));
}

export function permissionAllowedFor(audience: Audience, permission: string): boolean {
  return (permissionsForAudience(audience) as string[]).includes(permission);
}

/** Permissions in the list that the audience may not receive. */
export function disallowedPermissions(audience: Audience, permissions: string[]): string[] {
  return permissions.filter((p) => !permissionAllowedFor(audience, p));
}

export function isKnownPermission(p: string): p is Permission {
  return (PERMISSIONS as readonly string[]).includes(p);
}

export function defaultRole(key: string) {
  return SYSTEM_ROLES.find((r) => r.key === key) ?? null;
}

/** Message key for a permission label or explanation: access.perms.<area>.<action>.(label|help). */
export function permissionMessageKey(p: string, part: "label" | "help") {
  return `perms.${p}.${part}`;
}
