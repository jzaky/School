// Payment provider abstraction. "manual" is money recorded by finance staff (cash, cheque, bank transfer, card
// terminal); the online providers create a hosted payment page and confirm payment through a signed webhook.

export type OnlineProviderKey = "console" | "stripe" | "ngenius" | "telr";

export type CreateLinkInput = {
  orgId: string;
  linkId: string;
  amountFils: number;
  currency: "AED";
  /** Short description shown on the payment page (no personal data beyond the document number). */
  description: string;
  customerEmail: string | null;
  returnUrl: string;
  cancelUrl: string;
  /** Path of the built-in test checkout (console provider only). */
  testCheckoutPath: string;
};

export type CreateLinkResult = { url: string; externalId: string | null };

/** A webhook event whose signature checked out. */
export type VerifiedEvent = {
  eventId: string;
  outcome: "paid" | "failed" | "ignored";
  orgId: string | null;
  linkId: string | null;
  amountFils: number | null;
  currency: string | null;
  externalId: string | null;
  type: string;
};

export interface OnlineProvider {
  key: OnlineProviderKey;
  /** Every call is implemented and the configuration is present. Online payment is offered only when true. */
  ready: boolean;
  /** Missing environment variables, or why the adapter cannot be used yet. */
  missing: string[];
  /** A test provider: no money moves. */
  test: boolean;
  createLink(input: CreateLinkInput): Promise<CreateLinkResult>;
  /** Check the signature and read the event. Returns null when the signature is missing or wrong. */
  verifyWebhook(rawBody: string, headers: Headers, now: Date): Promise<VerifiedEvent | null>;
}
