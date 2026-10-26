// Student attendance certificate (English or Arabic), drawn with the shared PDF helpers so Arabic is shaped and laid
// out right to left. Shows counts and the percentage only, never reasons for absence.
import { drawLtr, drawRtl, drawSchoolMark, FONTS, GOLD, MUTED, NAVY, newPdf, type Letterhead } from "@/server/documents/pdf";
import type { Tally } from "./maths";
import { attendancePct, round1 } from "./maths";

export type CertificateData = {
  lang: "en" | "ar";
  reference: string;
  student: { en: string; ar: string; studentNo: string; grade: { en: string; ar: string }; homeroom: { en: string; ar: string } | null };
  from: string;
  to: string;
  tally: Tally;
  issuedAt: Date;
  issuer: { en: string; ar: string; titleEn: string | null; titleAr: string | null };
};

const fmt = (iso: string | Date, lang: "en" | "ar") =>
  new Intl.DateTimeFormat(lang === "ar" ? "ar-AE-u-nu-latn" : "en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: typeof iso === "string" ? "UTC" : "Asia/Dubai" }).format(typeof iso === "string" ? new Date(`${iso}T00:00:00Z`) : iso);

export async function renderCertificatePdf(d: CertificateData, letterhead: Letterhead): Promise<Buffer> {
  const ar = d.lang === "ar";
  const doc = newPdf({ size: "A4", margin: 0, info: { Title: ar ? "شهادة حضور" : `Attendance certificate ${d.student.en}`, Author: letterhead.school.en } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  const W = doc.page.width;
  const H = doc.page.height;
  const M = 56;
  const inner = W - M * 2;
  const text = (s: string, x: number, y: number, w: number, o: { size: number; font?: string; color?: string; align?: "center" }) =>
    // Without an alignment, Arabic lines sit at the trailing edge and English lines at the leading edge.
    ar ? drawRtl(doc, s, x, y, w, o) : drawLtr(doc, s, x, y, w, o);

  // Frame and header
  doc.rect(0, 0, W, 10).fill(NAVY);
  doc.rect(0, 10, W, 3).fill(GOLD);
  doc.roundedRect(M - 16, 40, inner + 32, H - 110, 10).lineWidth(0.8).strokeColor("#D9DEE5").stroke();
  drawSchoolMark(doc, W / 2 - 26, 62, 52, { logo: letterhead.logo, name: letterhead.shortEn });
  text(ar ? letterhead.school.ar : letterhead.school.en, M, 124, inner, { size: 14, font: FONTS.semibold, color: NAVY, align: "center" });
  text(ar ? letterhead.address.ar : letterhead.address.en, M, ar ? 146 : 146, inner, { size: 9, color: MUTED, align: "center" });
  text(ar ? "شهادة حضور" : "Attendance certificate", M, 186, inner, { size: 24, font: FONTS.bold, color: NAVY, align: "center" });
  doc.moveTo(W / 2 - 40, ar ? 238 : 226).lineTo(W / 2 + 40, ar ? 238 : 226).lineWidth(1.5).strokeColor(GOLD).stroke();

  // Statement
  const name = ar ? d.student.ar : d.student.en;
  const grade = ar ? d.student.grade.ar : d.student.grade.en;
  const homeroom = d.student.homeroom ? (ar ? d.student.homeroom.ar : d.student.homeroom.en) : null;
  const school = ar ? letterhead.school.ar : letterhead.school.en;
  const statement = ar
    ? `تشهد ${school} بأن الطالب/ة ${name}، رقم الطالب ${d.student.studentNo}، ${grade}${homeroom ? `، ${homeroom}` : ""}، مسجّل/ة لديها، وأن سجل حضوره/ا في الفترة من ${fmt(d.from, "ar")} إلى ${fmt(d.to, "ar")} كما يلي.`
    : `${school} certifies that ${name}, student number ${d.student.studentNo}, ${grade}${homeroom ? ` (${homeroom})` : ""}, is enrolled at the school, and that their attendance from ${fmt(d.from, "en")} to ${fmt(d.to, "en")} is as follows.`;
  let y = text(statement, M, 262, inner, { size: 11.5, color: "#1F2937" }) + 18;

  // Figures
  const t = d.tally;
  const pct = attendancePct(t);
  const pctText = pct === null ? "-" : ar ? `%${round1(pct).toFixed(1)}` : `${round1(pct).toFixed(1)}%`;
  const rows: Array<[string, string]> = ar
    ? [
        ["نسبة الحضور", pctText],
        ["أيام الدراسة المسجلة", String(t.possible)],
        ["أيام الحضور", String(t.attended)],
        ["أيام الغياب بعذر", String(t.authorised)],
        ["أيام الغياب بدون عذر", String(t.unauthorised)],
        ["مرات التأخر", String(t.late)],
      ]
    : [
        ["Attendance", pctText],
        ["School days on record", String(t.possible)],
        ["Days attended", String(t.attended)],
        ["Authorised absences (days)", String(t.authorised)],
        ["Unauthorised absences (days)", String(t.unauthorised)],
        ["Late arrivals", String(t.late)],
      ];
  const rowH = 30;
  doc.roundedRect(M, y, inner, rowH * rows.length + 8, 8).fill("#F3F6FA");
  y += 4;
  rows.forEach(([label, value], i) => {
    const ry = y + i * rowH;
    if (i > 0) doc.moveTo(M + 12, ry).lineTo(M + inner - 12, ry).lineWidth(0.5).strokeColor("#E1E6ED").stroke();
    const big = i === 0;
    if (ar) {
      drawRtl(doc, label, M + inner / 2, ry + 6, inner / 2 - 16, { size: big ? 12 : 10.5, font: big ? FONTS.semibold : FONTS.regular, color: NAVY });
      drawLtr(doc, value, M + 16, ry + (big ? 6 : 8), inner / 2 - 16, { size: big ? 13 : 10.5, font: FONTS.bold, color: NAVY });
    } else {
      drawLtr(doc, label, M + 16, ry + 8, inner / 2, { size: big ? 12 : 10.5, font: big ? FONTS.semibold : FONTS.regular, color: NAVY });
      // The value sits at the row's trailing edge: measure it and start it there.
      const size = big ? 13 : 10.5;
      const width = doc.font(FONTS.bold).fontSize(size).widthOfString(value) + 1;
      drawLtr(doc, value, M + inner - 16 - width, ry + (big ? 7 : 8), width, { size, font: FONTS.bold, color: NAVY });
    }
  });
  y += rowH * rows.length + 22;
  y = text(
    ar
      ? "أُعدّت هذه الشهادة من سجل الحضور اليومي للمدرسة. لا تتضمن أسباب الغياب. لا تُحتسب في النسبة الأيام التي لا يُلزم فيها الطالب بالحضور."
      : "This certificate is prepared from the school's daily attendance register. It does not include reasons for absence. Days the student was not required to attend do not count towards the percentage.",
    M,
    y,
    inner,
    { size: 9, color: MUTED },
  );

  // Signature
  const sy = H - 210;
  const issuer = ar ? d.issuer.ar : d.issuer.en;
  const title = ar ? d.issuer.titleAr || d.issuer.titleEn : d.issuer.titleEn;
  const sx = ar ? M : M + inner - 200;
  doc.moveTo(sx, sy + 40).lineTo(sx + 200, sy + 40).lineWidth(0.8).strokeColor("#9AA5B4").stroke();
  if (ar) {
    drawRtl(doc, issuer, sx, sy + 46, 200, { size: 10, font: FONTS.semibold, color: NAVY });
    if (title) drawRtl(doc, title, sx, sy + 66, 200, { size: 9, color: MUTED });
  } else {
    drawLtr(doc, issuer, sx, sy + 46, 200, { size: 10, font: FONTS.semibold, color: NAVY });
    if (title) drawLtr(doc, title, sx, sy + 62, 200, { size: 9, color: MUTED });
  }
  const meta = ar ? `تاريخ الإصدار: ${fmt(d.issuedAt, "ar")}   المرجع: ${d.reference}` : `Issued: ${fmt(d.issuedAt, "en")}   Reference: ${d.reference}`;
  text(meta, M, sy + 100, inner, { size: 9, color: MUTED });
  doc.rect(0, H - 8, W, 8).fill(NAVY);
  doc.end();
  return done;
}
