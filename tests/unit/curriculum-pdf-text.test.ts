import { describe, expect, it } from "vitest";
import path from "node:path";
import PDFDocument from "pdfkit";
import { extractPdfText } from "@/server/curriculum/pdf-text";
import { renderLessonPlanPdf } from "@/server/curriculum/pdf";

function makePdf(draw: (doc: PDFKit.PDFDocument) => void, opts: { compress?: boolean } = {}): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", compress: opts.compress ?? true });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  draw(doc);
  doc.end();
  return done;
}

describe("extractPdfText", () => {
  it("reads text drawn with an embedded font (ToUnicode map, compressed)", async () => {
    const font = path.join(process.cwd(), "assets", "fonts", "IBMPlexSansArabic-Regular.ttf");
    const pdf = await makePdf((doc) => {
      doc.font(font).fontSize(12);
      doc.text("Algorithms and programming");
      doc.text("1. Design an algorithm using a flowchart");
      doc.text("2. Write a program that uses selection");
      doc.addPage();
      doc.text("3. Explain how data is represented in binary");
    });
    const text = extractPdfText(pdf);
    expect(text).toContain("Algorithms and programming");
    expect(text).toContain("1. Design an algorithm using a flowchart");
    expect(text).toContain("3. Explain how data is represented in binary");
    expect(text.indexOf("1. Design")).toBeLessThan(text.indexOf("3. Explain"));
  });

  it("reads text drawn with a standard font, uncompressed", async () => {
    const pdf = await makePdf((doc) => {
      doc.font("Helvetica").text("Number: use place value to round decimals");
    }, { compress: false });
    expect(extractPdfText(pdf)).toContain("Number: use place value to round decimals");
  });

  it("returns an empty string for something that is not a PDF", () => {
    expect(extractPdfText(Buffer.from("hello"))).toBe("");
  });

  it("renders a lesson plan PDF whose session plan can be read back", async () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ time: `Min ${i} to ${i + 1}`, phase: "Main", title: `Activity ${i + 1}`, detail: "Pairs complete scaffolded questions." }));
    const pdf = await renderLessonPlanPdf({
      rtl: false,
      school: "Horizon International School",
      title: "Loops and iteration",
      subtitle: "Computer Science · Grade 9",
      meta: [["Class", "Computer Science 9"], ["Teacher", "Daniel Carter"]],
      sections: [{ heading: "Learning objectives", lines: ["Students can write count controlled loops."] }],
      session: { heading: "Session plan", rows },
      footer: "Lesson plan footer",
    });
    const text = extractPdfText(pdf);
    expect(text).toContain("Loops and iteration");
    expect(text).toContain("Activity 30");
    expect(text).toContain("Students can write count controlled loops.");
    const ar = await renderLessonPlanPdf({ rtl: true, school: "مدرسة", title: "الحلقات", subtitle: "الصف 9", meta: [["الشعبة", "علوم الحاسوب 9"]], sections: [], session: { heading: "خطة الحصة", rows: rows.slice(0, 3) }, footer: "تذييل" });
    expect(ar.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
