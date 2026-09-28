import { userScope } from "@/lib/tenant-db";

/** Pick the organization a user should land in: their last active one if still a member, else the first. */
export async function resolveActiveMembership(userId: string, preferredOrgId?: string | null) {
  return userScope(userId, async (tx) => {
    const memberships = await tx.membership.findMany({
      where: { userId, status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
      select: { id: true, orgId: true },
    });
    if (memberships.length === 0) return null;
    return memberships.find((m) => m.orgId === preferredOrgId) ?? memberships[0];
  });
}

export async function listUserOrganizations(userId: string) {
  return userScope(userId, async (tx) => {
    const memberships = await tx.membership.findMany({
      where: { userId, status: "ACTIVE" },
      select: { id: true, orgId: true, org: { select: { id: true, slug: true, nameEn: true, nameAr: true } } },
    });
    return memberships.map((m) => m.org);
  });
}
