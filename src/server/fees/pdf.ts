// Bilingual (English and Arabic) PDFs for fee documents: tax invoices, proformas, credit notes and receipts.
// Arabic is shaped and laid out right to left by the shared helpers in documents/pdf.ts. A tax invoice carries the
// school's legal name, address and TRN, the invoice number and issue date, the customer, each line with its
// quantity, unit price, discount, taxable amount, VAT rate and VAT, and the totals in AED.
import { drawLtr, drawRtl, drawSchoolMark, FONTS, GOLD, MUTED, NAVY, newPdf, type Letterhead } from "@/server/documents/pdf";
import { formatAed } from "./money";
import type { Seller } from "./config";

type Doc = PDFKit.PDFDocument;

const num = (fils: number) => formatAed(fils, "en", { currency: false });
const pctText = (bp: number) => `${(bp / 100).toFixed(bp % 100 === 0 ? 0 : 2)}%`;
/** The shared RTL helper does not mirror brackets, so Arabic text in fee PDFs drops parentheses for a comma. */
const ar = (s: string) => s.replace(/\s*\(([^()]*)\)/g, "، $1").trim();
/** A compact left-to-right block for table cells (tighter line spacing than the shared drawLtr). Returns the y after it. */
function cell(doc: Doc, text: string, x: number, y: number, width: number, opts: { size: number; color?: string; font?: string; align?: "left" | "right" }) {
  doc.font(opts.font ?? FONTS.regular).fontSize(opts.size).fillColor(opts.color ?? "#111827");
  doc.text(text, x, y, { width, align: opts.align ?? "left", lineGap: -1 });
  return doc.y;
}
/** Rough height of an Arabic block drawn by drawRtl (line height is 1.75 times the font size). */
function rtlHeight(doc: Doc, text: string, width: number, size: number) {
  doc.font(FONTS.regular).fontSize(size);
  const lines = Math.max(1, Math.ceil((doc.widthOfString(text) * 1.08) / width));
  return lines * size * 1.75;
}

function day(d: Date) {
  return {
    en: new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Dubai" }).format(d),
    ar: new Intl.DateTimeFormat("ar-AE-u-nu-latn", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Dubai" }).format(d),
  };
}

function open(title: string, author: string) {
  const doc = newPdf({ size: "A4", margin: 0, bufferPages: true, info: { Title: title, Author: author } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  return { doc, done };
}

const W = 595.28;
const H = 841.89;
const M = 36;
const INNER = W - M * 2;
const HALF = INNER / 2 - 8;

function header(doc: Doc, seller: Seller, lh: Letterhead | null, title: { en: string; ar: string }) {
  doc.rect(0, 0, W, 7).fill(NAVY);
  doc.rect(0, 7, W, 2).fill(GOLD);
  drawSchoolMark(doc, W / 2 - 20, 20, 40, { logo: lh?.logo, name: lh?.shortEn ?? seller.nameEn });
  drawLtr(doc, seller.nameEn, M, 22, HALF - 26, { size: 10.5, font: FONTS.semibold, color: NAVY });
  let y = doc.y + 1;
  drawLtr(doc, seller.addressEn, M, y, HALF - 26, { size: 7.5, color: MUTED });
  y = doc.y + 1;
  if (seller.trn) drawLtr(doc, `TRN: ${seller.trn}`, M, y, HALF - 26, { size: 7.5, font: FONTS.semibold, color: MUTED });
  drawRtl(doc, seller.nameAr, W / 2 + 26, 18, HALF - 26, { size: 10.5, font: FONTS.semibold, color: NAVY });
  const ya = drawRtl(doc, seller.addressAr, W / 2 + 26, 38, HALF - 26, { size: 7.5, color: MUTED });
  if (seller.trn) drawRtl(doc, `رقم التسجيل الضريبي: ${seller.trn}`, W / 2 + 26, ya - 2, HALF - 26, { size: 7.5, font: FONTS.semibold, color: MUTED });
  doc.rect(M, 84, INNER, 26).fill("#F1F4F8");
  drawLtr(doc, title.en.toUpperCase(), M + 10, 92, HALF, { size: 11, font: FONTS.bold, color: NAVY });
  drawRtl(doc, title.ar, W / 2, 87, HALF - 10, { size: 11, font: FONTS.bold, color: NAVY });
  return 122;
}

/** A label/value pair printed in both languages on one row: English on the left, Arabic on the right. */
function pair(doc: Doc, y: number, en: string, arLabel: string, value: string, valueAr?: string) {
  const endEn = drawLtr(doc, `${en}: ${value}`, M, y, HALF, { size: 8.5, color: "#1F2937" });
  const endAr = drawRtl(doc, `${arLabel}: ${ar(valueAr ?? value)}`, W / 2 + 8, y - 3, HALF, { size: 8.5, color: "#1F2937" });
  return Math.max(y + 15, endEn + 3, endAr);
}

function footer(doc: Doc, en: string, arText: string) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const fy = H - 46;
    doc.moveTo(M, fy).lineTo(W - M, fy).lineWidth(0.5).strokeColor("#E5E7EB").stroke();
    const endEn = cell(doc, en, M, fy + 8, HALF, { size: 6.5, color: MUTED });
    cell(doc, `Page ${i - range.start + 1} of ${range.count}`, M, endEn + 1, HALF, { size: 6.5, color: MUTED });
    const endAr = drawRtl(doc, arText, W / 2 + 8, fy + 5, HALF, { size: 6.5, color: MUTED });
    drawRtl(doc, `صفحة ${i - range.start + 1} من ${range.count}`, W / 2 + 8, endAr - 3, HALF, { size: 6.5, color: MUTED });
    doc.rect(0, H - 5, W, 5).fill(NAVY);
  }
}

export type InvoicePdfInput = {
  kind: "TAX" | "PROFORMA";
  vatRegistered: boolean;
  number: string;
  issueDate: Date;
  dueDate: Date;
  period: { en: string; ar: string } | null;
  accountCode: string;
  billTo: { name: string; nameAr: string | null; address: string | null; trn: string | null };
  seller: Seller;
  lines: Array<{ descriptionEn: string; descriptionAr: string; quantity: number; unitFils: number; grossFils: number; discountFils: number; netFils: number; vatRateBp: number; vatFils: number; totalFils: number; discountNote: { en: string; ar: string } | null }>;
  totals: { subtotalFils: number; discountFils: number; netFils: number; vatFils: number; totalFils: number; paidFils: number; creditedFils: number };
  bank: { en: string | null; ar: string | null };
  status: { en: string; ar: string } | null;
};

const COLS = [
  { key: "n", w: 16, en: "#", ar: "#" },
  { key: "desc", w: 177, en: "Description", ar: "البيان" },
  { key: "qty", w: 24, en: "Qty", ar: "الكمية" },
  { key: "unit", w: 52, en: "Unit price", ar: "سعر الوحدة" },
  { key: "disc", w: 48, en: "Discount", ar: "الخصم" },
  { key: "net", w: 56, en: "Taxable", ar: "الخاضع" },
  { key: "rate", w: 30, en: "VAT %", ar: "النسبة" },
  { key: "vat", w: 44, en: "VAT", ar: "الضريبة" },
  { key: "total", w: 76, en: "Total AED", ar: "الإجمالي" },
] as const;

function tableHeader(doc: Doc, y: number) {
  doc.rect(M, y, INNER, 26).fill(NAVY);
  let x = M;
  for (const c of COLS) {
    const align = c.key === "desc" || c.key === "n" ? "left" : "right";
    drawLtr(doc, c.en, x + 3, y + 3, c.w - 6, { size: 6.8, font: FONTS.semibold, color: "#FFFFFF", align });
    drawRtl(doc, c.ar, x + 3, y + 12, c.w - 6, { size: 6.3, color: "#DCE6F2" });
    x += c.w;
  }
  return y + 30;
}

export async function renderInvoicePdf(input: InvoicePdfInput, lh: Letterhead | null): Promise<Buffer> {
  const title =
    input.kind === "PROFORMA"
      ? { en: "Proforma invoice", ar: "فاتورة مبدئية" }
      : input.vatRegistered
        ? { en: "Tax invoice", ar: "فاتورة ضريبية" }
        : { en: "Invoice", ar: "فاتورة" };
  const { doc, done } = open(`${title.en} ${input.number}`, input.seller.nameEn);
  let y = header(doc, input.seller, lh, title);
  const iss = day(input.issueDate);
  const due = day(input.dueDate);
  y = pair(doc, y, input.kind === "PROFORMA" ? "Proforma no." : "Invoice no.", input.kind === "PROFORMA" ? "رقم الفاتورة المبدئية" : "رقم الفاتورة", input.number);
  y = pair(doc, y, "Issue date", "تاريخ الإصدار", iss.en, iss.ar);
  y = pair(doc, y, "Due date", "تاريخ الاستحقاق", due.en, due.ar);
  if (input.period) y = pair(doc, y, "Period", "الفترة", input.period.en, input.period.ar);
  y = pair(doc, y, "Account", "رقم الحساب", input.accountCode);

  // Bill to
  y += 4;
  doc.roundedRect(M, y, INNER, 44, 5).lineWidth(0.6).strokeColor("#D9DEE5").stroke();
  drawLtr(doc, "Bill to", M + 10, y + 6, HALF, { size: 7, color: MUTED });
  drawLtr(doc, input.billTo.name, M + 10, y + 16, HALF - 10, { size: 9.5, font: FONTS.semibold, color: NAVY });
  const extra = [input.billTo.address, input.billTo.trn ? `TRN: ${input.billTo.trn}` : null].filter(Boolean).join("  ·  ");
  if (extra) drawLtr(doc, extra, M + 10, y + 30, HALF - 10, { size: 7, color: MUTED });
  drawRtl(doc, "إلى السيد / السادة", W / 2, y + 3, HALF - 2, { size: 7, color: MUTED });
  drawRtl(doc, ar(input.billTo.nameAr || input.billTo.name), W / 2, y + 13, HALF - 2, { size: 9.5, font: FONTS.semibold, color: NAVY });
  if (input.billTo.trn) drawRtl(doc, `رقم التسجيل الضريبي: ${input.billTo.trn}`, W / 2, y + 27, HALF - 2, { size: 7, color: MUTED });
  y += 54;

  y = tableHeader(doc, y);
  const dw = COLS[1].w - 6;
  input.lines.forEach((l, i) => {
    doc.font(FONTS.regular).fontSize(7.4);
    const estimate =
      doc.heightOfString(l.descriptionEn, { width: dw, lineGap: -1 }) +
      rtlHeight(doc, ar(l.descriptionAr), dw, 7.2) +
      (l.discountNote ? (doc.font(FONTS.regular).fontSize(6.4), doc.heightOfString(l.discountNote.en, { width: dw, lineGap: -1 })) : 0) +
      8;
    if (y + estimate > H - 70) {
      doc.addPage({ size: "A4", margin: 0 });
      y = tableHeader(doc, 30);
    }
    let x = M;
    let rowEnd = y;
    const cells: Record<string, string> = {
      n: String(i + 1),
      qty: String(l.quantity),
      unit: num(l.quantity > 1 ? l.unitFils : l.grossFils),
      disc: l.discountFils ? `-${num(l.discountFils)}` : "0.00",
      net: num(l.netFils),
      rate: pctText(l.vatRateBp),
      vat: num(l.vatFils),
      total: num(l.totalFils),
    };
    for (const c of COLS) {
      if (c.key === "desc") {
        // English first, Arabic below it, then the discount note; each starts where the one before ended.
        const afterEn = cell(doc, l.descriptionEn, x + 3, y, dw, { size: 7.4 });
        const afterAr = drawRtl(doc, ar(l.descriptionAr), x + 3, afterEn, dw, { size: 7.2, color: "#374151" });
        rowEnd = Math.max(rowEnd, l.discountNote ? cell(doc, l.discountNote.en, x + 3, afterAr - 2, dw, { size: 6.4, color: MUTED }) : afterAr - 2);
      } else {
        rowEnd = Math.max(rowEnd, cell(doc, cells[c.key], x + 3, y, c.w - 6, { size: 7.4, align: c.key === "n" ? "left" : "right", font: c.key === "total" ? FONTS.semibold : FONTS.regular }));
      }
      x += c.w;
    }
    y = rowEnd + 4;
    doc.moveTo(M, y - 2).lineTo(W - M, y - 2).lineWidth(0.3).strokeColor("#E5E7EB").stroke();
    y += 3;
  });

  // VAT summary per rate and totals
  y += 6;
  if (y > H - 230) {
    doc.addPage({ size: "A4", margin: 0 });
    y = 40;
  }
  const byRate = new Map<number, { net: number; vat: number }>();
  for (const l of input.lines) {
    const r = byRate.get(l.vatRateBp) ?? { net: 0, vat: 0 };
    byRate.set(l.vatRateBp, { net: r.net + l.netFils, vat: r.vat + l.vatFils });
  }
  let vy = y;
  drawLtr(doc, "VAT summary", M, vy, 220, { size: 8, font: FONTS.semibold, color: NAVY });
  drawRtl(doc, "ملخص ضريبة القيمة المضافة", M, vy - 3, 220, { size: 8, font: FONTS.semibold, color: NAVY });
  vy += 14;
  for (const [rate, v] of [...byRate.entries()].sort((a, b) => b[0] - a[0])) {
    drawLtr(doc, `${rate ? `Standard rated ${pctText(rate)}` : "Zero rated, exempt or out of scope"}: taxable ${num(v.net)}, VAT ${num(v.vat)}`, M, vy, 220, { size: 7, color: "#374151" });
    drawRtl(doc, `${rate ? `خاضع بنسبة ${pctText(rate)}` : "نسبة صفرية أو معفى أو خارج النطاق"}، المبلغ الخاضع ${num(v.net)}، الضريبة ${num(v.vat)}`, M, vy + 9, 220, { size: 6.8, color: "#374151" });
    vy += 24;
  }

  const tx = M + INNER - 250;
  const rows: Array<{ en: string; ar: string; v: number; bold?: boolean; neg?: boolean }> = [
    { en: "Subtotal", ar: "المجموع الفرعي", v: input.totals.subtotalFils },
    { en: "Discounts", ar: "الخصومات", v: input.totals.discountFils, neg: true },
    { en: "Total taxable amount", ar: "إجمالي المبلغ الخاضع", v: input.totals.netFils },
    { en: "Total VAT", ar: "إجمالي الضريبة", v: input.totals.vatFils },
    { en: "Total (AED)", ar: "الإجمالي بالدرهم", v: input.totals.totalFils, bold: true },
  ];
  if (input.kind === "TAX" && (input.totals.paidFils || input.totals.creditedFils)) {
    rows.push({ en: "Paid", ar: "المدفوع", v: input.totals.paidFils, neg: true });
    if (input.totals.creditedFils) rows.push({ en: "Credited", ar: "المبالغ الدائنة", v: input.totals.creditedFils, neg: true });
    rows.push({ en: "Balance due (AED)", ar: "الرصيد المستحق بالدرهم", v: input.totals.totalFils - input.totals.paidFils - input.totals.creditedFils, bold: true });
  }
  let ty = y;
  for (const r of rows) {
    if (r.bold) doc.rect(tx, ty - 3, 250, 17).fill("#F1F4F8");
    drawLtr(doc, r.en, tx + 6, ty, 100, { size: 8, font: r.bold ? FONTS.bold : FONTS.regular, color: NAVY });
    drawRtl(doc, r.ar, tx + 96, ty - 3, 80, { size: 7.6, font: r.bold ? FONTS.bold : FONTS.regular, color: NAVY });
    drawLtr(doc, `${r.neg && r.v ? "-" : ""}${num(r.v)}`, tx + 176, ty, 68, { size: 8, font: r.bold ? FONTS.bold : FONTS.semibold, color: "#111827", align: "right" });
    ty += 17;
  }
  y = Math.max(vy, ty) + 10;

  if (input.status) {
    drawLtr(doc, input.status.en, M, y, HALF, { size: 8, font: FONTS.semibold, color: NAVY });
    drawRtl(doc, ar(input.status.ar), W / 2 + 8, y - 3, HALF, { size: 8, font: FONTS.semibold, color: NAVY });
    y += 16;
  }
  if (input.bank.en || input.bank.ar) {
    if (y > H - 110) {
      doc.addPage({ size: "A4", margin: 0 });
      y = 40;
    }
    drawLtr(doc, "Payment details", M, y, HALF, { size: 7.5, font: FONTS.semibold, color: NAVY });
    drawRtl(doc, "بيانات الدفع", W / 2 + 8, y - 3, HALF, { size: 7.5, font: FONTS.semibold, color: NAVY });
    drawLtr(doc, input.bank.en ?? "", M, y + 11, HALF, { size: 7, color: "#374151" });
    drawRtl(doc, ar(input.bank.ar ?? input.bank.en ?? ""), W / 2 + 8, y + 8, HALF, { size: 7, color: "#374151" });
  }
  const note =
    input.kind === "PROFORMA"
      ? { en: "This proforma is a request for payment, not a tax invoice. A tax invoice is issued when it is paid.", ar: "هذه فاتورة مبدئية لطلب الدفع وليست فاتورة ضريبية، وتصدر الفاتورة الضريبية عند السداد." }
      : { en: `Computer generated ${title.en.toLowerCase()} ${input.number}. Amounts in UAE dirhams (AED).`, ar: `${title.ar} صادرة إلكترونيًا رقم ${input.number}. المبالغ بالدرهم الإماراتي.` };
  footer(doc, note.en, note.ar);
  doc.end();
  return done;
}

export type CreditNotePdfInput = {
  number: string;
  issueDate: Date;
  invoiceNumber: string;
  invoiceDate: Date;
  reason: { en: string; ar: string };
  accountCode: string;
  billTo: { name: string; nameAr: string | null; trn: string | null };
  seller: Seller;
  vatRegistered: boolean;
  lines: Array<{ descriptionEn: string; descriptionAr: string; netFils: number; vatRateBp: number; vatFils: number; totalFils: number }>;
  totals: { netFils: number; vatFils: number; totalFils: number };
};

export async function renderCreditNotePdf(input: CreditNotePdfInput, lh: Letterhead | null): Promise<Buffer> {
  const title = input.vatRegistered ? { en: "Tax credit note", ar: "إشعار دائن ضريبي" } : { en: "Credit note", ar: "إشعار دائن" };
  const { doc, done } = open(`${title.en} ${input.number}`, input.seller.nameEn);
  let y = header(doc, input.seller, lh, title);
  const iss = day(input.issueDate);
  const inv = day(input.invoiceDate);
  y = pair(doc, y, "Credit note no.", "رقم الإشعار", input.number);
  y = pair(doc, y, "Issue date", "تاريخ الإصدار", iss.en, iss.ar);
  y = pair(doc, y, "Original invoice", "الفاتورة الأصلية", `${input.invoiceNumber} of ${inv.en}`, `${input.invoiceNumber} بتاريخ ${inv.ar}`);
  y = pair(doc, y, "Account", "رقم الحساب", input.accountCode);
  y = pair(doc, y, "Customer", "العميل", input.billTo.name, input.billTo.nameAr || input.billTo.name);
  if (input.billTo.trn) y = pair(doc, y, "Customer TRN", "الرقم الضريبي للعميل", input.billTo.trn);
  y = pair(doc, y, "Reason", "السبب", input.reason.en, input.reason.ar);
  y += 8;
  doc.rect(M, y, INNER, 22).fill(NAVY);
  const cw = [263, 70, 50, 60, 80];
  const heads = [
    { en: "Description", ar: "البيان" },
    { en: "Taxable", ar: "الخاضع" },
    { en: "VAT %", ar: "النسبة" },
    { en: "VAT", ar: "الضريبة" },
    { en: "Total AED", ar: "الإجمالي" },
  ];
  let x = M;
  heads.forEach((h, i) => {
    drawLtr(doc, h.en, x + 4, y + 3, cw[i] - 8, { size: 6.8, font: FONTS.semibold, color: "#FFFFFF", align: i === 0 ? "left" : "right" });
    drawRtl(doc, h.ar, x + 4, y + 10, cw[i] - 8, { size: 6.2, color: "#DCE6F2" });
    x += cw[i];
  });
  y += 28;
  for (const l of input.lines) {
    doc.font(FONTS.regular).fontSize(7.4);
    const estimate = doc.heightOfString(l.descriptionEn, { width: cw[0] - 8, lineGap: -1 }) + rtlHeight(doc, ar(l.descriptionAr), cw[0] - 8, 7.2) + 10;
    if (y + estimate > H - 130) {
      doc.addPage({ size: "A4", margin: 0 });
      y = 40;
    }
    x = M;
    const afterEn = cell(doc, l.descriptionEn, x + 4, y, cw[0] - 8, { size: 7.4 });
    let rowEnd = drawRtl(doc, ar(l.descriptionAr), x + 4, afterEn, cw[0] - 8, { size: 7.2, color: "#374151" }) - 2;
    const vals = [num(l.netFils), pctText(l.vatRateBp), num(l.vatFils), num(l.totalFils)];
    x += cw[0];
    vals.forEach((v, i) => {
      rowEnd = Math.max(rowEnd, cell(doc, v, x + 4, y, cw[i + 1] - 8, { size: 7.4, align: "right" }));
      x += cw[i + 1];
    });
    y = rowEnd + 4;
    doc.moveTo(M, y - 2).lineTo(W - M, y - 2).lineWidth(0.3).strokeColor("#E5E7EB").stroke();
    y += 5;
  }
  y += 6;
  const tx = M + INNER - 250;
  for (const r of [
    { en: "Total taxable credited", ar: "إجمالي المبلغ الخاضع الدائن", v: input.totals.netFils },
    { en: "VAT credited", ar: "الضريبة الدائنة", v: input.totals.vatFils },
    { en: "Total credited (AED)", ar: "إجمالي المبلغ الدائن بالدرهم", v: input.totals.totalFils, bold: true },
  ]) {
    if (r.bold) doc.rect(tx, y - 3, 250, 17).fill("#F1F4F8");
    drawLtr(doc, r.en, tx + 6, y, 110, { size: 8, font: r.bold ? FONTS.bold : FONTS.regular, color: NAVY });
    drawRtl(doc, r.ar, tx + 100, y - 3, 84, { size: 7.4, font: r.bold ? FONTS.bold : FONTS.regular, color: NAVY });
    drawLtr(doc, num(r.v), tx + 186, y, 58, { size: 8, font: FONTS.semibold, align: "right" });
    y += 17;
  }
  footer(doc, `Computer generated credit note ${input.number} against invoice ${input.invoiceNumber}.`, `إشعار دائن صادر إلكترونيًا رقم ${input.number} على الفاتورة ${input.invoiceNumber}.`);
  doc.end();
  return done;
}

export type ReceiptPdfInput = {
  number: string;
  date: Date;
  accountCode: string;
  receivedFrom: { en: string; ar: string };
  seller: Seller;
  amountFils: number;
  method: { en: string; ar: string };
  reference: string | null;
  allocations: Array<{ invoiceNumber: string; amountFils: number }>;
  unallocatedFils: number;
  bounced: boolean;
};

export async function renderReceiptPdf(input: ReceiptPdfInput, lh: Letterhead | null): Promise<Buffer> {
  const { doc, done } = open(`Receipt ${input.number}`, input.seller.nameEn);
  let y = header(doc, input.seller, lh, { en: "Payment receipt", ar: "إيصال استلام" });
  const d = day(input.date);
  y = pair(doc, y, "Receipt no.", "رقم الإيصال", input.number);
  y = pair(doc, y, "Date", "التاريخ", d.en, d.ar);
  y = pair(doc, y, "Account", "رقم الحساب", input.accountCode);
  y = pair(doc, y, "Received from", "استلمنا من", input.receivedFrom.en, input.receivedFrom.ar);
  y = pair(doc, y, "Method", "طريقة الدفع", input.method.en, input.method.ar);
  if (input.reference) y = pair(doc, y, "Reference", "المرجع", input.reference);
  y += 6;
  doc.roundedRect(M, y, INNER, 46, 6).fill("#F1F4F8");
  drawLtr(doc, "Amount received", M + 12, y + 8, HALF, { size: 8, color: MUTED });
  drawLtr(doc, `AED ${num(input.amountFils)}`, M + 12, y + 20, HALF, { size: 15, font: FONTS.bold, color: NAVY });
  drawRtl(doc, "المبلغ المستلم", W / 2, y + 4, HALF - 10, { size: 8, color: MUTED });
  drawRtl(doc, `${num(input.amountFils)} درهم`, W / 2, y + 17, HALF - 10, { size: 15, font: FONTS.bold, color: NAVY });
  y += 60;
  drawLtr(doc, "Applied to", M, y, HALF, { size: 8.5, font: FONTS.semibold, color: NAVY });
  drawRtl(doc, "خُصم المبلغ من", W / 2 + 8, y - 3, HALF, { size: 8.5, font: FONTS.semibold, color: NAVY });
  y += 16;
  if (!input.allocations.length) {
    drawLtr(doc, "Held as credit on the family account.", M, y, INNER, { size: 8 });
    y += 14;
  }
  for (const a of input.allocations) {
    drawLtr(doc, `Invoice ${a.invoiceNumber}`, M, y, HALF, { size: 8 });
    drawLtr(doc, num(a.amountFils), M, y, INNER, { size: 8, align: "right", font: FONTS.semibold });
    drawRtl(doc, `الفاتورة ${a.invoiceNumber}`, W / 2 - 60, y - 3, HALF - 40, { size: 8 });
    y += 15;
  }
  if (input.unallocatedFils > 0 && input.allocations.length) {
    drawLtr(doc, "Credit on the family account", M, y, HALF, { size: 8 });
    drawLtr(doc, num(input.unallocatedFils), M, y, INNER, { size: 8, align: "right", font: FONTS.semibold });
    drawRtl(doc, "رصيد دائن في حساب الأسرة", W / 2 - 60, y - 3, HALF - 40, { size: 8 });
    y += 15;
  }
  if (input.bounced) {
    y += 8;
    drawLtr(doc, "This cheque was returned unpaid. The receipt is cancelled.", M, y, INNER, { size: 9, font: FONTS.bold, color: "#B91C1C" });
    drawRtl(doc, "أُعيد هذا الشيك دون صرف، وأُلغي هذا الإيصال.", M, y + 12, INNER, { size: 9, font: FONTS.bold, color: "#B91C1C" });
  }
  footer(doc, `Computer generated receipt ${input.number}. Thank you.`, `إيصال صادر إلكترونيًا رقم ${input.number}. شكرًا لكم.`);
  doc.end();
  return done;
}
