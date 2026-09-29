// Requirement page fetcher.
// - A clear user agent, a timeout, a size cap and robots.txt respected (Disallow and Allow, longest match).
// - Redirects are followed and the final URL is recorded.
// - HTML is normalized to text BEFORE hashing (scripts, styles, navigation, cookie banners and dynamic
//   tokens removed) so cosmetic changes to a page never trigger extraction or review work.
// - Outcomes follow the collegedata-fyi archive branches (MIT, see docs/third-party.md):
//   INSERTED (first successful fetch), UNCHANGED (same hash), CHANGED (new hash), FAILED.
// - The raw page is stored in R2 under a content-addressed key when R2 is configured.
// Never logs page content. No "server-only" marker: the worker runs this.
import { createHash } from "node:crypto";
import type { Prisma, SourceStatus } from "@prisma/client";
import { putR2Object } from "@/server/documents/r2";

export const USER_AGENT = "HorizonSchoolOS-RequirementsBot/1.0 (+university entry requirements review; contact: school admissions office)";
export const ROBOTS_AGENT = "horizonschoolos-requirementsbot";
export const FETCH_TIMEOUT_MS = 20_000;
export const MAX_BYTES = 2_000_000;
const MAX_REDIRECTS = 5;

export type FetchOutcome = "INSERTED" | "UNCHANGED" | "CHANGED" | "FAILED";
export const OUTCOME_STATUS: Record<FetchOutcome, SourceStatus> = { INSERTED: "FETCHED", UNCHANGED: "UNCHANGED", CHANGED: "CHANGED", FAILED: "FAILED" };

// ---------------------------------------------------------------------------------------------
// Normalization

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "-",
  mdash: "-",
  hyphen: "-",
  lsquo: "'",
  rsquo: "'",
  ldquo: '"',
  rdquo: '"',
  hellip: "...",
  bull: "-",
  middot: "-",
  copy: "(c)",
  reg: "(R)",
  trade: "(TM)",
  times: "x",
  frac12: "1/2",
  eacute: "e",
};

export function decodeEntities(s: string) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return " ";
      // Dashes of every width become a plain hyphen.
      if (code >= 0x2010 && code <= 0x2015) return "-";
      if (code === 0xa0) return " ";
      return String.fromCodePoint(code);
    }
    return ENTITIES[body.toLowerCase()] ?? m;
  });
}

// Whole elements whose content is never requirement text.
const DROP_BLOCKS = ["script", "style", "noscript", "template", "svg", "iframe", "canvas", "object", "select"];
// Elements skipped together with their subtree.
const SKIP_TAGS = new Set(["nav", "footer", "header", "aside", "form", "button", "dialog", "menu"]);
// Attribute values that mark cookie banners, consent dialogs, skip links and similar chrome.
const CHROME_ATTR = /(cookie|consent|gdpr|onetrust|cookiebot|skip-?link|breadcrumb|site-?nav|navbar|megamenu|social-?share|share-?buttons|newsletter|chat-?widget)/i;
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const BLOCK = new Set(["p", "div", "section", "article", "main", "li", "ul", "ol", "dl", "dt", "dd", "table", "tr", "td", "th", "thead", "tbody", "h1", "h2", "h3", "h4", "h5", "h6", "br", "hr", "blockquote", "pre", "figure", "figcaption", "details", "summary"]);

// Tokens that change on every page load: timestamps, nonces, session and build ids.
const DYNAMIC_LINE = /^(page )?(last (updated|modified|reviewed)|updated on|generated|rendered|cache|build)\b/i;
const DYNAMIC_TOKENS: RegExp[] = [
  /\b\d{4}-\d{2}-\d{2}[t ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(z|[+-]\d{2}:?\d{2})?\b/gi, // ISO timestamps
  /\b(csrf|xsrf|nonce|token|session|sid|build)[-_ ]?(id)?\s*[:=]\s*\S+/gi,
  /\b[a-f0-9]{24,}\b/gi, // hashes and ids
  /(?<![A-Za-z0-9+/_-])(?=[A-Za-z0-9+/_-]*\d)(?=[A-Za-z0-9+/_-]*[A-Za-z])[A-Za-z0-9+/_-]{32,}={0,2}(?![A-Za-z0-9])/g, // base64-ish blobs
];

/**
 * Turn an HTML page into stable plain text: one block per line, whitespace collapsed,
 * page chrome and dynamic tokens removed. Plain text input is normalized the same way.
 */
export function normalizeHtml(html: string): string {
  let s = html.replace(/<!--[\s\S]*?-->/g, " ");
  for (const tag of DROP_BLOCKS) s = s.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}\\s*>`, "gi"), " ");
  s = s.replace(/<!doctype[^>]*>/gi, " ").replace(/<\?[\s\S]*?\?>/g, " ");

  const out: string[] = [];
  const stack: Array<{ tag: string; skip: boolean }> = [];
  let skipDepth = 0;
  const re = /<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)|(<)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m[3] !== undefined || m[4] !== undefined) {
      if (skipDepth === 0) out.push(m[3] ?? "<");
      continue;
    }
    const raw = m[0];
    const tag = m[1].toLowerCase();
    const attrs = m[2] ?? "";
    const closing = raw.startsWith("</");
    const selfClosing = VOID.has(tag) || /\/\s*$/.test(attrs);
    if (closing) {
      // Pop to the matching open tag (tolerates unclosed children).
      const idx = stack.map((x) => x.tag).lastIndexOf(tag);
      if (idx >= 0) {
        for (let i = stack.length - 1; i >= idx; i--) if (stack[i].skip) skipDepth--;
        stack.length = idx;
      }
      if (skipDepth === 0 && BLOCK.has(tag)) out.push("\n");
      continue;
    }
    if (selfClosing) {
      if (skipDepth === 0 && BLOCK.has(tag)) out.push("\n");
      continue;
    }
    const attrText = [...attrs.matchAll(/\b(id|class|role|aria-label|data-[\w-]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi)].map((a) => a[2]).join(" ");
    const bareAttrs = attrs.replace(/"[^"]*"|'[^']*'/g, '""');
    const hidden = /(^|\s)hidden(\s|=|$)/i.test(bareAttrs) || /aria-hidden\s*=\s*["']?true|display\s*:\s*none/i.test(attrs);
    const skip = SKIP_TAGS.has(tag) || hidden || attrText.split(/[\s"']+/).some((tok) => CHROME_ATTR.test(tok)) || /role\s*=\s*["']?(navigation|banner|contentinfo|dialog|alertdialog)/i.test(attrs);
    stack.push({ tag, skip });
    if (skip) skipDepth++;
    if (skipDepth === 0 && BLOCK.has(tag)) out.push("\n");
  }

  let text = decodeEntities(out.join(""));
  for (const r of DYNAMIC_TOKENS) text = text.replace(r, " ");
  return text
    .replace(/[\u200b-\u200f\u2028\u2029\ufeff]/g, "")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .split(/\r?\n/)
    .map((l) => l.replace(/[ \t\f\v\u00a0]+/g, " ").trim())
    .filter((l) => l && !DYNAMIC_LINE.test(l) && /[\p{L}\p{N}]/u.test(l))
    .join("\n");
}

export function sha256(text: string | Buffer) {
  return createHash("sha256").update(text).digest("hex");
}

/** Hash of the normalized text: the identity of a page's content. */
export const contentHash = (normalizedText: string) => sha256(normalizedText);

// ---------------------------------------------------------------------------------------------
// robots.txt

type RobotsGroup = { agents: string[]; rules: Array<{ allow: boolean; path: string }> };

export function parseRobots(txt: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let cur: RobotsGroup | null = null;
  let lastWasAgent = false;
  for (const rawLine of txt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const i = line.indexOf(":");
    if (i < 0) continue;
    const key = line.slice(0, i).trim().toLowerCase();
    const value = line.slice(i + 1).trim();
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], rules: [] };
        groups.push(cur);
      }
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((key === "disallow" || key === "allow") && cur) {
      lastWasAgent = false;
      if (key === "disallow" && value === "") continue; // "Disallow:" allows everything
      cur.rules.push({ allow: key === "allow", path: value });
    } else {
      lastWasAgent = false;
    }
  }
  return groups;
}

function ruleMatches(rulePath: string, path: string) {
  const anchored = rulePath.endsWith("$");
  const body = anchored ? rulePath.slice(0, -1) : rulePath;
  const re = new RegExp("^" + body.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + (anchored ? "$" : ""));
  return re.test(path);
}

/** Google-style evaluation: our group (else "*"), longest matching rule wins, Allow wins ties. */
export function robotsAllows(groups: RobotsGroup[], pathAndQuery: string, agent = ROBOTS_AGENT) {
  const ours = groups.filter((g) => g.agents.some((a) => a !== "*" && agent.includes(a)));
  const group = ours.length ? ours : groups.filter((g) => g.agents.includes("*"));
  let best: { allow: boolean; len: number } | null = null;
  for (const g of group) {
    for (const r of g.rules) {
      if (!ruleMatches(r.path, pathAndQuery)) continue;
      const len = r.path.length;
      if (!best || len > best.len || (len === best.len && r.allow)) best = { allow: r.allow, len };
    }
  }
  return best ? best.allow : true;
}

// ---------------------------------------------------------------------------------------------
// Fetching

export type FetchImpl = (url: string, init: RequestInit) => Promise<Response>;

export class PageFetchError extends Error {
  constructor(
    public code: "robots_disallowed" | "timeout" | "unreachable" | "http_error" | "too_large" | "unsupported_type" | "too_many_redirects" | "invalid_url",
    public status?: number,
  ) {
    super(`fetch:${code}${status ? `:${status}` : ""}`);
  }
}

export type FetchedPage = { finalUrl: string; status: number; contentType: string; body: Buffer };

async function readCapped(res: Response, maxBytes: number): Promise<Buffer> {
  const len = Number(res.headers.get("content-length") ?? "0");
  if (len > maxBytes) throw new PageFetchError("too_large");
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new PageFetchError("too_large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export type FetchOptions = {
  fetchImpl?: FetchImpl;
  timeoutMs?: number;
  maxBytes?: number;
  /** robots.txt cache per origin for one run. */
  robotsCache?: Map<string, RobotsGroup[]>;
};

async function robotsFor(origin: string, opts: FetchOptions): Promise<RobotsGroup[]> {
  const cache = opts.robotsCache;
  const hit = cache?.get(origin);
  if (hit) return hit;
  const f = opts.fetchImpl ?? fetch;
  let groups: RobotsGroup[];
  try {
    const res = await f(`${origin}/robots.txt`, { headers: { "user-agent": USER_AGENT }, redirect: "follow", signal: AbortSignal.timeout(opts.timeoutMs ?? FETCH_TIMEOUT_MS) });
    if (res.status >= 500) groups = [{ agents: ["*"], rules: [{ allow: false, path: "/" }] }];
    else if (!res.ok) groups = [];
    else groups = parseRobots((await readCapped(res, 500_000)).toString("utf8"));
  } catch {
    // robots.txt unreachable: the page fetch below will fail the same way if the site is down.
    groups = [];
  }
  cache?.set(origin, groups);
  return groups;
}

/** Fetch one page, following redirects by hand so every hop is checked against robots.txt. */
export async function fetchPage(url: string, opts: FetchOptions = {}): Promise<FetchedPage> {
  const f = opts.fetchImpl ?? fetch;
  let current: URL;
  try {
    current = new URL(url);
  } catch {
    throw new PageFetchError("invalid_url");
  }
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (current.protocol !== "http:" && current.protocol !== "https:") throw new PageFetchError("invalid_url");
    const groups = await robotsFor(current.origin, opts);
    if (!robotsAllows(groups, current.pathname + current.search)) throw new PageFetchError("robots_disallowed");
    let res: Response;
    try {
      res = await f(current.toString(), {
        headers: { "user-agent": USER_AGENT, accept: "text/html,text/plain;q=0.9,*/*;q=0.1", "accept-language": "en" },
        redirect: "manual",
        signal: AbortSignal.timeout(opts.timeoutMs ?? FETCH_TIMEOUT_MS),
      });
    } catch (e) {
      const name = e instanceof Error ? e.name : "";
      throw new PageFetchError(name === "TimeoutError" || name === "AbortError" ? "timeout" : "unreachable");
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      current = new URL(res.headers.get("location")!, current);
      await res.body?.cancel().catch(() => undefined);
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new PageFetchError("http_error", res.status);
    }
    const contentType = (res.headers.get("content-type") ?? "text/html").toLowerCase();
    if (!/text\/html|application\/xhtml|text\/plain/.test(contentType)) {
      await res.body?.cancel().catch(() => undefined);
      throw new PageFetchError("unsupported_type");
    }
    const body = await readCapped(res, opts.maxBytes ?? MAX_BYTES);
    return { finalUrl: current.toString(), status: res.status, contentType, body };
  }
  throw new PageFetchError("too_many_redirects");
}

// ---------------------------------------------------------------------------------------------
// Refreshing one source

export type RawStore = (key: string, body: Buffer, contentType: string) => Promise<string | null>;

/** Default raw store: R2 when configured, otherwise nothing is stored. */
export const r2RawStore: RawStore = (key, body, contentType) => putR2Object(key, body, contentType);

export const rawKey = (sourceId: string, rawSha: string, contentType: string) => `catalog/sources/${sourceId}/${rawSha}.${contentType.includes("plain") ? "txt" : "html"}`;

export type RefreshResult =
  | { outcome: "INSERTED" | "UNCHANGED" | "CHANGED"; sourceId: string; contentHash: string; text: string; finalUrl: string; rawKey: string | null }
  | { outcome: "FAILED"; sourceId: string; error: string };

type SourceDb = Pick<Prisma.TransactionClient, "requirementSource">;

/**
 * Fetch a source and record the outcome on its row. The row is updated before anything else is
 * written, so a crash after this point is repaired on the next run (collegedata ordering).
 */
export async function refreshSource(db: SourceDb, sourceId: string, opts: FetchOptions & { now?: Date; store?: RawStore | null } = {}): Promise<RefreshResult> {
  const now = opts.now ?? new Date();
  const source = await db.requirementSource.findUnique({ where: { id: sourceId } });
  if (!source) return { outcome: "FAILED", sourceId, error: "source_missing" };
  try {
    const page = await fetchPage(source.url, opts);
    const decoded = page.body.toString("utf8");
    const text = page.contentType.includes("plain") ? normalizeHtml(decoded.replace(/</g, "&lt;")) : normalizeHtml(decoded);
    if (!text) throw new PageFetchError("unsupported_type");
    const hash = contentHash(text);
    const outcome: FetchOutcome = !source.contentHash ? "INSERTED" : source.contentHash === hash ? "UNCHANGED" : "CHANGED";
    let stored: string | null = null;
    if (outcome !== "UNCHANGED" && opts.store !== null) {
      try {
        stored = await (opts.store ?? r2RawStore)(rawKey(source.id, sha256(page.body), page.contentType), page.body, page.contentType);
      } catch {
        stored = null; // storage is best effort; the hash and text still drive the pipeline
      }
    }
    await db.requirementSource.update({ where: { id: source.id }, data: { status: OUTCOME_STATUS[outcome], retrievedAt: now, contentHash: hash, lastError: null } });
    return { outcome, sourceId: source.id, contentHash: hash, text, finalUrl: page.finalUrl, rawKey: stored };
  } catch (e) {
    const error = e instanceof PageFetchError ? e.message.replace(/^fetch:/, "") : "unexpected";
    await db.requirementSource.update({ where: { id: source.id }, data: { status: "FAILED", retrievedAt: now, lastError: error.slice(0, 200) } });
    return { outcome: "FAILED", sourceId: source.id, error };
  }
}
