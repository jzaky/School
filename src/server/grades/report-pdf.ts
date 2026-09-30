// Bilingual term report card PDF. Uses the shared drawing helpers in documents/pdf.ts for Arabic shaping.
import PDFDocument from "pdfkit";
import { drawLtr, drawRtl, drawSchoolMark, FONTS, GOLD, MUTED, NAVY, type Letterhead } from "@/server/documents/pdf";
import type { ReportCardData } from "./report-card";

function fmtDates(iso: string) {
  const d = new Date(iso);
  const en = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Dubai" }).format(d);
  const ar = new Intl.DateTimeFormat("ar-AE-u-nu-latn", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Dubai" }).format(d);
  return { en, ar };
}

const pct = (n: number | null) => (n === null ? "-" : `${n.toFixed(1)}%`);
// In a right-to-left line the percent sign is written first so that it is drawn after the number.
const pctAr = (n: number | null) => (n === null ? "-" : `%${n.toFixed(1)}`);

/** `letterhead` adds the school's logo; the names printed are the ones stored when the card was issued. */
export async function renderReportCardPdf(data: ReportCardData, letterhead?: Letterhead | null): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 0, bufferPages: true, info: { Title: `Term report card ${data.student.en} ${data.term.en}`, Author: data.school.en } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  const W = doc.page.width;
  const H = doc.page.height;
  const M = 40;
  const inner = W - M * 2;
  const half = inner / 2 - 10;

  const header = () => {
    doc.rect(0, 0, W, 8).fill(NAVY);
    doc.rect(0, 8, W, 2).fill(GOLD);
    drawSchoolMark(doc, W / 2 - 20, 24, 40, { logo: letterhead?.logo, name: letterhead?.shortEn ?? data.school.en });
    drawLtr(doc, data.school.en, M, 30, half - 20, { size: 11, font: FONTS.semibold, color: NAVY });
    drawLtr(doc, "Term report card", M, 46, half - 20, { size: 9, color: MUTED });
    drawRtl(doc, data.school.ar, W / 2 + 30, 26, half - 20, { size: 11, font: FONTS.semibold, color: NAVY });
    drawRtl(doc, "بطاقة التقرير الفصلي", W / 2 + 30, 44, half - 20, { size: 9, color: MUTED });
    doc.moveTo(M, 74).lineTo(W - M, 74).lineWidth(0.6).strokeColor("#D9DEE5").stroke();
  };
  header();

  // Student block
  const d = fmtDates(data.issuedAt);
  const cls = `${data.student.grade}${data.student.section ?? ""}`;
  drawLtr(doc, data.student.en, M, 86, half, { size: 15, font: FONTS.bold, color: NAVY });
  drawLtr(doc, `Student no. ${data.student.studentNo}  ·  Grade ${cls}`, M, 108, half, { size: 9, color: MUTED });
  drawLtr(doc, `${data.term.en}  ·  ${data.year.en}  ·  Issued ${d.en}`, M, 122, half, { size: 9, color: MUTED });
  drawRtl(doc, data.student.ar, W / 2 + 10, 82, half, { size: 15, font: FONTS.bold, color: NAVY });
  drawRtl(doc, `الرقم ${data.student.studentNo}  ·  الصف ${cls}`, W / 2 + 10, 104, half, { size: 9, color: MUTED });
  drawRtl(doc, `${data.term.ar}  ·  ${data.year.ar}  ·  تاريخ الإصدار ${d.ar}`, W / 2 + 10, 120, half, { size: 9, color: MUTED });

  // Overall summary
  doc.roundedRect(M, 146, inner, 40, 6).fill("#F3F6FA");
  drawLtr(doc, `Overall average: ${pct(data.overall)}   Band: ${data.overallBand ?? "-"}`, M + 12, 160, half, { size: 10, font: FONTS.semibold, color: NAVY });
  drawRtl(doc, `المعدل العام: ${pctAr(data.overall)}   التقدير: ${data.overallBand ?? "-"}`, W / 2, 155, half - 2, { size: 10, font: FONTS.semibold, color: NAVY });

  // Table: subject | teacher | average | band | comment (English above, Arabic below in each cell)
  const cols = [
    { key: "subject", w: 118 },
    { key: "teacher", w: 104 },
    { key: "avg", w: 54 },
    { key: "band", w: 40 },
    { key: "comment", w: inner - 118 - 104 - 54 - 40 },
  ];
  const xs: number[] = [];
  cols.reduce((x, c) => (xs.push(x), x + c.w), M);
  const pad = 6;

  const tableHead = (y: number) => {
    doc.rect(M, y, inner, 34).fill(NAVY);
    const heads = [
      ["Subject", "المادة"],
      ["Teacher", "المعلم"],
      ["Average", "المعدل"],
      ["Band", "التقدير"],
      ["Teacher comment", "ملاحظة المعلم"],
    ];
    heads.forEach(([en, ar], i) => {
      drawLtr(doc, en, xs[i] + pad, y + 4, cols[i].w - pad * 2, { size: 8, font: FONTS.semibold, color: "#FFFFFF" });
      drawRtl(doc, ar, xs[i] + pad, y + 15, cols[i].w - pad * 2, { size: 8, font: FONTS.semibold, color: "#E9C46A" });
    });
    return y + 34;
  };

  let y = tableHead(198);
  data.rows.forEach((r) => {
    if (y > H - 150) {
      doc.addPage();
      header();
      y = tableHead(86);
    }
    const cellTop = y + 5;
    const y1 = drawLtr(doc, r.subjectEn, xs[0] + pad, cellTop, cols[0].w - pad * 2, { size: 9, font: FONTS.semibold, color: NAVY });
    const y1b = drawRtl(doc, r.subjectAr, xs[0] + pad, y1, cols[0].w - pad * 2, { size: 9, color: NAVY });
    const y2 = drawLtr(doc, r.teacherEn || "-", xs[1] + pad, cellTop, cols[1].w - pad * 2, { size: 8, color: "#1F2937" });
    const y2b = r.teacherAr ? drawRtl(doc, r.teacherAr, xs[1] + pad, y2, cols[1].w - pad * 2, { size: 8, color: "#1F2937" }) : y2;
    drawLtr(doc, pct(r.average), xs[2] + pad, cellTop, cols[2].w - pad * 2, { size: 9, font: FONTS.semibold });
    drawLtr(doc, r.band ?? "-", xs[3] + pad, cellTop, cols[3].w - pad * 2, { size: 11, font: FONTS.bold, color: NAVY });
    const y5 = drawLtr(doc, r.commentEn, xs[4] + pad, cellTop, cols[4].w - pad * 2, { size: 8, color: "#1F2937" });
    const y5b = drawRtl(doc, r.commentAr, xs[4] + pad, y5, cols[4].w - pad * 2, { size: 8, color: MUTED });
    y = Math.max(y1b, y2b, y5b, cellTop + 24) + 4;
    doc.moveTo(M, y).lineTo(W - M, y).lineWidth(0.5).strokeColor("#E5E7EB").stroke();
  });
  if (!data.rows.length) {
    drawLtr(doc, "No subjects are recorded for this term.", M + pad, y + 10, half, { size: 9, color: MUTED });
    drawRtl(doc, "لا توجد مواد مسجلة لهذا الفصل.", W / 2, y + 6, half, { size: 9, color: MUTED });
    y += 40;
  }

  // Band key
  if (y > H - 130) {
    doc.addPage();
    header();
    y = 90;
  }
  y += 14;
  const key = data.bands.map((b) => `${b.label} ${b.minPercent}%+`).join("   ");
  drawLtr(doc, `Grade bands: ${key}`, M, y, inner, { size: 8, color: MUTED });
  drawLtr(doc, "Averages are weighted by assessment and include published work only.", M, y + 13, inner, { size: 8, color: MUTED });
  drawRtl(doc, "سلم التقديرات أدناه. المعدلات موزونة حسب التقييم وتشمل الأعمال المنشورة فقط.", M, y + 30, inner, { size: 8, color: MUTED });
  // The band key under the Arabic line sits at the page's trailing edge for right-to-left readers.
  const keyWidth = doc.font(FONTS.regular).fontSize(8).widthOfString(key) + 2;
  drawLtr(doc, key, M + inner - keyWidth, y + 47, keyWidth, { size: 8, color: MUTED });

  // Footer on every page
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const fy = H - 46;
    doc.moveTo(M, fy).lineTo(W - M, fy).lineWidth(0.5).strokeColor("#E5E7EB").stroke();
    drawLtr(doc, `Issued by ${data.school.en} from published grades.`, M, fy + 8, half, { size: 7, color: MUTED });
    drawRtl(doc, `صدر عن ${data.school.ar} استنادًا إلى الدرجات المنشورة.`, W / 2 + 10, fy + 4, half, { size: 7, color: MUTED });
    doc.rect(0, H - 6, W, 6).fill(NAVY);
  }
  doc.end();
  return done;
}
