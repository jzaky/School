// Partner resources: links to external providers (career experiences, advisors, test preparation and so on)
// that school admins and career advisors add for students and parents. Clicks are counted in aggregate only:
// one counter per link, never who clicked.
import type { Tx } from "@/server/db";
import { audit } from "@/server/audit/audit";

export const PARTNER_CATEGORIES = ["career_experience", "advising", "test_prep", "scholarships", "internships", "other"] as const;
export type PartnerCategory = (typeof PARTNER_CATEGORIES)[number];
export const PARTNER_AUDIENCES = ["student", "parent"] as const;

export class PartnerError extends Error {
  constructor(public code: "NOT_FOUND" | "NAME_REQUIRED" | "DESC_REQUIRED" | "INVALID_URL" | "INVALID_CATEGORY" | "AUDIENCE_REQUIRED") {
    super(code);
  }
}

export type PartnerInput = { id?: string | null; nameEn: string; nameAr: string; descEn: string; descAr: string; category: string; url: string; audience: string[]; active: boolean };

/** Validate and normalize (pure). Only https links, so families never leave for an insecure page. */
export function normalizePartner(input: PartnerInput) {
  const nameEn = input.nameEn.trim();
  if (nameEn.length < 2) throw new PartnerError("NAME_REQUIRED");
  const descEn = input.descEn.trim();
  if (descEn.length < 5) throw new PartnerError("DESC_REQUIRED");
  if (!(PARTNER_CATEGORIES as readonly string[]).includes(input.category)) throw new PartnerError("INVALID_CATEGORY");
  let url: URL;
  try {
    url = new URL(input.url.trim());
  } catch {
    throw new PartnerError("INVALID_URL");
  }
  if (url.protocol !== "https:" || !url.hostname.includes(".")) throw new PartnerError("INVALID_URL");
  const audience = [...new Set(input.audience.filter((a) => (PARTNER_AUDIENCES as readonly string[]).includes(a)))];
  if (!audience.length) throw new PartnerError("AUDIENCE_REQUIRED");
  return {
    nameEn: nameEn.slice(0, 120),
    nameAr: (input.nameAr.trim() || nameEn).slice(0, 120),
    descEn: descEn.slice(0, 600),
    descAr: (input.descAr.trim() || descEn).slice(0, 600),
    category: input.category,
    url: url.toString(),
    audience,
    active: Boolean(input.active),
  };
}

export async function savePartner(tx: Tx, orgId: string, input: PartnerInput, actorId: string) {
  const data = normalizePartner(input);
  if (input.id) {
    const cur = await tx.partnerResource.findFirst({ where: { orgId, id: input.id } });
    if (!cur) throw new PartnerError("NOT_FOUND");
    const row = await tx.partnerResource.update({ where: { id: cur.id }, data });
    await audit(tx, orgId, { actorId, action: "partner_resource.update", entityType: "PartnerResource", entityId: row.id, meta: { active: row.active, audience: row.audience } });
    return row;
  }
  const row = await tx.partnerResource.create({ data: { orgId, ...data, createdById: actorId } });
  await audit(tx, orgId, { actorId, action: "partner_resource.create", entityType: "PartnerResource", entityId: row.id, meta: { category: row.category, audience: row.audience } });
  return row;
}

export async function deletePartner(tx: Tx, orgId: string, id: string, actorId: string) {
  const cur = await tx.partnerResource.findFirst({ where: { orgId, id } });
  if (!cur) throw new PartnerError("NOT_FOUND");
  await tx.partnerResource.delete({ where: { id: cur.id } });
  await audit(tx, orgId, { actorId, action: "partner_resource.delete", entityType: "PartnerResource", entityId: id, meta: { clicks: cur.clickCount } });
}

/** The audience key for a viewer, or null for staff (who preview links without counting). */
export function viewerAudience(v: { isStudent: boolean; isParent: boolean }): "student" | "parent" | null {
  return v.isStudent ? "student" : v.isParent ? "parent" : null;
}
