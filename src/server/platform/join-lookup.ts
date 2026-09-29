// Pre-tenant lookups for joining a school.
//
// This is the documented "platform admin" exception to CLAUDE.md hard rule 2. Before someone belongs to a
// school there is no organization context, and the app role cannot read another school's invitations or
// find a school by its join code. These narrow functions use the owner client (catalogDb) to answer one
// question each and return only ids and public school branding. Everything after that goes through
// tenantDb / tenantTx with the organization id they return.
//
// Rules: inputs are validated before they reach a query, nothing here writes, and no personal data is returned.
import { catalogDb } from "@/server/platform/catalog-db";
import { tenantDb } from "@/lib/tenant-db";
import { schoolVerified } from "@/server/onboarding/verification";
import { looksLikeToken, hashToken, normalizeJoinCode } from "@/server/access/tokens";

export class JoinUnavailableError extends Error {
  constructor() {
    super("join:unavailable");
  }
}

function db() {
  const c = catalogDb();
  if (!c) throw new JoinUnavailableError();
  return c;
}

export type PublicSchool = {
  id: string;
  nameEn: string;
  nameAr: string;
  shortNameEn: string | null;
  shortNameAr: string | null;
  logoUrl: string | null;
  primaryColor: string;
  defaultLocale: "en" | "ar";
  parentSelfJoin: boolean;
  parentJoinApproval: boolean;
  studentSelfJoin: boolean;
  staffEmailDomains: string[];
  staffDomainAutoApprove: boolean;
  googleSignIn: boolean;
  microsoftSignIn: boolean;
};

const PUBLIC_SELECT = {
  id: true,
  nameEn: true,
  nameAr: true,
  shortNameEn: true,
  shortNameAr: true,
  logoUrl: true,
  primaryColor: true,
  defaultLocale: true,
  parentSelfJoin: true,
  parentJoinApproval: true,
  studentSelfJoin: true,
  staffEmailDomains: true,
  staffDomainAutoApprove: true,
  googleSignIn: true,
  microsoftSignIn: true,
} as const;

/** Which school and invitation a raw token belongs to. Only the hash is compared. */
export async function findInvitationByToken(token: string): Promise<{ orgId: string; invitationId: string } | null> {
  if (!looksLikeToken(token)) return null;
  const row = await db().invitation.findUnique({ where: { tokenHash: hashToken(token) }, select: { id: true, orgId: true } });
  return row ? { orgId: row.orgId, invitationId: row.id } : null;
}

/** The school with this join code, ignoring case, spaces and dashes. */
export async function findSchoolByJoinCode(code: string): Promise<PublicSchool | null> {
  const norm = normalizeJoinCode(code);
  if (!norm) return null;
  const rows = await db().$queryRaw<Array<{ id: string; createdById: string | null }>>`
    SELECT "id", "createdById" FROM "Organization"
    WHERE "joinCode" IS NOT NULL AND regexp_replace(upper("joinCode"), '[^A-Z0-9]', '', 'g') = ${norm}
    LIMIT 1`;
  if (!rows[0]) return null;
  // A new school's family code works only after its founding administrator confirms their email.
  if (!(await schoolVerified({ id: rows[0].id, createdById: rows[0].createdById }))) return null;
  return schoolById(rows[0].id);
}

/** Public branding and join settings of one school. Once the id is known this reads through tenantDb. */
export async function schoolById(orgId: string): Promise<PublicSchool | null> {
  if (!/^[a-z0-9]{10,40}$/i.test(orgId)) return null;
  return tenantDb(orgId).organization.findUnique({ where: { id: orgId }, select: PUBLIC_SELECT });
}

/** True when an owner connection is configured, so the join pages can work. */
export function joinAvailable(): boolean {
  return catalogDb() !== null;
}
