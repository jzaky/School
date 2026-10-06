// Sign-in account handling after a person's data is erased at one school.
// The User row is global: it is anonymised only when the person has no membership at another school.
import { identityDb, userScope } from "@/lib/tenant-db";

export type AccountOutcome = "anonymised" | "kept_other_school" | "none";

export async function anonymiseAccountIfUnused(userId: string | null, orgId: string): Promise<AccountOutcome> {
  if (!userId) return "none";
  const others = await userScope(userId, (tx) => tx.membership.count({ where: { userId, orgId: { not: orgId } } }));
  if (others > 0) return "kept_other_school";
  const user = await identityDb.user.findUnique({ where: { id: userId } });
  if (!user || user.isPlatformAdmin) return "kept_other_school";
  await identityDb.account.deleteMany({ where: { userId } });
  await identityDb.user.update({
    where: { id: userId },
    data: { email: `erased-${userId}@erased.invalid`, emailVerified: null, passwordHash: null, nameEn: "Former member", nameAr: "عضو سابق", image: null, lastActiveOrgId: null },
  });
  return "anonymised";
}
