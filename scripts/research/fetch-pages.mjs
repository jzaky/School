// Fetches official university pages for the requirements research and writes them ENCRYPTED.
// Runs on GitHub Actions (open internet); see .github/workflows/research-fetch.yml.
//
// The repository is public, so page text is never written in the clear: each chunk is gzipped,
// encrypted with a random AES-256-GCM key, and that key is encrypted with the RSA public key in
// research/fetch-key.pub. Only the holder of the private key (kept outside the repo) can read it.
// Logs print only the URL, HTTP status and text length.
//
// Usage: node fetch-pages.mjs --list <json> --chunk <i> --of <n> --out <file> --key <public key pem>
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createCipheriv, createHash, publicEncrypt, randomBytes, constants } from "node:crypto";
import { gzipSync } from "node:zlib";
import { chromium } from "playwright";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, v, i, all) => (v.startsWith("--") ? [...acc, [v.slice(2), all[i + 1]]] : acc), []),
);
const list = JSON.parse(readFileSync(args.list, "utf8"));
const pages = (list.pages ?? list).filter((p) => p && p.url);
const of = Number(args.of ?? 1);
const chunk = Number(args.chunk ?? 0);
const mine = pages.filter((_, i) => i % of === chunk);
const publicKey = readFileSync(args.key, "utf8");
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const WAYBACK_BEFORE = list.waybackBefore ?? "20250915";

/** Page text in reading order, one block per line, including collapsed sections (accordions, tabs). */
function domText() {
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "TEMPLATE", "IFRAME", "CANVAS", "VIDEO", "AUDIO", "PICTURE", "SELECT"]);
  const BLOCK = new Set([
    "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "BR", "CAPTION", "DD", "DETAILS", "DIALOG", "DIV", "DL", "DT", "FIELDSET",
    "FIGCAPTION", "FIGURE", "FOOTER", "FORM", "H1", "H2", "H3", "H4", "H5", "H6", "HEADER", "HR", "LI", "MAIN", "NAV",
    "OL", "P", "PRE", "SECTION", "SUMMARY", "TABLE", "TBODY", "TFOOT", "THEAD", "TR", "UL", "BUTTON",
  ]);
  const out = [];
  let line = "";
  const flush = () => {
    const t = line.replace(/[ \t ​]+/g, " ").trim();
    if (t) out.push(t);
    line = "";
  };
  const walk = (node) => {
    if (node.nodeType === 3) {
      line += node.nodeValue;
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = node.tagName;
    if (SKIP.has(tag)) return;
    const block = BLOCK.has(tag);
    if (block) flush();
    if (tag === "TD" || tag === "TH") line += " ";
    for (const child of node.childNodes) walk(child);
    if (tag === "TD" || tag === "TH") line += " | ";
    if (block) flush();
  };
  walk(document.body || document.documentElement);
  flush();
  // Drop consecutive duplicate lines (menus repeated for mobile and desktop).
  return out.filter((l, i) => l !== out[i - 1]).join("\n");
}

const sha = (s) => createHash("sha256").update(s).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchWayback(browser, url) {
  try {
    const q = `https://archive.org/wayback/available?url=${encodeURIComponent(url)}&timestamp=${WAYBACK_BEFORE}`;
    const res = await fetch(q, { headers: { "User-Agent": UA } });
    if (!res.ok) return null;
    const j = await res.json();
    const snap = j?.archived_snapshots?.closest;
    if (!snap?.available || !snap.timestamp) return null;
    // Closest snapshot to the target date; ignore ones newer than list.waybackLatest (too recent to compare).
    if (Number(snap.timestamp.slice(0, 8)) > Number(list.waybackLatest ?? "20260301")) return null;
    const raw = `https://web.archive.org/web/${snap.timestamp}id_/${url}`;
    const r2 = await fetch(raw, { headers: { "User-Agent": UA }, redirect: "follow" });
    if (!r2.ok) return { timestamp: snap.timestamp, snapshotUrl: snap.url, status: r2.status, text: "", hash: null };
    const html = await r2.text();
    const ctx = await browser.newContext({ javaScriptEnabled: false, userAgent: UA });
    const p = await ctx.newPage();
    await p.setContent(html, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => undefined);
    const text = await p.evaluate(domText).catch(() => "");
    await ctx.close();
    return { timestamp: snap.timestamp, snapshotUrl: snap.url, status: r2.status, text, hash: text ? sha(text) : null };
  } catch (e) {
    return { error: String(e).slice(0, 200) };
  }
}

const browser = await chromium.launch();
const context = await browser.newContext({ userAgent: UA, locale: "en-US", viewport: { width: 1366, height: 900 } });
const records = [];
for (const entry of mine) {
  const page = await context.newPage();
  const rec = { url: entry.url, fetchedAt: new Date().toISOString() };
  try {
    const res = await page.goto(entry.url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
    await sleep(1500);
    await page.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true))).catch(() => undefined);
    rec.status = res ? res.status() : 0;
    rec.finalUrl = page.url();
    rec.title = await page.title().catch(() => "");
    rec.text = (await page.evaluate(domText)).slice(0, 400000);
    rec.hash = sha(rec.text);
    // Links on the page (text and address), so the next round can follow them without a search engine.
    rec.links = await page
      .evaluate(() => {
        const seen = new Set();
        const out = [];
        for (const a of document.querySelectorAll("a[href]")) {
          const h = a.href.split("#")[0];
          if (!/^https?:/.test(h) || seen.has(h)) continue;
          seen.add(h);
          out.push([(a.innerText || a.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().slice(0, 120), h]);
          if (out.length >= 800) break;
        }
        return out;
      })
      .catch(() => []);
  } catch (e) {
    rec.status = 0;
    rec.error = String(e).slice(0, 300);
    rec.text = "";
  }
  if (entry.wayback) rec.wayback = await fetchWayback(browser, entry.url);
  console.log(`${rec.status}\t${(rec.text || "").length}\t${rec.wayback?.timestamp ?? "-"}\t${entry.url}`);
  records.push(rec);
  await page.close();
  await sleep(800);
}
await browser.close();

const payload = gzipSync(Buffer.from(JSON.stringify({ v: 1, chunk, of, records })));
const key = randomBytes(32);
const iv = randomBytes(12);
const cipher = createCipheriv("aes-256-gcm", key, iv);
const data = Buffer.concat([cipher.update(payload), cipher.final()]);
const ek = publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, key);
mkdirSync(dirname(args.out), { recursive: true });
writeFileSync(
  args.out,
  JSON.stringify({ v: 1, alg: "RSA-OAEP-256+A256GCM+gzip", ek: ek.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") }),
);
console.log(`chunk ${chunk}/${of}: ${records.length} pages, ${records.filter((r) => r.status >= 200 && r.status < 400 && r.text).length} with text`);
