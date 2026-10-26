// The person signing off a return: name and title in both languages.
import type { TenantDb } from "@/lib/tenant-db";
import { GovError } from "./access";

/** Their own title, else their job title, else their principal (or first) role. */
export async function signerOf(db: TenantDb, membershipId: string) {
  const m = await db.membership.findUnique({
    where: { id: membershipId },
    select: { titleEn: true, titleAr: true, user: { select: { nameEn: true, nameAr: true } }, staffProfile: { select: { jobTitleEn: true, jobTitleAr: true } }, roles: { select: { role: { select: { key: true, nameEn: true, nameAr: true } } } } },
  });
  if (!m) throw new GovError("NOT_FOUND");
  const role = m.roles.map((r) => r.role).find((r) => r.key === "principal") ?? m.roles[0]?.role;
  const en = m.titleEn || m.staffProfile?.jobTitleEn || role?.nameEn || null;
  const ar = m.titleAr || m.staffProfile?.jobTitleAr || role?.nameAr || en;
  return { name: { en: m.user.nameEn, ar: m.user.nameAr || m.user.nameEn }, title: en ? { en, ar: ar ?? en } : null };
}
