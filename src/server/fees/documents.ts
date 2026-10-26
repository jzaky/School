import "server-only";
// Fee document PDFs for the download routes. Staff need fees.view; a parent only sees documents of accounts they
// pay or of their own children (parentAccountIds). Students never see fees. Every download is audited.
import { NextResponse } from "next/server";
import type { Ctx } from "@/server/context";
import { audit } from "@/server/audit/audit";
import { letterheadFor } from "@/server/documents/letterhead";
import type { Seller } from "./config";
import { parentAccountIds } from "./accounts";
import { renderCreditNotePdf, renderInvoicePdf, renderReceiptPdf } from "./pdf";
import { formatAed } from "./money";
import { balanceOf } from "./ledger";

export async function canSeeAccount(ctx: Ctx, accountId: string) {
  if (ctx.isStaff) return ctx.can("fees.view");
  if (ctx.isParent && ctx.can("family.portal")) return (await parentAccountIds(ctx.db, ctx)).includes(accountId);
  return false;
}

const pdfResponse = (pdf: Buffer, name: string, inline: boolean) =>
  new NextResponse(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${name}.pdf"`, "Cache-Control": "private, no-store" } });

const METHOD: Record<string, { en: string; ar: string }> = {
  CASH: { en: "Cash", ar: "نقدًا" },
  CHEQUE: { en: "Cheque", ar: "شيك" },
  BANK_TRANSFER: { en: "Bank transfer", ar: "تحويل بنكي" },
  CARD: { en: "Card (school terminal)", ar: "بطاقة (جهاز المدرسة)" },
  ONLINE: { en: "Online payment", ar: "دفع إلكتروني" },
};

async function logDownload(ctx: Ctx, entityType: string, entityId: string, number: string) {
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "fees.document.download", entityType, entityId, meta: { number } });
}

export async function invoicePdfResponse(ctx: Ctx, invoiceId: string, inline: boolean) {
  const inv = await ctx.db.invoice.findFirst({ where: { id: invoiceId }, include: { lines: { orderBy: { seq: "asc" } } } });
  if (!inv || !(await canSeeAccount(ctx, inv.accountId))) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const account = await ctx.db.feeAccount.findFirstOrThrow({ where: { id: inv.accountId } });
  const seller = inv.seller as unknown as Seller;
  const fmt = (f: number) => formatAed(f, "en");
  const pdf = await renderInvoicePdf(
    {
      kind: inv.kind,
      vatRegistered: seller.vatRegistered,
      number: inv.number,
      issueDate: inv.issueDate,
      dueDate: inv.dueDate,
      period: inv.periodLabelEn ? { en: inv.periodLabelEn, ar: inv.periodLabelAr ?? inv.periodLabelEn } : null,
      accountCode: account.code,
      billTo: { name: inv.billToName, nameAr: inv.billToNameAr, address: inv.billToAddress, trn: inv.billToTrn },
      seller,
      lines: inv.lines.map((l) => {
        const d = (l.discounts as Array<{ labelEn: string; labelAr: string; amountFils: number }> | null) ?? [];
        return { ...l, discountNote: d.length ? { en: d.map((x) => `${x.labelEn} ${fmt(x.amountFils)}`).join(", "), ar: d.map((x) => `${x.labelAr} ${formatAed(x.amountFils, "ar")}`).join("، ") } : null };
      }),
      totals: inv,
      bank: await bankDetails(ctx),
      status: inv.kind === "TAX" && inv.status === "PAID" && balanceOf(inv) === 0 ? { en: "Paid in full. Thank you.", ar: "مسددة بالكامل. شكرًا لكم." } : null,
    },
    await letterheadFor(ctx.db, ctx.org),
  );
  await logDownload(ctx, "Invoice", inv.id, inv.number);
  return pdfResponse(pdf, inv.number, inline);
}

async function bankDetails(ctx: Ctx) {
  const s = await ctx.db.financeSettings.findFirst({ where: {}, select: { bankDetailsEn: true, bankDetailsAr: true } });
  return { en: s?.bankDetailsEn ?? null, ar: s?.bankDetailsAr ?? null };
}

export async function creditNotePdfResponse(ctx: Ctx, id: string, inline: boolean) {
  const cn = await ctx.db.creditNote.findFirst({ where: { id }, include: { lines: true } });
  if (!cn || !(await canSeeAccount(ctx, cn.accountId))) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const [inv, account] = await Promise.all([ctx.db.invoice.findFirstOrThrow({ where: { id: cn.invoiceId } }), ctx.db.feeAccount.findFirstOrThrow({ where: { id: cn.accountId } })]);
  const seller = inv.seller as unknown as Seller;
  const pdf = await renderCreditNotePdf(
    {
      number: cn.number,
      issueDate: cn.issueDate,
      invoiceNumber: inv.number,
      invoiceDate: inv.issueDate,
      reason: { en: cn.reasonEn, ar: cn.reasonAr ?? cn.reasonEn },
      accountCode: account.code,
      billTo: { name: inv.billToName, nameAr: inv.billToNameAr, trn: inv.billToTrn },
      seller,
      vatRegistered: seller.vatRegistered,
      lines: cn.lines,
      totals: cn,
    },
    await letterheadFor(ctx.db, ctx.org),
  );
  await logDownload(ctx, "CreditNote", cn.id, cn.number);
  return pdfResponse(pdf, cn.number, inline);
}

export async function receiptPdfResponse(ctx: Ctx, id: string, inline: boolean) {
  const p = await ctx.db.feePayment.findFirst({ where: { id } });
  if (!p || !p.number || !(await canSeeAccount(ctx, p.accountId))) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const [account, allocations] = await Promise.all([ctx.db.feeAccount.findFirstOrThrow({ where: { id: p.accountId } }), ctx.db.feeAllocation.findMany({ where: { paymentId: p.id } })]);
  const ids = [...new Set(allocations.map((a) => a.invoiceId))];
  const invoices = ids.length ? await ctx.db.invoice.findMany({ where: { id: { in: ids } }, select: { id: true, number: true, seller: true } }) : [];
  const latest = await ctx.db.invoice.findFirst({ where: { accountId: p.accountId }, orderBy: { issueDate: "desc" }, select: { seller: true } });
  const sellerJson = (invoices[0]?.seller ?? latest?.seller) as unknown as Seller | undefined;
  const seller: Seller = sellerJson ?? { nameEn: ctx.org.nameEn, nameAr: ctx.org.nameAr, addressEn: ctx.org.emirate, addressAr: "", trn: null, vatRegistered: false };
  const per = ids.map((iid) => ({ invoiceNumber: invoices.find((i) => i.id === iid)?.number ?? "", amountFils: allocations.filter((a) => a.invoiceId === iid).reduce((s, a) => s + a.amountFils, 0) })).filter((x) => x.amountFils > 0);
  const method = METHOD[p.method] ?? { en: p.method, ar: p.method };
  const ref = p.method === "CHEQUE" ? [p.chequeNumber, p.chequeBank].filter(Boolean).join(", ") : p.reference;
  const pdf = await renderReceiptPdf(
    {
      number: p.number,
      date: p.clearedAt ?? p.receivedAt,
      accountCode: account.code,
      receivedFrom: { en: p.payerName ?? account.nameEn, ar: p.payerName ?? account.nameAr },
      seller,
      amountFils: p.amountFils,
      method,
      reference: ref || null,
      allocations: per,
      unallocatedFils: p.status === "CLEARED" ? p.amountFils - p.allocatedFils : 0,
      bounced: p.status === "BOUNCED",
    },
    await letterheadFor(ctx.db, ctx.org),
  );
  await logDownload(ctx, "FeePayment", p.id, p.number);
  return pdfResponse(pdf, p.number, inline);
}
