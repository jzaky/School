// Shared steps for turning a person into a member of a school: staff, parent or student.
// Used by invitation accept, joining with the school code, and approving join requests.
import type { MembershipStatus } from "@prisma/client";
import type { TenantTx } from "@/lib/tenant-db";
import { audienceOfRole, type Audience } from "./permission-catalog";

export class JoinError extends Error {
  constructor(public code: string) {
    super(`join:${code}`);
  }
}

export function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().replace(/\s+/g, " ").split(" ");
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
}

export async function rolesByKeys(tx: TenantTx, keys: string[], audience: Audience) {
  const roles = await tx.role.findMany({ where: { key: { in: keys } }, select: { id: true, key: true } });
  if (roles.some((r) => audienceOfRole(r.key) !== audience)) throw new JoinError("ROLE_AUDIENCE");
  return roles;
}

export async function grantRoles(tx: TenantTx, orgId: string, membershipId: string, roleIds: string[]) {
  if (roleIds.length === 0) return;
  await tx.membershipRole.createMany({ data: roleIds.map((roleId) => ({ orgId, membershipId, roleId })), skipDuplicates: true });
}

type MemberRow = { id: string; status: MembershipStatus; student: { id: string } | null; guardian: { id: string } | null; roles: Array<{ role: { key: string } }> };

export async function findMembership(tx: TenantTx, userId: string): Promise<MemberRow | null> {
  return tx.membership.findFirst({
    where: { userId },
    select: { id: true, status: true, student: { select: { id: true } }, guardian: { select: { id: true } }, roles: { select: { role: { select: { key: true } } } } },
  });
}

export function membershipAudience(m: MemberRow): Audience | null {
  if (m.guardian || m.roles.some((r) => r.role.key === "parent")) return "parent";
  if (m.student || m.roles.some((r) => r.role.key === "student")) return "student";
  if (m.roles.length > 0) return "staff";
  return null;
}

/** Create or reuse the membership for a user. Refuses to mix staff and family access in one school. */
export async function ensureMembership(
  tx: TenantTx,
  orgId: string,
  userId: string,
  audience: Audience,
  status: MembershipStatus,
): Promise<{ id: string; created: boolean }> {
  const existing = await findMembership(tx, userId);
  if (!existing) {
    const m = await tx.membership.create({ data: { orgId, userId, status } });
    return { id: m.id, created: true };
  }
  if (existing.status === "SUSPENDED") throw new JoinError("SUSPENDED");
  const current = membershipAudience(existing);
  if (current && current !== audience) throw new JoinError("OTHER_ACCESS");
  if (existing.status !== "ACTIVE" && existing.status !== status) await tx.membership.update({ where: { id: existing.id }, data: { status } });
  return { id: existing.id, created: false };
}

/** Staff profile so the person shows in the staff directory. */
export async function ensureStaffProfile(tx: TenantTx, orgId: string, membershipId: string, departmentId?: string | null) {
  await tx.staffProfile.upsert({
    where: { membershipId },
    create: { orgId, membershipId, departmentId: departmentId ?? null },
    update: departmentId ? { departmentId } : {},
  });
}

/**
 * Link a parent membership to a guardian record: reuse the school's guardian row with the same email
 * when it is not yet linked to anyone, otherwise create one from the person's name.
 */
export async function ensureGuardian(
  tx: TenantTx,
  orgId: string,
  membershipId: string,
  person: { email: string; nameEn: string; nameAr?: string | null },
): Promise<string> {
  const own = await tx.guardian.findUnique({ where: { membershipId }, select: { id: true } });
  if (own) return own.id;
  const byEmail = await tx.guardian.findFirst({ where: { membershipId: null, email: { equals: person.email, mode: "insensitive" } }, select: { id: true } });
  if (byEmail) {
    await tx.guardian.update({ where: { id: byEmail.id }, data: { membershipId } });
    return byEmail.id;
  }
  const en = splitName(person.nameEn);
  const ar = splitName(person.nameAr || person.nameEn);
  const g = await tx.guardian.create({
    data: { orgId, membershipId, firstNameEn: en.first, lastNameEn: en.last, firstNameAr: ar.first, lastNameAr: ar.last, email: person.email },
  });
  return g.id;
}

export async function linkChildren(tx: TenantTx, orgId: string, guardianId: string, studentIds: string[]) {
  if (studentIds.length === 0) return 0;
  const students = await tx.student.findMany({ where: { id: { in: studentIds } }, select: { id: true } });
  const res = await tx.guardianLink.createMany({
    data: students.map((s) => ({ orgId, guardianId, studentId: s.id, isPrimary: false, canApprove: true, receivesUpdates: true })),
    skipDuplicates: true,
  });
  return res.count;
}

export async function linkStudent(tx: TenantTx, membershipId: string, studentId: string) {
  const s = await tx.student.findUnique({ where: { id: studentId }, select: { id: true, membershipId: true } });
  if (!s) throw new JoinError("NOT_FOUND");
  if (s.membershipId && s.membershipId !== membershipId) throw new JoinError("STUDENT_TAKEN");
  await tx.student.update({ where: { id: s.id }, data: { membershipId } });
}

/** Close any open join request for this membership (for example when an invite is accepted instead). */
export async function closeOpenRequests(tx: TenantTx, membershipId: string, decidedById: string | null, now: Date, note: string) {
  await tx.joinRequest.updateMany({
    where: { membershipId, status: "PENDING" },
    data: { status: "APPROVED", decidedById, decidedAt: now, decisionNote: note },
  });
}
