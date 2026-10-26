// Checks for files families upload with an application. Pure (works on bytes), so it is unit tested.
//
// Only documents and photos are accepted, recognised by their content (magic bytes), never by the name or the
// browser's claimed type: PDF, JPEG, PNG, WebP and HEIC (phone photos). Anything else, including every executable,
// script, archive, Office file, HTML or SVG, is refused. The file's extension must match its content, and a PDF that
// carries JavaScript or launch actions is refused. Files are always served as downloads with nosniff.
import { MAX_UPLOAD_BYTES } from "./config";

export type Sniffed = { mime: string; ext: string };

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);
const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));

/** The file type from its first bytes, or null when it is not an accepted document or image. */
export function sniff(b: Uint8Array): Sniffed | null {
  if (b.length < 12) return null;
  if (startsWith(b, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { mime: "application/pdf", ext: "pdf" };
  if (startsWith(b, [0xff, 0xd8, 0xff])) return { mime: "image/jpeg", ext: "jpg" };
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: "image/png", ext: "png" };
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return { mime: "image/webp", ext: "webp" };
  if (ascii(b, 4, 8) === "ftyp" && ["heic", "heix", "heif", "mif1", "msf1", "hevc"].includes(ascii(b, 8, 12))) return { mime: "image/heic", ext: "heic" };
  return null;
}

const EXT_OK: Record<string, string[]> = {
  pdf: ["pdf"],
  jpg: ["jpg", "jpeg"],
  png: ["png"],
  webp: ["webp"],
  heic: ["heic", "heif"],
};

/** A safe stored name: the original base name (letters, digits, Arabic, dots, dashes) and the real extension. */
export function safeFileName(name: string, ext: string): string {
  const base = name
    .replace(/\.[^.]*$/, "")
    .replace(/[^\p{L}\p{N} _-]+/gu, " ")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || "document"}.${ext}`;
}

export type UploadProblem = "EMPTY" | "TOO_LARGE" | "TYPE" | "EXTENSION" | "ACTIVE_CONTENT";

/** Validate an uploaded file. Returns the detected type and a safe name, or the reason it is refused. */
export function checkUpload(name: string, bytes: Uint8Array, maxBytes = MAX_UPLOAD_BYTES): { ok: true; type: Sniffed; fileName: string } | { ok: false; problem: UploadProblem } {
  if (bytes.length === 0) return { ok: false, problem: "EMPTY" };
  if (bytes.length > maxBytes) return { ok: false, problem: "TOO_LARGE" };
  const type = sniff(bytes);
  if (!type) return { ok: false, problem: "TYPE" };
  const parts = name.toLowerCase().split(".");
  const ext = parts.length > 1 ? parts[parts.length - 1] : "";
  // Double extensions such as "report.pdf.exe" fail here: the last extension must match the content.
  if (!EXT_OK[type.ext].includes(ext)) return { ok: false, problem: "EXTENSION" };
  if (type.ext === "pdf" && hasActivePdfContent(bytes)) return { ok: false, problem: "ACTIVE_CONTENT" };
  return { ok: true, type, fileName: safeFileName(name, ext === "jpeg" ? "jpg" : ext) };
}

/** PDFs that run code when opened: JavaScript, launch actions, embedded files or forms that submit. */
export function hasActivePdfContent(bytes: Uint8Array): boolean {
  // Scan as latin1 text; names in PDF dictionaries are ASCII. Hex-escaped names (/J#61vaScript) are normalised.
  const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("latin1").replace(/#([0-9a-f]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
  return /\/(JavaScript|JS|Launch|EmbeddedFile|SubmitForm|RichMedia)\b/.test(text);
}
