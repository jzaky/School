// Email verification for a school's founding administrator.
// A school counts as verified once the person who created it has confirmed their email address
// (schools created by the platform, like the demo, have no creator and are always verified).
// Until then the setup wizard works, but staff invitations and family access stay locked.
import { createHash, randomBytes } from "node:crypto";
import { identityDb, tenantTx } from "@/lib/tenant-db";
import { execCtx } from "@/server/db";
import { notify } from "@/server/notify/notify";
import { flushEffects } from "@/server/queue-core";

const TTL_MS = 48 * 3600_000;
const identifierFor = (userId: string) => `verify-email:${userId}`;
export const hashToken = (raw: string) => createHash("sha256").update(raw).digest("hex");

type OrgLike = { id: string; createdById: string | null };

/** Is the school verified? Pass the current user when they may be the creator, to save a lookup. */
export async function schoolVerified(org: OrgLike, current?: { id: string; emailVerified: Date | null }): Promise<boolean> {
  if (!org.createdById) return true;
  if (current && current.id === org.createdById) return current.emailVerified !== null;
  const creator = await identityDb.user.findUnique({ where: { id: org.createdById }, select: { emailVerified: true } });
  return Boolean(creator?.emailVerified);
}

/** Throw unless the school is verified. For invitation and family-access actions. */
export async function requireVerifiedSchool(org: OrgLike) {
  if (!(await schoolVerified(org))) throw new Error("UNVERIFIED_SCHOOL");
}

/**
 * Create a fresh verification link for the user and email it through the school's notification pipeline
 * (template email_verification). Older links for the same user stop working. The raw token only travels in the
 * email; the database keeps its SHA-256 hash.
 */
export async function sendVerificationEmail(input: { orgId: string; membershipId: string; userId: string; name: string; school: { en: string; ar: string }; now?: Date }) {
  const now = input.now ?? new Date();
  const raw = randomBytes(32).toString("base64url");
  const token = hashToken(raw);
  const identifier = identifierFor(input.userId);
  await identityDb.verificationToken.deleteMany({ where: { identifier } });
  await identityDb.verificationToken.create({ data: { identifier, token, expires: new Date(now.getTime() + TTL_MS) } });
  const effects = await tenantTx(input.orgId, async (tx) => {
    const ec = execCtx(tx, input.orgId, { now, actorId: input.membershipId });
    await notify(ec, {
      recipients: [input.membershipId],
      templateKey: "email_verification",
      vars: { name: input.name, school: input.school },
      href: `/verify-email?token=${raw}`,
      kind: "email_verification",
      channels: ["EMAIL"],
      urgent: true,
      idempotencyBase: `verify:${input.userId}:${token.slice(0, 16)}`,
    });
    return ec.effects;
  });
  await flushEffects(effects);
  return { token: raw };
}

/** Confirm a verification link. Returns the user id, or null when the link is unknown or expired. */
export async function confirmEmailToken(raw: string, now = new Date()): Promise<string | null> {
  if (!raw || raw.length < 20 || raw.length > 200) return null;
  const row = await identityDb.verificationToken.findFirst({ where: { token: hashToken(raw), identifier: { startsWith: "verify-email:" } } });
  if (!row) return null;
  const userId = row.identifier.slice("verify-email:".length);
  await identityDb.verificationToken.deleteMany({ where: { identifier: row.identifier } });
  if (row.expires.getTime() < now.getTime()) return null;
  await identityDb.user.update({ where: { id: userId }, data: { emailVerified: now } });
  return userId;
}
