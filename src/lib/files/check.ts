// Upload checks shared by every place that stores a file people upload. Pure (works on bytes), unit tested.
//
// A file is recognised by its content (magic bytes), never by its name or the type the browser claims. Each
// upload path lists the kinds it accepts; everything else is refused, including HTML, SVG, scripts, executables
// and archives. The name's extension must match the content, PDFs that run code when opened are refused, Word
// files with macros are refused, and the stored name is rebuilt from safe characters with the real extension.

export type FileKind = "pdf" | "jpeg" | "png" | "webp" | "heic" | "docx" | "doc" | "xlsx" | "csv";

export type Sniffed = { kind: FileKind; mime: string; ext: string };

const MIME: Record<FileKind, string> = {
  pdf: "application/pdf",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
};

/** Extensions a name may carry for each kind (the first is the one stored). */
const EXTENSIONS: Record<FileKind, string[]> = {
  pdf: ["pdf"],
  jpeg: ["jpg", "jpeg"],
  png: ["png"],
  webp: ["webp"],
  heic: ["heic", "heif"],
  docx: ["docx"],
  doc: ["doc"],
  xlsx: ["xlsx"],
  csv: ["csv", "txt"],
};

/**
 * The content type for a stored file, from the extension the upload check gave it (stored names always end in the
 * real extension). Unknown extensions are served as opaque bytes.
 */
export function mimeForName(name: string): string {
  const ext = String(name ?? "").toLowerCase().split(".").pop() ?? "";
  for (const [kind, exts] of Object.entries(EXTENSIONS) as Array<[FileKind, string[]]>) if (exts.includes(ext)) return MIME[kind];
  return "application/octet-stream";
}

/** Kinds that are safe to show inline in a browser tab (everything else is sent as a download). */
export const INLINE_SAFE_MIME = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);
const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, Math.min(to, b.length)));
const latin1 = (b: Uint8Array) => Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString("latin1");

/** Entry names in a ZIP's central directory (enough to tell Word from Excel from any other archive). */
export function zipEntryNames(b: Uint8Array, max = 2000): string[] | null {
  const buf = Buffer.from(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const names: string[] = [];
  for (let n = 0; n < count && n < max; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) return null;
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    names.push(buf.subarray(p + 46, p + 46 + nameLen).toString("utf8"));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

/** Plain text that is safe to keep as CSV: valid UTF-8, no control bytes, and not markup a browser would run. */
function looksLikeCsv(b: Uint8Array): boolean {
  const head = b.subarray(0, 64 * 1024);
  for (const c of head) if (c === 0 || (c < 0x09) || (c > 0x0d && c < 0x20 && c !== 0x1b)) return false;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(head.length < b.length ? head.subarray(0, lastCharBoundary(head)) : head);
  } catch {
    return false;
  }
  const start = text.replace(/^\uFEFF/, "").trimStart().slice(0, 512).toLowerCase();
  if (start.startsWith("<") || /<(script|html|svg|iframe|body|meta|object|embed)\b/.test(text.toLowerCase())) return false;
  return true;
}

/** Cut point that does not split a multi-byte UTF-8 character. */
function lastCharBoundary(b: Uint8Array): number {
  let i = b.length;
  while (i > 0 && i > b.length - 4 && (b[i - 1] & 0xc0) === 0x80) i--;
  if (i > 0 && b[i - 1] >= 0xc0) i--;
  return i;
}

/** The file type from its content, or null when it is not a kind Horizon ever accepts. */
export function sniffFile(b: Uint8Array): Sniffed | null {
  const kind = sniffKind(b);
  return kind ? { kind, mime: MIME[kind], ext: EXTENSIONS[kind][0] } : null;
}

function sniffKind(b: Uint8Array): FileKind | null {
  if (b.length < 4) return null;
  if (startsWith(b, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf";
  if (startsWith(b, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return "webp";
  if (b.length >= 12 && ascii(b, 4, 8) === "ftyp" && ["heic", "heix", "heif", "mif1", "msf1", "hevc"].includes(ascii(b, 8, 12))) return "heic";
  if (startsWith(b, [0x50, 0x4b, 0x03, 0x04])) {
    const names = zipEntryNames(b);
    if (!names) return null;
    if (names.includes("[Content_Types].xml") && names.some((n) => n.startsWith("word/"))) return "docx";
    if (names.includes("[Content_Types].xml") && names.some((n) => n.startsWith("xl/"))) return "xlsx";
    return null;
  }
  if (startsWith(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return "doc";
  if (looksLikeCsv(b)) return "csv";
  return null;
}

/** PDFs that run code when opened: JavaScript, launch actions, embedded files or forms that submit. */
export function hasActivePdfContent(bytes: Uint8Array): boolean {
  // Names in PDF dictionaries are ASCII; hex-escaped names (/J#61vaScript) are normalised first.
  const text = latin1(bytes).replace(/#([0-9a-f]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
  return /\/(JavaScript|JS|Launch|EmbeddedFile|SubmitForm|RichMedia)\b/.test(text);
}

/** Word files that carry macros (a VBA project in a .docx, or macro storage in an old .doc). */
export function hasMacros(kind: FileKind, bytes: Uint8Array): boolean {
  if (kind === "docx" || kind === "xlsx") return (zipEntryNames(bytes) ?? []).some((n) => /vbaProject\.bin$|vbaData\.xml$/i.test(n));
  if (kind === "doc") {
    // OLE directory entry names are UTF-16LE.
    const utf16 = (s: string) => Buffer.from(s, "utf16le").toString("latin1");
    const text = latin1(bytes);
    return [utf16("_VBA_PROJECT"), utf16("Macros"), utf16("VBA")].some((n) => text.includes(n));
  }
  return false;
}

/** A safe stored name: the original base name (letters in any script, digits, spaces, dashes) and the real extension. */
export function safeFileName(name: string, ext: string): string {
  const base = String(name ?? "")
    .normalize("NFC")
    .replace(/\.[^.]*$/, "")
    .replace(/[^\p{L}\p{N} _-]+/gu, " ")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || "file"}.${ext}`;
}

export type UploadProblem = "EMPTY" | "TOO_LARGE" | "TYPE" | "EXTENSION" | "ACTIVE_CONTENT";
export type CheckedFile = { ok: true; type: Sniffed; fileName: string };

/** Validate an upload against the kinds this path accepts. Returns the detected type and a safe name, or why not. */
export function checkFile(name: string, bytes: Uint8Array, opts: { allow: readonly FileKind[]; maxBytes: number }): CheckedFile | { ok: false; problem: UploadProblem } {
  if (bytes.length === 0) return { ok: false, problem: "EMPTY" };
  if (bytes.length > opts.maxBytes) return { ok: false, problem: "TOO_LARGE" };
  const type = sniffFile(bytes);
  if (!type || !opts.allow.includes(type.kind)) return { ok: false, problem: "TYPE" };
  const parts = String(name ?? "").toLowerCase().split(".");
  const ext = parts.length > 1 ? parts[parts.length - 1] : "";
  // Double extensions such as "report.pdf.exe" fail here: the last extension must match the content.
  if (!EXTENSIONS[type.kind].includes(ext)) return { ok: false, problem: "EXTENSION" };
  if (type.kind === "pdf" && hasActivePdfContent(bytes)) return { ok: false, problem: "ACTIVE_CONTENT" };
  if (hasMacros(type.kind, bytes)) return { ok: false, problem: "ACTIVE_CONTENT" };
  return { ok: true, type, fileName: safeFileName(name, ext === "jpeg" ? "jpg" : ext) };
}

/** Kinds for general documents and form attachments. */
export const DOCUMENT_KINDS: readonly FileKind[] = ["pdf", "jpeg", "png", "webp", "heic", "docx", "doc", "csv"];
/** Kinds for logos and photos shown in the app. */
export const IMAGE_KINDS: readonly FileKind[] = ["jpeg", "png", "webp"];

/**
 * A Content-Disposition value that is safe for any file name: an ASCII fallback plus the UTF-8 name (RFC 6266),
 * so Arabic names survive and quotes or line breaks can never break the header.
 */
export function contentDisposition(kind: "inline" | "attachment", fileName: string): string {
  const name = String(fileName ?? "file").normalize("NFC").replace(/[\r\n"\\]/g, "_").slice(0, 150) || "file";
  const fallback = name.replace(/[^\x20-\x7e]/g, "_");
  return `${kind}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}

/** Inline only for content types a browser shows without running anything; everything else downloads. */
export function dispositionFor(mime: string | null | undefined, fileName: string, wantInline: boolean): string {
  return contentDisposition(wantInline && INLINE_SAFE_MIME.has(String(mime ?? "").toLowerCase()) ? "inline" : "attachment", fileName);
}
