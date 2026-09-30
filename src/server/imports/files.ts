// Reading an uploaded spreadsheet into a table of cells: CSV (UTF-8, UTF-16 or the Arabic Windows code page
// that older Excel versions save) or the first sheet of an .xlsx file.
import Papa from "papaparse";
import { readXlsx } from "@/server/transcripts/xlsx";

export class FileReadError extends Error {
  constructor(public code: "TYPE" | "XLS_OLD" | "UNREADABLE" | "EMPTY") {
    super(`file:${code}`);
  }
}

/** Decodes CSV bytes: a BOM wins, then strict UTF-8, then Windows-1256 (Arabic Excel "CSV"). */
export function decodeText(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder("utf-16le").decode(buf.subarray(2));
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder("utf-16be").decode(buf.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf).replace(/^﻿/, "");
  } catch {
    try {
      return new TextDecoder("windows-1256").decode(buf);
    } catch {
      return buf.toString("latin1");
    }
  }
}

/**
 * The separator used by the header line (comma, semicolon as in some European Excel settings, or tab).
 * Decided from the header only, because data cells often hold lists written with semicolons.
 */
export function detectDelimiter(text: string): string {
  const header = text.split(/\r?\n/).find((l) => l.trim()) ?? "";
  const count = (ch: string) => header.split(ch).length - 1;
  const options = [",", ";", "\t"].map((d) => ({ d, n: count(d) }));
  const best = options.reduce((a, b) => (b.n > a.n ? b : a));
  return best.n > 0 ? best.d : ",";
}

export function parseCsvTable(text: string): string[][] {
  const clean = text.replace(/^﻿/, "");
  const res = Papa.parse<string[]>(clean, { skipEmptyLines: false, delimiter: detectDelimiter(clean) });
  return res.data.map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? "")) : []));
}

/** The file as rows of cells. `maxRows` bounds the work on very large files (the caller reports the limit). */
export function readTable(fileName: string, buf: Buffer, maxRows: number): { table: string[][]; xlsx: boolean } {
  const name = fileName.toLowerCase();
  if (name.endsWith(".xls")) throw new FileReadError("XLS_OLD");
  if (name.endsWith(".xlsx")) {
    try {
      return { table: readXlsx(buf, maxRows), xlsx: true };
    } catch {
      throw new FileReadError("UNREADABLE");
    }
  }
  if (!name.endsWith(".csv") && !name.endsWith(".txt")) throw new FileReadError("TYPE");
  return { table: parseCsvTable(decodeText(buf)).slice(0, maxRows), xlsx: false };
}
