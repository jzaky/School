// "Staff must use single sign-on": when a school turns this on, staff can no longer sign in with a password or an
// email link, only through the school's single sign-on options. School administrators keep password sign-in so a
// broken identity provider can never lock the school out (break-glass), and families are never affected.
import { tenantDb } from "@/lib/tenant-db";
import type { Policy } from "./policy";

export async function localSignInAllowed(orgId: string, membershipId: string, policy: Pick<Policy, "staffSsoRequired">): Promise<boolean> {
  if (!policy.staffSsoRequired) return true;
  const m = await tenantDb(orgId).membership.findUnique({
    where: { id: membershipId },
    select: { student: { select: { id: true } }, guardian: { select: { id: true } }, roles: { select: { role: { select: { key: true } } } } },
  });
  if (!m) return false;
  const keys = m.roles.map((r) => r.role.key);
  const family = !!m.student || !!m.guardian || keys.includes("parent") || keys.includes("student");
  if (family) return true;
  return keys.includes("school_admin");
}
