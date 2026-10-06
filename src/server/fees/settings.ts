// School fee payment link. Horizon only links to the school's own portal; it never processes payments.
import type { TenantDb } from "@/lib/tenant-db";
import { audit } from "@/server/audit/audit";

export type FeeSettingsInput = { url: string; contact: string };

/** Validates the link (https only, no credentials in the URL) and trims the contact. */
export function parseFeeSettings(input: FeeSettingsInput): { ok: true; url: string | null; contact: string | null } | { ok: false; error: "URL_INVALID" | "CONTACT_TOO_LONG" } {
  const raw = input.url.trim();
  const contact = input.contact.trim().replace(/\s+/g, " ");
  if (contact.length > 200) return { ok: false, error: "CONTACT_TOO_LONG" };
  if (!raw) return { ok: true, url: null, contact: contact || null };
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, error: "URL_INVALID" };
  }
  if (u.protocol !== "https:" || u.username || u.password || raw.length > 500) return { ok: false, error: "URL_INVALID" };
  return { ok: true, url: u.toString(), contact: contact || null };
}

export async function saveFeeSettings(db: TenantDb, orgId: string, actor: { membershipId: string; userId: string }, input: FeeSettingsInput) {
  const parsed = parseFeeSettings(input);
  if (!parsed.ok) return parsed;
  const before = await db.organization.findUnique({ where: { id: orgId }, select: { feePaymentUrl: true, feeContact: true } });
  await db.organization.update({ where: { id: orgId }, data: { feePaymentUrl: parsed.url, feeContact: parsed.contact } });
  await audit(db, orgId, {
    actorId: actor.membershipId,
    actorUserId: actor.userId,
    action: "org.fees_update",
    entityType: "Organization",
    entityId: orgId,
    meta: { from: { url: before?.feePaymentUrl ?? null, contact: before?.feeContact ?? null }, to: { url: parsed.url, contact: parsed.contact } },
  });
  return { ok: true as const };
}
