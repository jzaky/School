// "Who can see what": everyone who can see sensitive records or change access, grouped by area, with the
// role that grants it, whether that access ends, and when the person was last active. People and roles
// only, never records. Areas come from the permission catalog, so a sensitive permission added later
// appears under "other" without changes here.
import type { Prisma } from "@prisma/client";
import { PERMISSIONS } from "@/server/identity/permissions";
import { isSensitivePermission } from "./permission-catalog";
import { assignmentActive } from "./until";

export type ReportArea = { key: string; permissions: string[] };

const NAMED_AREAS: ReportArea[] = [
  { key: "safeguarding", permissions: ["safeguarding.view", "safeguarding.manage", "safeguarding.export", "safeguarding.break_glass"] },
  { key: "wellbeing", permissions: ["cases.wellbeing"] },
  { key: "medical", permissions: ["people.medical"] },
  { key: "reasons", permissions: ["attendance.reasons", "absence.reasons"] },
  { key: "identity", permissions: ["people.reveal_ids"] },
  { key: "audit", permissions: ["audit.view"] },
  { key: "roles", permissions: ["roles.manage"] },
  { key: "integrations", permissions: ["integrations.manage"] },
];

/** Raising a safeguarding concern is open to every staff member and reveals nothing, so it is not listed. */
const NOT_LISTED = ["safeguarding.refer"];

/** The report areas, with any other sensitive permission in the catalog gathered under "other". */
export function reportAreas(all: readonly string[] = PERMISSIONS): ReportArea[] {
  const named = new Set(NAMED_AREAS.flatMap((a) => a.permissions));
  const other = all.filter((p) => isSensitivePermission(p) && !named.has(p) && !NOT_LISTED.includes(p));
  return other.length ? [...NAMED_AREAS, { key: "other", permissions: other }] : NAMED_AREAS;
}

export const REPORT_PERMISSIONS = () => reportAreas().flatMap((a) => a.permissions);

export type ReportMember = {
  id: string;
  status: string;
  lastSeenAt: Date | null;
  user: { nameEn: string; nameAr: string | null; email: string };
  roles: Array<{ roleId: string; expiresAt: Date | null; role: { id: string; key: string; nameEn: string; nameAr: string; permissions: string[] } }>;
};

export type ReportGrant = { roleId: string; key: string; nameEn: string; nameAr: string; expiresAt: Date | null };
export type ReportEntry = {
  membershipId: string;
  nameEn: string;
  nameAr: string | null;
  email: string;
  lastSeenAt: Date | null;
  /** The area's permissions this person has. */
  permissions: string[];
  /** Roles that grant any of them, with their end dates. */
  via: ReportGrant[];
  /** When the person's access to this area ends: null when any granting role does not expire. */
  until: Date | null;
};

/** Builds the report from active members and their role assignments. Pure, so it is unit-tested. */
export function buildAccessReport(members: ReportMember[], now: Date = new Date(), areas: ReportArea[] = reportAreas()) {
  return areas.map((area) => {
    const entries: ReportEntry[] = [];
    for (const m of members) {
      if (m.status !== "ACTIVE") continue;
      const grants = m.roles.filter((r) => assignmentActive(r.expiresAt, now) && r.role.permissions.some((p) => area.permissions.includes(p)));
      if (grants.length === 0) continue;
      const permissions = area.permissions.filter((p) => grants.some((g) => g.role.permissions.includes(p)));
      const permanent = grants.some((g) => !g.expiresAt);
      const until = permanent ? null : new Date(Math.max(...grants.map((g) => g.expiresAt!.getTime())));
      entries.push({
        membershipId: m.id,
        nameEn: m.user.nameEn,
        nameAr: m.user.nameAr,
        email: m.user.email,
        lastSeenAt: m.lastSeenAt,
        permissions,
        via: grants.map((g) => ({ roleId: g.role.id, key: g.role.key, nameEn: g.role.nameEn, nameAr: g.role.nameAr, expiresAt: g.expiresAt })),
        until,
      });
    }
    entries.sort((a, b) => a.nameEn.localeCompare(b.nameEn));
    return { ...area, entries };
  });
}

/** Members to load for the report: active people holding a role with any report permission. */
export function reportMemberWhere(now: Date = new Date()): Prisma.MembershipWhereInput {
  return {
    status: "ACTIVE",
    roles: { some: { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }], role: { permissions: { hasSome: REPORT_PERMISSIONS() } } } },
  };
}

export const reportMemberSelect = {
  id: true,
  status: true,
  lastSeenAt: true,
  user: { select: { nameEn: true, nameAr: true, email: true } },
  roles: { select: { roleId: true, expiresAt: true, role: { select: { id: true, key: true, nameEn: true, nameAr: true, permissions: true } } } },
} satisfies Prisma.MembershipSelect;

/** Who may open the report: people who manage roles and the safeguarding lead. */
export function canSeeAccessReport(can: (p: "roles.manage" | "safeguarding.manage") => boolean) {
  return can("roles.manage") || can("safeguarding.manage");
}
