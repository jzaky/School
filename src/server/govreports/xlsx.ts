// A workbook with several sheets, bold two-row headers (English, then Arabic), frozen header rows, column widths
// and an optional warning row style. Built on the in-house ZIP writer; cells are text or numbers, never formulas.
import { createZip } from "@/lib/zip";

export type SheetCell = string | number | null;
export type Sheet = {
  name: string;
  /** Header rows (bold, frozen). Usually two: English and Arabic. */
  headers: SheetCell[][];
  rows: SheetCell[][];
  /** Rows (by index in `rows`) to show bold, for example a total row. */
  boldRows?: number[];
  /** Rows to show as a warning (amber fill). */
  warnRows?: number[];
  rtl?: boolean;
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

function colName(i: number) {
  let n = i + 1;
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// Styles: 0 normal, 1 header (bold, light fill, bottom border), 2 bold, 3 warning (bold, amber fill).
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF6"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF3D6"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border/><border><bottom style="thin"><color rgb="FF9AA5B4"/></bottom></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="1" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs></styleSheet>`;

function cell(ref: string, v: SheetCell, style: number): string {
  const s = style ? ` s="${style}"` : "";
  if (v === null || v === undefined || v === "") return style ? `<c r="${ref}"${s}/>` : "";
  if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}"${s}><v>${v}</v></c>`;
  return `<c r="${ref}" t="inlineStr"${s}><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`;
}

function sheetXml(sh: Sheet): string {
  const all = [...sh.headers, ...sh.rows];
  const width = Math.max(1, ...all.map((r) => r.length));
  const widths = Array.from({ length: width }, (_, j) => Math.min(60, Math.max(8, ...all.map((r) => String(r[j] ?? "").length + 2))));
  const cols = `<cols>${widths.map((w, j) => `<col min="${j + 1}" max="${j + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>`;
  const bold = new Set(sh.boldRows ?? []);
  const warn = new Set(sh.warnRows ?? []);
  const body = all
    .map((r, i) => {
      const di = i - sh.headers.length;
      const style = i < sh.headers.length ? 1 : warn.has(di) ? 3 : bold.has(di) ? 2 : 0;
      return `<row r="${i + 1}">${r.map((v, j) => cell(`${colName(j)}${i + 1}`, v, style)).join("")}</row>`;
    })
    .join("");
  const frozen = sh.headers.length ? `<pane ySplit="${sh.headers.length}" topLeftCell="A${sh.headers.length + 1}" activePane="bottomLeft" state="frozen"/>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"${sh.rtl ? ' rightToLeft="1"' : ""}>${frozen}</sheetView></sheetViews>${cols}<sheetData>${body}</sheetData></worksheet>`;
}

/** Sheet names: at most 31 characters, no []:*?/\ and unique within the workbook. */
function sheetNames(names: string[]) {
  const used = new Set<string>();
  return names.map((n, i) => {
    let base = n.replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31) || `Sheet${i + 1}`;
    let k = 2;
    while (used.has(base.toLowerCase())) base = `${base.slice(0, 28)} ${k++}`;
    used.add(base.toLowerCase());
    return base;
  });
}

export function workbook(sheets: Sheet[]): Buffer {
  const names = sheetNames(sheets.map((s) => s.name));
  const overrides = sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("");
  const wbSheets = names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("");
  const rels = sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("");
  return createZip([
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${overrides}</Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${wbSheets}</sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", data: STYLES },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) })),
  ]);
}
