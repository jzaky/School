// School referral codes. Each school has a code its leaders can share as /signup?ref=CODE; a school that
// signs up with it records the referring school (Organization.referredByOrgId). No discounts are applied
// automatically: commercial terms are agreed offline.
// Cross-school reads (resolving a code at sign-up, the platform referral list) use the owner client; a
// school's own code is created through its tenant client (the org_update policy covers its own row).
import { randomBytes } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { JOIN_CODE_ALPHABET, joinCodeFrom } from "@/lib/signup";
import type { TenantDb } from "@/lib/tenant-db";

type OrgDb = Pick<PrismaClient, "organization">;

const CODE_RE = new RegExp(`^[${JOIN_CODE_ALPHABET}]{8}$`);

/** Uppercase, trimmed code when it has the right shape, else null. */
export function normalizeReferralCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return CODE_RE.test(code) ? code : null;
}

/** The school's referral code, creating one on first use. Runs on the school's own tenant client. */
export async function ensureReferralCode(db: TenantDb, orgId: string): Promise<string> {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { referralCode: true } });
  if (org?.referralCode) return org.referralCode;
  for (let i = 0; i < 6; i++) {
    const code = joinCodeFrom(randomBytes(8));
    try {
      // Only fills an empty code, so two first views at once keep the same code.
      await db.organization.updateMany({ where: { id: orgId, referralCode: null }, data: { referralCode: code } });
      const after = await db.organization.findUnique({ where: { id: orgId }, select: { referralCode: true } });
      if (after?.referralCode) return after.referralCode;
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
    }
  }
  throw new Error("REFERRAL_CODE_FAILED");
}

/** The school behind a referral code (owner client), or null. */
export async function resolveReferralCode(db: OrgDb, raw: unknown) {
  const code = normalizeReferralCode(raw);
  if (!code) return null;
  return db.organization.findUnique({ where: { referralCode: code }, select: { id: true, nameEn: true, nameAr: true } });
}

/** Schools that referred at least one other school, with the schools they referred (owner client). */
export async function referralOverview(db: OrgDb) {
  const referred = await db.organization.findMany({
    where: { referredByOrgId: { not: null } },
    select: { id: true, nameEn: true, nameAr: true, createdAt: true, referredByOrgId: true, isDemo: true },
    orderBy: { createdAt: "desc" },
    take: 2000,
  });
  const referrerIds = [...new Set(referred.map((o) => o.referredByOrgId!))];
  const referrers = await db.organization.findMany({ where: { id: { in: referrerIds } }, select: { id: true, nameEn: true, nameAr: true, referralCode: true } });
  const withCodes = await db.organization.count({ where: { referralCode: { not: null } } });
  return {
    withCodes,
    totalReferred: referred.length,
    rows: referrers
      .map((r) => ({ ...r, schools: referred.filter((o) => o.referredByOrgId === r.id) }))
      .sort((a, b) => b.schools.length - a.schools.length || a.nameEn.localeCompare(b.nameEn)),
  };
}
