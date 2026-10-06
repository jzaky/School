// Bilingual summary PDF for a data subject export: who the export is about, what the school holds
// per area, and what was withheld and why. English on the left, Arabic on the right.
import PDFDocument from "pdfkit";
import { FONTS, GOLD, MUTED, NAVY, drawLtr, drawRtl } from "@/server/documents/pdf";
import { areaLabel, exportLabel } from "./labels";

export type SummaryInput = {
  school: { en: string; ar: string };
  subjectName: { en: string; ar: string };
  kind: "student" | "guardian" | "staff";
  reference: string;
  request: { number: string; type: string } | null;
  generatedAt: Date;
  details: Array<{ key: string; value: string }>;
  areas: Array<{ model: string; count: number }>;
  files: number;
  withheld: Array<{ model: string; reason: string; count: number }>;
};

function fmt(d: Date, locale: "en" | "ar") {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-AE-u-nu-latn" : "en-GB", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" }).format(d);
}

export async function renderSubjectSummaryPdf(input: SummaryInput): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 0, bufferPages: true, info: { Title: `${exportLabel("en", "pdfTitle")} ${input.reference}` } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  const W = doc.page.width;
  const H = doc.page.height;
  const M = 48;
  const inner = W - M * 2;
  const col = (inner - 24) / 2;
  const xAr = M + col + 24;

  const band = () => {
    doc.rect(0, 0, W, 8).fill(NAVY);
    doc.rect(0, 8, W, 2).fill(GOLD);
  };
  const ensure = (y: number, need: number) => {
    if (y + need < H - 60) return y;
    doc.addPage({ size: "A4", margin: 0 });
    band();
    return 40;
  };
  /** One bilingual line pair. Returns the y below it. */
  const pair = (y: number, en: string, ar: string, size = 9, font = FONTS.regular, color = "#1F2937") => {
    y = ensure(y, size * 3);
    const yEn = drawLtr(doc, en, M, y, col, { size, font, color });
    const yAr = drawRtl(doc, ar, xAr, y - 3, col, { size, font, color });
    return Math.max(yEn, yAr) + 4;
  };
  const heading = (y: number, key: string) => {
    y = ensure(y + 8, 40);
    y = pair(y, exportLabel("en", key), exportLabel("ar", key), 12, FONTS.semibold, NAVY);
    doc.moveTo(M, y).lineTo(W - M, y).lineWidth(0.5).strokeColor("#E5E7EB").stroke();
    return y + 6;
  };

  band();
  let y = 32;
  y = pair(y, input.school.en, input.school.ar, 10, FONTS.semibold, MUTED);
  y = pair(y + 4, exportLabel("en", "pdfTitle"), exportLabel("ar", "pdfTitle"), 17, FONTS.bold, NAVY);
  y = pair(y + 2, input.subjectName.en, input.subjectName.ar, 13, FONTS.semibold);
  y = pair(y, `${exportLabel("en", `kind.${input.kind}`)} · ${input.reference}`, `${exportLabel("ar", `kind.${input.kind}`)} · ${input.reference}`, 9, FONTS.regular, MUTED);
  y = pair(y, exportLabel("en", "generated", { date: fmt(input.generatedAt, "en") }), exportLabel("ar", "generated", { date: fmt(input.generatedAt, "ar") }), 9, FONTS.regular, MUTED);
  if (input.request) {
    y = pair(
      y,
      exportLabel("en", "requestLine", { number: input.request.number, type: exportLabel("en", `requestType.${input.request.type}`) }),
      exportLabel("ar", "requestLine", { number: input.request.number, type: exportLabel("ar", `requestType.${input.request.type}`) }),
      9,
      FONTS.regular,
      MUTED,
    );
  } else {
    y = pair(y, exportLabel("en", "noRequest"), exportLabel("ar", "noRequest"), 9, FONTS.regular, MUTED);
  }

  if (input.details.length) {
    y = heading(y + 6, "detailsTitle");
    for (const d of input.details) y = pair(y, `${exportLabel("en", `detail.${d.key}`)}: ${d.value}`, `${exportLabel("ar", `detail.${d.key}`)}: ${d.value}`);
  }

  y = heading(y + 6, "heldTitle");
  for (const a of input.areas) y = pair(y, `${areaLabel("en", a.model)}: ${a.count}`, `${areaLabel("ar", a.model)}: ${a.count}`);
  y = pair(y, exportLabel("en", "filesLine", { n: input.files }), exportLabel("ar", "filesLine", { n: input.files }));

  y = heading(y + 6, "withheldTitle");
  if (!input.withheld.length) y = pair(y, exportLabel("en", "withheldNone"), exportLabel("ar", "withheldNone"));
  for (const w of input.withheld) {
    y = pair(y, `${areaLabel("en", w.model)}: ${w.count}`, `${areaLabel("ar", w.model)}: ${w.count}`, 9, FONTS.semibold);
    y = pair(y, exportLabel("en", `reason.${w.reason}`), exportLabel("ar", `reason.${w.reason}`), 8, FONTS.regular, MUTED);
  }

  y = heading(y + 6, "contentsTitle");
  pair(y, exportLabel("en", "contentsBody"), exportLabel("ar", "contentsBody"), 8, FONTS.regular, MUTED);

  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.font(FONTS.regular).fontSize(7).fillColor(MUTED).text(exportLabel("en", "footer"), M, H - 34, { width: col, lineBreak: false });
    drawRtl(doc, exportLabel("ar", "footer"), xAr, H - 38, col, { size: 7, color: MUTED });
  }
  doc.end();
  return done;
}
