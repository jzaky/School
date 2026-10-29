import { voidGrantsForRequest } from "../gateway/grants.js";
import type { PaymentDocument, Prisma, TenantDb } from "@aegis/db";
import { z } from "zod";
import { appendEvidence } from "../evidence/ledger.js";
import type { OrgContext } from "../lib/context.js";
import { AegisError, conflict, forbidden, notFound } from "../lib/errors.js";
import { assertPermission } from "../orgs/orgs.js";

/**
 * Payment document matching (docs/PAYMENT_MATCHING.md). Auditors ask: are receipts and invoices matched
 * against payment records? For a payment tool with matching on, AEGIS lets an agent pay only against a
 * document (invoice, receipt or purchase order) that the system of record registered: same vendor, same
 * currency, the same amount within a tolerance, not voided, and not already claimed by another payment.
 * The agent cannot register documents, so it cannot create the record it pays against.
 *
 * What this catches: payments with no matching record, amounts or payees that differ from the record, and
 * paying the same document twice. What it does not do: judge whether an uploaded receipt image is genuine
 * or AI-generated. That stays with the system of record and the people who approve what it registers.
 *
 * Whether a document is paid is read from the request that claimed it, so nothing else needs updating:
 * a claim by a request that was refused, rejected, expired or failed is released automatically.
 */
export const documentMatchSchema = z.object({
  documentParam: z.string().min(1).max(60).default("invoiceRef"),
  vendorParam: z.string().min(1).max(60).default("vendorRef"),
  amountParam: z.string().min(1).max(60).default("amount"),
  currencyParam: z.string().min(1).max(60).default("currency"),
  kinds: z.array(z.enum(["invoice", "receipt", "purchase_order"])).min(1).default(["invoice"]),
  /** Absolute difference allowed between the payment and the document amount. */
  amountTolerance: z.number().min(0).max(1_000_000).default(0),
  /** deny: refused at the door. require_approval: held for a person to check. */
  effect: z.enum(["deny", "require_approval"]).default("deny"),
});
export type DocumentMatch = z.infer<typeof documentMatchSchema>;

export function readDocumentMatch(destinationRules: unknown): DocumentMatch | null {
  const v = (destinationRules as { documentMatch?: unknown } | null)?.documentMatch;
  if (!v) return null;
  const parsed = documentMatchSchema.safeParse(v);
  // A malformed setting fails closed: matching with defaults, refusing on mismatch.
  return parsed.success ? parsed.data : documentMatchSchema.parse({});
}

/** Request statuses that end without the payment happening: their claim on a document is released. */
const ENDED_WITHOUT_PAYMENT = new Set(["denied", "rejected", "expired", "failed"]);

export type DocumentState = "open" | "in_progress" | "paid" | "void";

export async function documentState(db: TenantDb, doc: Pick<PaymentDocument, "status" | "reservedByRequestId">): Promise<{ state: DocumentState; requestStatus: string | null }> {
  if (doc.status === "void") return { state: "void", requestStatus: null };
  if (!doc.reservedByRequestId) return { state: "open", requestStatus: null };
  const r = await db.actionRequest.findUnique({ where: { id: doc.reservedByRequestId }, select: { status: true } });
  if (!r || ENDED_WITHOUT_PAYMENT.has(r.status)) return { state: "open", requestStatus: r?.status ?? null };
  return { state: r.status === "executed" ? "paid" : "in_progress", requestStatus: r.status };
}

export type MatchResult = { ok: true; doc: PaymentDocument; staleReservation: string | null } | { ok: false; code: "missing_reference" | "not_found" | "void" | "wrong_kind" | "vendor_mismatch" | "currency_mismatch" | "amount_mismatch" | "duplicate"; message: string };

export async function checkPaymentDocument(db: TenantDb, orgId: string, rule: DocumentMatch, params: Record<string, unknown>, requestId: string): Promise<MatchResult> {
  const ref = params[rule.documentParam];
  if (typeof ref !== "string" || !ref.trim()) return { ok: false, code: "missing_reference", message: `This payment must reference a registered ${rule.kinds.join(" or ")} in "${rule.documentParam}"` };
  const doc = await db.paymentDocument.findUnique({ where: { orgId_ref: { orgId, ref: ref.trim() } } });
  if (!doc) return { ok: false, code: "not_found", message: `No registered document ${ref} in the system of record: there is nothing to match this payment against` };
  if (!rule.kinds.includes(doc.kind as DocumentMatch["kinds"][number])) return { ok: false, code: "wrong_kind", message: `Document ${ref} is a ${doc.kind}; this payment needs a ${rule.kinds.join(" or ")}` };
  const vendor = params[rule.vendorParam];
  if (vendor !== doc.vendorRef) return { ok: false, code: "vendor_mismatch", message: `Document ${ref} is for vendor ${doc.vendorRef}, but the payment goes to ${typeof vendor === "string" ? vendor : "an unnamed payee"}` };
  const currency = params[rule.currencyParam];
  // A payment that states no currency cannot be shown to match the document's: fail closed.
  if (typeof currency !== "string" || !currency.trim()) return { ok: false, code: "currency_mismatch", message: `Document ${ref} is in ${doc.currency}, and the payment states no currency in "${rule.currencyParam}"` };
  if (currency.toUpperCase() !== doc.currency.toUpperCase()) return { ok: false, code: "currency_mismatch", message: `Document ${ref} is in ${doc.currency}, the payment is in ${currency}` };
  const amount = Number(params[rule.amountParam]);
  const expected = Number(doc.amount);
  if (!Number.isFinite(amount) || Math.abs(amount - expected) > rule.amountTolerance + 1e-9) return { ok: false, code: "amount_mismatch", message: `Document ${ref} is for ${doc.currency} ${expected.toLocaleString("en-US")}, the payment is for ${Number.isFinite(amount) ? amount.toLocaleString("en-US") : "no amount"}` };
  const state = await documentState(db, doc);
  if (state.state === "void") return { ok: false, code: "void", message: `Document ${ref} was voided in the system of record` };
  if ((state.state === "paid" || state.state === "in_progress") && doc.reservedByRequestId !== requestId) return { ok: false, code: "duplicate", message: `Document ${ref} is already ${state.state === "paid" ? "paid" : "being paid"} by another request: this would pay it twice` };
  return { ok: true, doc, staleReservation: state.state === "open" ? doc.reservedByRequestId : null };
}

/** Claims the document for this request. Conditional, so two payments racing for one document cannot both win. */
export async function reservePaymentDocument(db: TenantDb, match: Extract<MatchResult, { ok: true }>, requestId: string, now: Date): Promise<boolean> {
  const r = await db.paymentDocument.updateMany({ where: { id: match.doc.id, reservedByRequestId: match.staleReservation }, data: { reservedByRequestId: requestId, reservedAt: now } });
  return r.count === 1;
}

export const registerDocumentsSchema = z.object({
  documents: z
    .array(
      z.object({
        ref: z.string().trim().min(1).max(100),
        kind: z.enum(["invoice", "receipt", "purchase_order"]),
        vendorRef: z.string().trim().min(1).max(100),
        amount: z.number().positive().max(1e15),
        currency: z.string().trim().length(3),
        detail: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .min(1)
    .max(500),
});

/**
 * Registers documents from the system of record (an integration key) or a person with integrations:write.
 * Agents are refused. A document already claimed by a payment cannot be changed.
 */
export async function registerPaymentDocuments(db: TenantDb, ctx: OrgContext, input: unknown) {
  if (ctx.actor.type === "agent") throw forbidden("Agents cannot register the documents they pay against");
  if (ctx.actor.type !== "integration") assertPermission(ctx, "integrations:write");
  const { documents } = registerDocumentsSchema.parse(input);
  const results: { ref: string; outcome: "registered" | "updated" | "unchanged" | "locked" }[] = [];
  for (const d of documents) {
    const existing = await db.paymentDocument.findUnique({ where: { orgId_ref: { orgId: ctx.orgId, ref: d.ref } } });
    const data = { kind: d.kind, vendorRef: d.vendorRef, amount: d.amount, currency: d.currency.toUpperCase(), detail: d.detail as Prisma.InputJsonValue };
    if (!existing) {
      const row = await db.paymentDocument.create({ data: { orgId: ctx.orgId, ref: d.ref, ...data, sourceType: ctx.actor.type === "integration" ? "integration" : "user", sourceId: ctx.actor.id ?? null, sourceLabel: ctx.actor.label ?? null } });
      await appendEvidence(db, ctx, { type: "payment_document.registered", subjectType: "payment_document", subjectId: row.id, payload: { ref: d.ref, kind: d.kind, vendorRef: d.vendorRef, amount: d.amount, currency: data.currency } });
      results.push({ ref: d.ref, outcome: "registered" });
      continue;
    }
    const same = existing.kind === d.kind && existing.vendorRef === d.vendorRef && Number(existing.amount) === d.amount && existing.currency === data.currency;
    if (same) {
      results.push({ ref: d.ref, outcome: "unchanged" });
      continue;
    }
    const state = await documentState(db, existing);
    if (state.state === "paid" || state.state === "in_progress") {
      results.push({ ref: d.ref, outcome: "locked" });
      continue;
    }
    await db.paymentDocument.update({ where: { id: existing.id }, data });
    await appendEvidence(db, ctx, { type: "payment_document.updated", subjectType: "payment_document", subjectId: existing.id, payload: { ref: d.ref, from: { vendorRef: existing.vendorRef, amount: Number(existing.amount), currency: existing.currency }, to: { vendorRef: d.vendorRef, amount: d.amount, currency: data.currency } } });
    results.push({ ref: d.ref, outcome: "updated" });
  }
  return { results };
}

/** Mismatches a person may resolve; a voided or already-paid document is refused in every mode. */
export function isStructuralMismatch(code: Exclude<MatchResult, { ok: true }>["code"]): boolean {
  return code === "void" || code === "duplicate";
}

export async function voidPaymentDocument(db: TenantDb, ctx: OrgContext, id: string, reason: string) {
  if (ctx.actor.type === "agent") throw forbidden("Agents cannot void documents");
  if (ctx.actor.type !== "integration") assertPermission(ctx, "integrations:write");
  if (reason.trim().length < 5) throw new AegisError("validation", "A reason of at least 5 characters is required");
  const doc = await db.paymentDocument.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!doc) throw notFound("Payment document");
  if ((await documentState(db, doc)).state === "paid") throw conflict("This document is already paid; reverse the payment in the system of record");
  await db.paymentDocument.update({ where: { id }, data: { status: "void" } });
  // A payment already authorized against this document loses its permission: live grants are voided, and a
  // later grant is refused (staleAuthorization re-checks the document).
  if (doc.reservedByRequestId) await voidGrantsForRequest(db, doc.reservedByRequestId, `Payment document ${doc.ref} was voided`);
  await appendEvidence(db, ctx, { type: "payment_document.voided", subjectType: "payment_document", subjectId: id, payload: { ref: doc.ref, reason: reason.trim() } });
}

export async function listPaymentDocuments(db: TenantDb, ctx: OrgContext, opts: { take?: number } = {}) {
  assertPermission(ctx, "gateway:read");
  const docs = await db.paymentDocument.findMany({ where: { orgId: ctx.orgId }, orderBy: { createdAt: "desc" }, take: opts.take ?? 100 });
  return Promise.all(docs.map(async (d) => ({ ...d, amount: Number(d.amount), ...(await documentState(db, d)) })));
}

/** Turns matching on or off for a payment tool (stored in the tool's destination rules). */
export async function setDocumentMatching(db: TenantDb, ctx: OrgContext, toolId: string, config: unknown | null) {
  assertPermission(ctx, "policies:activate");
  const tool = await db.tool.findFirst({ where: { id: toolId, orgId: ctx.orgId } });
  if (!tool) throw notFound("Tool");
  const rules = { ...((tool.destinationRules ?? {}) as Record<string, unknown>) };
  if (config === null) delete rules.documentMatch;
  else rules.documentMatch = documentMatchSchema.parse(config);
  await db.tool.update({ where: { id: tool.id }, data: { destinationRules: rules as Prisma.InputJsonValue } });
  await appendEvidence(db, ctx, { type: "tool.document_matching_set", subjectType: "tool", subjectId: tool.id, payload: { key: tool.key, documentMatch: rules.documentMatch ?? null } });
  return rules.documentMatch ?? null;
}
