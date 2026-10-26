// Which school a public application page belongs to.
//
// Like the join pages (src/server/platform/join-lookup.ts), this is the documented "platform admin" exception to
// CLAUDE.md hard rule 2: before a family belongs to a school there is no organization context, and the app role
// cannot find another school by its slug. This one function uses the owner client to turn a slug into a school id
// and nothing else. Everything after that reads through tenantDb(orgId). Inputs are validated before the query,
// nothing here writes, and no personal data is returned.
import "server-only";
import { catalogDb } from "@/server/platform/catalog-db";
import { publicOrgBySlug, tenantDb } from "@/lib/tenant-db";

export type ApplySchool = {
  id: string;
  slug: string;
  nameEn: string;
  nameAr: string;
  shortNameEn: string | null;
  shortNameAr: string | null;
  logoUrl: string | null;
  primaryColor: string;
  isDemo: boolean;
  curricula: string[];
  emirate: string;
  supportEmail: string | null;
  feePaymentUrl: string | null;
};

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,60}$/;

async function orgIdForSlug(slug: string): Promise<string | null> {
  const owner = catalogDb();
  if (owner) {
    const row = await owner.organization.findUnique({ where: { slug }, select: { id: true } });
    return row?.id ?? null;
  }
  // Without an owner connection only the public demo school can be found.
  return (await publicOrgBySlug(slug))?.id ?? null;
}

/** The school for a slug with its public branding, or null when there is no such school. */
export async function applySchoolBySlug(slug: string): Promise<ApplySchool | null> {
  const s = (slug ?? "").toLowerCase();
  if (!SLUG_RE.test(s)) return null;
  const id = await orgIdForSlug(s);
  if (!id) return null;
  return tenantDb(id).organization.findUnique({
    where: { id },
    select: { id: true, slug: true, nameEn: true, nameAr: true, shortNameEn: true, shortNameAr: true, logoUrl: true, primaryColor: true, isDemo: true, curricula: true, emirate: true, supportEmail: true, feePaymentUrl: true },
  });
}
