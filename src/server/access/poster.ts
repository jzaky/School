// Printable bilingual family join poster: school name, the join code, a QR code to the join page and
// three short steps in English and Arabic. Arabic is shaped and laid out by the shared PDF helpers.
import PDFDocument from "pdfkit";
import { FONTS, GOLD, MUTED, NAVY, drawLtr, drawRtl, drawSchoolMark } from "@/server/documents/pdf";
import { encodeQr } from "./qr";

export type PosterInput = {
  school: { en: string; ar: string };
  code: string;
  url: string;
  steps: { en: string[]; ar: string[] };
  title: { en: string; ar: string };
  subtitle: { en: string; ar: string };
  codeLabel: { en: string; ar: string };
  footer: { en: string; ar: string };
  color?: string;
  /** The school's logo, shown on a white tile in the header band. */
  logo?: Buffer | null;
};

export async function renderJoinPoster(input: PosterInput): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 0, info: { Title: `${input.title.en} ${input.school.en}`, Author: input.school.en } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  const W = doc.page.width;
  const H = doc.page.height;
  const M = 48;
  const inner = W - M * 2;
  const half = (inner - 24) / 2;
  const brand = /^#[0-9a-f]{6}$/i.test(input.color ?? "") ? input.color! : NAVY;

  doc.rect(0, 0, W, 118).fill(brand);
  doc.rect(0, 118, W, 4).fill(GOLD);
  const nameW = input.logo ? half - 34 : half;
  if (input.logo) {
    doc.roundedRect(W / 2 - 30, 29, 60, 60, 10).fill("#FFFFFF");
    drawSchoolMark(doc, W / 2 - 25, 34, 50, { logo: input.logo, name: input.school.en });
  }
  drawLtr(doc, input.school.en, M, 40, nameW, { size: 15, font: FONTS.semibold, color: "#FFFFFF" });
  drawRtl(doc, input.school.ar, M + inner - nameW, 36, nameW, { size: 15, font: FONTS.semibold, color: "#FFFFFF" });

  drawLtr(doc, input.title.en, M, 150, inner, { size: 26, font: FONTS.bold, color: brand, align: "center" });
  drawRtl(doc, input.title.ar, M, 188, inner, { size: 24, font: FONTS.bold, color: brand, align: "center" });
  drawLtr(doc, input.subtitle.en, M, 236, inner, { size: 11, color: MUTED, align: "center" });
  drawRtl(doc, input.subtitle.ar, M, 254, inner, { size: 11, color: MUTED, align: "center" });

  // QR code
  const matrix = encodeQr(input.url);
  const quiet = 3;
  const cells = matrix.length + quiet * 2;
  const qrSize = 210;
  const cell = qrSize / cells;
  const qx = (W - qrSize) / 2;
  const qy = 296;
  doc.roundedRect(qx - 10, qy - 10, qrSize + 20, qrSize + 20, 12).lineWidth(1).strokeColor("#D9DEE5").stroke();
  doc.rect(qx, qy, qrSize, qrSize).fill("#FFFFFF");
  matrix.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) doc.rect(qx + (x + quiet) * cell, qy + (y + quiet) * cell, cell + 0.2, cell + 0.2).fill("#000000");
    }),
  );

  // Code
  const cy = qy + qrSize + 26;
  drawLtr(doc, input.codeLabel.en, M, cy, inner, { size: 11, color: MUTED, align: "center" });
  drawRtl(doc, input.codeLabel.ar, M, cy + 14, inner, { size: 11, color: MUTED, align: "center" });
  doc.roundedRect(W / 2 - 130, cy + 42, 260, 54, 10).fill("#F3F5F8");
  drawLtr(doc, input.code, W / 2 - 130, cy + 52, 260, { size: 26, font: FONTS.bold, color: brand, align: "center" });
  drawLtr(doc, input.url, M, cy + 104, inner, { size: 9, color: MUTED, align: "center" });

  // Steps
  let y = cy + 134;
  const ny = y;
  input.steps.en.forEach((s, i) => {
    doc.circle(M + 9, y + 7, 9).fill(GOLD);
    doc.font(FONTS.bold).fontSize(9).fillColor("#FFFFFF").text(String(i + 1), M, y + 2, { width: 18, align: "center" });
    y = drawLtr(doc, s, M + 26, y, half - 26, { size: 10 }) + 8;
  });
  let ya = ny - 3;
  input.steps.ar.forEach((s, i) => {
    const x0 = M + half + 24;
    doc.circle(x0 + half - 9, ya + 10, 9).fill(GOLD);
    doc.font(FONTS.bold).fontSize(9).fillColor("#FFFFFF").text(String(i + 1), x0 + half - 18, ya + 5, { width: 18, align: "center" });
    ya = drawRtl(doc, s, x0, ya, half - 26, { size: 10 }) + 6;
  });

  const fy = H - 64;
  doc.moveTo(M, fy).lineTo(W - M, fy).lineWidth(0.5).strokeColor("#E5E7EB").stroke();
  drawLtr(doc, input.footer.en, M, fy + 12, half, { size: 8, color: MUTED });
  drawRtl(doc, input.footer.ar, M + half + 24, fy + 8, half, { size: 8, color: MUTED });
  doc.rect(0, H - 6, W, 6).fill(brand);
  doc.end();
  return done;
}
