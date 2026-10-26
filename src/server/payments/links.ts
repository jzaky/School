// Online payment links and webhook processing. No "server-only" marker: tests import it directly.
// Webhook design: (1) the provider adapter checks the signature over the raw body before anything is read;
// (2) the event id is claimed in PaymentEvent (unique per school, provider and event), so a repeated delivery does
// nothing; (3) the payment itself uses the idempotency key "link:<link id>", so two different events for the same
// link still record one payment; (4) the amount and currency must match the link exactly.
import { tenantTx } from "@/lib/tenant-db";
import { execCtx, type Effect, type Tx } from "@/server/db";
import { flushEffects } from "@/server/queue-core";
import { loadFinanceConfig } from "@/server/fees/config";
import { balanceOf, convertProforma, earlyPaymentOffer, FeeError, recordPayment, type Actor } from "@/server/fees/ledger";
import { notifyReceipt } from "@/server/fees/notices";
import { onlinePaymentAvailable, providerForWebhook } from "./providers";
import type { OnlineProvider } from "./types";

const LINK_TTL_MS = 24 * 3_600_000;
const SYSTEM: Actor = { membershipId: null, userId: null };

/** Amount to ask for online: the balance, less the early payment discount while it is on offer. */
export async function payableNow(tx: Tx, orgId: string, invoiceId: string, now: Date) {
  const inv = await tx.invoice.findFirst({ where: { id: invoiceId, orgId } });
  if (!inv) throw new FeeError("NOT_FOUND");
  if (inv.kind === "PROFORMA") return inv.status === "OPEN" ? { invoice: inv, amountFils: inv.totalFils, early: null } : null;
  if (inv.status !== "OPEN" && inv.status !== "PARTIAL") return null;
  const early = await earlyPaymentOffer(tx, orgId, inv.id, now);
  const amountFils = early ? early.payNowFils : balanceOf(inv);
  return amountFils > 0 ? { invoice: inv, amountFils, early } : null;
}

/**
 * Create (or reuse) a payment link for an invoice and return the provider's page. The link row is written first and
 * cancelled again if the provider call fails, so nothing is left half made.
 */
export async function createPaymentLink(
  orgId: string,
  input: { invoiceId: string; locale: "en" | "ar"; baseUrl: string; createdById: string | null },
  now = new Date(),
  providerIn?: OnlineProvider | null,
): Promise<{ ok: true; url: string; test: boolean } | { ok: false; error: string }> {
  const cfgOn = await tenantTx(orgId, (tx) => loadFinanceConfig(tx, orgId));
  const { available, provider: configured } = onlinePaymentAvailable(cfgOn.onlinePayments);
  const provider = providerIn ?? configured;
  if (!provider || (!providerIn && !available)) return { ok: false, error: "ONLINE_NOT_SET_UP" };
  const prepared = await tenantTx(orgId, async (tx) => {
    const due = await payableNow(tx, orgId, input.invoiceId, now);
    if (!due) return null;
    const reuse = await tx.paymentLink.findFirst({
      where: { orgId, invoiceId: due.invoice.id, status: "OPEN", amountFils: due.amountFils, provider: provider.key, expiresAt: { gt: new Date(now.getTime() + 30 * 60_000) }, url: { not: null } },
      orderBy: { createdAt: "desc" },
    });
    if (reuse) return { link: reuse, invoice: due.invoice, reused: true };
    const link = await tx.paymentLink.create({
      data: { orgId, accountId: due.invoice.accountId, invoiceId: due.invoice.id, amountFils: due.amountFils, provider: provider.key, expiresAt: new Date(now.getTime() + LINK_TTL_MS), createdById: input.createdById, createdAt: now },
    });
    await tx.auditEvent.create({ data: { orgId, actorId: input.createdById, action: "fees.payment_link.create", entityType: "PaymentLink", entityId: link.id, meta: { invoice: due.invoice.number, amountFils: due.amountFils, provider: provider.key } } });
    return { link, invoice: due.invoice, reused: false };
  });
  if (!prepared) return { ok: false, error: "NOTHING_TO_PAY" };
  if (prepared.reused && prepared.link.url) return { ok: true, url: prepared.link.url, test: provider.test };
  const base = input.baseUrl.replace(/\/$/, "");
  try {
    const res = await provider.createLink({
      orgId,
      linkId: prepared.link.id,
      amountFils: prepared.link.amountFils,
      currency: "AED",
      description: `${prepared.invoice.number}`,
      customerEmail: prepared.invoice.billToEmail,
      returnUrl: `${base}/${input.locale}/fees?paid=${prepared.link.id}`,
      cancelUrl: `${base}/${input.locale}/fees?cancelled=${prepared.link.id}`,
      testCheckoutPath: `/${input.locale}/fees/pay/${prepared.link.id}`,
    });
    await tenantTx(orgId, (tx) => tx.paymentLink.update({ where: { id: prepared.link.id }, data: { url: res.url, externalId: res.externalId } }));
    return { ok: true, url: res.url, test: provider.test };
  } catch {
    await tenantTx(orgId, (tx) => tx.paymentLink.update({ where: { id: prepared.link.id }, data: { status: "CANCELLED" } }));
    return { ok: false, error: "PROVIDER_ERROR" };
  }
}

export type WebhookResult = { status: number; body: { ok: boolean; result: string } };

/** Handle one webhook delivery (also used by the test checkout, through the same signature check). */
export async function handlePaymentWebhook(providerKey: string, rawBody: string, headers: Headers, now = new Date(), opts: { provider?: OnlineProvider; flush?: (e: Effect[]) => Promise<void> } = {}): Promise<WebhookResult> {
  const provider = opts.provider ?? providerForWebhook(providerKey);
  if (!provider) return { status: 404, body: { ok: false, result: "unknown_provider" } };
  let event;
  try {
    event = await provider.verifyWebhook(rawBody, headers, now);
  } catch {
    event = null;
  }
  if (!event) return { status: 400, body: { ok: false, result: "bad_signature" } };
  if (!event.orgId || !event.linkId || !/^[a-z0-9]{10,40}$/i.test(event.orgId)) return { status: 200, body: { ok: true, result: "ignored" } };
  const orgId = event.orgId;
  const effects: Effect[] = [];
  const result = await tenantTx(
    orgId,
    async (tx) => {
      const claim = await tx.paymentEvent.createMany({ data: [{ orgId, provider: provider.key, eventId: event.eventId, type: event.type.slice(0, 80), linkId: event.linkId, outcome: "received" }], skipDuplicates: true });
      if (claim.count !== 1) return "duplicate";
      const link = await tx.paymentLink.findFirst({ where: { id: event.linkId!, orgId } });
      if (!link || link.provider !== provider.key) return "unknown_link";
      if (event.outcome !== "paid") return event.outcome === "failed" ? "failed" : "ignored";
      if (event.amountFils !== link.amountFils || (event.currency ?? "").toUpperCase() !== link.currency) return "amount_mismatch";
      if (link.status === "PAID") return "already_paid";
      let invoiceId = link.invoiceId;
      const inv = invoiceId ? await tx.invoice.findFirst({ where: { id: invoiceId, orgId } }) : null;
      // A paid proforma (for example a seat booking) becomes a tax invoice first.
      if (inv && inv.kind === "PROFORMA") invoiceId = (await convertProforma(tx, orgId, inv.id, SYSTEM, now)).id;
      const ec = execCtx(tx, orgId, { effects, now });
      const res = await recordPayment(
        tx,
        orgId,
        {
          accountId: link.accountId,
          method: "ONLINE",
          amountFils: link.amountFils,
          receivedAt: now,
          provider: provider.key,
          externalId: event.externalId,
          reference: event.externalId,
          idempotencyKey: `link:${link.id}`,
          invoiceIds: invoiceId ? [invoiceId] : [],
          earlyDiscountInvoiceId: inv && inv.kind === "TAX" ? inv.id : null,
          earlyAt: link.createdAt,
        },
        SYSTEM,
      );
      await tx.paymentLink.update({ where: { id: link.id }, data: { status: "PAID", paidAt: now, paymentId: res.payment.id } });
      if (!res.duplicate) await notifyReceipt(ec, res.payment);
      return res.duplicate ? "already_paid" : "paid";
    },
    { timeout: 60_000 },
  );
  await tenantTx(orgId, (tx) => tx.paymentEvent.updateMany({ where: { orgId, provider: provider.key, eventId: event.eventId }, data: { outcome: result } })).catch(() => undefined);
  await (opts.flush ?? flushEffects)(effects);
  return { status: 200, body: { ok: true, result } };
}
