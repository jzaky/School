// Best-effort plain text extraction from an uploaded PDF, so a curriculum document can be read into the
// standards importer. Handles Flate-compressed content, object streams and ToUnicode font maps, which covers
// PDFs exported from common word processors. Scanned PDFs have no text; the caller asks the person to paste.
import { inflateSync } from "node:zlib";

type Obj = { dict: string; stream?: Buffer };
type CMap = { bytes: number; map: Map<number, string> };

function decodeStream(dict: string, raw: Buffer): Buffer | undefined {
  if (!/\/FlateDecode/.test(dict)) return /\/Filter/.test(dict) ? undefined : raw;
  try {
    return inflateSync(raw);
  } catch {
    try {
      return inflateSync(raw, { finishFlush: 2 });
    } catch {
      return undefined;
    }
  }
}

function parseObjects(buf: Buffer): Map<number, Obj> {
  const s = buf.toString("latin1");
  const objs = new Map<number, Obj>();
  const re = /(\d+)\s+\d+\s+obj\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const num = Number(m[1]);
    const start = m.index + m[0].length;
    const end = s.indexOf("endobj", start);
    if (end < 0) break;
    const body = s.slice(start, end);
    const si = body.search(/\bstream\r?\n/);
    if (si >= 0) {
      const dict = body.slice(0, si);
      const dataStart = start + si + body.slice(si).match(/^stream\r?\n/)![0].length;
      const lenMatch = dict.match(/\/Length\s+(\d+)(?!\s+\d+\s+R)/);
      let dataEnd = lenMatch ? dataStart + Number(lenMatch[1]) : s.indexOf("endstream", dataStart);
      if (dataEnd > end || dataEnd < dataStart) dataEnd = s.indexOf("endstream", dataStart);
      objs.set(num, { dict, stream: decodeStream(dict, buf.subarray(dataStart, dataEnd)) });
    } else objs.set(num, { dict: body });
    re.lastIndex = end;
  }
  // Objects packed inside object streams.
  for (const o of [...objs.values()]) {
    if (!/\/Type\s*\/ObjStm/.test(o.dict) || !o.stream) continue;
    const n = Number(o.dict.match(/\/N\s+(\d+)/)?.[1] ?? 0);
    const first = Number(o.dict.match(/\/First\s+(\d+)/)?.[1] ?? 0);
    const text = o.stream.toString("latin1");
    const nums = text.slice(0, first).trim().split(/\s+/).map(Number);
    for (let i = 0; i < n; i++) {
      const id = nums[i * 2];
      const off = first + nums[i * 2 + 1];
      const next = i + 1 < n ? first + nums[(i + 1) * 2 + 1] : text.length;
      if (!objs.has(id)) objs.set(id, { dict: text.slice(off, next) });
    }
  }
  return objs;
}

function hexToBytes(hex: string): number[] {
  const h = hex.replace(/[^0-9a-f]/gi, "");
  const padded = h.length % 2 ? `${h}0` : h;
  const out: number[] = [];
  for (let i = 0; i < padded.length; i += 2) out.push(parseInt(padded.slice(i, i + 2), 16));
  return out;
}

function utf16(hex: string) {
  const b = hexToBytes(hex);
  let s = "";
  for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode((b[i] << 8) | b[i + 1]);
  return s;
}

function parseCMap(text: string): CMap {
  const map = new Map<number, string>();
  const cs = text.match(/begincodespacerange\s*<([0-9a-fA-F]+)>/);
  const bytes = cs ? Math.max(1, cs[1].length / 2) : 2;
  for (const block of text.match(/beginbfchar([\s\S]*?)endbfchar/g) ?? []) {
    for (const m of block.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) map.set(parseInt(m[1], 16), utf16(m[2]));
  }
  for (const block of text.match(/beginbfrange([\s\S]*?)endbfrange/g) ?? []) {
    for (const m of block.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]+>|\[[^\]]*\])/g)) {
      const lo = parseInt(m[1], 16);
      const hi = parseInt(m[2], 16);
      if (hi - lo > 5000) continue;
      if (m[3].startsWith("[")) {
        const items = [...m[3].matchAll(/<([0-9a-fA-F]+)>/g)].map((x) => utf16(x[1]));
        items.forEach((u, i) => map.set(lo + i, u));
      } else {
        const base = utf16(m[3].slice(1, -1));
        const last = base.charCodeAt(base.length - 1);
        for (let c = lo; c <= hi; c++) map.set(c, base.slice(0, -1) + String.fromCharCode(last + (c - lo)));
      }
    }
  }
  return { bytes, map };
}

const ref = (s: string, key: string) => {
  const m = s.match(new RegExp(`/${key}\\s+(\\d+)\\s+\\d+\\s+R`));
  return m ? Number(m[1]) : null;
};

function fontMaps(objs: Map<number, Obj>) {
  const cmaps = new Map<number, CMap>();
  const byFontObj = new Map<number, CMap>();
  for (const [id, o] of objs) {
    const tu = ref(o.dict, "ToUnicode");
    if (tu === null) continue;
    const cm = objs.get(tu);
    if (!cm?.stream) continue;
    if (!cmaps.has(tu)) cmaps.set(tu, parseCMap(cm.stream.toString("latin1")));
    byFontObj.set(id, cmaps.get(tu)!);
  }
  // Resource names (/F1) to font objects. Names are usually consistent across pages.
  const byName = new Map<string, CMap | null>();
  const addFrom = (dict: string) => {
    for (const m of dict.matchAll(/\/([A-Za-z0-9_+.-]+)\s+(\d+)\s+\d+\s+R/g)) {
      const fid = Number(m[2]);
      const f = objs.get(fid);
      if (f && /\/Type\s*\/Font/.test(f.dict)) byName.set(m[1], byFontObj.get(fid) ?? null);
    }
  };
  for (const o of objs.values()) {
    const inline = o.dict.match(/\/Font\s*<<([\s\S]*?)>>/);
    if (inline) addFrom(inline[1]);
    const fr = ref(o.dict, "Font");
    if (fr !== null && objs.get(fr)) addFrom(objs.get(fr)!.dict);
  }
  return byName;
}

function pageContents(objs: Map<number, Obj>): number[] {
  const out: number[] = [];
  const catalog = [...objs.values()].find((o) => /\/Type\s*\/Catalog/.test(o.dict));
  const root = catalog ? ref(catalog.dict, "Pages") : null;
  const seen = new Set<number>();
  const walk = (id: number) => {
    if (seen.has(id)) return;
    seen.add(id);
    const o = objs.get(id);
    if (!o) return;
    const kids = o.dict.match(/\/Kids\s*\[([^\]]*)\]/);
    if (kids) for (const k of kids[1].matchAll(/(\d+)\s+\d+\s+R/g)) walk(Number(k[1]));
    const arr = o.dict.match(/\/Contents\s*\[([^\]]*)\]/);
    if (arr) for (const k of arr[1].matchAll(/(\d+)\s+\d+\s+R/g)) out.push(Number(k[1]));
    else {
      const c = ref(o.dict, "Contents");
      if (c !== null) out.push(c);
    }
  };
  if (root !== null) walk(root);
  return out;
}

function readLiteral(s: string, i: number): [number[], number] {
  const bytes: number[] = [];
  let depth = 1;
  i++;
  while (i < s.length && depth > 0) {
    const c = s[i];
    if (c === "\\") {
      const n = s[i + 1];
      const esc: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12, "(": 40, ")": 41, "\\": 92 };
      if (n in esc) {
        bytes.push(esc[n]);
        i += 2;
      } else if (/[0-7]/.test(n)) {
        const oct = s.slice(i + 1, i + 4).match(/^[0-7]{1,3}/)![0];
        bytes.push(parseInt(oct, 8) & 0xff);
        i += 1 + oct.length;
      } else if (n === "\r" || n === "\n") i += n === "\r" && s[i + 2] === "\n" ? 3 : 2;
      else i += 2;
      continue;
    }
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (depth > 0) bytes.push(c.charCodeAt(0));
    i++;
  }
  return [bytes, i];
}

function decodeBytes(bytes: number[], cmap: CMap | null | undefined) {
  if (!cmap) return String.fromCharCode(...bytes.filter((b) => b >= 32 || b === 9));
  let out = "";
  for (let i = 0; i + cmap.bytes <= bytes.length; i += cmap.bytes) {
    let code = 0;
    for (let k = 0; k < cmap.bytes; k++) code = (code << 8) | bytes[i + k];
    out += cmap.map.get(code) ?? "";
  }
  return out;
}

function textFromContent(s: string, fonts: Map<string, CMap | null>): string {
  let out = "";
  let font: CMap | null | undefined;
  const operands: Array<string | number | number[] | Array<number | number[]>> = [];
  let lastY: number | null = null;
  let i = 0;
  const emit = (t: string) => (out += t);
  while (i < s.length) {
    const c = s[i];
    if (c === "(") {
      const [b, j] = readLiteral(s, i);
      operands.push(b);
      i = j;
    } else if (c === "<" && s[i + 1] !== "<") {
      const j = s.indexOf(">", i);
      operands.push(hexToBytes(s.slice(i + 1, j)));
      i = j + 1;
    } else if (c === "[") {
      const arr: Array<number | number[]> = [];
      i++;
      while (i < s.length && s[i] !== "]") {
        if (s[i] === "(") {
          const [b, j] = readLiteral(s, i);
          arr.push(b);
          i = j;
        } else if (s[i] === "<") {
          const j = s.indexOf(">", i);
          arr.push(hexToBytes(s.slice(i + 1, j)));
          i = j + 1;
        } else {
          const m = s.slice(i).match(/^-?\d*\.?\d+/);
          if (m) {
            arr.push(Number(m[0]));
            i += m[0].length;
          } else i++;
        }
      }
      operands.push(arr);
      i++;
    } else if (c === "/") {
      const m = s.slice(i + 1).match(/^[^\s/<>[\]()]+/);
      operands.push(`/${m?.[0] ?? ""}`);
      i += 1 + (m?.[0].length ?? 0);
    } else if (/[-\d.]/.test(c)) {
      const m = s.slice(i).match(/^-?\d*\.?\d+/);
      if (m) {
        operands.push(Number(m[0]));
        i += m[0].length;
      } else i++;
    } else if (/[A-Za-z'"*]/.test(c)) {
      const m = s.slice(i).match(/^[A-Za-z'"*]+/)!;
      const op = m[0];
      i += op.length;
      if (op === "Tf") {
        const name = operands.find((o) => typeof o === "string") as string | undefined;
        if (name) font = fonts.get(name.slice(1));
      } else if (op === "Tj" || op === "'" || op === '"') {
        if (op !== "Tj") emit("\n");
        const b = operands[operands.length - 1];
        if (Array.isArray(b)) emit(decodeBytes(b as number[], font));
      } else if (op === "TJ") {
        const arr = operands[operands.length - 1];
        if (Array.isArray(arr)) {
          for (const part of arr as Array<number | number[]>) {
            if (typeof part === "number") {
              if (part < -180) emit(" ");
            } else emit(decodeBytes(part, font));
          }
        }
      } else if (op === "Td" || op === "TD") {
        const ty = operands[operands.length - 1];
        if (typeof ty === "number" && Math.abs(ty) > 0.5) emit("\n");
        else emit(" ");
      } else if (op === "Tm") {
        const y = operands[operands.length - 1];
        if (typeof y === "number") {
          if (lastY !== null && Math.abs(y - lastY) > 0.5) emit("\n");
          else if (lastY !== null) emit(" ");
          lastY = y;
        }
      } else if (op === "T*") {
        emit("\n");
      } else if (op === "ET") emit("\n");
      operands.length = 0;
    } else i++;
  }
  return out;
}

/** Extract readable text from a PDF. Returns an empty string when the file has no extractable text. */
export function extractPdfText(buf: Buffer): string {
  if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") return "";
  const objs = parseObjects(buf);
  const fonts = fontMaps(objs);
  let ids = pageContents(objs);
  if (!ids.length) ids = [...objs.entries()].filter(([, o]) => o.stream && /\bBT\b/.test(o.stream.toString("latin1"))).map(([id]) => id);
  const text = ids
    .map((id) => objs.get(id)?.stream)
    .filter((b): b is Buffer => Boolean(b))
    .map((b) => textFromContent(b.toString("latin1"), fonts))
    .join("\n");
  return text
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter((l, i, arr) => l || (i > 0 && arr[i - 1]))
    .join("\n")
    .trim();
}
