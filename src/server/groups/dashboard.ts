// Group dashboard data. Steps, in this order:
// 1. the caller's group role is checked (userScope, RLS on GroupMember);
// 2. the member schools are listed (userScope, RLS on SchoolGroupSchool returns only their group's schools);
// 3. each school is evaluated on its own through tenantDb(orgId).
// No query reads two schools at once, and no owner (RLS-bypassing) client is used.
import type { GroupRole } from "@prisma/client";
import { tenantDb } from "@/lib/tenant-db";
import { listUserOrganizations } from "@/server/identity/session-org";
import { groupSchoolLinks, requireGroupRole } from "./access";
import { aggregateGroupKpis, collectSchoolKpis, type GroupTotals, type SchoolKpis } from "./kpis";

export type GroupSchoolRow = {
  orgId: string;
  nameEn: string;
  nameAr: string;
  shortNameEn: string | null;
  shortNameAr: string | null;
  emirate: string;
  hasLogo: boolean;
  joinedAt: Date;
  via: string;
  /** The caller also holds an ACTIVE membership here, so "Open school" works. */
  canOpen: boolean;
  kpis: SchoolKpis;
};

export type GroupDashboard = { role: GroupRole; schools: GroupSchoolRow[]; totals: GroupTotals };

export async function loadGroupDashboard(userId: string, groupId: string, now = new Date()): Promise<GroupDashboard> {
  const role = await requireGroupRole(userId, groupId);
  const [links, mine] = await Promise.all([groupSchoolLinks(userId, groupId), listUserOrganizations(userId)]);
  const myOrgIds = new Set(mine.map((o) => o.id));
  const schools = await Promise.all(
    links.map(async (l): Promise<GroupSchoolRow | null> => {
      const db = tenantDb(l.orgId);
      const [org, kpis] = await Promise.all([
        db.organization.findUnique({ where: { id: l.orgId }, select: { nameEn: true, nameAr: true, shortNameEn: true, shortNameAr: true, emirate: true, logoUrl: true } }),
        collectSchoolKpis(db, l.orgId, now),
      ]);
      if (!org) return null;
      return { orgId: l.orgId, nameEn: org.nameEn, nameAr: org.nameAr, shortNameEn: org.shortNameEn, shortNameAr: org.shortNameAr, emirate: org.emirate, hasLogo: !!org.logoUrl, joinedAt: l.joinedAt, via: l.via, canOpen: myOrgIds.has(l.orgId), kpis };
    }),
  );
  const rows = schools.filter((s): s is GroupSchoolRow => s !== null);
  return { role, schools: rows, totals: aggregateGroupKpis(rows.map((r) => r.kpis)) };
}

/** Names of the group's schools only (for pickers), read the same way. */
export async function listGroupSchools(userId: string, groupId: string) {
  await requireGroupRole(userId, groupId);
  const links = await groupSchoolLinks(userId, groupId);
  const rows = await Promise.all(
    links.map(async (l) => {
      const org = await tenantDb(l.orgId).organization.findUnique({ where: { id: l.orgId }, select: { id: true, nameEn: true, nameAr: true } });
      return org ? { ...org, joinedAt: l.joinedAt, via: l.via } : null;
    }),
  );
  return rows.filter((r): r is NonNullable<typeof r> => r !== null);
}
