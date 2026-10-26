// Online payment providers, chosen by PAYMENTS_PROVIDER. Only providers whose calls are fully implemented from the
// provider's public documentation report ready = true; the others stay off and the app says "Online payment is
// not set up". See docs/decisions.md (Fees and invoicing) for what each adapter does and what is still to do.
import { createHmac, randomUUID } from "node:crypto";
import { signPayload, verifySignatureHeader } from "./signature";
import type { CreateLinkInput, CreateLinkResult, OnlineProvider, OnlineProviderKey, VerifiedEvent } from "./types";

const env = (k: string) => process.env[k]?.trim() || "";

// ---------------------------------------------------------------------------------------------
// console: the built-in test checkout. No money moves; the page is labelled as a test everywhere.
// ---------------------------------------------------------------------------------------------

export function consoleSecret(): string {
  const own = env("PAYMENTS_TEST_SECRET");
  if (own) return own;
  const auth = env("AUTH_SECRET") || env("NEXTAUTH_SECRET");
  return auth ? createHmac("sha256", auth).update("horizon-payments-test-checkout").digest("hex") : "";
}

export type ConsoleEvent = { id: string; type: "payment.succeeded" | "payment.failed"; orgId: string; linkId: string; amountFils: number; currency: string };

/** Signed body and header for a test checkout result (sent through the same webhook handler as real providers). */
export function consoleSignedEvent(e: Omit<ConsoleEvent, "id"> & { id?: string }, now: Date) {
  const body = JSON.stringify({ id: e.id ?? `evt_test_${randomUUID()}`, type: e.type, orgId: e.orgId, linkId: e.linkId, amountFils: e.amountFils, currency: e.currency });
  return { body, signature: signPayload(consoleSecret(), body, Math.floor(now.getTime() / 1000)) };
}

const consoleProvider = (): OnlineProvider => {
  const secret = consoleSecret();
  return {
    key: "console",
    ready: Boolean(secret),
    missing: secret ? [] : ["PAYMENTS_TEST_SECRET"],
    test: true,
    async createLink(input: CreateLinkInput): Promise<CreateLinkResult> {
      return { url: input.testCheckoutPath, externalId: `test_${input.linkId}` };
    },
    async verifyWebhook(rawBody: string, headers: Headers, now: Date): Promise<VerifiedEvent | null> {
      if (!verifySignatureHeader(secret, rawBody, headers.get("x-horizon-signature"), now)) return null;
      const e = JSON.parse(rawBody) as ConsoleEvent;
      return {
        eventId: String(e.id),
        type: e.type,
        outcome: e.type === "payment.succeeded" ? "paid" : "failed",
        orgId: e.orgId ?? null,
        linkId: e.linkId ?? null,
        amountFils: Number.isSafeInteger(e.amountFils) ? e.amountFils : null,
        currency: e.currency ?? null,
        externalId: `test_${e.linkId}`,
      };
    },
  };
};

// ---------------------------------------------------------------------------------------------
// Stripe Checkout (https://docs.stripe.com/api/checkout/sessions/create and https://docs.stripe.com/webhooks).
// Requires STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET (the endpoint's whsec_ secret). The webhook endpoint is
// /api/payments/webhook/stripe, subscribed to checkout.session.completed.
// ---------------------------------------------------------------------------------------------

const stripeProvider = (): OnlineProvider => {
  const key = env("STRIPE_SECRET_KEY");
  const whsec = env("STRIPE_WEBHOOK_SECRET");
  const missing = [...(key ? [] : ["STRIPE_SECRET_KEY"]), ...(whsec ? [] : ["STRIPE_WEBHOOK_SECRET"])];
  return {
    key: "stripe",
    ready: missing.length === 0,
    missing,
    test: key.startsWith("sk_test_"),
    async createLink(input: CreateLinkInput): Promise<CreateLinkResult> {
      const form = new URLSearchParams();
      form.set("mode", "payment");
      form.set("success_url", input.returnUrl);
      form.set("cancel_url", input.cancelUrl);
      form.set("client_reference_id", input.linkId);
      form.set("line_items[0][quantity]", "1");
      form.set("line_items[0][price_data][currency]", input.currency.toLowerCase());
      form.set("line_items[0][price_data][unit_amount]", String(input.amountFils));
      form.set("line_items[0][price_data][product_data][name]", input.description.slice(0, 120));
      form.set("metadata[orgId]", input.orgId);
      form.set("metadata[linkId]", input.linkId);
      if (input.customerEmail) form.set("customer_email", input.customerEmail);
      const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": `link-${input.linkId}` },
        body: form.toString(),
      });
      if (!res.ok) throw new Error(`stripe_${res.status}`);
      const json = (await res.json()) as { id?: string; url?: string };
      if (!json.url || !json.id) throw new Error("stripe_no_url");
      return { url: json.url, externalId: json.id };
    },
    async verifyWebhook(rawBody: string, headers: Headers, now: Date): Promise<VerifiedEvent | null> {
      if (!verifySignatureHeader(whsec, rawBody, headers.get("stripe-signature"), now)) return null;
      const e = JSON.parse(rawBody) as { id: string; type: string; data?: { object?: { id?: string; client_reference_id?: string; amount_total?: number; currency?: string; payment_status?: string; metadata?: Record<string, string> } } };
      const o = e.data?.object ?? {};
      const paid = e.type === "checkout.session.completed" && o.payment_status === "paid";
      return {
        eventId: e.id,
        type: e.type,
        outcome: paid ? "paid" : "ignored",
        orgId: o.metadata?.orgId ?? null,
        linkId: o.metadata?.linkId ?? o.client_reference_id ?? null,
        amountFils: typeof o.amount_total === "number" ? o.amount_total : null,
        currency: o.currency ? o.currency.toUpperCase() : null,
        externalId: o.id ?? null,
      };
    },
  };
};

// ---------------------------------------------------------------------------------------------
// Network International N-Genius Online (https://docs.ngenius-payments.com).
// Implemented from the public docs: access token (POST {base}/identity/auth/access-token, Basic API key,
// application/vnd.ni-identity.v1+json) and order creation (POST {base}/transactions/outlets/{outlet}/orders,
// application/vnd.ni-payment.v2+json, action PURCHASE, amount in minor units, hosted page at _links.payment.href).
// TODO: payment confirmation. The public pages we could verify do not document the order status call or a webhook
// signature, so the adapter is not ready and online payment stays off with N-Genius until both are implemented
// against the merchant's documentation.
// ---------------------------------------------------------------------------------------------

const ngeniusProvider = (): OnlineProvider => {
  const apiKey = env("NGENIUS_API_KEY");
  const outlet = env("NGENIUS_OUTLET_REF");
  const base = env("NGENIUS_API_BASE") || "https://api-gateway.sandbox.ngenius-payments.com";
  const missing = [...(apiKey ? [] : ["NGENIUS_API_KEY"]), ...(outlet ? [] : ["NGENIUS_OUTLET_REF"]), "TODO: payment confirmation (order status and webhook verification)"];
  return {
    key: "ngenius",
    ready: false,
    missing,
    test: base.includes("sandbox"),
    async createLink(input: CreateLinkInput): Promise<CreateLinkResult> {
      const tokenRes = await fetch(`${base}/identity/auth/access-token`, { method: "POST", headers: { Authorization: `Basic ${apiKey}`, "Content-Type": "application/vnd.ni-identity.v1+json" } });
      if (!tokenRes.ok) throw new Error(`ngenius_token_${tokenRes.status}`);
      const { access_token } = (await tokenRes.json()) as { access_token?: string };
      if (!access_token) throw new Error("ngenius_no_token");
      const res = await fetch(`${base}/transactions/outlets/${encodeURIComponent(outlet)}/orders`, {
        method: "POST",
        headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/vnd.ni-payment.v2+json", Accept: "application/vnd.ni-payment.v2+json" },
        body: JSON.stringify({ action: "PURCHASE", amount: { currencyCode: input.currency, value: input.amountFils }, emailAddress: input.customerEmail ?? undefined, merchantAttributes: { redirectUrl: input.returnUrl, cancelUrl: input.cancelUrl } }),
      });
      if (!res.ok) throw new Error(`ngenius_order_${res.status}`);
      const json = (await res.json()) as { reference?: string; _links?: { payment?: { href?: string } } };
      if (!json._links?.payment?.href) throw new Error("ngenius_no_url");
      return { url: json._links.payment.href, externalId: json.reference ?? null };
    },
    async verifyWebhook(): Promise<VerifiedEvent | null> {
      // TODO: verify per the merchant's N-Genius webhook configuration, then re-read the order status server side.
      return null;
    },
  };
};

// ---------------------------------------------------------------------------------------------
// Telr hosted payment page (https://telr-api.readme.io/reference/payment-page).
// Implemented from the public docs: POST https://secure.telr.com/gateway/order.json with method "create", store,
// authkey, order { cartid, test, amount (major units, "9.50"), currency, description }, return URLs; the page is
// order.url and the reference order.ref.
// TODO: payment confirmation. The public status page ("check") does not list the paid status codes, and the
// transaction advice signature is not documented there, so the adapter is not ready until both are confirmed.
// ---------------------------------------------------------------------------------------------

const telrProvider = (): OnlineProvider => {
  const store = env("TELR_STORE_ID");
  const authkey = env("TELR_AUTH_KEY");
  const testMode = env("TELR_TEST_MODE") !== "0";
  const missing = [...(store ? [] : ["TELR_STORE_ID"]), ...(authkey ? [] : ["TELR_AUTH_KEY"]), "TODO: payment confirmation (status codes and transaction advice signature)"];
  return {
    key: "telr",
    ready: false,
    missing,
    test: testMode,
    async createLink(input: CreateLinkInput): Promise<CreateLinkResult> {
      const amount = `${Math.floor(input.amountFils / 100)}.${String(input.amountFils % 100).padStart(2, "0")}`;
      const res = await fetch("https://secure.telr.com/gateway/order.json", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method: "create",
          store: Number(store),
          authkey,
          framed: 0,
          order: { cartid: input.linkId.slice(0, 63), test: testMode ? "1" : "0", amount, currency: input.currency, description: input.description.slice(0, 63) },
          return: { authorised: input.returnUrl, declined: input.cancelUrl, cancelled: input.cancelUrl },
        }),
      });
      if (!res.ok) throw new Error(`telr_${res.status}`);
      const json = (await res.json()) as { order?: { ref?: string; url?: string }; error?: { message?: string } };
      if (!json.order?.url) throw new Error("telr_no_url");
      return { url: json.order.url, externalId: json.order.ref ?? null };
    },
    async verifyWebhook(): Promise<VerifiedEvent | null> {
      // TODO: confirm through the "check" call with the order reference once the paid status codes are confirmed.
      return null;
    },
  };
};

const FACTORIES: Record<OnlineProviderKey, () => OnlineProvider> = { console: consoleProvider, stripe: stripeProvider, ngenius: ngeniusProvider, telr: telrProvider };

export function isProviderKey(k: string): k is OnlineProviderKey {
  return k in FACTORIES;
}

/** The provider named by PAYMENTS_PROVIDER, or null when none is configured. */
export function configuredProvider(): OnlineProvider | null {
  const key = env("PAYMENTS_PROVIDER").toLowerCase();
  return isProviderKey(key) ? FACTORIES[key]() : null;
}

/** The adapter for a webhook path, only when it is the configured provider. */
export function providerForWebhook(key: string): OnlineProvider | null {
  const p = configuredProvider();
  return p && p.key === key ? p : null;
}

/** Online payment is offered to families only when the platform provider is ready and the school switched it on. */
export function onlinePaymentAvailable(schoolEnabled: boolean): { available: boolean; provider: OnlineProvider | null } {
  const provider = configuredProvider();
  return { available: Boolean(provider?.ready && schoolEnabled), provider };
}
