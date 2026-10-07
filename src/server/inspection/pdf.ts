// Bilingual evidence pack PDF on the school's letterhead. Aggregates only: no names, no case references.
import PDFDocument from "pdfkit";
import { drawLtr, drawRtl, drawSchoolMark, FONTS, GOLD, MUTED, NAVY, type Letterhead } from "@/server/documents/pdf";
import type { EvidencePack } from "./evidence";
import { breakdownText, frameworkLabel, headingLabel, L, metricLabel, metricValue, periodText } from "./format";

export async function renderEvidencePdf(pack: EvidencePack, input: { letterhead: Letterhead; generatedBy: { en: string; ar: string } }): Promise<Buffer> {
  const en = L("en");
  const ar = L("ar");
  const lh = input.letterhead;
  const doc = new PDFDocument({ size: "A4", margin: 0, info: { Title: `${en.title} - ${lh.school.en}`, Author: lh.school.en } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  const W = doc.page.width;
  const H = doc.page.height;
  const M = 40;
  const inner = W - M * 2;
  const half = inner / 2 - 30;
  const generated = new Date(pack.generatedAt);
  const fmtGen = (loc: "en" | "ar") => new Intl.DateTimeFormat(loc === "ar" ? "ar-AE-u-nu-latn" : "en-GB", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" }).format(generated);

  const letterhead = () => {
    doc.rect(0, 0, W, 8).fill(NAVY);
    doc.rect(0, 8, W, 2).fill(GOLD);
    drawSchoolMark(doc, W / 2 - 20, 22, 40, { logo: lh.logo, name: lh.shortEn });
    drawLtr(doc, lh.school.en, M, 24, half, { size: 11, font: FONTS.semibold, color: NAVY });
    drawLtr(doc, lh.address.en, M, 40, half, { size: 7.5, color: MUTED });
    drawRtl(doc, lh.school.ar, W / 2 + 30, 20, half, { size: 11, font: FONTS.semibold, color: NAVY });
    drawRtl(doc, lh.address.ar, W / 2 + 30, 38, half, { size: 7.5, color: MUTED });
    doc.moveTo(M, 70).lineTo(W - M, 70).lineWidth(0.6).strokeColor("#D9DEE5").stroke();
  };
  let page = 1;
  const footer = () => {
    const fy = H - 58;
    doc.moveTo(M, fy).lineTo(W - M, fy).lineWidth(0.5).strokeColor("#E5E7EB").stroke();
    drawLtr(doc, `${en.disclaimer} ${en.pdf.page} ${page}`, M, fy + 6, inner / 2 - 10, { size: 6.5, color: MUTED });
    drawRtl(doc, `${ar.disclaimer} ${ar.pdf.page} ${page}`, W / 2 + 10, fy + 2, inner / 2 - 10, { size: 6.5, color: MUTED });
    doc.rect(0, H - 6, W, 6).fill(NAVY);
  };
  const newPage = () => {
    footer();
    doc.addPage();
    page++;
    letterhead();
    return 84;
  };

  letterhead();
  let y = 82;
  drawLtr(doc, en.title, M, y, half, { size: 16, font: FONTS.bold, color: NAVY });
  drawRtl(doc, ar.title, W / 2 + 30, y - 6, half, { size: 16, font: FONTS.bold, color: NAVY });
  y += 28;
  drawLtr(doc, `${en.pdf.period}: ${periodText(pack, "en")}`, M, y, half, { size: 9, color: MUTED });
  drawRtl(doc, `${ar.pdf.period}: ${periodText(pack, "ar")}`, W / 2 + 30, y - 4, half, { size: 9, color: MUTED });
  y += 14;
  const g1 = drawLtr(doc, `${en.pdf.generated}: ${fmtGen("en")}, ${en.pdf.generatedBy}: ${input.generatedBy.en}`, M, y, half, { size: 8, color: MUTED });
  const g2 = drawRtl(doc, `${ar.pdf.generated}: ${fmtGen("ar")}، ${ar.pdf.generatedBy}: ${input.generatedBy.ar}`, W / 2 + 30, y - 4, half, { size: 8, color: MUTED });
  y = Math.max(g1, g2 - 4) + 10;
  // Disclaimer box, sized to its text.
  const boxW = inner / 2 - 16;
  const discEn = `${en.disclaimer} ${en.aggregatesOnly}`;
  const discAr = `${ar.disclaimer} ${ar.aggregatesOnly}`;
  doc.font(FONTS.regular).fontSize(7.5);
  const hEn = doc.heightOfString(discEn, { width: boxW, lineGap: 7.5 * 0.45 });
  const hAr = doc.heightOfString(discAr, { width: boxW }) * 1.45;
  const boxH = Math.max(hEn, hAr) + 16;
  doc.rect(M, y, inner, boxH).fill("#FFF8E6");
  drawLtr(doc, discEn, M + 8, y + 6, boxW, { size: 7.5, color: "#6B4E00" });
  drawRtl(doc, discAr, W / 2 + 8, y + 2, boxW, { size: 7.5, color: "#6B4E00" });
  y += boxH + 12;

  const C = { labelEn: M, valEn: M + 168, valAr: M + 262, labelAr: M + 345 };
  const W_LABEL = 160;
  const W_VAL = 88;
  const W_LABEL_AR = inner - 345;

  for (const s of pack.sections) {
    if (y > H - 170) y = newPage();
    // Heading band
    doc.rect(M, y, inner, 34).fill("#EEF2F7");
    drawLtr(doc, en.headingPrefix, M + 8, y + 4, inner / 2 - 16, { size: 6.5, color: MUTED });
    drawRtl(doc, ar.headingPrefix, W / 2 + 8, y + 1, inner / 2 - 16, { size: 6.5, color: MUTED });
    drawLtr(doc, headingLabel(s.key, "en"), M + 8, y + 15, inner / 2 - 16, { size: 11, font: FONTS.bold, color: NAVY });
    drawRtl(doc, headingLabel(s.key, "ar"), W / 2 + 8, y + 10, inner / 2 - 16, { size: 11, font: FONTS.bold, color: NAVY });
    y += 40;
    for (const m of s.metrics) {
      if (y > H - 92) y = newPage();
      const top = y;
      const a = drawLtr(doc, metricLabel(m.key, "en"), C.labelEn, top, W_LABEL, { size: 8.5 });
      const b = drawLtr(doc, metricValue(m, "en"), C.valEn, top, W_VAL, { size: 8.5, font: FONTS.semibold });
      const c = drawRtl(doc, metricValue(m, "ar"), C.valAr, top - 4, W_VAL - 8, { size: 8.5, font: FONTS.semibold });
      const d = drawRtl(doc, metricLabel(m.key, "ar"), C.labelAr, top - 4, W_LABEL_AR, { size: 8.5 });
      y = Math.max(a, b, c - 4, d - 4) + 2;
      if (m.breakdown?.length) {
        const e = drawLtr(doc, breakdownText(m, "en"), C.labelEn + 8, y, inner / 2 - 16, { size: 7, color: MUTED });
        const f = drawRtl(doc, breakdownText(m, "ar"), W / 2 + 8, y - 3, inner / 2 - 16, { size: 7, color: MUTED });
        y = Math.max(e, f - 3) + 2;
      }
      doc.moveTo(M, y).lineTo(W - M, y).lineWidth(0.3).strokeColor("#E5E7EB").stroke();
      y += 4;
    }
    // Related framework areas (the school's own regulator; all four for other regulators).
    const rows = pack.regulator === "OTHER" ? s.mapping : s.mapping.filter((r) => r.framework === pack.regulator);
    for (const r of rows) {
      if (y > H - 92) y = newPage();
      const e = drawLtr(doc, `${en.mapping.title} (${frameworkLabel(r.framework, "en")}): ${r.areaEn}`, M, y + 2, inner / 2 - 10, { size: 7, color: NAVY });
      const f = drawRtl(doc, `${ar.mapping.title}، ${frameworkLabel(r.framework, "ar")}: ${r.areaAr}`, W / 2 + 10, y - 1, inner / 2 - 10, { size: 7, color: NAVY });
      y = Math.max(e, f - 3) + 2;
    }
    y += 12;
  }
  footer();
  doc.end();
  return done;
}
