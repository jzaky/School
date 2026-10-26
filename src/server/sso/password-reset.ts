// Forgotten password. The request always gets the same answer, whether or not the address has an account, and
// the work is padded to a fixed minimum time. The emailed link is single use, expires after 45 minutes and is
// stored only as a SHA-256 hash; asking again replaces it. Requests are limited per address and per network
// address, and so are reset attempts. Staff whose school requires single sign-on get an email telling them to use
// it instead of a reset link, so the screen still reveals nothing. A successful reset uses the sign-up password
// rules, ends every other session of that person (User.sessionsValidFrom), writes an audit event in each of their
// schools and sends a confirmation email.
import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { createTranslator } from "next-intl";
import { identityDb, tenantDb, tenantTx, userScope } from "@/lib/tenant-db";
import { passwordIssues, type PasswordIssue } from "@/lib/signup";
import { resolveActiveMembership } from "@/server/identity/session-org";
import { clear, hit } from "@/server/access/rate-limit";
import { audit } from "@/server/audit/audit";
import { execCtx } from "@/server/db";
import { queueDirectEmail } from "@/server/notify/direct";
import { flushEffects } from "@/server/queue-core";
import { loadPolicy } from "./policy";
import { localSignInAllowed } from "./staff-sso";
import { randomToken } from "./seal";
import en from "../../../messages/en.json";
import ar from "../../../messages/ar.json";

export const RESET_TTL_MS = 45 * 60_000;
const PREFIX = "pwreset:";
const hash = (raw: string) => createHash("sha256").update(raw).digest("hex");
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

type T = (k: string, v?: Record<string, string | number>) => string;
const translator = (locale: "en" | "ar") => createTranslator({ locale, messages: locale === "ar" ? ar : en, namespace: "sso.reset.email" }) as unknown as T;

async function pad<V>(started: number, minMs: number, value: V): Promise<V> {
  const wait = minMs - (Date.now() - started);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  return value;
}

async function schoolOf(orgId: string) {
  return tenantDb(orgId).organization.findUnique({ where: { id: orgId }, select: { nameEn: true, nameAr: true, slug: true } });
}

async function sendMail(orgId: string, membershipId: string, to: string, locale: "en" | "ar", key: string, mail: { subject: string; body: string; href: string | null }, now: Date) {
  const effects = await tenantTx(orgId, async (tx) => {
    const ec = execCtx(tx, orgId, { now, actorId: membershipId });
    await queueDirectEmail(ec, { to, templateKey: "password_reset", subject: mail.subject, body: mail.body, href: mail.href, locale, idempotencyKey: key });
    return ec.effects;
  });
  await flushEffects(effects);
}

export type ResetRequest = { email: string; locale: "en" | "ar"; ip: string; now?: Date; minMs?: number };
export type ResetRequestResult = { sent: boolean; reason?: "INVALID" | "RATE_LIMITED" | "UNKNOWN" | "SSO_ONLY" };

/** Emails a reset link, or a "use single sign-on" note to staff who must. The caller shows one message for all. */
export async function requestPasswordReset(req: ResetRequest): Promise<ResetRequestResult> {
  const started = Date.now();
  const minMs = req.minMs ?? 600;
  const now = req.now ?? new Date();
  const email = req.email.trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 200) return pad(started, minMs, { sent: false, reason: "INVALID" });
  const [byEmail, byIp] = await Promise.all([hit(`pwreset:${email}`, 3, 60 * 60), hit(`pwreset-ip:${req.ip}`, 10, 15 * 60)]);
  if (!byEmail.ok || !byIp.ok) return pad(started, minMs, { sent: false, reason: "RATE_LIMITED" });

  const user = await identityDb.user.findUnique({ where: { email }, select: { id: true, lastActiveOrgId: true } });
  const membership = user ? await resolveActiveMembership(user.id, user.lastActiveOrgId, { includePending: true }) : null;
  // A school email needs a school to send from; people with no school membership cannot reset by email.
  if (!user || !membership) return pad(started, minMs, { sent: false, reason: "UNKNOWN" });
  const orgId = membership.orgId;
  const school = await schoolOf(orgId);
  const t = translator(req.locale);
  const name = (req.locale === "ar" ? school?.nameAr : school?.nameEn) || school?.nameEn || "";

  if (!(await localSignInAllowed(orgId, membership.id, await loadPolicy(orgId)))) {
    await sendMail(orgId, membership.id, email, req.locale, `pwreset-sso:${user.id}:${Math.floor(now.getTime() / RESET_TTL_MS)}`, { subject: t("ssoSubject", { school: name }), body: t("ssoBody", { school: name }), href: null }, now);
    await audit(tenantDb(orgId), orgId, { actorId: membership.id, actorUserId: user.id, action: "auth.password_reset_requested", entityType: "Membership", entityId: membership.id, meta: { outcome: "sso_required" } });
    return pad(started, minMs, { sent: true, reason: "SSO_ONLY" });
  }

  const raw = randomToken(32);
  const token = hash(raw);
  const identifier = `${PREFIX}${user.id}`;
  await identityDb.verificationToken.deleteMany({ where: { identifier } });
  await identityDb.verificationToken.create({ data: { identifier, token, expires: new Date(now.getTime() + RESET_TTL_MS) } });
  await sendMail(orgId, membership.id, email, req.locale, `pwreset:${user.id}:${token.slice(0, 24)}`, { subject: t("subject", { school: name }), body: t("body", { school: name, minutes: RESET_TTL_MS / 60_000 }), href: `/reset-password?token=${raw}` }, now);
  await audit(tenantDb(orgId), orgId, { actorId: membership.id, actorUserId: user.id, action: "auth.password_reset_requested", entityType: "Membership", entityId: membership.id, meta: { outcome: "link_sent" } });
  return pad(started, minMs, { sent: true });
}

async function findToken(raw: unknown) {
  if (typeof raw !== "string" || raw.length < 30 || raw.length > 100) return null;
  const token = hash(raw);
  const row = await identityDb.verificationToken.findFirst({ where: { token, identifier: { startsWith: PREFIX } } });
  return row ? { ...row, userId: row.identifier.slice(PREFIX.length) } : null;
}

/** Whether a reset link can still be used (for the page; does not use it up). */
export async function resetLinkValid(raw: unknown, now = new Date()): Promise<boolean> {
  const row = await findToken(raw);
  return !!row && row.expires.getTime() >= now.getTime();
}

export type ResetResult = { ok: true } | { ok: false; code: "INVALID" | "WEAK" | "RATE_LIMITED" | "SSO_ONLY"; issues?: PasswordIssue[] };

export async function resetPassword(input: { token: unknown; password: string; ip: string; locale: "en" | "ar"; now?: Date }): Promise<ResetResult> {
  const now = input.now ?? new Date();
  if (!(await hit(`pwreset-use-ip:${input.ip}`, 20, 15 * 60)).ok) return { ok: false, code: "RATE_LIMITED" };
  const row = await findToken(input.token);
  if (!row || row.expires.getTime() < now.getTime()) return { ok: false, code: "INVALID" };
  const user = await identityDb.user.findUnique({ where: { id: row.userId }, select: { id: true, email: true, lastActiveOrgId: true } });
  if (!user) return { ok: false, code: "INVALID" };
  // A weak password does not use up the link, so the person can try again.
  const issues = passwordIssues(input.password, user.email);
  if (issues.length) return { ok: false, code: "WEAK", issues };
  const gone = await identityDb.verificationToken.deleteMany({ where: { identifier: row.identifier, token: row.token } });
  if (gone.count !== 1) return { ok: false, code: "INVALID" };
  const membership = await resolveActiveMembership(user.id, user.lastActiveOrgId, { includePending: true });
  if (membership && !(await localSignInAllowed(membership.orgId, membership.id, await loadPolicy(membership.orgId)))) return { ok: false, code: "SSO_ONLY" };

  await identityDb.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(input.password, 12), sessionsValidFrom: now } });
  await identityDb.user.updateMany({ where: { id: user.id, emailVerified: null }, data: { emailVerified: now } });
  // Every other way in that was waiting is cancelled too: other reset links, email sign-in links, sign-on tickets.
  await identityDb.verificationToken.deleteMany({ where: { OR: [{ identifier: { startsWith: `${PREFIX}${user.id}` } }, { identifier: { startsWith: `magic:${user.id}:` } }, { identifier: { startsWith: `sso-ticket:${user.id}:` } }] } });
  await clear(`signin:${user.email}`);

  const memberships = await userScope(user.id, (tx) => tx.membership.findMany({ where: { userId: user.id }, select: { id: true, orgId: true } }));
  for (const m of memberships) {
    await audit(tenantDb(m.orgId), m.orgId, { actorId: m.id, actorUserId: user.id, action: "auth.password_reset", entityType: "Membership", entityId: m.id, meta: { sessionsEnded: true } });
  }
  if (membership) {
    const school = await schoolOf(membership.orgId);
    const t = translator(input.locale);
    const name = (input.locale === "ar" ? school?.nameAr : school?.nameEn) || school?.nameEn || "";
    await sendMail(membership.orgId, membership.id, user.email, input.locale, `pwreset-done:${user.id}:${now.getTime()}`, { subject: t("doneSubject", { school: name }), body: t("doneBody", { school: name }), href: "/home" }, now);
  }
  return { ok: true };
}

export { sessionRevoked } from "./session-revocation";
