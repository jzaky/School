// Who may use the import center and which parts of it. Pure, so the rules are unit-tested.
import type { ImportKind } from "@/lib/imports/types";

/** The person running an import: their school, membership, account and the permissions they hold now. */
export type ImportActor = { orgId: string; membershipId: string; userId: string; perms: ReadonlySet<string> };

export class ImportError extends Error {
  constructor(public code: string) {
    super(`import:${code}`);
  }
}

export type ImportAccess = {
  /** The page and the staff, students, classes and enrollments imports. */
  center: boolean;
  /** Staff rows may give roles that open safeguarding, wellbeing, medical or identity records, or manage roles. */
  sensitiveRoles: boolean;
  /** Staff rows may give the school administrator role. */
  adminRole: boolean;
  /** Invitations can be sent from a staff import (the school must also be verified). */
  invite: boolean;
  /** Subject choices (the subject registration import). */
  registrations: boolean;
};

export function importAccess(perms: ReadonlySet<string>): ImportAccess {
  const center = perms.has("admin.access") && perms.has("people.manage");
  return {
    center,
    sensitiveRoles: center && perms.has("roles.manage"),
    adminRole: center && perms.has("school.manage"),
    invite: center && perms.has("people.invite"),
    registrations: center && perms.has("registration.manage"),
  };
}

export function canRunKind(perms: ReadonlySet<string>, kind: ImportKind): boolean {
  const a = importAccess(perms);
  return kind === "registrations" ? a.registrations : a.center;
}
