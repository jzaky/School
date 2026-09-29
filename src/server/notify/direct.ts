// Email to an address that is not (yet) an active member: invitations, join decisions.
// Same pipeline as notify(): an OutboundMessage row keyed by an idempotency key, delivered after commit by
// the worker (Resend when configured, console provider otherwise). The address is never logged.
import type { ExecCtx } from "@/server/db";

export type DirectEmail = {
  to: string;
  templateKey: string;
  subject: string;
  body: string;
  /** App path without locale, for the link at the end of the email (for example /join/abc). */
  href?: string | null;
  locale: "en" | "ar";
  idempotencyKey: string;
};

export async function queueDirectEmail(ec: ExecCtx, msg: DirectEmail): Promise<boolean> {
  const { tx, orgId } = ec;
  const existing = await tx.outboundMessage.findUnique({ where: { orgId_idempotencyKey: { orgId, idempotencyKey: msg.idempotencyKey } } });
  if (existing) return false;
  const row = await tx.outboundMessage.create({
    data: {
      orgId,
      channel: "EMAIL",
      to: msg.to,
      templateKey: msg.templateKey,
      subject: msg.subject.slice(0, 300),
      idempotencyKey: msg.idempotencyKey,
      status: ec.quiet ? "DELIVERED" : "QUEUED",
      sentAt: ec.quiet ? ec.now : null,
      createdAt: ec.now,
    },
  });
  if (!ec.quiet) {
    ec.effects.push({
      kind: "job",
      queue: "notify",
      name: "deliver",
      data: { orgId, outboundId: row.id, locale: msg.locale, body: msg.body, href: msg.href ?? null },
      jobId: `deliver:${orgId}:${row.id}`,
    });
  }
  return true;
}
