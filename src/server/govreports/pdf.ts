// Summary PDF of a return, in English or Arabic, on the school's letterhead, with the principal's sign-off.
// Aggregate tables only: no names, no identifiers, no health details. Arabic is shaped and laid out right to left
// with the shared helpers (src/server/documents/pdf.ts).
import { drawLtr, drawRtl, drawSchoolMark, FONTS, GOLD, MUTED, NAVY, newPdf, type Letterhead } from "@/server/documents/pdf";
import { gt, type Loc } from "./labels";
import { cellValue, type Table } from "./table";

type Doc = PDFKit.PDFDocument;

export type SummaryPdfInput = {
  loc: Loc;
  title: string;
  authority: string;
  period: string;
  version: number;
  dataSha256: string;
  generatedAt: Date;
  generatedBy: string;
  problems: number;
  tables: Table[];
  signOff: { name: string; title: string | null; at: string; stale: boolean } | null;
  letterhead: Letterhead;
};

const INK = "#1F2937";
const LINE = "#D9DEE5";

export async function renderSummaryPdf(d: SummaryPdfInput): Promise<Buffer> {
  const ar = d.loc === "ar";
  const doc = newPdf({ size: "A4", margin: 0, info: { Title: d.title, Author: d.letterhead.school.en } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  const W = doc.page.width;
  const H = doc.page.height;
  const M = 40;
  const inner = W - M * 2;
  const t = (key: string, v?: Record<string, string | number>) => gt(d.loc, key, v);
  /** Paragraph text at the reading edge of the language. */
  const text = (s: string, x: number, y: number, w: number, o: { size: number; font?: string; color?: string; align?: "center" }) => (ar ? drawRtl(doc, s, x, y, w, o) : drawLtr(doc, s, x, y, w, o));

  let page = 1;
  const header = () => {
    doc.rect(0, 0, W, 8).fill(NAVY);
    doc.rect(0, 8, W, 2).fill(GOLD);
    const markX = ar ? W - M - 36 : M;
    drawSchoolMark(doc, markX, 22, 36, { logo: d.letterhead.logo, name: d.letterhead.shortEn });
    const tx = ar ? M : M + 46;
    text(ar ? d.letterhead.school.ar : d.letterhead.school.en, tx, ar ? 18 : 24, inner - 46, { size: 11, font: FONTS.semibold, color: NAVY });
    text(ar ? d.letterhead.address.ar : d.letterhead.address.en, tx, ar ? 36 : 40, inner - 46, { size: 7.5, color: MUTED });
    doc.moveTo(M, 68).lineTo(W - M, 68).lineWidth(0.6).strokeColor(LINE).stroke();
  };
  const footer = () => {
    const fy = H - 40;
    doc.moveTo(M, fy).lineTo(W - M, fy).lineWidth(0.5).strokeColor("#E5E7EB").stroke();
    text(t("pdf.footer", { page, version: d.version }), M, fy + (ar ? 2 : 6), inner, { size: 6.5, color: MUTED });
    doc.rect(0, H - 6, W, 6).fill(NAVY);
  };
  const newPage = () => {
    footer();
    doc.addPage();
    page++;
    header();
    return 80;
  };
  const room = (y: number, need: number) => (y + need > H - 56 ? newPage() : y);

  header();
  let y = 80;
  y = text(d.title, M, y, inner, { size: 16, font: FONTS.bold, color: NAVY }) + (ar ? 0 : 4);
  const meta = [
    `${t("pdf.authority")}: ${d.authority}`,
    `${t("pdf.period")}: ${d.period}`,
    `${t("pdf.version")}: ${d.version}    ${t("pdf.checksum")}: ${d.dataSha256.slice(0, 16)}`,
    `${t("pdf.generated")}: ${d.generatedBy}, ${new Intl.DateTimeFormat(ar ? "ar-AE-u-nu-latn" : "en-GB", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" }).format(d.generatedAt)}`,
  ];
  for (const line of meta) y = text(line, M, y, inner, { size: 8.5, color: MUTED });
  y += 6;

  // Format notice: there is no published format, so the layout is Horizon's own.
  const box = (body: string, fill: string, ink: string) => {
    doc.font(FONTS.regular).fontSize(8);
    const h = (ar ? doc.heightOfString(body, { width: inner - 20 }) * 1.5 : doc.heightOfString(body, { width: inner - 20, lineGap: 3.6 })) + 14;
    y = room(y, h + 8);
    doc.roundedRect(M, y, inner, h, 6).fill(fill);
    text(body, M + 10, y + (ar ? 3 : 7), inner - 20, { size: 8, color: ink });
    y += h + 8;
  };
  box(t("pdf.formatNotice", { authority: d.authority }), "#EEF3FA", NAVY);
  if (d.problems > 0) box(t("pdf.problemsWarning", { n: d.problems }), "#FFF3D6", "#6B4E00");

  for (const tb of d.tables) {
    y = room(y, 70);
    y = text(ar ? tb.title.ar : tb.title.en, M, y + 4, inner, { size: 11, font: FONTS.semibold, color: NAVY }) + 2;
    y = drawTable(doc, tb, d.loc, M, y, inner, () => newPage(), H - 56);
    if (tb.note) y = text(ar ? tb.note.ar : tb.note.en, M, y + 2, inner, { size: 7.5, color: MUTED });
    y += 10;
  }

  // Sign-off
  y = room(y, 120);
  y = text(t("pdf.signOff"), M, y + 6, inner, { size: 11, font: FONTS.semibold, color: NAVY }) + 4;
  if (d.signOff) {
    const who = d.signOff.title ? `${d.signOff.name}, ${d.signOff.title}` : d.signOff.name;
    y = text(t("pdf.signedBy", { who, date: d.signOff.at }), M, y, inner, { size: 10, color: INK });
    if (d.signOff.stale) y = text(t("pdf.signOffStale"), M, y + 2, inner, { size: 8.5, color: "#B42318" });
  } else {
    y = text(t("pdf.notSigned"), M, y, inner, { size: 9, color: MUTED });
  }
  y += 22;
  const third = (inner - 40) / 3;
  const labels = [t("pdf.name"), t("pdf.signature"), t("pdf.date")];
  labels.forEach((l, i) => {
    const x = ar ? M + inner - (i + 1) * third - i * 20 : M + i * (third + 20);
    doc.moveTo(x, y + 18).lineTo(x + third, y + 18).lineWidth(0.7).strokeColor("#9AA5B4").stroke();
    text(l, x, y + 22, third, { size: 8, color: MUTED });
    if (d.signOff && i !== 1) text(i === 0 ? d.signOff.name : d.signOff.at, x, ar ? y - 2 : y + 4, third, { size: 9, color: INK });
  });
  footer();
  doc.end();
  return done;
}

/** A table with a header band, light row stripes and a bold total row. Arabic tables run right to left. */
function drawTable(doc: Doc, tb: Table, loc: Loc, x: number, y: number, width: number, newPage: () => number, bottom: number): number {
  const ar = loc === "ar";
  const n = tb.columns.length;
  const weights = tb.columns.map((c, i) => (i === 0 ? 2.4 : c.num ? 1 : 1.6));
  const sum = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => (w / sum) * width);
  const xs: number[] = [];
  let acc = 0;
  for (let i = 0; i < n; i++) {
    xs.push(ar ? x + width - acc - widths[i] : x + acc);
    acc += widths[i];
  }
  const headH = 26;
  const rowH = 17;
  const fit = (s: string, w: number, font: string, size: number) => {
    doc.font(font).fontSize(size);
    if (doc.widthOfString(s) <= w) return s;
    let out = s;
    while (out.length > 1 && doc.widthOfString(`${out}…`) > w) out = out.slice(0, -1);
    return `${out}…`;
  };
  const head = (yy: number) => {
    doc.rect(x, yy, width, headH).fill("#E8EEF6");
    tb.columns.forEach((c, i) => {
      const label = ar ? c.label.ar : c.label.en;
      if (ar) drawRtl(doc, label, xs[i] + 3, yy + 3, widths[i] - 6, { size: 6.8, font: FONTS.semibold, color: NAVY, align: c.num ? "center" : undefined });
      else drawLtr(doc, label, xs[i] + 3, yy + 4, widths[i] - 6, { size: 6.8, font: FONTS.semibold, color: NAVY, align: c.num ? "center" : undefined });
    });
    return yy + headH;
  };
  if (!tb.rows.length) {
    y = head(y);
    const msg = gt(loc, "pdf.noRows");
    if (ar) drawRtl(doc, msg, x + 6, y + 1, width - 12, { size: 8, color: MUTED });
    else drawLtr(doc, msg, x + 6, y + 4, width - 12, { size: 8, color: MUTED });
    return y + rowH + 2;
  }
  y = head(y);
  tb.rows.forEach((r, ri) => {
    if (y + rowH > bottom) y = head(newPage());
    const total = tb.totalRow && ri === tb.rows.length - 1;
    if (ri % 2 === 1 || total) doc.rect(x, y, width, rowH).fill(total ? "#F1F4F8" : "#FAFBFC");
    r.forEach((c, i) => {
      const v = cellValue(c, loc, undefined, { present: gt(loc, "present"), missing: gt(loc, "missing") });
      const font = total || i === 0 ? FONTS.semibold : FONTS.regular;
      const s = typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(1)) : String(v);
      const w = widths[i] - 6;
      const txt = fit(s, w, font, 7.5);
      const rtlText = ar && typeof v !== "number" && /[؀-ۿ]/.test(txt);
      if (rtlText) drawRtl(doc, txt, xs[i] + 3, y + 3, w, { size: 7.5, font, color: INK, align: tb.columns[i].num ? "center" : undefined });
      else drawLtr(doc, txt, xs[i] + 3, y + 4, w, { size: 7.5, font, color: INK, align: tb.columns[i].num || ar ? "center" : undefined });
    });
    y += rowH;
  });
  doc.moveTo(x, y).lineTo(x + width, y).lineWidth(0.5).strokeColor(LINE).stroke();
  return y + 2;
}
