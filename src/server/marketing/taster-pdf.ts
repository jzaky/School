// Career taster result as a bilingual PDF: page one in English, page two in Arabic (right to left).
// Uses the shared PDF helpers, which shape Arabic glyphs and order mixed-direction runs correctly.
import PDFDocument from "pdfkit";
import { DIMENSIONS } from "@/server/career/dimensions";
import { drawLtr, drawRtl, FONTS, GOLD, MUTED, NAVY } from "@/server/documents/pdf";
import { areaExplanation, dimensionLabel, type TasterResult } from "./taster";

const COPY = {
  en: {
    title: "Career taster result",
    prepared: (name: string, date: string) => `Prepared for ${name} on ${date}`,
    areas: "Career areas that fit you",
    match: (n: number) => `${n}% match`,
    examples: "Example careers",
    profile: "Strengths profile",
    disclaimer: "A short 12-question taster, not a full assessment. Talk it through with a parent, teacher or school counselor.",
  },
  ar: {
    title: "نتيجة مستكشف المهن",
    prepared: (name: string, date: string) => `أُعدّت لـ ${name} بتاريخ ${date}`,
    areas: "المجالات المهنية المناسبة لك",
    match: (n: number) => `نسبة التوافق ${n}%`,
    examples: "أمثلة على المهن",
    profile: "ملف نقاط القوة",
    disclaimer: "مستكشف قصير من 12 عبارة وليس تقييمًا كاملًا. ناقش النتيجة مع ولي أمرك أو معلمك أو المرشد المدرسي.",
  },
} as const;

type Doc = PDFKit.PDFDocument;

function page(doc: Doc, locale: "en" | "ar", name: string, result: TasterResult, now: Date) {
  const c = COPY[locale];
  const rtl = locale === "ar";
  const W = doc.page.width;
  const M = 48;
  const inner = W - M * 2;
  const text = (s: string, y: number, size: number, opts: { font?: string; color?: string; x?: number; width?: number } = {}) =>
    rtl
      ? drawRtl(doc, s, opts.x ?? M, y, opts.width ?? inner, { size, font: opts.font, color: opts.color })
      : drawLtr(doc, s, opts.x ?? M, y, opts.width ?? inner, { size, font: opts.font, color: opts.color });

  doc.rect(0, 0, W, 6).fill(NAVY);
  doc.rect(0, 6, W, 2).fill(GOLD);
  let y = text("Horizon", 28, 10, { font: FONTS.semibold, color: GOLD });
  y = text(c.title, y + 4, 20, { font: FONTS.bold, color: NAVY });
  const date = new Intl.DateTimeFormat(rtl ? "ar-AE-u-nu-latn" : "en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Dubai" }).format(now);
  y = text(c.prepared(name, date), y + 2, 10, { color: MUTED });

  y = text(c.areas, y + 18, 13, { font: FONTS.semibold, color: NAVY });
  result.areas.slice(0, 3).forEach((a, i) => {
    const top = y + 8;
    y = text(`${i + 1}. ${a.name[locale]}  ·  ${c.match(a.matchScore)}`, top, 11.5, { font: FONTS.semibold });
    y = text(areaExplanation(a, locale), y + 1, 9.5, { color: "#374151" });
    y = text(`${c.examples}: ${a.careers.map((x) => x.title[locale]).join(rtl ? "، " : ", ")}`, y + 1, 9, { color: MUTED });
  });

  y = text(c.profile, y + 18, 13, { font: FONTS.semibold, color: NAVY });
  y += 8;
  const labelW = 170;
  const barW = inner - labelW - 40;
  for (const d of [...DIMENSIONS].sort((p, q) => result.scores[q] - result.scores[p])) {
    const score = result.scores[d];
    const barX = rtl ? M + 40 : M + labelW;
    const labelX = rtl ? M + inner - labelW : M;
    text(dimensionLabel(d, locale), y - 2, 9, { x: labelX, width: labelW - 10 });
    doc.roundedRect(barX, y + 2, barW, 7, 3.5).fill("#E5E7EB");
    const fill = Math.max(4, (barW * score) / 100);
    doc.roundedRect(rtl ? barX + barW - fill : barX, y + 2, fill, 7, 3.5).fill(NAVY);
    // The score sits at the outer edge: after the bar in English, before it in Arabic.
    doc.font(FONTS.regular).fontSize(9).fillColor(MUTED);
    const sw = doc.widthOfString(String(score));
    doc.text(String(score), rtl ? M : M + inner - sw, y, { lineBreak: false });
    y += 20;
  }
  text(c.disclaimer, doc.page.height - 70, 8.5, { color: MUTED });
}

export async function renderTasterPdf(input: { name: string; result: TasterResult; now?: Date }): Promise<Buffer> {
  const now = input.now ?? new Date();
  const doc = new PDFDocument({ size: "A4", margin: 0, info: { Title: "Career taster result" } });
  const chunks: Buffer[] = [];
  doc.on("data", (b: Buffer) => chunks.push(b));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  page(doc, "en", input.name, input.result, now);
  doc.addPage({ size: "A4", margin: 0 });
  page(doc, "ar", input.name, input.result, now);
  doc.end();
  return done;
}
