// Who may see a school group, and in what role.
//
// Group tables are read through userScope (app.current_user_id), so Row-Level Security only returns the
// caller's own group roles and the schools of their groups. A group role never grants anything inside a
// school: opening a school still needs an ACTIVE membership there.
import type { GroupRole } from "@prisma/client";
import { identityDb, userScope } from "@/lib/tenant-db";
import { platformAdminEmails } from "@/server/platform/catalog-db";

export type GroupSummary = { id: string; slug: string; nameEn: string; nameAr: string; logoUrl: string | null; updatedAt: Date };
export type GroupRoleRow = { groupId: string; role: GroupRole; titleEn: string | null; titleAr: string | null; group: GroupSummary };

export class GroupAccessError extends Error {
  constructor(public code: "forbidden" | "not_found") {
    super(`group:${code}`);
  }
}

/** The caller's group roles (RLS: only their own rows). */
export async function groupRolesForUser(userId: string): Promise<GroupRoleRow[]> {
  if (!userId) return [];
  return userScope(userId, (tx) =>
    tx.groupMember.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { groupId: true, role: true, titleEn: true, titleAr: true, group: { select: { id: true, slug: true, nameEn: true, nameAr: true, logoUrl: true, updatedAt: true } } },
    }),
  );
}

/** The caller's role in one group, or null. */
export async function groupRoleOf(userId: string, groupId: string): Promise<GroupRole | null> {
  const rows = await groupRolesForUser(userId);
  return rows.find((r) => r.groupId === groupId)?.role ?? null;
}

/** Throws unless the user holds a role in the group (ADMIN when `admin` is set). Returns the role. */
export async function requireGroupRole(userId: string, groupId: string, opts: { admin?: boolean } = {}): Promise<GroupRole> {
  const role = await groupRoleOf(userId, groupId);
  if (!role) throw new GroupAccessError("forbidden");
  if (opts.admin && role !== "ADMIN") throw new GroupAccessError("forbidden");
  return role;
}

/** Member schools of a group as the caller may see them (RLS returns nothing for a non-member). */
export async function groupSchoolLinks(userId: string, groupId: string) {
  return userScope(userId, (tx) => tx.schoolGroupSchool.findMany({ where: { groupId }, orderBy: { joinedAt: "asc" }, select: { orgId: true, via: true, joinedAt: true } }));
}

/** Platform admins: the User flag, or an email listed in PLATFORM_ADMIN_EMAILS. */
export function isPlatformAdmin(user: { isPlatformAdmin: boolean; email: string } | null | undefined): boolean {
  if (!user) return false;
  return user.isPlatformAdmin || platformAdminEmails().includes(user.email.trim().toLowerCase());
}

export async function platformAdminById(userId: string): Promise<boolean> {
  if (!userId) return false;
  return isPlatformAdmin(await identityDb.user.findUnique({ where: { id: userId }, select: { isPlatformAdmin: true, email: true } }));
}
