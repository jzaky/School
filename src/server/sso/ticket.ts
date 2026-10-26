// One-time sign-in tickets. After a single sign-on is verified and linked (src/server/sso/link.ts), the callback
// route issues a ticket that the Auth.js "sso" credentials provider redeems once to open a fresh session.
// Only the SHA-256 hash is stored (VerificationToken), tickets live two minutes, and redeeming deletes the row
// in the same statement that finds it, so a ticket can never be used twice.
import { createHash } from "node:crypto";
import { identityDb } from "@/lib/tenant-db";
import { randomToken } from "./seal";

const PREFIX = "sso-ticket:";
const TTL_MS = 2 * 60_000;
const hash = (raw: string) => createHash("sha256").update(raw).digest("hex");

export type Ticket = { userId: string; orgId: string; membershipId: string; method: string };

const ID = /^[a-z0-9]{10,40}$/i;
const METHOD = /^[a-z_]{3,20}$/;

export async function issueTicket(t: Ticket, now = new Date()): Promise<string> {
  if (!ID.test(t.userId) || !ID.test(t.orgId) || !ID.test(t.membershipId) || !METHOD.test(t.method)) throw new Error("invalid ticket");
  const raw = randomToken(32);
  await identityDb.verificationToken.create({ data: { identifier: `${PREFIX}${t.userId}:${t.orgId}:${t.membershipId}:${t.method}`, token: hash(raw), expires: new Date(now.getTime() + TTL_MS) } });
  return raw;
}

export async function redeemTicket(raw: unknown, now = new Date()): Promise<Ticket | null> {
  if (typeof raw !== "string" || raw.length < 30 || raw.length > 100) return null;
  const token = hash(raw);
  const row = await identityDb.verificationToken.findFirst({ where: { token, identifier: { startsWith: PREFIX } } });
  if (!row) return null;
  const gone = await identityDb.verificationToken.deleteMany({ where: { identifier: row.identifier, token } });
  if (gone.count !== 1 || row.expires.getTime() < now.getTime()) return null;
  const [userId, orgId, membershipId, method] = row.identifier.slice(PREFIX.length).split(":");
  if (!userId || !orgId || !membershipId || !method) return null;
  return { userId, orgId, membershipId, method };
}

/** Removes expired tickets and magic links (called by the worker sweeper). */
export async function sweepExpiredTokens(now = new Date()) {
  const res = await identityDb.verificationToken.deleteMany({ where: { expires: { lt: now }, OR: [{ identifier: { startsWith: PREFIX } }, { identifier: { startsWith: "magic:" } }] } });
  return res.count;
}
