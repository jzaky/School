import { userScope } from "@/lib/tenant-db";

/**
 * Pick the organization a user should land in: their last active one if still a member, else the first.
 * With includePending, someone whose only membership is waiting for approval still gets a session, which
 * grants nothing (the request context requires ACTIVE) and lands them on the "Waiting for the school" screen.
 */
export async function resolveActiveMembership(userId: string, preferredOrgId?: string | null, opts: { includePending?: boolean } = {}) {
  return userScope(userId, async (tx) => {
    const memberships = await tx.membership.findMany({
      where: { userId, status: opts.includePending ? { in: ["ACTIVE", "PENDING_APPROVAL"] } : "ACTIVE" },
      orderBy: { createdAt: "asc" },
      select: { id: true, orgId: true, status: true },
    });
    const active = memberships.filter((m) => m.status === "ACTIVE");
    const pool = active.length ? active : memberships;
    if (pool.length === 0) return null;
    const m = pool.find((x) => x.orgId === preferredOrgId) ?? pool[0];
    return { id: m.id, orgId: m.orgId };
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
