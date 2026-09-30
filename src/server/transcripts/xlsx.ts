// Minimal XLSX reader: the first worksheet as a table of strings. Server only (node:zlib).
// An .xlsx file is a zip of XML parts; we read the central directory, inflate the parts we need
// (shared strings, workbook, first sheet) and read cell values. Formulas give their cached value.
// No spreadsheet library is installed, and this is all a transcript import needs.
import { inflateRawSync } from "node:zlib";

type Entry = { name: string; method: number; size: number; offset: number };

function entries(buf: Buffer): Entry[] {
  // End of central directory: signature 0x06054b50, within the last 64 KB plus 22 bytes.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not_zip");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out: Entry[] = [];
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    out.push({ name: buf.subarray(p + 46, p + 46 + nameLen).toString("utf8"), method, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function read(buf: Buffer, e: Entry): string {
  if (buf.readUInt32LE(e.offset) !== 0x04034b50) throw new Error("bad_entry");
  const start = e.offset + 30 + buf.readUInt16LE(e.offset + 26) + buf.readUInt16LE(e.offset + 28);
  const raw = buf.subarray(start, start + e.size);
  if (e.method === 0) return raw.toString("utf8");
  if (e.method === 8) return inflateRawSync(raw).toString("utf8");
  throw new Error("unsupported_compression");
}

const decode = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&amp;/g, "&");

const texts = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1])).join("");

function colIndex(ref: string): number {
  const letters = ref.replace(/\d+/g, "");
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** The first worksheet as rows of cell text. Throws on files that are not xlsx. */
export function readXlsx(buf: Buffer, maxRows = 200): string[][] {
  const list = entries(buf);
  const byName = new Map(list.map((e) => [e.name, e]));
  const shared: string[] = [];
  const ss = byName.get("xl/sharedStrings.xml");
  if (ss) for (const m of read(buf, ss).matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(texts(m[1]));
  // First sheet in workbook order, through the workbook relationships.
  let sheetPath = "xl/worksheets/sheet1.xml";
  const wb = byName.get("xl/workbook.xml");
  const rels = byName.get("xl/_rels/workbook.xml.rels");
  if (wb && rels) {
    const rid = read(buf, wb).match(/<sheet\b[^>]*\br:id="([^"]+)"/)?.[1];
    const target = rid ? read(buf, rels).match(new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"`))?.[1] ?? read(buf, rels).match(new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${rid}"`))?.[1] : undefined;
    if (target) sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
  }
  const sheet = byName.get(sheetPath) ?? list.find((e) => e.name.startsWith("xl/worksheets/") && e.name.endsWith(".xml"));
  if (!sheet) throw new Error("no_sheet");
  const xml = read(buf, sheet);
  const rows: string[][] = [];
  for (const rm of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    // Excel leaves blank rows out of the XML; keep them as empty rows so row numbers match the sheet.
    const rowNo = Number(rm[1].match(/\br="(\d+)"/)?.[1] ?? 0);
    while (rowNo > rows.length + 1 && rows.length < maxRows) rows.push([]);
    if (rows.length >= maxRows) break;
    const row: string[] = [];
    for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const body = cm[2] ?? "";
      const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1];
      const type = attrs.match(/\bt="(\w+)"/)?.[1];
      const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let value = "";
      if (type === "s") value = shared[Number(v)] ?? "";
      else if (type === "inlineStr") value = texts(body);
      else if (type === "b") value = v === "1" ? "TRUE" : "FALSE";
      else value = v !== undefined ? decode(v) : "";
      const idx = ref ? colIndex(ref) : row.length;
      while (row.length < idx) row.push("");
      row[idx] = value;
    }
    rows.push(row);
  }
  return rows;
}
