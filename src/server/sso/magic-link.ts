// Email sign-in links ("magic links"). A request never reveals whether an address has an account: the caller
// always shows the same message, and the work is padded to a fixed minimum time. Links are single use, expire after
// 15 minutes, are stored only as a SHA-256 hash, and asking again replaces the previous link. Requests are limited
// per address and per network address; redeeming is limited per network address. The landing page asks for a
// click before the link is used, so mail scanners that open links cannot spend it.
import { createHash } from "node:crypto";
import { createTranslator } from "next-intl";
import { identityDb, tenantDb, tenantTx } from "@/lib/tenant-db";
import { resolveActiveMembership } from "@/server/identity/session-org";
import { hit } from "@/server/access/rate-limit";
import { audit } from "@/server/audit/audit";
import { execCtx } from "@/server/db";
import { queueDirectEmail } from "@/server/notify/direct";
import { flushEffects } from "@/server/queue-core";
import { loadPolicy, methodAvailable } from "./policy";
import { localSignInAllowed } from "./staff-sso";
import { randomToken } from "./seal";
import en from "../../../messages/en.json";
import ar from "../../../messages/ar.json";

export const MAGIC_TTL_MS = 15 * 60_000;
const PREFIX = "magic:";
const hash = (raw: string) => createHash("sha256").update(raw).digest("hex");
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export type MagicRequest = { email: string; orgId: string | null; locale: "en" | "ar"; ip: string; now?: Date; minMs?: number };
export type MagicResult = { sent: boolean; reason?: "INVALID" | "RATE_LIMITED" | "UNKNOWN" | "NOT_ALLOWED" };

async function pad<T>(started: number, minMs: number, value: T): Promise<T> {
  const wait = minMs - (Date.now() - started);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  return value;
}

/** Sends a sign-in link when the address belongs to a member whose school offers email links. */
export async function requestMagicLink(req: MagicRequest): Promise<MagicResult> {
  const started = Date.now();
  const minMs = req.minMs ?? 600;
  const now = req.now ?? new Date();
  const email = req.email.trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 200) return pad(started, minMs, { sent: false, reason: "INVALID" });
  const [byEmail, byIp] = await Promise.all([hit(`magic:${email}`, 5, 60 * 60), hit(`magic-ip:${req.ip}`, 20, 15 * 60)]);
  if (!byEmail.ok || !byIp.ok) return pad(started, minMs, { sent: false, reason: "RATE_LIMITED" });

  const user = await identityDb.user.findUnique({ where: { email }, select: { id: true, lastActiveOrgId: true, nameEn: true } });
  if (!user) return pad(started, minMs, { sent: false, reason: "UNKNOWN" });
  const membership = req.orgId
    ? await tenantDb(req.orgId).membership.findUnique({ where: { orgId_userId: { orgId: req.orgId, userId: user.id } }, select: { id: true, orgId: true, status: true } })
    : await resolveActiveMembership(user.id, user.lastActiveOrgId, { includePending: true }).then((m) => (m ? { ...m, status: "ACTIVE" as const } : null));
  if (!membership || (membership.status !== "ACTIVE" && membership.status !== "PENDING_APPROVAL")) return pad(started, minMs, { sent: false, reason: "UNKNOWN" });
  const orgId = membership.orgId;
  const policy = await loadPolicy(orgId);
  if (!methodAvailable(policy, "magic_link") || !(await localSignInAllowed(orgId, membership.id, policy))) return pad(started, minMs, { sent: false, reason: "NOT_ALLOWED" });

  const raw = randomToken(32);
  const token = hash(raw);
  const identifier = `${PREFIX}${user.id}:${orgId}`;
  await identityDb.verificationToken.deleteMany({ where: { identifier } });
  await identityDb.verificationToken.create({ data: { identifier, token, expires: new Date(now.getTime() + MAGIC_TTL_MS) } });

  const org = await tenantDb(orgId).organization.findUnique({ where: { id: orgId }, select: { nameEn: true, nameAr: true } });
  type T = (k: string, v?: Record<string, string | number>) => string;
  const t = createTranslator({ locale: req.locale, messages: req.locale === "ar" ? ar : en, namespace: "sso.email" }) as unknown as T;
  const school = (req.locale === "ar" ? org?.nameAr : org?.nameEn) || org?.nameEn || "";
  const effects = await tenantTx(orgId, async (tx) => {
    const ec = execCtx(tx, orgId, { now, actorId: membership.id });
    await queueDirectEmail(ec, {
      to: email,
      templateKey: "magic_link",
      subject: t("subject", { school }),
      body: t("body", { school, minutes: MAGIC_TTL_MS / 60_000 }),
      href: `/magic-link?token=${raw}`,
      locale: req.locale,
      idempotencyKey: `magic:${user.id}:${token.slice(0, 24)}`,
    });
    await audit(tx, orgId, { actorId: membership.id, actorUserId: user.id, action: "auth.magic_link_sent", entityType: "Membership", entityId: membership.id });
    return ec.effects;
  });
  await flushEffects(effects);
  return pad(started, minMs, { sent: true });
}

export type MagicRedeemed = { userId: string; orgId: string; membershipId: string };

/** Uses a link once. Null when unknown, used, expired, or no longer allowed by the school. */
export async function redeemMagicLink(raw: unknown, opts: { ip: string; now?: Date }): Promise<MagicRedeemed | null> {
  const now = opts.now ?? new Date();
  if (typeof raw !== "string" || raw.length < 30 || raw.length > 100) return null;
  if (!(await hit(`magic-redeem-ip:${opts.ip}`, 30, 15 * 60)).ok) return null;
  const token = hash(raw);
  const row = await identityDb.verificationToken.findFirst({ where: { token, identifier: { startsWith: PREFIX } } });
  if (!row) return null;
  const gone = await identityDb.verificationToken.deleteMany({ where: { identifier: row.identifier, token } });
  if (gone.count !== 1 || row.expires.getTime() < now.getTime()) return null;
  const [userId, orgId] = row.identifier.slice(PREFIX.length).split(":");
  if (!userId || !orgId) return null;
  const m = await tenantDb(orgId).membership.findUnique({ where: { orgId_userId: { orgId, userId } }, select: { id: true, status: true } });
  if (!m || (m.status !== "ACTIVE" && m.status !== "PENDING_APPROVAL")) return null;
  const policy = await loadPolicy(orgId);
  if (!methodAvailable(policy, "magic_link") || !(await localSignInAllowed(orgId, m.id, policy))) return null;
  // The address was proven by opening the email.
  await identityDb.user.updateMany({ where: { id: userId, emailVerified: null }, data: { emailVerified: now } });
  await audit(tenantDb(orgId), orgId, { actorId: m.id, actorUserId: userId, action: "auth.sign_in", entityType: "Membership", entityId: m.id, meta: { method: "magic_link" } });
  return { userId, orgId, membershipId: m.id };
}
