// Letter PDF generation with correct Arabic shaping and right-to-left layout.
// fontkit (used by pdfkit) shapes Arabic glyphs and reverses RTL runs; this module adds the bidi
// step pdfkit lacks: it wraps lines itself and places mixed Arabic / Latin / number runs in visual order.
import PDFDocument from "pdfkit";
import path from "node:path";
import { applyMerge } from "./merge";

const FONT_DIR = path.join(process.cwd(), "assets", "fonts");
export const FONTS = {
  regular: path.join(FONT_DIR, "IBMPlexSansArabic-Regular.ttf"),
  semibold: path.join(FONT_DIR, "IBMPlexSansArabic-SemiBold.ttf"),
  bold: path.join(FONT_DIR, "IBMPlexSansArabic-Bold.ttf"),
};

const NAVY = "#123A63";
const GOLD = "#C8A24A";
const MUTED = "#5B6778";


type Doc = PDFKit.PDFDocument;

export const ARABIC_LETTER_RE = /[\u0621-\u064A\u066E-\u06D3\u06D5\u06FA-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFC\u064B-\u065F\u0670]/;
const LTR_CHAR_RE = /[A-Za-z0-9\u00C0-\u024F\u0660-\u0669\u06F0-\u06F9]/;

/**
 * Split a line of an RTL paragraph into directional runs (a small subset of the Unicode bidi algorithm):
 * Arabic letters are R, Latin letters and digits are L, everything else is neutral. Neutrals between two
 * runs of the same direction join them; otherwise they take the paragraph direction (R).
 */
function runs(line: string): Array<{ text: string; rtl: boolean }> {
  const chars = [...line];
  const cls = chars.map((c) => (ARABIC_LETTER_RE.test(c) ? "R" : LTR_CHAR_RE.test(c) ? "L" : "N"));
  for (let i = 0; i < cls.length; i++) {
    if (cls[i] !== "N") continue;
    let j = i;
    while (j < cls.length && cls[j] === "N") j++;
    const before = i > 0 ? cls[i - 1] : "R";
    const after = j < cls.length ? cls[j] : "R";
    const resolved = before === after ? before : "R";
    for (let k = i; k < j; k++) cls[k] = resolved;
    i = j - 1;
  }
  const out: Array<{ text: string; rtl: boolean }> = [];
  chars.forEach((c, i) => {
    const rtl = cls[i] === "R";
    const last = out[out.length - 1];
    if (last && last.rtl === rtl) last.text += c;
    else out.push({ text: c, rtl });
  });
  return out;
}

function wrap(doc: Doc, text: string, width: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    if (!para.trim()) {
      lines.push("");
      continue;
    }
    let cur = "";
    for (const word of para.split(/\s+/)) {
      const next = cur ? `${cur} ${word}` : word;
      if (doc.widthOfString(next) > width && cur) {
        lines.push(cur);
        cur = word;
      } else cur = next;
    }
    lines.push(cur);
  }
  return lines;
}

/** Draw one right-to-left paragraph block. Returns the y after the block. */
export function drawRtl(doc: Doc, text: string, x: number, y: number, width: number, opts: { size: number; font?: string; color?: string; lineGap?: number; align?: "right" | "center" }) {
  doc.font(opts.font ?? FONTS.regular).fontSize(opts.size).fillColor(opts.color ?? "#1F2937");
  const lineHeight = opts.size * 1.75 + (opts.lineGap ?? 0);
  for (const line of wrap(doc, text, width)) {
    if (!line) {
      y += lineHeight * 0.6;
      continue;
    }
    const parts = runs(line.trim());
    // An RTL run is shaped and reversed by fontkit; an LTR run is drawn as is.
    const total = parts.reduce((s, p) => s + doc.widthOfString(p.text), 0);
    let cursor = opts.align === "center" ? x + (width + total) / 2 : x + width;
    for (const p of parts) {
      const w = doc.widthOfString(p.text);
      cursor -= w;
      doc.text(p.text, cursor, y, { lineBreak: false, features: p.rtl ? ["rlig", "calt", "liga"] : undefined });
    }
    y += lineHeight;
  }
  return y;
}

export function drawLtr(doc: Doc, text: string, x: number, y: number, width: number, opts: { size: number; font?: string; color?: string; align?: "left" | "center" | "right" }) {
  doc.font(opts.font ?? FONTS.regular).fontSize(opts.size).fillColor(opts.color ?? "#1F2937");
  doc.text(text, x, y, { width, align: opts.align ?? "left", lineGap: opts.size * 0.45 });
  return doc.y;
}

export type LetterInput = {
  output: "EN" | "AR" | "BILINGUAL";
  school: { en: string; ar: string };
  title: { en: string; ar: string };
  reference: string;
  bodyEn: string;
  bodyAr: string;
  merge: { en: Record<string, string>; ar: Record<string, string> };
  signatory: { en: string; ar: string };
  signerName?: { en: string; ar: string } | null;
  issuedAt: Date;
  verifyNote?: { en: string; ar: string };
};

function dates(d: Date) {
  const g = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Dubai" }).format(d);
  const ga = new Intl.DateTimeFormat("ar-AE-u-nu-latn", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Dubai" }).format(d);
  const h = new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura-nu-latn", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Dubai" }).format(d);
  return { g, ga, h };
}

export async function renderLetterPdf(input: LetterInput): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 0, info: { Title: `${input.title.en} ${input.reference}`, Author: input.school.en } });
  doc.registerFont("regular", FONTS.regular);
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  const W = doc.page.width;
  const M = 56;
  const inner = W - M * 2;

  // Letterhead
  doc.rect(0, 0, W, 8).fill(NAVY);
  doc.rect(0, 8, W, 2).fill(GOLD);
  doc.roundedRect(W / 2 - 20, 34, 40, 40, 8).fill(NAVY);
  doc.font(FONTS.bold).fontSize(20).fillColor("#E9C46A").text("H", W / 2 - 20, 42, { width: 40, align: "center" });
  drawLtr(doc, input.school.en, M, 42, inner / 2 - 30, { size: 12, font: FONTS.semibold, color: NAVY });
  drawLtr(doc, "Al Barsha South, Dubai, United Arab Emirates", M, 60, inner / 2 - 30, { size: 8, color: MUTED });
  drawRtl(doc, input.school.ar, W / 2 + 30, 38, inner / 2 - 30, { size: 12, font: FONTS.semibold, color: NAVY });
  drawRtl(doc, "البرشاء جنوب، دبي، الإمارات العربية المتحدة", W / 2 + 30, 58, inner / 2 - 30, { size: 8, color: MUTED });
  doc.moveTo(M, 92).lineTo(W - M, 92).lineWidth(0.6).strokeColor("#D9DEE5").stroke();

  // Reference and dates
  const d = dates(input.issuedAt);
  drawLtr(doc, `Ref: ${input.reference}`, M, 104, inner / 2, { size: 9, color: MUTED });
  drawLtr(doc, `Date: ${d.g}`, M, 118, inner / 2, { size: 9, color: MUTED });
  drawRtl(doc, `الرقم المرجعي: ${input.reference}`, W / 2, 100, inner / 2, { size: 9, color: MUTED });
  drawRtl(doc, `التاريخ: ${d.ga} الموافق ${d.h}`, W / 2, 116, inner / 2, { size: 9, color: MUTED });

  const bodyEn = applyMerge(input.bodyEn, input.merge.en);
  const bodyAr = applyMerge(input.bodyAr, input.merge.ar);
  let y = 158;

  if (input.output === "BILINGUAL") {
    const colW = (inner - 28) / 2;
    drawLtr(doc, input.title.en, M, y, colW, { size: 15, font: FONTS.bold, color: NAVY });
    drawRtl(doc, input.title.ar, M + colW + 28, y - 4, colW, { size: 15, font: FONTS.bold, color: NAVY });
    y += 36;
    doc.moveTo(W / 2, y - 6).lineTo(W / 2, 690).lineWidth(0.5).strokeColor("#E5E7EB").stroke();
    const yEn = drawLtr(doc, bodyEn, M, y, colW, { size: 10 });
    const yAr = drawRtl(doc, bodyAr, M + colW + 28, y - 4, colW, { size: 10 });
    y = Math.max(yEn, yAr) + 30;
  } else if (input.output === "EN") {
    drawLtr(doc, input.title.en, M, y, inner, { size: 17, font: FONTS.bold, color: NAVY });
    y = drawLtr(doc, bodyEn, M, y + 40, inner, { size: 11 }) + 34;
  } else {
    drawRtl(doc, input.title.ar, M, y - 4, inner, { size: 17, font: FONTS.bold, color: NAVY });
    y = drawRtl(doc, bodyAr, M, y + 36, inner, { size: 11 }) + 30;
  }

  // Signature block
  y = Math.max(y, 560);
  const sigW = input.output === "BILINGUAL" ? (inner - 28) / 2 : inner;
  if (input.output !== "AR") {
    doc.moveTo(M, y + 34).lineTo(M + 170, y + 34).lineWidth(0.6).strokeColor("#9CA3AF").stroke();
    if (input.signerName) drawLtr(doc, input.signerName.en, M, y + 40, sigW, { size: 10, font: FONTS.semibold });
    drawLtr(doc, input.signatory.en, M, y + (input.signerName ? 56 : 40), sigW, { size: 9, color: MUTED });
  }
  if (input.output !== "EN") {
    const x0 = input.output === "BILINGUAL" ? M + sigW + 28 : M;
    doc.moveTo(x0 + sigW - 170, y + 34).lineTo(x0 + sigW, y + 34).lineWidth(0.6).strokeColor("#9CA3AF").stroke();
    if (input.signerName) drawRtl(doc, input.signerName.ar, x0, y + 36, sigW, { size: 10, font: FONTS.semibold });
    drawRtl(doc, input.signatory.ar, x0, y + (input.signerName ? 54 : 38), sigW, { size: 9, color: MUTED });
  }
  // School seal
  doc.circle(W / 2, y + 44, 30).lineWidth(1.2).strokeColor(GOLD).stroke();
  doc.circle(W / 2, y + 44, 25).lineWidth(0.5).strokeColor(GOLD).stroke();
  doc.font(FONTS.semibold).fontSize(7).fillColor(GOLD).text("HORIZON", W / 2 - 30, y + 36, { width: 60, align: "center" });
  doc.font(FONTS.regular).fontSize(6).fillColor(GOLD).text("DUBAI", W / 2 - 30, y + 46, { width: 60, align: "center" });

  // Footer
  const fy = doc.page.height - 58;
  doc.moveTo(M, fy).lineTo(W - M, fy).lineWidth(0.5).strokeColor("#E5E7EB").stroke();
  drawLtr(doc, input.verifyNote?.en ?? `Verify this document with the Registrar's Office quoting ${input.reference}. Generated by Horizon OS.`, M, fy + 10, inner / 2 - 10, { size: 7, color: MUTED });
  drawRtl(doc, input.verifyNote?.ar ?? `للتحقق من هذا المستند يُرجى التواصل مع مكتب التسجيل وذكر الرقم ${input.reference}.`, W / 2 + 10, fy + 6, inner / 2 - 10, { size: 7, color: MUTED });
  doc.rect(0, doc.page.height - 6, W, 6).fill(NAVY);

  doc.end();
  return done;
}

/** A simple placeholder PDF for sample uploaded documents in the demo. */
export async function renderSamplePdf(title: { en: string; ar: string }, subtitle: { en: string; ar: string }): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 0 });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  const W = doc.page.width;
  doc.rect(0, 0, W, 8).fill(NAVY);
  drawLtr(doc, title.en, 56, 80, W / 2 - 70, { size: 18, font: FONTS.bold, color: NAVY });
  drawLtr(doc, subtitle.en, 56, 110, W / 2 - 70, { size: 10, color: MUTED });
  drawRtl(doc, title.ar, W / 2 + 14, 76, W / 2 - 70, { size: 18, font: FONTS.bold, color: NAVY });
  drawRtl(doc, subtitle.ar, W / 2 + 14, 108, W / 2 - 70, { size: 10, color: MUTED });
  doc.roundedRect(56, 170, W - 112, 420, 10).lineWidth(0.8).dash(4, { space: 4 }).strokeColor("#CBD5E1").stroke();
  drawLtr(doc, "Sample document for the demo school. The original file is stored securely in document storage.", 90, 360, W - 180, { size: 10, color: MUTED, align: "center" });
  drawRtl(doc, "مستند نموذجي للمدرسة التجريبية، والملف الأصلي محفوظ بأمان في مخزن المستندات.", 90, 390, W - 180, { size: 10, color: MUTED, align: "center" });
  doc.end();
  return done;
}

/** Case chronology export: every action, decision and contact with timestamps. */
export async function renderChronologyPdf(input: { title: string; subtitle: string; rows: Array<{ when: string; who: string; kind: string; text: string }>; footer: string }): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 48, info: { Title: input.title } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  const W = doc.page.width - 96;
  doc.font(FONTS.bold).fontSize(15).fillColor(NAVY).text(input.title, 48, 48, { width: W });
  doc.font(FONTS.regular).fontSize(9).fillColor(MUTED).text(input.subtitle, { width: W });
  doc.moveDown(0.8);
  for (const r of input.rows) {
    if (doc.y > doc.page.height - 110) doc.addPage();
    doc.font(FONTS.semibold).fontSize(9).fillColor(NAVY).text(`${r.when}  ·  ${r.kind}  ·  ${r.who}`, { width: W });
    const isRtl = ARABIC_LETTER_RE.test(r.text);
    if (isRtl) {
      const y = drawRtl(doc, r.text, 48, doc.y, W, { size: 9 });
      doc.y = y;
    } else {
      doc.font(FONTS.regular).fontSize(9).fillColor("#1F2937").text(r.text, { width: W });
    }
    doc.moveDown(0.6);
  }
  doc.font(FONTS.regular).fontSize(7).fillColor(MUTED).text(input.footer, 48, doc.page.height - 40, { width: W });
  doc.end();
  return done;
}

/** Shared drawing helpers for other bilingual PDFs (for example term report cards). */
export { drawRtl, drawLtr, FONTS, NAVY, GOLD, MUTED, ARABIC_LETTER_RE };
