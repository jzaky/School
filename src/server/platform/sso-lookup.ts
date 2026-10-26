// Pre-tenant lookups for signing in: a school's sign-in page by its address (slug), and the school a ClassLink
// LaunchPad or Clever portal sign-in belongs to (by tenant or district id).
//
// This is the documented "platform admin" exception to CLAUDE.md hard rule 2, like join-lookup.ts: before sign-in
// there is no organization context, and the app role cannot find a school it does not belong to. Each function
// answers one question with ids and public branding only; everything after goes through tenantDb(orgId).
import { catalogDb } from "@/server/platform/catalog-db";
import { tenantDb } from "@/lib/tenant-db";

export type SignInSchool = { id: string; slug: string; nameEn: string; nameAr: string; logoUrl: string | null; primaryColor: string; isDemo: boolean };

const SLUG = /^[a-z0-9][a-z0-9-]{1,62}$/;
const SELECT = { id: true, slug: true, nameEn: true, nameAr: true, logoUrl: true, primaryColor: true, isDemo: true } as const;

/** The school with this address, or null. Works without an owner connection for the demo school only. */
export async function schoolBySlug(slug: string): Promise<SignInSchool | null> {
  const s = slug.trim().toLowerCase();
  if (!SLUG.test(s)) return null;
  const db = catalogDb();
  if (db) return db.organization.findUnique({ where: { slug: s }, select: SELECT });
  // Without an owner connection the app role sees the demo school only (prisma/rls.sql section 3).
  const { publicOrgBySlug } = await import("@/lib/tenant-db");
  const org = await publicOrgBySlug(s);
  return org ? { id: org.id, slug: org.slug, nameEn: org.nameEn, nameAr: org.nameAr, logoUrl: org.logoUrl, primaryColor: org.primaryColor, isDemo: org.isDemo } : null;
}

export async function schoolById(orgId: string): Promise<SignInSchool | null> {
  if (!/^[a-z0-9]{10,40}$/i.test(orgId)) return null;
  return tenantDb(orgId).organization.findUnique({ where: { id: orgId }, select: SELECT });
}

/** The school that registered this ClassLink tenant or Clever district (each id belongs to one school at most). */
export async function orgForTenant(provider: "classlink" | "clever", tenant: string | null): Promise<string | null> {
  if (!tenant || tenant.length > 120) return null;
  const db = catalogDb();
  if (!db) return null;
  const row = await db.signInPolicy.findUnique({ where: provider === "classlink" ? { classlinkTenantId: tenant } : { cleverDistrictId: tenant }, select: { orgId: true } });
  return row?.orgId ?? null;
}

/** Whether another school already registered this tenant or district id (for a clear message on save). */
export async function tenantTaken(provider: "classlink" | "clever", tenant: string, orgId: string): Promise<boolean> {
  const owner = await orgForTenant(provider, tenant);
  return !!owner && owner !== orgId;
}
