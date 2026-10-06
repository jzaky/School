// Bilingual career guidance report PDF. English reads from the left edge, Arabic from the right edge of the
// same row, using the shared helpers in documents/pdf.ts for Arabic shaping and right-to-left runs.
import PDFDocument from "pdfkit";
import { drawLtr, drawRtl, drawSchoolMark, FONTS, GOLD, MUTED, NAVY, type Letterhead } from "@/server/documents/pdf";
import { PLAN_STATUS, type CareerReportData } from "./report";

function fmtDates(iso: string) {
  const d = new Date(iso);
  const en = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Dubai" }).format(d);
  const ar = new Intl.DateTimeFormat("ar-AE-u-nu-latn", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Dubai" }).format(d);
  return { en, ar };
}

export async function renderCareerReportPdf(data: CareerReportData, letterhead?: Letterhead | null): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 0, bufferPages: true, info: { Title: `Career guidance report ${data.student.en}`, Author: data.school.en } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  const W = doc.page.width;
  const H = doc.page.height;
  const M = 40;
  const inner = W - M * 2;
  const half = inner / 2 - 10;
  const xAr = W / 2 + 10;

  const header = () => {
    doc.rect(0, 0, W, 8).fill(NAVY);
    doc.rect(0, 8, W, 2).fill(GOLD);
    drawSchoolMark(doc, W / 2 - 20, 24, 40, { logo: letterhead?.logo, name: letterhead?.shortEn ?? data.school.en });
    drawLtr(doc, data.school.en, M, 30, half - 20, { size: 11, font: FONTS.semibold, color: NAVY });
    drawLtr(doc, "Career guidance report", M, 46, half - 20, { size: 9, color: MUTED });
    drawRtl(doc, data.school.ar, xAr + 20, 26, half - 20, { size: 11, font: FONTS.semibold, color: NAVY });
    drawRtl(doc, "تقرير الإرشاد المهني", xAr + 20, 44, half - 20, { size: 9, color: MUTED });
    doc.moveTo(M, 74).lineTo(W - M, 74).lineWidth(0.6).strokeColor("#D9DEE5").stroke();
  };
  const ensure = (y: number, needed: number) => {
    if (y + needed <= H - 70) return y;
    doc.addPage();
    header();
    return 88;
  };
  const section = (y: number, en: string, ar: string) => {
    y = ensure(y, 70);
    doc.roundedRect(M, y, inner, 24, 4).fill("#F3F6FA");
    drawLtr(doc, en, M + 10, y + 6, half, { size: 10, font: FONTS.bold, color: NAVY });
    drawRtl(doc, ar, xAr, y + 2, half - 10, { size: 10, font: FONTS.bold, color: NAVY });
    return y + 34;
  };
  /** One bilingual row: English on the left half, Arabic on the right half. */
  const pair = (y: number, en: string, ar: string, opts: { size?: number; font?: string; color?: string } = {}) => {
    const size = opts.size ?? 9;
    const yEn = drawLtr(doc, en, M, y, half, { size, font: opts.font, color: opts.color });
    const yAr = drawRtl(doc, ar, xAr, y - 4, half, { size, font: opts.font, color: opts.color });
    return Math.max(yEn, yAr) + 2;
  };

  header();

  // Student
  const issued = fmtDates(data.issuedAt);
  drawLtr(doc, data.student.en, M, 86, half, { size: 15, font: FONTS.bold, color: NAVY });
  drawLtr(doc, `Student no. ${data.student.studentNo}  ·  Grade ${data.student.grade}  ·  Issued ${issued.en}`, M, 108, half, { size: 9, color: MUTED });
  drawRtl(doc, data.student.ar, xAr, 82, half, { size: 15, font: FONTS.bold, color: NAVY });
  drawRtl(doc, `الرقم ${data.student.studentNo}  ·  الصف ${data.student.grade}  ·  تاريخ الإصدار ${issued.ar}`, xAr, 104, half, { size: 9, color: MUTED });
  let y = 140;

  // 1. Assessment
  y = section(y, "Interests and strengths assessment", "تقييم الميول ونقاط القوة");
  if (data.assessment) {
    const c = fmtDates(data.assessment.completedAt);
    y = pair(y, `Completed on ${c.en}. Scores run from 0 to 100.`, `أُكمل في ${c.ar}. تتراوح الدرجات بين 0 و100.`, { color: MUTED });
    const barX = M + 150;
    const barW = inner - 300 - 40;
    for (const s of data.assessment.scores) {
      y = ensure(y, 20);
      drawLtr(doc, s.en, M, y + 1, 145, { size: 8.5 });
      doc.roundedRect(barX, y + 3, barW, 8, 4).fill("#E8EDF3");
      doc.roundedRect(barX, y + 3, Math.max(4, (barW * Math.min(100, s.score)) / 100), 8, 4).fill(s.score >= 70 ? NAVY : s.score >= 40 ? "#4F7CAC" : "#A9BCD3");
      drawLtr(doc, String(s.score), barX + barW + 6, y + 1, 30, { size: 8.5, font: FONTS.semibold, color: NAVY });
      drawRtl(doc, s.ar, W - M - 145, y - 3, 145, { size: 8.5 });
      y += 18;
    }
    y += 6;
  } else {
    y = pair(y, "The assessment has not been completed yet.", "لم يُستكمل التقييم بعد.", { color: MUTED });
  }

  // 2. Careers
  y = section(y + 4, "Top matched careers", "أفضل المهن المطابقة");
  if (data.careers.length) {
    data.careers.forEach((c, i) => {
      y = ensure(y, 44);
      const tagEn = [c.chosen ? "chosen by the student" : "", c.reviewed ? "" : "awaiting the career advisor's review"].filter(Boolean).join(", ");
      const tagAr = [c.chosen ? "اختارها الطالب" : "", c.reviewed ? "" : "بانتظار مراجعة المرشد المهني"].filter(Boolean).join("، ");
      const top = y;
      const y1 = drawLtr(doc, `${i + 1}. ${c.en}  ·  ${c.score}% match`, M, y, half, { size: 10, font: FONTS.semibold, color: NAVY });
      const y2 = drawLtr(doc, tagEn ? `${c.cluster.en}  ·  ${tagEn}` : c.cluster.en, M, y1, half, { size: 8, color: MUTED });
      const a1 = drawRtl(doc, `${i + 1}. ${c.ar}  ·  تطابق %${c.score}`, xAr, top - 4, half, { size: 10, font: FONTS.semibold, color: NAVY });
      const a2 = drawRtl(doc, tagAr ? `${c.cluster.ar}  ·  ${tagAr}` : c.cluster.ar, xAr, a1 - 6, half, { size: 8, color: MUTED });
      y = Math.max(y2, a2) + 4;
      doc.moveTo(M, y).lineTo(W - M, y).lineWidth(0.4).strokeColor("#E5E7EB").stroke();
      y += 6;
    });
  } else {
    y = pair(y, "No career matches have been shared yet. The career advisor reviews matches before they are shared.", "لم تتم مشاركة مهن مقترحة بعد. يراجع المرشد المهني المهن المقترحة قبل مشاركتها.", { color: MUTED });
  }

  // 3. Fields
  y = section(y + 4, "Related university fields of study", "مجالات الدراسة الجامعية المرتبطة");
  if (data.fields.length) {
    for (const f of data.fields) {
      y = ensure(y, 18);
      y = pair(y, `•  ${f.en}`, `•  ${f.ar}`);
    }
  } else {
    y = pair(y, "Fields of study appear once career matches are shared.", "تظهر مجالات الدراسة بعد مشاركة المهن المقترحة.", { color: MUTED });
  }

  // 4. Course plan
  y = section(y + 4, "Course plan", "خطة المواد الدراسية");
  if (data.plan) {
    const p = data.plan;
    const st = PLAN_STATUS[p.status];
    y = pair(y, `${p.name}`, `${p.name}`, { font: FONTS.semibold, color: NAVY });
    y = pair(y, `Status: ${st.en}${p.approvedAt ? ` on ${fmtDates(p.approvedAt).en}` : ""}`, `الحالة: ${st.ar}${p.approvedAt ? ` بتاريخ ${fmtDates(p.approvedAt).ar}` : ""}`);
    if (p.courses) y = pair(y, `${p.courses} planned courses${p.grades ? ` for grades ${p.grades}` : ""}`, `${p.courses} مادة مخططة${p.grades ? ` للصفوف ${p.grades}` : ""}`, { color: MUTED });
    if (p.goal) y = pair(y, `Goal: ${p.goal.en}`, `الهدف: ${p.goal.ar}`, { color: MUTED });
  } else {
    y = pair(y, "No course plan has been started yet.", "لم تبدأ خطة المواد بعد.", { color: MUTED });
  }

  // 5. Next steps
  y = section(y + 4, "Next steps", "الخطوات التالية");
  data.nextSteps.forEach((s, i) => {
    y = ensure(y, 30);
    y = pair(y, `${i + 1}. ${s.en}`, `${i + 1}. ${s.ar}`) + 2;
  });

  // Footer on every page
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const fy = H - 52;
    doc.moveTo(M, fy).lineTo(W - M, fy).lineWidth(0.5).strokeColor("#E5E7EB").stroke();
    drawLtr(doc, `Guidance from ${data.school.en}. Matches describe interests, not ability, and are a starting point for conversation.`, M, fy + 8, half, { size: 7, color: MUTED });
    drawRtl(doc, `إرشاد من ${data.school.ar}. تعبّر المهن المقترحة عن الميول لا عن القدرات، وهي نقطة بداية للحوار.`, xAr, fy + 4, half, { size: 7, color: MUTED });
    doc.rect(0, H - 6, W, 6).fill(NAVY);
  }
  doc.end();
  return done;
}
