import { createHash } from "node:crypto";
import type { ExpenseClaim, FinancialTransaction, Prisma, TenantDb } from "@aegis/db";
import { z } from "zod";
import { appendEvidence } from "../evidence/ledger.js";
import type { OrgContext } from "../lib/context.js";
import { conflict, forbidden, notFound } from "../lib/errors.js";
import { assertPermission } from "../orgs/orgs.js";

/**
 * Expense receipt validation (docs/RECEIPT_VALIDATION.md). An expense claim is checked against what cannot be
 * edited by the person claiming: the card or bank transaction in the system of record, earlier claims, and the
 * arithmetic and tax rules of the receipt itself. Every check is deterministic; money is compared in minor units.
 *
 * Verdicts:
 * - verified_match: the receipt agrees with itself, the tax rules and a real transaction, and is not a duplicate.
 * - requires_review: something needs a person (an indicator, a near-duplicate image, an unknown merchant match).
 * - confirmed_mismatch: a fact contradicts the claim (a different amount was charged, the purchase was reversed,
 *   the receipt or transaction was already reimbursed, the totals do not add up).
 * - insufficient_evidence: there is nothing authoritative to compare with (no transactions for that card and date).
 *
 * AI-generated-content signals (C2PA or IPTC "trained algorithmic media" labels, generator names in metadata) are
 * indicators only. They send a claim to a person; on their own they never make it a mismatch, and they do not
 * establish fraud. Their absence proves nothing: such labels are easy to strip.
 */

// ---------- money ----------

/** Parses an amount to minor units exactly ("27.34" -> 2734n). Numbers are read through their decimal string. */
export function amountToMinor(v: number | string, decimals = 2): bigint {
  const s = typeof v === "number" ? v.toFixed(decimals) : v.trim();
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new Error(`not an amount: ${s}`);
  const frac = (m[3] ?? "").padEnd(decimals, "0");
  if (frac.length > decimals && /[1-9]/.test(frac.slice(decimals))) throw new Error(`more than ${decimals} decimal places: ${s}`);
  const n = BigInt(m[2]!) * 10n ** BigInt(decimals) + BigInt(frac.slice(0, decimals) || "0");
  return m[1] ? -n : n;
}
export const minorToAmount = (n: bigint, decimals = 2) => `${n < 0n ? "-" : ""}${(n < 0n ? -n : n) / 10n ** BigInt(decimals)}.${((n < 0n ? -n : n) % 10n ** BigInt(decimals)).toString().padStart(decimals, "0")}`;

// ---------- tax rules ----------

/**
 * Standard VAT rates in basis points. Illustrative and to be confirmed by the customer's tax adviser: rules change
 * and some supplies are zero-rated or exempt. Jurisdictions without VAT are absent, so no rate check is made.
 */
export const VAT_RULES: Record<string, { standardBp: number; trn?: RegExp; trnName?: string }> = {
  AE: { standardBp: 500, trn: /^100\d{12}$/, trnName: "UAE Tax Registration Number (15 digits starting 100)" },
  SA: { standardBp: 1500, trn: /^3\d{13}3$/, trnName: "Saudi VAT number (15 digits starting and ending with 3)" },
  BH: { standardBp: 1000 },
  OM: { standardBp: 500 },
};

/** VAT on a net amount, rounded half up to the minor unit. */
export function vatOn(netMinor: bigint, bp: number): bigint {
  return (netMinor * BigInt(bp) + 5000n) / 10000n;
}

// ---------- receipt image ----------

/** 64-bit difference hash: the image shrunk to 9x8 grey pixels, one bit per neighbour comparison. */
export async function differenceHash(image: Buffer): Promise<string | null> {
  try {
    const { default: sharp } = await import("sharp");
    const px = await sharp(image).rotate().greyscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
    let bits = 0n;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits = (bits << 1n) | (px[y * 9 + x]! > px[y * 9 + x + 1]! ? 1n : 0n);
    return bits.toString(16).padStart(16, "0");
  } catch {
    return null;
  }
}
export function hamming(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

const AI_SOURCE_TYPES = ["trainedAlgorithmicMedia", "compositeWithTrainedAlgorithmicMedia", "algorithmicMedia"];
const GENERATORS = ["DALL-E", "DALL·E", "Midjourney", "Stable Diffusion", "Adobe Firefly", "Imagen", "gpt-image", "Ideogram", "Flux"];
const EDITORS = ["Photoshop", "GIMP", "Canva", "Pixelmator", "Affinity Photo"];

/** Reads provenance labels from the file's bytes (C2PA manifests, XMP/IPTC fields, software tags). */
export function provenanceSignals(image: Buffer): { c2pa: boolean; aiSourceType: string | null; generator: string | null; editor: string | null } {
  const head = image.subarray(0, 1_000_000).toString("latin1");
  const tail = image.length > 1_000_000 ? image.subarray(image.length - 200_000).toString("latin1") : "";
  const text = head + tail;
  const find = (list: string[]) => list.find((g) => text.toLowerCase().includes(g.toLowerCase())) ?? null;
  return { c2pa: /c2pa/i.test(text), aiSourceType: AI_SOURCE_TYPES.find((t) => text.includes(t)) ?? null, generator: find(GENERATORS), editor: find(EDITORS) };
}

// ---------- assessment ----------

export type Verdict = "verified_match" | "requires_review" | "confirmed_mismatch" | "insufficient_evidence";
export interface ReceiptFinding {
  code: string;
  /** mismatch decides the verdict; review sends to a person; info is recorded; ok is a passed check. */
  level: "mismatch" | "review" | "info" | "ok";
  message: string;
  evidence?: Record<string, unknown>;
}

export interface ReceiptFacts {
  claimRef: string;
  merchantName: string;
  cardRef: string | null;
  receiptDate: Date;
  currency: string;
  subtotalMinor: bigint | null;
  vatMinor: bigint | null;
  totalMinor: bigint;
  claimedMinor: bigint;
  trn: string | null;
  jurisdiction: string;
  zeroRated: boolean;
  receiptSha256: string | null;
  receiptDhash: string | null;
  provenance: ReturnType<typeof provenanceSignals> | null;
  submittedAt: Date;
}

export interface ReceiptContext {
  transactions: Pick<FinancialTransaction, "ref" | "kind" | "cardRef" | "merchantName" | "amountMinor" | "currency" | "postedAt" | "originalRef">[];
  /** Earlier claims in the organization (not this one). */
  priorClaims: Pick<ExpenseClaim, "ref" | "receiptSha256" | "receiptDhash" | "matchedRefs" | "merchantName" | "totalMinor" | "receiptDate" | "verdict">[];
  /** Whether the transaction feed covers this card for the receipt's dates at all. */
  feedCovers: boolean;
}

const STOP = new Set(["llc", "l.l.c", "fze", "fzco", "fz", "co", "ltd", "limited", "inc", "the", "and", "&", "est", "trading", "dmcc", "pjsc", "company"]);
const tokens = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9؀-ۿ ]+/g, " ").split(/\s+/).filter((t) => t.length > 1 && !STOP.has(t)));
export function merchantSimilarity(a: string, b: string): number {
  const x = tokens(a), y = tokens(b);
  if (!x.size || !y.size) return 0;
  const inter = [...x].filter((t) => y.has(t)).length;
  return inter / Math.min(x.size, y.size);
}

const DAY = 86_400_000;

/** Pure and deterministic: the same facts and records always give the same verdict and findings. */
export function assessReceipt(f: ReceiptFacts, c: ReceiptContext): { verdict: Verdict; findings: ReceiptFinding[]; matchedRefs: string[] } {
  const out: ReceiptFinding[] = [];
  const money = (n: bigint) => `${f.currency} ${minorToAmount(n)}`;

  // 1. The receipt agrees with itself.
  if (f.subtotalMinor !== null && f.vatMinor !== null) {
    if (f.subtotalMinor + f.vatMinor !== f.totalMinor) out.push({ code: "totals_do_not_add_up", level: "mismatch", message: `Subtotal ${money(f.subtotalMinor)} plus VAT ${money(f.vatMinor)} is ${money(f.subtotalMinor + f.vatMinor)}, but the receipt total is ${money(f.totalMinor)}` });
    else out.push({ code: "totals_add_up", level: "ok", message: "Subtotal plus VAT equals the total" });
  }
  if (f.claimedMinor > f.totalMinor) out.push({ code: "claim_exceeds_receipt", level: "mismatch", message: `The claim is for ${money(f.claimedMinor)}, more than the receipt total ${money(f.totalMinor)}` });
  if (f.receiptDate.getTime() > f.submittedAt.getTime() + DAY) out.push({ code: "receipt_dated_in_future", level: "mismatch", message: `The receipt is dated ${f.receiptDate.toISOString().slice(0, 10)}, after the claim was submitted` });

  // 2. Tax rules of the jurisdiction (rates to be confirmed by the customer's tax adviser).
  const rule = VAT_RULES[f.jurisdiction];
  if (rule && f.subtotalMinor !== null && f.vatMinor !== null && !f.zeroRated) {
    const expected = vatOn(f.subtotalMinor, rule.standardBp);
    const diff = f.vatMinor - expected;
    if (diff < -1n || diff > 1n) out.push({ code: "vat_rate_wrong", level: "review", message: `VAT should be ${money(expected)} at the ${rule.standardBp / 100}% standard rate on ${money(f.subtotalMinor)}, the receipt shows ${money(f.vatMinor)}`, evidence: { jurisdiction: f.jurisdiction, rateBp: rule.standardBp } });
    else out.push({ code: "vat_rate_correct", level: "ok", message: `VAT matches the ${rule.standardBp / 100}% standard rate` });
  }
  if (rule?.trn && f.vatMinor !== null && f.vatMinor > 0n) {
    if (!f.trn) out.push({ code: "trn_missing", level: "review", message: `VAT is charged but no ${rule.trnName} is shown` });
    else if (!rule.trn.test(f.trn.replace(/\s|-/g, ""))) out.push({ code: "trn_invalid_format", level: "review", message: `"${f.trn}" is not a valid ${rule.trnName}. Only the format is checked, not registration` });
    else out.push({ code: "trn_format_ok", level: "ok", message: "Tax registration number has a valid format (registration itself is not checked)" });
  }

  // 3. The same receipt or picture claimed before.
  if (f.receiptSha256) {
    const same = c.priorClaims.find((p) => p.receiptSha256 === f.receiptSha256);
    if (same) out.push({ code: "duplicate_receipt_file", level: "mismatch", message: `The same receipt file was already claimed in ${same.ref}`, evidence: { claim: same.ref } });
  }
  if (f.receiptDhash) {
    const near = c.priorClaims.filter((p) => p.receiptDhash && p.receiptSha256 !== f.receiptSha256).map((p) => ({ p, d: hamming(p.receiptDhash!, f.receiptDhash!) })).filter((x) => x.d <= 6).sort((a, b) => a.d - b.d)[0];
    if (near) out.push({ code: "reused_receipt_image", level: "review", message: `The receipt image closely matches the one in ${near.p.ref} (${near.d} of 64 bits differ): possibly the same picture resized, cropped or edited`, evidence: { claim: near.p.ref, distance: near.d } });
  }

  // 4. Provenance labels: indicators for a person, never proof.
  const pv = f.provenance;
  if (pv?.aiSourceType) out.push({ code: "ai_generated_label", level: "review", message: `The file carries a "${pv.aiSourceType}" label, which marks AI-generated content. This is an indicator, not proof of fraud` });
  else if (pv?.generator) out.push({ code: "ai_generator_named", level: "review", message: `The file's metadata names ${pv.generator}, an image generator. This is an indicator, not proof of fraud` });
  if (pv?.editor) out.push({ code: "edited_in_image_editor", level: "info", message: `The file's metadata names ${pv.editor}; receipts are often re-saved by phones and scanners, so this alone means little` });

  // 5. The transaction that really happened.
  const matched: string[] = [];
  const window = c.transactions.filter((t) => t.currency.toUpperCase() === f.currency.toUpperCase() && (!f.cardRef || !t.cardRef || t.cardRef === f.cardRef) && t.postedAt.getTime() >= f.receiptDate.getTime() - DAY && t.postedAt.getTime() <= f.receiptDate.getTime() + 4 * DAY);
  const undone = new Map<string, bigint>();
  for (const t of c.transactions) if ((t.kind === "refund" || t.kind === "reversal") && t.originalRef) undone.set(t.originalRef, (undone.get(t.originalRef) ?? 0n) + t.amountMinor);
  const purchases = window.filter((t) => t.kind === "purchase").map((t) => ({ t, sim: merchantSimilarity(t.merchantName, f.merchantName), net: t.amountMinor - (undone.get(t.ref) ?? 0n) }));
  const sameMerchant = purchases.filter((p) => p.sim >= 0.5);
  let txFound = false;
  const exact = sameMerchant.find((p) => p.t.amountMinor === f.totalMinor);
  if (exact) {
    txFound = true;
    matched.push(exact.t.ref);
    if (exact.net <= 0n) out.push({ code: "transaction_reversed", level: "mismatch", message: `The ${money(exact.t.amountMinor)} charge ${exact.t.ref} was fully refunded or reversed`, evidence: { transaction: exact.t.ref } });
    else if (exact.net < f.claimedMinor) out.push({ code: "transaction_partly_refunded", level: "mismatch", message: `${money(exact.t.amountMinor - exact.net)} of charge ${exact.t.ref} was refunded; only ${money(exact.net)} can be claimed`, evidence: { transaction: exact.t.ref } });
    else out.push({ code: "transaction_matches", level: "ok", message: `Charge ${exact.t.ref} at ${exact.t.merchantName} for ${money(exact.t.amountMinor)} on ${exact.t.postedAt.toISOString().slice(0, 10)}`, evidence: { transaction: exact.t.ref } });
  } else {
    // A split payment: two or three charges at the same merchant adding up to the total.
    const list = sameMerchant.slice(0, 12);
    let split: typeof list | null = null;
    for (let i = 0; i < list.length && !split; i++) for (let j = i + 1; j < list.length && !split; j++) {
      if (list[i]!.t.amountMinor + list[j]!.t.amountMinor === f.totalMinor) split = [list[i]!, list[j]!];
      for (let k = j + 1; k < list.length && !split; k++) if (list[i]!.t.amountMinor + list[j]!.t.amountMinor + list[k]!.t.amountMinor === f.totalMinor) split = [list[i]!, list[j]!, list[k]!];
    }
    if (split) {
      txFound = true;
      matched.push(...split.map((s) => s.t.ref));
      const net = split.reduce((n, s) => n + s.net, 0n);
      if (net < f.claimedMinor) out.push({ code: "transaction_partly_refunded", level: "mismatch", message: `Part of the split payment was refunded; only ${money(net)} can be claimed` });
      else out.push({ code: "split_transaction_matches", level: "ok", message: `${split.length} charges at ${split[0]!.t.merchantName} add up to ${money(f.totalMinor)}: ${split.map((s) => s.t.ref).join(", ")}` });
    } else if (sameMerchant.length) {
      txFound = true;
      const closest = [...sameMerchant].sort((a, b) => Number((a.t.amountMinor > f.totalMinor ? a.t.amountMinor - f.totalMinor : f.totalMinor - a.t.amountMinor) - (b.t.amountMinor > f.totalMinor ? b.t.amountMinor - f.totalMinor : f.totalMinor - b.t.amountMinor)))[0]!;
      matched.push(closest.t.ref);
      out.push({ code: "amount_differs_from_charge", level: "mismatch", message: `The card was charged ${money(closest.t.amountMinor)} at ${closest.t.merchantName} (${closest.t.ref}), but the receipt says ${money(f.totalMinor)}`, evidence: { transaction: closest.t.ref, charged: minorToAmount(closest.t.amountMinor), receipt: minorToAmount(f.totalMinor) } });
    } else if (c.feedCovers) {
      out.push({ code: "no_matching_charge", level: "review", message: `No charge at a merchant like "${f.merchantName}" for ${money(f.totalMinor)} near ${f.receiptDate.toISOString().slice(0, 10)} on this card. It may have been paid another way; a person must check` });
    }
  }

  // 6. The same charge reimbursed twice.
  for (const ref of matched) {
    const prior = c.priorClaims.find((p) => p.matchedRefs.includes(ref) && p.verdict !== "confirmed_mismatch");
    if (prior) out.push({ code: "transaction_already_claimed", level: "mismatch", message: `Charge ${ref} was already claimed in ${prior.ref}`, evidence: { claim: prior.ref, transaction: ref } });
  }

  const verdict: Verdict = out.some((x) => x.level === "mismatch") ? "confirmed_mismatch" : out.some((x) => x.level === "review") ? "requires_review" : !txFound ? "insufficient_evidence" : "verified_match";
  if (verdict === "insufficient_evidence") out.push({ code: "no_authoritative_record", level: "info", message: "There is no card or bank transaction to compare with for this card and date, so the claim cannot be verified automatically" });
  return { verdict, findings: out, matchedRefs: matched };
}

// ---------- records ----------

export const transactionsSchema = z.object({
  transactions: z
    .array(
      z.object({
        ref: z.string().trim().min(1).max(100),
        kind: z.enum(["purchase", "refund", "reversal"]).default("purchase"),
        cardRef: z.string().trim().max(40).nullable().default(null),
        merchantName: z.string().trim().min(1).max(200),
        amount: z.union([z.string(), z.number()]),
        currency: z.string().trim().length(3),
        postedAt: z.coerce.date(),
        originalRef: z.string().trim().max(100).nullable().default(null),
      }),
    )
    .min(1)
    .max(1000),
});

/** Card and bank transactions from the system of record. Agents cannot register them. */
export async function registerTransactions(db: TenantDb, ctx: OrgContext, input: unknown) {
  if (ctx.actor.type === "agent") throw forbidden("Agents cannot register financial transactions");
  if (ctx.actor.type !== "integration") assertPermission(ctx, "integrations:write");
  const { transactions } = transactionsSchema.parse(input);
  let created = 0;
  for (const t of transactions) {
    const amountMinor = amountToMinor(t.amount);
    if (amountMinor <= 0n) throw new Error(`Transaction ${t.ref}: the amount must be positive; use kind refund or reversal`);
    const exists = await db.financialTransaction.findUnique({ where: { orgId_ref: { orgId: ctx.orgId, ref: t.ref } } });
    if (exists) continue;
    await db.financialTransaction.create({ data: { orgId: ctx.orgId, ref: t.ref, kind: t.kind, cardRef: t.cardRef, merchantName: t.merchantName, amountMinor, currency: t.currency.toUpperCase(), postedAt: t.postedAt, originalRef: t.originalRef, sourceType: ctx.actor.type === "integration" ? "integration" : "user", sourceId: ctx.actor.id ?? null, sourceLabel: ctx.actor.label ?? null } });
    created++;
  }
  await appendEvidence(db, ctx, { type: "financial_transactions.registered", subjectType: "organization", subjectId: ctx.orgId, payload: { received: transactions.length, created } });
  return { received: transactions.length, created };
}

export const claimSchema = z.object({
  ref: z.string().trim().min(1).max(100),
  claimantRef: z.string().trim().min(1).max(100),
  cardRef: z.string().trim().max(40).nullable().default(null),
  merchantName: z.string().trim().min(1).max(200),
  receiptDate: z.coerce.date(),
  currency: z.string().trim().length(3),
  subtotal: z.union([z.string(), z.number()]).nullable().default(null),
  vat: z.union([z.string(), z.number()]).nullable().default(null),
  total: z.union([z.string(), z.number()]),
  claimed: z.union([z.string(), z.number()]).nullable().default(null),
  trn: z.string().trim().max(30).nullable().default(null),
  jurisdiction: z.string().trim().length(2).default("AE"),
  zeroRated: z.boolean().default(false),
  /** The receipt file, base64. Used for the file hash, the image hash and provenance labels; not stored. */
  receiptBase64: z.string().max(14_000_000).optional(),
});

/**
 * Submits an expense claim from the expense system (integration key) or a person. The receipt's fields come from
 * the expense system's extraction or from extractReceiptText; the file, when given, is hashed and inspected.
 */
export async function submitExpenseClaim(db: TenantDb, ctx: OrgContext, input: unknown) {
  if (ctx.actor.type === "agent") throw forbidden("Agents cannot submit the claims they are paid against");
  if (ctx.actor.type !== "integration") assertPermission(ctx, "integrations:write");
  const v = claimSchema.parse(input);
  if (await db.expenseClaim.findUnique({ where: { orgId_ref: { orgId: ctx.orgId, ref: v.ref } } })) throw conflict(`Claim ${v.ref} already exists`);
  const now = ctx.now ?? new Date();
  const file = v.receiptBase64 ? Buffer.from(v.receiptBase64, "base64") : null;
  const facts: ReceiptFacts = {
    claimRef: v.ref,
    merchantName: v.merchantName,
    cardRef: v.cardRef,
    receiptDate: v.receiptDate,
    currency: v.currency.toUpperCase(),
    subtotalMinor: v.subtotal === null ? null : amountToMinor(v.subtotal),
    vatMinor: v.vat === null ? null : amountToMinor(v.vat),
    totalMinor: amountToMinor(v.total),
    claimedMinor: amountToMinor(v.claimed ?? v.total),
    trn: v.trn,
    jurisdiction: v.jurisdiction.toUpperCase(),
    zeroRated: v.zeroRated,
    receiptSha256: file ? createHash("sha256").update(file).digest("hex") : null,
    receiptDhash: file ? await differenceHash(file) : null,
    provenance: file ? provenanceSignals(file) : null,
    submittedAt: now,
  };
  const from = new Date(v.receiptDate.getTime() - 2 * DAY), to = new Date(v.receiptDate.getTime() + 5 * DAY);
  const transactions = await db.financialTransaction.findMany({ where: { orgId: ctx.orgId, OR: [{ postedAt: { gte: from, lte: to } }, { kind: { in: ["refund", "reversal"] }, postedAt: { gte: from } }] } });
  const feedCovers = (await db.financialTransaction.count({ where: { orgId: ctx.orgId, ...(v.cardRef ? { cardRef: v.cardRef } : {}), postedAt: { gte: from, lte: to } } })) > 0;
  const priorClaims = await db.expenseClaim.findMany({ where: { orgId: ctx.orgId }, select: { ref: true, receiptSha256: true, receiptDhash: true, matchedRefs: true, merchantName: true, totalMinor: true, receiptDate: true, verdict: true }, take: 5000, orderBy: { createdAt: "desc" } });
  const a = assessReceipt(facts, { transactions, priorClaims, feedCovers });
  const row = await db.expenseClaim.create({
    data: {
      orgId: ctx.orgId, ref: v.ref, claimantRef: v.claimantRef, cardRef: v.cardRef, merchantName: v.merchantName, receiptDate: v.receiptDate, currency: facts.currency,
      subtotalMinor: facts.subtotalMinor, vatMinor: facts.vatMinor, totalMinor: facts.totalMinor, claimedMinor: facts.claimedMinor, trn: v.trn, jurisdiction: facts.jurisdiction,
      receiptSha256: facts.receiptSha256, receiptDhash: facts.receiptDhash, receiptMeta: (facts.provenance ?? {}) as Prisma.InputJsonValue,
      verdict: a.verdict, findings: a.findings as unknown as Prisma.InputJsonValue, matchedRefs: a.matchedRefs,
      sourceType: ctx.actor.type === "integration" ? "integration" : "user", sourceId: ctx.actor.id ?? null, sourceLabel: ctx.actor.label ?? null,
    },
  });
  await appendEvidence(db, ctx, { type: "expense_claim.assessed", subjectType: "expense_claim", subjectId: row.id, payload: { ref: v.ref, verdict: a.verdict, findings: a.findings.filter((f) => f.level !== "ok").map((f) => f.code), matchedRefs: a.matchedRefs } });
  return { claim: row, verdict: a.verdict, findings: a.findings };
}

export async function listExpenseClaims(db: TenantDb, ctx: OrgContext) {
  assertPermission(ctx, "gateway:read");
  const rows = await db.expenseClaim.findMany({ where: { orgId: ctx.orgId }, orderBy: { createdAt: "desc" }, take: 100 });
  return rows.map((r) => ({ ...r, total: minorToAmount(r.totalMinor), claimed: minorToAmount(r.claimedMinor), findings: r.findings as unknown as ReceiptFinding[] }));
}

// ---------- reading a receipt ----------

/**
 * Reads the fields of a plain-text receipt (or the text layer of a PDF) with simple, explainable patterns. Real
 * deployments should send fields from the expense system's own extraction; this covers typed and e-receipts.
 */
export function extractReceiptText(text: string): { merchantName: string | null; date: string | null; subtotal: string | null; vat: string | null; total: string | null; trn: string | null; currency: string | null } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const amount = (re: RegExp) => {
    for (const l of lines) {
      const m = re.exec(l);
      if (m) return m[1]!.replace(/,/g, "");
    }
    return null;
  };
  const num = String.raw`([0-9][0-9,]*\.[0-9]{2})`;
  const date = /\b(\d{4}-\d{2}-\d{2}|\d{2}[/.-]\d{2}[/.-]\d{4})\b/.exec(text)?.[1] ?? null;
  const iso = date && /^\d{2}/.test(date) ? `${date.slice(6, 10)}-${date.slice(3, 5)}-${date.slice(0, 2)}` : date;
  return {
    merchantName: lines[0] ?? null,
    date: iso,
    subtotal: amount(new RegExp(String.raw`(?:sub\s*-?\s*total|net(?:\s+amount)?|amount before vat)\D{0,20}` + num, "i")),
    vat: amount(new RegExp(String.raw`\b(?:vat|tax)\b(?!\s*(?:no|number|reg|trn))[^\n]{0,24}?` + num, "i")),
    total: amount(new RegExp(String.raw`\b(?:grand\s+total|total(?:\s+amount)?|amount\s+due|fare|total\s+due)\b\D{0,20}` + num, "i")),
    trn: /\b(?:TRN|VAT\s*(?:reg(?:istration)?\s*)?(?:no|number)\.?)\s*[:#]?\s*([0-9][0-9 -]{12,20}[0-9])/i.exec(text)?.[1]?.replace(/[\s-]/g, "") ?? null,
    currency: /\b(AED|SAR|USD|EUR|GBP|BHD|OMR|QAR|KWD)\b/.exec(text)?.[1] ?? null,
  };
}

// ---------- paying a claim ----------

export const claimRuleSchema = z.object({ claimParam: z.string().min(1).max(60).default("claimId"), amountParam: z.string().min(1).max(60).default("amount") });
export function readClaimRule(destinationRules: unknown) {
  const v = (destinationRules as { expenseClaims?: unknown } | null)?.expenseClaims;
  if (!v) return null;
  const p = claimRuleSchema.safeParse(v);
  return p.success ? p.data : claimRuleSchema.parse({});
}

const ENDED = new Set(["denied", "rejected", "expired", "failed"]);
export type ClaimCheck = { outcome: "allow"; claim: ExpenseClaim; stale: string | null } | { outcome: "require_approval"; message: string; claim: ExpenseClaim; stale: string | null } | { outcome: "deny"; message: string; claim: ExpenseClaim | null };

/** For a reimbursement tool: verified claims may be paid; review and insufficient evidence go to a person; mismatches are refused. */
export async function checkClaimForPayment(db: TenantDb, orgId: string, rule: NonNullable<ReturnType<typeof readClaimRule>>, params: Record<string, unknown>, requestId: string): Promise<ClaimCheck> {
  const ref = params[rule.claimParam];
  if (typeof ref !== "string" || !ref) return { outcome: "deny", message: `This reimbursement must reference an assessed expense claim in "${rule.claimParam}"`, claim: null };
  const claim = await db.expenseClaim.findUnique({ where: { orgId_ref: { orgId, ref } } });
  if (!claim) return { outcome: "deny", message: `No assessed expense claim ${ref}`, claim: null };
  let amount: bigint;
  try {
    amount = amountToMinor(params[rule.amountParam] as number | string);
  } catch {
    return { outcome: "deny", message: `The reimbursement amount is missing or invalid`, claim };
  }
  if (amount !== claim.claimedMinor) return { outcome: "deny", message: `Claim ${ref} is for ${claim.currency} ${minorToAmount(claim.claimedMinor)}, the reimbursement is for ${minorToAmount(amount)}`, claim };
  let stale: string | null = null;
  if (claim.reservedByRequestId && claim.reservedByRequestId !== requestId) {
    const r = await db.actionRequest.findUnique({ where: { id: claim.reservedByRequestId }, select: { status: true } });
    if (r && !ENDED.has(r.status)) return { outcome: "deny", message: `Claim ${ref} is already ${r.status === "executed" ? "paid" : "being paid"}: this would reimburse it twice`, claim };
    stale = claim.reservedByRequestId;
  }
  const why = (claim.findings as unknown as ReceiptFinding[]).filter((f) => f.level === "mismatch" || f.level === "review").map((f) => f.message).join("; ");
  if (claim.verdict === "confirmed_mismatch") return { outcome: "deny", message: `Claim ${ref} does not match the records: ${why}`, claim };
  if (claim.verdict === "requires_review") return { outcome: "require_approval", message: `Claim ${ref} needs a person: ${why}`, claim, stale };
  if (claim.verdict === "insufficient_evidence") return { outcome: "require_approval", message: `Claim ${ref} has no card or bank transaction to verify against; a person must check the receipt`, claim, stale };
  return { outcome: "allow", claim, stale };
}

export async function reserveClaim(db: TenantDb, claimId: string, stale: string | null, requestId: string, now: Date) {
  const r = await db.expenseClaim.updateMany({ where: { id: claimId, reservedByRequestId: stale }, data: { reservedByRequestId: requestId, reservedAt: now } });
  return r.count === 1;
}

export async function setClaimRule(db: TenantDb, ctx: OrgContext, toolId: string, config: unknown | null) {
  assertPermission(ctx, "policies:activate");
  const tool = await db.tool.findFirst({ where: { id: toolId, orgId: ctx.orgId } });
  if (!tool) throw notFound("Tool");
  const rules = { ...((tool.destinationRules ?? {}) as Record<string, unknown>) };
  if (config === null) delete rules.expenseClaims;
  else rules.expenseClaims = claimRuleSchema.parse(config);
  await db.tool.update({ where: { id: tool.id }, data: { destinationRules: rules as Prisma.InputJsonValue } });
  await appendEvidence(db, ctx, { type: "tool.claim_rule_set", subjectType: "tool", subjectId: tool.id, payload: { key: tool.key, expenseClaims: rules.expenseClaims ?? null } });
  return rules.expenseClaims ?? null;
}
