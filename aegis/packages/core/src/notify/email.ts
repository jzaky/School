import { trimTrailing } from "../lib/crypto.js";
import type { TenantDb } from "@aegis/db";
import { env } from "../env.js";
import { logger } from "../lib/logger.js";

/**
 * Email copies of the notifications someone has to act on: approval requests, escalations and
 * reassignments, quarantined actions, raised alerts and new incidents. The in-app notification stays the
 * record; the email only tells the person to open the console. Nothing in an email can approve, reject or
 * release anything.
 *
 * Off unless AEGIS_EMAIL_NOTIFICATIONS=true. With RESEND_API_KEY set, mail goes through Resend; without it,
 * the console provider logs that a message would have been sent (type and notification id, never the
 * address or the content).
 *
 * Exactly once: each notification is sent with its id as the provider's idempotency key, and marked
 * emailed once the provider accepts it. A retry after a crash between the two reuses the key, which
 * the provider deduplicates. Temporary failures (429, 5xx, network) are retried on the next run, up
 * to five attempts. Definitive refusals (other 4xx) stop at once. Notifications older than a day
 * are not mailed.
 */
export const EMAIL_NOTIFICATION_TYPES = ["approval.requested", "approval.escalated", "approval.reassigned", "gateway.quarantined", "alert.raised", "incident.created"] as const;
export const EMAIL_MAX_ATTEMPTS = 5;
const MAX_AGE_MS = 24 * 3600_000;

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  idempotencyKey: string;
}

export type EmailSendResult = { ok: true; id: string | null } | { ok: false; retry: boolean; error: string };

export interface EmailProvider {
  readonly name: "console" | "resend";
  send(msg: EmailMessage): Promise<EmailSendResult>;
}

export const consoleEmailProvider: EmailProvider = {
  name: "console",
  async send(msg) {
    logger.info({ idempotencyKey: msg.idempotencyKey, domain: msg.to.split("@")[1] ?? null }, "email (console provider): not sent, no RESEND_API_KEY");
    return { ok: true, id: null };
  },
};

/** Resend's REST API (POST /emails) with its Idempotency-Key header. */
export function resendEmailProvider(apiKey: string, opts: { baseUrl?: string; from?: string; fetchImpl?: typeof fetch } = {}): EmailProvider {
  const base = trimTrailing(opts.baseUrl ?? env().RESEND_API_BASE, "/");
  const f = opts.fetchImpl ?? fetch;
  return {
    name: "resend",
    async send(msg) {
      let res: Response;
      try {
        res = await f(`${base}/emails`, {
          method: "POST",
          headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "idempotency-key": msg.idempotencyKey },
          body: JSON.stringify({ from: opts.from ?? env().EMAIL_FROM, to: [msg.to], subject: msg.subject, text: msg.text }),
          signal: AbortSignal.timeout(10_000),
        });
      } catch (e) {
        return { ok: false, retry: true, error: `Resend unreachable: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300) };
      }
      const body = await res.text().catch(() => "");
      if (res.ok) {
        let id: string | null = null;
        try {
          id = (JSON.parse(body) as { id?: string }).id ?? null;
        } catch {
          id = null;
        }
        return { ok: true, id };
      }
      let message = `HTTP ${res.status}`;
      try {
        const m = (JSON.parse(body) as { message?: string }).message;
        if (m) message = `HTTP ${res.status}: ${m}`;
      } catch {
        // keep the status only
      }
      return { ok: false, retry: res.status === 429 || res.status >= 500, error: message.slice(0, 300) };
    },
  };
}

let override: EmailProvider | null | undefined;
/** Tests replace the provider; null restores the configured one. */
export function setEmailProvider(p: EmailProvider | null) {
  override = p ?? undefined;
}

/** The configured provider, or null when email notifications are off. */
export function emailProvider(): EmailProvider | null {
  if (override) return override;
  const e = env();
  if (!e.AEGIS_EMAIL_NOTIFICATIONS) return null;
  return e.RESEND_API_KEY ? resendEmailProvider(e.RESEND_API_KEY) : consoleEmailProvider;
}

type Runner = <T>(fn: (db: TenantDb) => Promise<T>) => Promise<T>;

function compose(n: { title: string; body: string; link: string | null }, orgName: string): { subject: string; text: string } {
  const base = env().WEB_PUBLIC_URL.replace(/\/+$/, "");
  const link = n.link ? (n.link.startsWith("http") ? n.link : `${base}${n.link.startsWith("/") ? "" : "/"}${n.link}`) : base;
  const lines = [n.title, "", ...(n.body ? [n.body, ""] : []), `Open in AEGIS: ${link}`, "", `Sent by AEGIS for ${orgName}. Act in the console; nothing in this email approves, rejects or releases anything.`];
  return { subject: `[AEGIS] ${n.title}`.slice(0, 200), text: lines.join("\n") };
}

/** Sends the pending email copies for one organization. Returns counts. */
export async function deliverNotificationEmails(run: Runner, orgId: string, opts: { now?: Date; batch?: number; provider?: EmailProvider | null } = {}) {
  const provider = opts.provider === undefined ? emailProvider() : opts.provider;
  const out = { sent: 0, failed: 0, retrying: 0 };
  if (!provider) return out;
  const now = opts.now ?? new Date();
  const pending = await run(async (db) => {
    const rows = await db.notification.findMany({
      where: { orgId, emailedAt: null, emailAttempts: { lt: EMAIL_MAX_ATTEMPTS }, type: { in: [...EMAIL_NOTIFICATION_TYPES] }, createdAt: { gte: new Date(now.getTime() - MAX_AGE_MS) } },
      orderBy: { createdAt: "asc" },
      take: opts.batch ?? 50,
      select: { id: true, userId: true, title: true, body: true, link: true },
    });
    if (!rows.length) return [];
    const [users, org] = await Promise.all([
      db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId))] }, status: "active" }, select: { id: true, email: true } }),
      db.organization.findUnique({ where: { id: orgId }, select: { name: true } }),
    ]);
    const email = new Map(users.map((u) => [u.id, u.email]));
    return rows.map((r) => ({ ...r, to: email.get(r.userId) ?? null, orgName: org?.name ?? "your organization" }));
  });
  for (const n of pending) {
    if (!n.to) {
      // Inactive or removed user: never mail, and stop trying.
      await run((db) => db.notification.update({ where: { id: n.id }, data: { emailAttempts: EMAIL_MAX_ATTEMPTS, emailError: "The user is not active" } }));
      out.failed++;
      continue;
    }
    const { subject, text } = compose(n, n.orgName);
    const r = await provider.send({ to: n.to, subject, text, idempotencyKey: `aegis-notification-${n.id}` });
    if (r.ok) {
      await run((db) => db.notification.update({ where: { id: n.id }, data: { emailedAt: now, emailError: null, emailAttempts: { increment: 1 } } }));
      out.sent++;
    } else {
      await run((db) => db.notification.update({ where: { id: n.id }, data: { emailAttempts: r.retry ? { increment: 1 } : EMAIL_MAX_ATTEMPTS, emailError: r.error } }));
      if (r.retry) out.retrying++;
      else out.failed++;
    }
  }
  return out;
}
