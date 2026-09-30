// Printable bilingual exam timetable, in the same letterhead style as school letters.
import PDFDocument from "pdfkit";
import { drawLtr, drawRtl, drawSchoolMark, FONTS, GOLD, MUTED, NAVY } from "@/server/documents/pdf";

export type TimetableRow = { start: Date; end: Date; subjectEn: string; subjectAr: string; room: string | null };

const TZ = "Asia/Dubai";
const en = (d: Date, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { ...o, timeZone: TZ }).format(d);
const ar = (d: Date, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("ar-AE-u-nu-latn", { ...o, timeZone: TZ }).format(d);

export async function renderExamTimetablePdf(input: {
  school: { en: string; ar: string };
  heading: { en: string; ar: string };
  subheading: { en: string; ar: string };
  rows: TimetableRow[];
  generatedAt: Date;
  /** The school's logo; the school's initial is drawn when there is none. */
  logo?: Buffer | null;
}): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 0, info: { Title: input.heading.en, Author: input.school.en } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  const W = doc.page.width;
  const H = doc.page.height;
  const M = 40;
  const inner = W - M * 2;

  const letterhead = () => {
    doc.rect(0, 0, W, 8).fill(NAVY);
    doc.rect(0, 8, W, 2).fill(GOLD);
    drawSchoolMark(doc, W / 2 - 20, 24, 40, { logo: input.logo, name: input.school.en });
    const half = inner / 2 - 30;
    drawLtr(doc, input.school.en, M, 26, half, { size: 11, font: FONTS.semibold, color: NAVY });
    drawRtl(doc, input.school.ar, W / 2 + 30, 22, half, { size: 11, font: FONTS.semibold, color: NAVY });
    drawLtr(doc, input.heading.en, M, 50, half, { size: 16, font: FONTS.bold, color: NAVY });
    drawRtl(doc, input.heading.ar, W / 2 + 30, 44, half, { size: 16, font: FONTS.bold, color: NAVY });
    drawLtr(doc, input.subheading.en, M, 76, half, { size: 9, color: MUTED });
    drawRtl(doc, input.subheading.ar, W / 2 + 30, 72, half, { size: 9, color: MUTED });
    doc.moveTo(M, 100).lineTo(W - M, 100).lineWidth(0.6).strokeColor("#D9DEE5").stroke();
  };

  // Columns: Date | Time | Subject | Room | المادة | التاريخ
  const cols = [
    { w: 100, head: "Date" },
    { w: 70, head: "Time" },
    { w: 105, head: "Subject" },
    { w: 72, head: "Room" },
    { w: 84, head: "المادة", rtl: true },
    { w: 84, head: "التاريخ", rtl: true },
  ];
  const xs = cols.reduce<number[]>((acc, c, i) => [...acc, i === 0 ? M : acc[i - 1] + cols[i - 1].w], []);
  const header = (y: number) => {
    doc.rect(M, y, inner, 22).fill("#EEF2F7");
    cols.forEach((c, i) => {
      if (c.rtl) drawRtl(doc, c.head, xs[i] + 4, y + 2, c.w - 8, { size: 8.5, font: FONTS.semibold, color: NAVY });
      else drawLtr(doc, c.head, xs[i] + 4, y + 6, c.w - 8, { size: 8.5, font: FONTS.semibold, color: NAVY });
    });
    return y + 22;
  };

  letterhead();
  let y = header(112);
  if (!input.rows.length) {
    drawLtr(doc, "No exams are scheduled.", M, y + 16, inner / 2, { size: 10, color: MUTED });
    drawRtl(doc, "لا توجد امتحانات مجدولة.", W / 2, y + 12, inner / 2, { size: 10, color: MUTED });
  }
  input.rows.forEach((r, idx) => {
    if (y > H - 90) {
      doc.addPage();
      letterhead();
      y = header(112);
    }
    const rowH = 26;
    if (idx % 2 === 1) doc.rect(M, y, inner, rowH).fill("#FAFBFC");
    const time = `${en(r.start, { hour: "2-digit", minute: "2-digit", hour12: false })} - ${en(r.end, { hour: "2-digit", minute: "2-digit", hour12: false })}`;
    drawLtr(doc, en(r.start, { weekday: "short", day: "numeric", month: "short" }), xs[0] + 4, y + 8, cols[0].w - 8, { size: 8.5 });
    drawLtr(doc, time, xs[1] + 4, y + 8, cols[1].w - 8, { size: 8.5 });
    drawLtr(doc, r.subjectEn, xs[2] + 4, y + 8, cols[2].w - 8, { size: 8.5, font: FONTS.semibold });
    drawLtr(doc, r.room ?? "-", xs[3] + 4, y + 8, cols[3].w - 8, { size: 8.5 });
    drawRtl(doc, r.subjectAr, xs[4] + 4, y + 4, cols[4].w - 8, { size: 8.5, font: FONTS.semibold });
    drawRtl(doc, ar(r.start, { weekday: "short", day: "numeric", month: "short" }), xs[5] + 4, y + 4, cols[5].w - 8, { size: 8.5 });
    doc.moveTo(M, y + rowH).lineTo(W - M, y + rowH).lineWidth(0.4).strokeColor("#E5E7EB").stroke();
    y += rowH;
  });

  const fy = H - 50;
  doc.moveTo(M, fy).lineTo(W - M, fy).lineWidth(0.5).strokeColor("#E5E7EB").stroke();
  drawLtr(doc, `Arrive 15 minutes before each exam with your student ID. Generated ${en(input.generatedAt, { day: "numeric", month: "long", year: "numeric" })}.`, M, fy + 10, inner / 2 - 10, { size: 7, color: MUTED });
  drawRtl(doc, "يُرجى الحضور قبل كل امتحان بخمس عشرة دقيقة مع بطاقة الطالب.", W / 2 + 10, fy + 6, inner / 2 - 10, { size: 7, color: MUTED });
  doc.rect(0, H - 6, W, 6).fill(NAVY);
  doc.end();
  return done;
}
