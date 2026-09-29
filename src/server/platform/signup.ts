// Platform provisioning for self-serve sign-up.
//
// This is the documented "platform admin" exception to CLAUDE.md hard rule 2: a new school has no
// organization yet, and app_user may not INSERT into Organization, so creating the school, installing its
// starter template and the first membership runs on the owner client (catalogDb). Rules:
// - Only these narrow functions use the owner client; every input is validated (src/lib/signup.ts) first.
// - Nothing here reads another school's data; the only cross-tenant reads are slug and join code uniqueness.
// - Every provisioning writes an AuditEvent in the new school.
// After the membership exists the request switches to tenantDb and a normal session.
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import type { SchoolCurriculum } from "@prisma/client";
import { catalogDb, type CatalogDb } from "./catalog-db";
import { installStarterTemplate } from "../../../prisma/seed/starter";
import { wipeTenant } from "../../../prisma/seed/lib";
import { joinCodeFrom, regulatorFor, slugCandidates } from "@/lib/signup";

export class SignupError extends Error {
  constructor(public code: "credentials" | "unavailable" | "failed") {
    super(`signup:${code}`);
  }
}

function owner(): CatalogDb {
  const db = catalogDb();
  if (!db) throw new SignupError("unavailable");
  return db;
}

export type SignupUserResult = { userId: string; created: boolean };

/**
 * Find or create the global user for a password sign-up. An existing account is only reused when the
 * password matches; otherwise the caller shows the same generic message as any credential failure,
 * so the form never reveals whether an email is registered.
 */
export async function resolvePasswordUser(input: { email: string; password: string; name: string; locale: "en" | "ar" }, db: CatalogDb = owner()): Promise<SignupUserResult> {
  const email = input.email.trim().toLowerCase();
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    if (!existing.passwordHash) throw new SignupError("credentials");
    const ok = await bcrypt.compare(input.password, existing.passwordHash);
    if (!ok) throw new SignupError("credentials");
    return { userId: existing.id, created: false };
  }
  const passwordHash = await bcrypt.hash(input.password, 12);
  const user = await db.user.create({ data: { email, nameEn: input.name.trim(), passwordHash, locale: input.locale } });
  return { userId: user.id, created: true };
}

/** The first free slug for a school name. */
export async function freeSlug(nameEn: string, db: CatalogDb = owner()): Promise<string> {
  const candidates = slugCandidates(nameEn, 20);
  const taken = new Set((await db.organization.findMany({ where: { slug: { in: candidates } }, select: { slug: true } })).map((o) => o.slug));
  const free = candidates.find((c) => !taken.has(c));
  if (free) return free;
  return `${candidates[0].slice(0, 32)}-${randomBytes(3).toString("hex")}`;
}

/** A join code no other school uses. */
export async function freeJoinCode(db: CatalogDb = owner()): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const code = joinCodeFrom(randomBytes(8));
    if (!(await db.organization.findUnique({ where: { joinCode: code }, select: { id: true } }))) return code;
  }
  throw new SignupError("failed");
}

export type ProvisionInput = {
  userId: string;
  schoolNameEn: string;
  schoolNameAr: string;
  emirate: string;
  curricula: SchoolCurriculum[];
  locale: "en" | "ar";
  isPrincipal: boolean;
  now?: Date;
};

export type Provisioned = { orgId: string; slug: string; membershipId: string };

/** Create the school, install the starter template and make the user its administrator. Cleans up on failure. */
export async function provisionSchool(input: ProvisionInput, db: CatalogDb = owner()): Promise<Provisioned> {
  const now = input.now ?? new Date();
  const slug = await freeSlug(input.schoolNameEn, db);
  const joinCode = await freeJoinCode(db);
  const org = await db.organization.create({
    data: {
      slug,
      nameEn: input.schoolNameEn.trim(),
      nameAr: input.schoolNameAr.trim(),
      emirate: input.emirate,
      regulator: regulatorFor(input.emirate),
      curricula: input.curricula,
      defaultLocale: input.locale,
      timezone: "Asia/Dubai",
      hijriEnabled: true,
      joinCode,
      createdById: input.userId,
      isDemo: false,
    },
  });
  try {
    await installStarterTemplate(db, org.id, { curricula: input.curricula, locale: input.locale, now });
    const roles = await db.role.findMany({ where: { orgId: org.id, key: { in: input.isPrincipal ? ["school_admin", "principal"] : ["school_admin"] } }, select: { id: true } });
    const administration = await db.department.findFirst({ where: { orgId: org.id, key: "administration" }, select: { id: true } });
    const title = input.isPrincipal ? { en: "Principal", ar: "مدير المدرسة" } : { en: "School Administrator", ar: "مسؤول إدارة المدرسة" };
    const membership = await db.membership.create({ data: { orgId: org.id, userId: input.userId, status: "ACTIVE", titleEn: title.en, titleAr: title.ar, locale: input.locale } });
    await db.staffProfile.create({ data: { orgId: org.id, membershipId: membership.id, departmentId: administration?.id ?? null, jobTitleEn: title.en, jobTitleAr: title.ar } });
    await db.membershipRole.createMany({ data: roles.map((r) => ({ orgId: org.id, membershipId: membership.id, roleId: r.id })) });
    await db.user.update({ where: { id: input.userId }, data: { lastActiveOrgId: org.id } });
    await db.auditEvent.create({
      data: { orgId: org.id, actorId: membership.id, actorUserId: input.userId, action: "org.signup", entityType: "Organization", entityId: org.id, meta: { curricula: input.curricula, emirate: input.emirate, principal: input.isPrincipal } },
    });
    return { orgId: org.id, slug, membershipId: membership.id };
  } catch (e) {
    await removeSchool(org.id, db).catch(() => undefined);
    throw e instanceof SignupError ? e : new SignupError("failed");
  }
}

/** Delete a school and every row it owns (failed sign-up cleanup, tests). */
export async function removeSchool(orgId: string, db: CatalogDb = owner()) {
  await wipeTenant(db, orgId);
  await db.organization.delete({ where: { id: orgId } });
}

/** Remove a user created during a sign-up that then failed. Only users with no memberships are removed. */
export async function removeOrphanUser(userId: string, db: CatalogDb = owner()) {
  const memberships = await db.membership.count({ where: { userId } });
  if (memberships === 0) await db.user.delete({ where: { id: userId } }).catch(() => undefined);
}
