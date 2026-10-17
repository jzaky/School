/**
 * Generates a small real PDF at test time with pdfkit (nothing binary is checked in).
 * pdfVersion 1.4 is required: pdf-parse's bundled pdf.js cannot read pdfkit's default 1.7 xref.
 */
import PDFDocument from "pdfkit";

export function makePdf(pages: string[], title = "Test document"): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, pdfVersion: "1.4", info: { Title: title } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    pages.forEach((text, i) => {
      if (i > 0) doc.addPage();
      doc.font("Helvetica").fontSize(11).text(text, { width: 495 });
    });
    doc.end();
  });
}
