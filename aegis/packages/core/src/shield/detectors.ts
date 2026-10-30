/**
 * Shield detector registry.
 *
 * Original implementation following the publicly described recognizer / anonymizer pattern
 * (a recognizer returns typed spans with a confidence; an anonymizer operator rewrites each
 * span according to the configured action). No code is copied from any project. Checksums
 * (IBAN mod-97, Luhn) are implemented from the public algorithms.
 *
 * Every detector is deterministic: same input, same spans. Confidence values are heuristic
 * labels that explain how strong the match is (format plus checksum is stronger than format
 * alone); they never change the configured action.
 *
 * Nothing in this file logs. Findings carry field paths, class keys and masked previews only.
 */

export interface DetectorSpan {
  start: number;
  end: number;
  value: string;
  /** 0..1 heuristic strength of the match. */
  confidence: number;
  /** Optional detector note, for example "checksum valid" or "format only". */
  note?: string;
}

export type Detector = (text: string) => DetectorSpan[];

export type DataAction = "allow" | "mask" | "redact" | "block" | "require_approval";
export type Severity = "low" | "medium" | "high" | "critical";

export const SEVERITY_ORDER: Severity[] = ["low", "medium", "high", "critical"];

export function severityRank(s: string | null | undefined): number {
  const i = SEVERITY_ORDER.indexOf((s ?? "") as Severity);
  return i < 0 ? 0 : i;
}

export function maxSeverity(values: (string | null | undefined)[]): Severity | null {
  let best: Severity | null = null;
  for (const v of values) {
    if (!v) continue;
    if (best === null || severityRank(v) > severityRank(best)) best = v as Severity;
  }
  return best;
}

/** Hard limits that keep inspection bounded for any input. */
export const LIMITS = {
  /** Longest single string a detector scans; longer strings are scanned up to this length and flagged. */
  maxStringLength: 200_000,
  /** Deepest object nesting inspected. */
  maxDepth: 32,
  /** Maximum matches collected per detector per string. */
  maxMatchesPerDetector: 1_000,
  /** Custom patterns: maximum source length. */
  maxCustomPatternLength: 500,
  /** Custom patterns: maximum string length scanned. */
  maxCustomScanLength: 20_000,
  /** Custom patterns: wall-clock budget per string in milliseconds, checked between matches. */
  customScanBudgetMs: 50,
} as const;

// ---------- helpers ----------

function runRegex(text: string, re: RegExp, confidence: number, accept?: (m: RegExpExecArray) => { ok: boolean; confidence?: number; note?: string }): DetectorSpan[] {
  const out: DetectorSpan[] = [];
  const input = text.length > LIMITS.maxStringLength ? text.slice(0, LIMITS.maxStringLength) : text;
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex += 1;
      continue;
    }
    const verdict = accept ? accept(m) : { ok: true };
    if (verdict.ok) {
      out.push({ start: m.index, end: m.index + m[0].length, value: m[0], confidence: verdict.confidence ?? confidence, ...(verdict.note ? { note: verdict.note } : {}) });
      if (out.length >= LIMITS.maxMatchesPerDetector) break;
    }
  }
  return out;
}

/** Luhn (ISO/IEC 7812) check over a digit string. Public algorithm. */
export function luhnValid(digits: string): boolean {
  if (!/^\d{2,}$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** IBAN mod-97 (ISO 7064) check over a normalised IBAN (no spaces, upper case). Public algorithm. */
export function ibanChecksumValid(iban: string): boolean {
  const s = iban.replace(/[\s-]/g, "").toUpperCase();
  if (s.length < 15 || s.length > 34) return false;
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(s)) return false;
  const rearranged = s.slice(4) + s.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const v = ch >= "A" && ch <= "Z" ? String(ch.charCodeAt(0) - 55) : ch;
    remainder = Number(String(remainder) + v) % 97;
  }
  return remainder === 1;
}

/** Shannon entropy in bits per character. */
export function shannonEntropy(s: string): number {
  if (s.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  for (const c of counts.values()) {
    const p = c / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------- built-in detectors ----------

const email: Detector = (text) => runRegex(text, /[A-Za-z0-9._%+-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,24}/g, 0.9);

/**
 * Phone numbers: international (+ or 00 prefix, 7 to 15 digits, UAE +971 included) and UAE
 * local formats (05x mobile, 0x landline). Digit runs that belong to card numbers or IBANs are
 * resolved by the overlap rule in classifyText (longer, stronger span wins).
 */
const phone: Detector = (text) => {
  const intl = runRegex(text, /(?<![\w+])(?:\+|00)\d{1,3}[\s.-]?(?:\(\d{1,4}\)[\s.-]?)?\d{1,4}(?:[\s.-]?\d{2,4}){1,4}(?!\d)/g, 0.8, (m) => {
    const digits = m[0].replace(/\D/g, "");
    return { ok: digits.length >= 8 && digits.length <= 15 };
  });
  const local = runRegex(text, /(?<![\w+.-])0(?:5\d|[2-9])[\s-]?\d{3}[\s-]?\d{4}(?!\d)/g, 0.6, (m) => {
    const digits = m[0].replace(/\D/g, "");
    return { ok: digits.length === 9 || digits.length === 10, note: "UAE local format" };
  });
  return [...intl, ...local];
};

const iban: Detector = (text) =>
  runRegex(text, /(?<![A-Z0-9])[A-Z]{2}\d{2}(?:[ -]?[A-Z0-9]){11,30}(?![A-Z0-9])/g, 0.98, (m) => {
    const ok = ibanChecksumValid(m[0]);
    return ok ? { ok: true, note: "mod-97 checksum valid" } : { ok: false };
  });

const cardNumber: Detector = (text) =>
  runRegex(text, /(?<![\dA-Z])(?:\d[ -]?){12,18}\d(?!\d)/g, 0.95, (m) => {
    const digits = m[0].replace(/\D/g, "");
    if (digits.length < 13 || digits.length > 19) return { ok: false };
    // A digit run directly after an IBAN prefix (two letters, two digits) belongs to the IBAN.
    const before = text.slice(Math.max(0, m.index - 6), m.index);
    if (/[A-Z]{2}\d{2}[ -]?$/.test(before)) return { ok: false };
    return { ok: luhnValid(digits), note: "Luhn checksum valid" };
  });

/**
 * Emirates ID: 784-YYYY-NNNNNNN-N (15 digits). The number is an ISO/IEC 7812 style identifier
 * whose last digit is a Luhn check digit (publicly documented). A match whose Luhn check fails
 * is still reported at lower confidence as format only, because the formats in the wild include
 * transcription errors and the cost of missing one is higher than a review.
 */
const emiratesId: Detector = (text) =>
  runRegex(text, /(?<!\d)784-?(?:19|20)\d{2}-?\d{7}-?\d(?!\d)/g, 0.98, (m) => {
    const digits = m[0].replace(/\D/g, "");
    if (digits.length !== 15) return { ok: false };
    return luhnValid(digits) ? { ok: true, confidence: 0.98, note: "Luhn check digit valid" } : { ok: true, confidence: 0.6, note: "format only, check digit mismatch" };
  });

const API_KEY_PREFIXES: { re: RegExp; note: string }[] = [
  { re: /\baegis_ak_[A-Za-z0-9_-]{8,}/g, note: "AEGIS agent key" },
  { re: /\bsk-(?:[a-z]+-)?[A-Za-z0-9_-]{16,}/g, note: "sk- prefixed secret key" },
  { re: /\bAKIA[0-9A-Z]{16}\b/g, note: "AWS access key id" },
  { re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, note: "GitHub token" },
  { re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, note: "Slack token" },
  { re: /\bAIza[0-9A-Za-z_-]{35}\b/g, note: "Google API key" },
];

const apiKey: Detector = (text) => {
  const out: DetectorSpan[] = [];
  for (const p of API_KEY_PREFIXES) out.push(...runRegex(text, p.re, 0.95, () => ({ ok: true, note: p.note })));
  // Generic high-entropy tokens: 32+ characters of token alphabet, letters and digits mixed,
  // Shannon entropy above 4 bits per character, not a UUID and not a plain hex digest shorter than 48.
  const generic = runRegex(text, /(?<![A-Za-z0-9_\-/+=.])[A-Za-z0-9_-]{32,}(?![A-Za-z0-9_\-/+=])/g, 0.6, (m) => {
    const v = m[0];
    if (UUID_RE.test(v)) return { ok: false };
    if (!/[A-Za-z]/.test(v) || !/\d/.test(v)) return { ok: false };
    if (/^[0-9a-f]+$/i.test(v) && v.length < 48) return { ok: false };
    const h = shannonEntropy(v);
    return h >= 4.0 ? { ok: true, note: `high entropy ${h.toFixed(2)} bits/char` } : { ok: false };
  });
  for (const g of generic) if (!out.some((o) => o.start <= g.start && o.end >= g.end)) out.push(g);
  return out;
};

const jwt: Detector = (text) => runRegex(text, /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?![A-Za-z0-9_.-])/g, 0.95, () => ({ ok: true, note: "three base64url segments, JSON header" }));

const privateKey: Detector = (text) => {
  const blocks = runRegex(text, /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?-----/g, 1);
  const headersOnly = runRegex(text, /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?-----/g, 0.9, () => ({ ok: true, note: "PEM header without footer" }));
  const out = [...blocks];
  for (const h of headersOnly) if (!blocks.some((b) => b.start <= h.start && b.end >= h.end)) out.push(h);
  return out;
};

const passwordAssignment: Detector = (text) =>
  runRegex(text, /\b(?:password|passwd|pwd|passphrase|secret|api[_-]?secret|client[_-]?secret)\b["']?\s*(?:[:=]|is)\s*["']?[^\s"',;]{4,}/gi, 0.8, (m) => {
    // "password is required" style sentences are not assignments.
    const tail = m[0].replace(/^[^:=]*?(?:[:=]|\bis\b)\s*["']?/i, "");
    if (/^(?:required|optional|invalid|incorrect|wrong|reset|expired|empty|null|undefined|missing|the|a|an|not|your|their|changed|updated|set)$/i.test(tail)) return { ok: false };
    return { ok: true };
  });

const ipAddress: Detector = (text) => {
  const v4 = runRegex(text, /(?<![\d.])(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}(?![\d.])/g, 0.7, (m) => {
    // Version strings such as 1.2.3.4 are indistinguishable by shape; keep the span but lower confidence when every octet is tiny.
    const small = m[0].split(".").every((o) => Number(o) < 20);
    return { ok: true, confidence: small ? 0.4 : 0.7, note: small ? "could be a version string" : undefined };
  });
  const v6 = runRegex(text, /(?<![A-Za-z0-9:])(?:[0-9a-f]{1,4}:){2,7}(?::?[0-9a-f]{1,4}){1,6}(?![A-Za-z0-9:])/gi, 0.6, (m) => ({ ok: m[0].split(":").length >= 4 && /[0-9a-f]{3,}/i.test(m[0]) }));
  return [...v4, ...v6];
};

const url: Detector = (text) => runRegex(text, /\b(?:https?|ftp|sftp|s3|wss?):\/\/[^\s<>"'`)\]}]+/gi, 0.9);

export const BUILTIN_DETECTORS: Record<string, Detector> = {
  email,
  phone,
  iban,
  card_number: cardNumber,
  emirates_id: emiratesId,
  api_key: apiKey,
  jwt,
  private_key: privateKey,
  password_assignment: passwordAssignment,
  ip_address: ipAddress,
  url,
};

export const DETECTOR_KEYS = [...Object.keys(BUILTIN_DETECTORS), "custom_regex"] as const;
export type DetectorKey = (typeof DETECTOR_KEYS)[number];

// ---------- custom regex (safe compilation) ----------

export interface CompiledPattern {
  source: string;
  flags: string;
  regex: RegExp;
}

/**
 * Compiles a customer supplied pattern defensively:
 * - length cap
 * - no backreferences, no lookbehind with quantifiers inside groups (kept simple: no backrefs)
 * - rejects nested quantifiers (a quantified group whose body is itself quantified), the classic
 *   catastrophic backtracking shape such as (a+)+ or (\d*)*
 * - optional leading (?i) turns into the i flag; otherwise flags are g only
 * Throws an Error with a human readable reason when the pattern is rejected.
 */
export function compileCustomPattern(pattern: string): CompiledPattern {
  if (typeof pattern !== "string" || pattern.trim().length === 0) throw new Error("Pattern is empty");
  if (pattern.length > LIMITS.maxCustomPatternLength) throw new Error(`Pattern is longer than ${LIMITS.maxCustomPatternLength} characters`);
  let source = pattern;
  let flags = "g";
  if (source.startsWith("(?i)")) {
    source = source.slice(4);
    flags += "i";
  }
  if (/\\[1-9]/.test(source) || /\\k</.test(source)) throw new Error("Backreferences are not allowed");
  if (hasNestedQuantifier(source)) throw new Error("Nested quantifiers (for example (a+)+ or (.*)*) are not allowed");
  let regex: RegExp;
  try {
    regex = new RegExp(source, flags);
  } catch (e) {
    throw new Error(`Pattern does not compile: ${e instanceof Error ? e.message : "unknown"}`);
  }
  return { source, flags, regex };
}

/** True when a group containing a quantifier is itself followed by a quantifier. Escapes and classes are skipped. */
export function hasNestedQuantifier(source: string): boolean {
  const stack: { hasQuantifier: boolean }[] = [];
  let inClass = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;
    if (ch === "\\") {
      i += 1;
      continue;
    }
    if (inClass) {
      if (ch === "]") inClass = false;
      continue;
    }
    if (ch === "[") {
      inClass = true;
      continue;
    }
    if (ch === "(") {
      stack.push({ hasQuantifier: false });
      continue;
    }
    if (ch === ")") {
      const closed = stack.pop();
      const next = source[i + 1];
      if (closed?.hasQuantifier && (next === "*" || next === "+" || next === "{")) return true;
      if (closed?.hasQuantifier && stack.length > 0) stack[stack.length - 1]!.hasQuantifier = true;
      continue;
    }
    if (ch === "*" || ch === "+" || ch === "{") {
      if (stack.length > 0) stack[stack.length - 1]!.hasQuantifier = true;
    }
  }
  return false;
}

/** Runs a compiled custom pattern with an input cap and a wall-clock budget checked between matches. */
export function customRegexDetector(compiled: CompiledPattern): Detector {
  return (text) => {
    const input = text.length > LIMITS.maxCustomScanLength ? text.slice(0, LIMITS.maxCustomScanLength) : text;
    const out: DetectorSpan[] = [];
    const started = Date.now();
    const re = compiled.regex;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(input)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex += 1;
      } else {
        out.push({ start: m.index, end: m.index + m[0].length, value: m[0], confidence: 0.7, note: "custom pattern" });
      }
      if (out.length >= LIMITS.maxMatchesPerDetector) break;
      if (Date.now() - started > LIMITS.customScanBudgetMs) {
        out.push({ start: 0, end: 0, value: "", confidence: 0, note: "scan budget exhausted; results partial" });
        break;
      }
    }
    return out.filter((s) => s.end > s.start || s.note?.startsWith("scan budget"));
  };
}

// ---------- classes and classification ----------

/** The subset of a DataClass row the detectors need. */
export interface DataClassSpec {
  key: string;
  detector: string;
  pattern?: string | null;
  action: DataAction;
  severity: string;
  enabled?: boolean;
}

export interface TaggedSpan extends DetectorSpan {
  dataClass: string;
  action: DataAction;
  severity: string;
}

const customCache = new Map<string, Detector | Error>();

export function detectorFor(spec: DataClassSpec): Detector | null {
  if (spec.detector === "custom_regex") {
    if (!spec.pattern) return null;
    const cached = customCache.get(spec.pattern);
    if (cached instanceof Error) return null;
    if (cached) return cached;
    try {
      const d = customRegexDetector(compileCustomPattern(spec.pattern));
      customCache.set(spec.pattern, d);
      return d;
    } catch (e) {
      customCache.set(spec.pattern, e instanceof Error ? e : new Error("invalid pattern"));
      return null;
    }
  }
  return BUILTIN_DETECTORS[spec.detector] ?? null;
}

/**
 * Runs every enabled class over the text and resolves overlaps: when two spans overlap, the
 * longer span wins, then the higher confidence, then the more severe class. This keeps an IBAN
 * from also being reported as a card number or a phone number.
 */
export function classifyText(text: string, classes: DataClassSpec[]): TaggedSpan[] {
  if (typeof text !== "string" || text.length === 0) return [];
  const all: TaggedSpan[] = [];
  for (const c of classes) {
    if (c.enabled === false) continue;
    const det = detectorFor(c);
    if (!det) continue;
    for (const s of det(text)) {
      if (s.end <= s.start) continue;
      all.push({ ...s, dataClass: c.key, action: c.action, severity: c.severity });
    }
  }
  all.sort((a, b) => b.end - b.start - (a.end - a.start) || b.confidence - a.confidence || severityRank(b.severity) - severityRank(a.severity) || a.start - b.start);
  const accepted: TaggedSpan[] = [];
  for (const s of all) {
    if (accepted.some((a) => s.start < a.end && a.start < s.end)) continue;
    accepted.push(s);
  }
  accepted.sort((a, b) => a.start - b.start);
  return accepted;
}

// ---------- anonymizer operators ----------

/** Keeps the last `keep` alphanumeric characters, replaces the others with *, preserves separators. */
export function maskValue(value: string, keep = 4): string {
  const chars = [...value];
  const isAlnum = (c: string) => /[\p{L}\p{N}]/u.test(c);
  const total = chars.filter(isAlnum).length;
  if (total <= keep) return "*".repeat(Math.max(4, value.length));
  let alnumSeen = 0;
  for (let i = chars.length - 1; i >= 0; i--) {
    if (!isAlnum(chars[i]!)) continue;
    alnumSeen += 1;
    if (alnumSeen > keep) chars[i] = "*";
  }
  return chars.join("");
}

export function redactValue(dataClass: string): string {
  return `[REDACTED:${dataClass}]`;
}

/** Applies mask and redact operators to a string given its accepted spans. Other actions leave the text unchanged. */
export function rewriteText(text: string, spans: TaggedSpan[]): string {
  let out = text;
  const ordered = [...spans].sort((a, b) => b.start - a.start);
  for (const s of ordered) {
    if (s.action === "mask") out = out.slice(0, s.start) + maskValue(s.value) + out.slice(s.end);
    else if (s.action === "redact") out = out.slice(0, s.start) + redactValue(s.dataClass) + out.slice(s.end);
  }
  return out;
}

// ---------- parameter inspection ----------

export interface Finding {
  dataClass: string;
  action: DataAction;
  count: number;
  severity: string;
  field: string;
  /** Highest confidence among the matches in this field. Heuristic label. */
  confidence: number;
  /** Masked previews (never the raw value), at most 3. */
  previews: string[];
  /** False when the action is mask or redact but the field is preserved (addressing fields). */
  applied: boolean;
  notes: string[];
}

export interface InspectionResult {
  params: Record<string, unknown>;
  findings: Finding[];
  dataClasses: string[];
  highestSeverity: Severity | null;
  blocked: boolean;
  blockedClasses: string[];
  requireApproval: boolean;
  /** Field paths whose strings were longer than the scan limit (scanned partially). */
  oversizeFields: string[];
  heuristic: true;
}

/**
 * Field names that address the destination of an action. Their values are governed by the tool's
 * destination allowlist (gateway baseline), so mask and redact are not applied to them: rewriting
 * a recipient would change where the action goes. They are still classified, recorded as findings,
 * and block or require_approval still apply.
 */
export const PRESERVED_FIELD_KEYS = ["to", "destination", "url", "recipient", "email", "endpoint", "webhook", "from", "cc", "bcc", "replyTo", "reply_to", "fromAccount", "toAccount", "from_account", "to_account", "iban", "account"];

export interface InspectOptions {
  preservedFieldKeys?: string[];
}

export function inspectParams(params: Record<string, unknown>, classes: DataClassSpec[], opts: InspectOptions = {}): InspectionResult {
  const preserved = new Set(opts.preservedFieldKeys ?? PRESERVED_FIELD_KEYS);
  const active = classes.filter((c) => c.enabled !== false);
  const findings = new Map<string, Finding>();
  const oversize: string[] = [];

  const visit = (value: unknown, path: string, lastKey: string, depth: number): unknown => {
    if (depth > LIMITS.maxDepth) return value;
    if (typeof value === "string") {
      if (value.length > LIMITS.maxStringLength) oversize.push(path);
      const spans = classifyText(value, active);
      if (spans.length === 0) return value;
      const keep = preserved.has(lastKey);
      for (const s of spans) {
        const id = `${path}::${s.dataClass}`;
        const f = findings.get(id) ?? { dataClass: s.dataClass, action: s.action, count: 0, severity: s.severity, field: path, confidence: 0, previews: [], applied: !(keep && (s.action === "mask" || s.action === "redact")), notes: [] };
        f.count += 1;
        f.confidence = Math.max(f.confidence, s.confidence);
        if (f.previews.length < 3) f.previews.push(maskValue(s.value));
        if (s.note && !f.notes.includes(s.note)) f.notes.push(s.note);
        if (keep && (s.action === "mask" || s.action === "redact") && !f.notes.includes("addressing field preserved; governed by destination rules")) f.notes.push("addressing field preserved; governed by destination rules");
        findings.set(id, f);
      }
      return keep ? value : rewriteText(value, spans);
    }
    if (Array.isArray(value)) return value.map((v, i) => visit(v, `${path}[${i}]`, lastKey, depth + 1));
    if (value && typeof value === "object" && !(value instanceof Date)) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = visit(v, path ? `${path}.${k}` : k, k, depth + 1);
      return out;
    }
    return value;
  };

  const rewritten = visit(params ?? {}, "", "", 0) as Record<string, unknown>;
  const list = [...findings.values()];
  const blockedClasses = [...new Set(list.filter((f) => f.action === "block").map((f) => f.dataClass))];
  return {
    params: rewritten,
    findings: list,
    dataClasses: [...new Set(list.map((f) => f.dataClass))].sort(),
    highestSeverity: maxSeverity(list.map((f) => f.severity)),
    blocked: blockedClasses.length > 0,
    blockedClasses,
    requireApproval: list.some((f) => f.action === "require_approval"),
    oversizeFields: oversize,
    heuristic: true,
  };
}
