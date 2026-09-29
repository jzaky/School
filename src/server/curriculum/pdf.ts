// Printable lesson plan with the session laid out minute by minute. Arabic is shaped and laid out right to left.
import PDFDocument from "pdfkit";
import { drawLtr, drawRtl, FONTS } from "@/server/documents/pdf";

const NAVY = "#123A63";
const GOLD = "#C8A24A";
const MUTED = "#5B6778";

export type LessonPdfInput = {
  rtl: boolean;
  school: string;
  title: string;
  subtitle: string;
  meta: Array<[string, string]>;
  sections: Array<{ heading: string; lines: string[] }>;
  session: { heading: string; rows: Array<{ time: string; phase: string; title: string; detail: string }> };
  footer: string;
};

export async function renderLessonPlanPdf(input: LessonPdfInput): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 0, bufferPages: true, info: { Title: input.title } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  const W = doc.page.width;
  const H = doc.page.height;
  const M = 48;
  const inner = W - M * 2;
  let y = 0;

  const text = (s: string, x: number, width: number, opts: { size: number; font?: string; color?: string }) => {
    if (!s) return y;
    return input.rtl ? drawRtl(doc, s, x, y, width, opts) : drawLtr(doc, s, x, y, width, opts);
  };
  const ensure = (need: number) => {
    if (y + need > H - 60) {
      doc.addPage();
      doc.rect(0, 0, W, 4).fill(NAVY);
      y = M;
    }
  };

  doc.rect(0, 0, W, 8).fill(NAVY);
  doc.rect(0, 8, W, 2).fill(GOLD);
  y = 28;
  y = text(input.school, M, inner, { size: 9, color: MUTED }) + 4;
  y = text(input.title, M, inner, { size: 18, font: FONTS.bold, color: NAVY }) + 2;
  y = text(input.subtitle, M, inner, { size: 10, color: MUTED }) + 10;

  // Meta grid, two columns
  const colW = (inner - 16) / 2;
  for (let i = 0; i < input.meta.length; i += 2) {
    const startY = y;
    let maxY = y;
    for (let k = 0; k < 2 && i + k < input.meta.length; k++) {
      const [label, value] = input.meta[i + k];
      const x = input.rtl ? M + (1 - k) * (colW + 16) : M + k * (colW + 16);
      y = startY;
      y = text(label, x, colW, { size: 8, color: MUTED });
      y = text(value, x, colW, { size: 10, font: FONTS.semibold });
      maxY = Math.max(maxY, y);
    }
    y = maxY + 4;
  }
  doc.moveTo(M, y + 2).lineTo(W - M, y + 2).lineWidth(0.6).strokeColor("#D9DEE5").stroke();
  y += 12;

  const heading = (h: string) => {
    ensure(40);
    y = text(h, M, inner, { size: 12, font: FONTS.bold, color: NAVY }) + 2;
  };

  // Session plan first: it is what a teacher prints the plan for.
  heading(input.session.heading);
  const timeW = 90;
  for (const r of input.session.rows) {
    ensure(46);
    const rowY = y;
    const timeX = input.rtl ? W - M - timeW : M;
    const bodyX = input.rtl ? M : M + timeW + 8;
    const bodyW = inner - timeW - 8;
    y = rowY;
    y = text(r.time, timeX, timeW, { size: 9, font: FONTS.semibold });
    y = text(r.phase, timeX, timeW, { size: 8, color: MUTED });
    const leftY = y;
    y = rowY;
    y = text(r.title, bodyX, bodyW, { size: 10, font: FONTS.semibold });
    for (const line of r.detail.split("\n").filter(Boolean)) {
      ensure(20);
      y = text(line, bodyX, bodyW, { size: 9, color: "#374151" });
    }
    y = Math.max(y, leftY) + 4;
    doc.moveTo(M, y).lineTo(W - M, y).lineWidth(0.4).strokeColor("#E5E7EB").stroke();
    y += 6;
  }
  y += 6;

  for (const s of input.sections) {
    if (!s.lines.length) continue;
    heading(s.heading);
    for (const line of s.lines) {
      ensure(22);
      y = text(`• ${line}`, M, inner, { size: 10 }) + 1;
    }
    y += 8;
  }

  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    y = H - 40;
    text(input.footer, M, inner, { size: 7, color: MUTED });
  }
  doc.end();
  return done;
}
