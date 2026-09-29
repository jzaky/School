// Finds candidate official pages for the requirements research from each university's own sitemap.
// Runs on GitHub Actions (open internet). Output is a list of URLs only (no page text), so it is safe
// to commit to the public repository.
//
// Input list: { "universities": [ { "key": "imperial_college_london", "domains": ["www.imperial.ac.uk"],
//   "keywords": ["computing", "artificial-intelligence"] } ] }
// Usage: node discover.mjs --list <json> --out <json>
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { gunzipSync } from "node:zlib";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, v, i, all) => (v.startsWith("--") ? [...acc, [v.slice(2), all[i + 1]]] : acc), []),
);
const list = JSON.parse(readFileSync(args.list, "utf8"));
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const MAX_SITEMAPS = 60;
const MAX_URLS = 250000;

// Pages a UAE-based applicant needs: entry requirements, qualifications by country, English, tests, deadlines.
const GENERAL = [
  ["entry-requirement", 8], ["entry_requirement", 8], ["requirements", 5], ["admission", 4], ["international", 3], ["undergraduate", 2],
  ["united-arab-emirates", 9], ["uae", 6], ["emirat", 6], ["india", 5], ["country", 4], ["countries", 4], ["qualification", 5],
  ["english-language", 7], ["english-requirement", 7], ["language-requirement", 6], ["ielts", 6], ["toefl", 5],
  ["a-level", 5], ["alevel", 5], ["baccalaureate", 5], ["-ib-", 4], ["american", 4], ["high-school", 4], ["curriculum", 3],
  ["standardized-test", 7], ["testing", 5], ["test-policy", 7], ["sat", 2], ["deadline", 6], ["dates", 4], ["apply", 3], ["how-to-apply", 5],
  ["first-year", 3], ["freshman", 3], ["tawjihi", 7], ["thanaweya", 6], ["cbse", 7], ["foundation", 2], ["course-selection", 4], ["coursework", 5],
];
const NOISE = /\.(pdf|jpg|jpeg|png|gif|svg|webp|mp4|mp3|zip|docx?|xlsx?|pptx?)(\?|$)|\/(news|events?|blog|stories|staff|people|profiles?|research|alumni|media|press|library|jobs|careers-at|calendar\/event|tag|author|search)\//i;

async function get(url, ms = 30000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "*/*" }, redirect: "follow", signal: ctl.signal });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 40_000_000) return null;
    const gz = url.endsWith(".gz") || (buf[0] === 0x1f && buf[1] === 0x8b);
    return (gz ? gunzipSync(buf) : buf).toString("utf8");
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function sitemapUrls(domain) {
  const queue = [];
  const robots = await get(`https://${domain}/robots.txt`, 15000);
  for (const m of (robots ?? "").matchAll(/^\s*sitemap:\s*(\S+)/gim)) queue.push(m[1].trim());
  if (!queue.length) queue.push(`https://${domain}/sitemap.xml`, `https://${domain}/sitemap_index.xml`, `https://${domain}/wp-sitemap.xml`);
  const seen = new Set();
  const urls = new Set();
  let fetched = 0;
  while (queue.length && fetched < MAX_SITEMAPS && urls.size < MAX_URLS) {
    const sm = queue.shift();
    if (seen.has(sm)) continue;
    seen.add(sm);
    const xml = await get(sm);
    fetched++;
    if (!xml) continue;
    const locs = [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]]+?)\s*(?:\]\]>)?\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, "&"));
    if (/<sitemapindex/i.test(xml)) {
      // Prefer sitemaps that sound relevant, so the cap is spent well.
      const ranked = locs.sort((a, b) => rel(b) - rel(a));
      queue.push(...ranked);
    } else for (const u of locs) urls.add(u);
  }
  return { urls: [...urls], sitemaps: fetched };
}
const rel = (u) => (/(page|course|program|study|admission|undergrad|degree|content|post|node)/i.test(u) ? 1 : 0) - (/(news|event|image|video|people|staff|profile|blog|tag|author|product)/i.test(u) ? 1 : 0);

function score(url, keywords) {
  const u = url.toLowerCase();
  if (NOISE.test(u)) return 0;
  let s = 0;
  for (const [k, w] of GENERAL) if (u.includes(k)) s += w;
  let kw = 0;
  for (const k of keywords) if (u.includes(k.toLowerCase())) kw += 8;
  s += kw;
  if (/\/(undergraduate|study|courses?|programmes?|programs?|degrees?|admissions?)\//.test(u)) s += 3;
  if (/\/(postgraduate|graduate|masters?|phd|doctoral|mba|executive)\//.test(u) || /postgraduate|masters|-msc|-mba|phd/.test(u)) s -= 12;
  return s;
}

const out = { generatedAt: new Date().toISOString(), universities: [] };
for (const uni of list.universities) {
  const all = new Set();
  let sitemaps = 0;
  for (const d of uni.domains) {
    const r = await sitemapUrls(d);
    r.urls.forEach((u) => all.add(u));
    sitemaps += r.sitemaps;
  }
  const ranked = [...all]
    .map((u) => [u, score(u, uni.keywords ?? [])])
    .filter(([, s]) => s >= 6)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 400)
    .map(([u, s]) => ({ url: u, score: s }));
  console.log(`${uni.key}\tsitemaps=${sitemaps}\turls=${all.size}\tcandidates=${ranked.length}`);
  out.universities.push({ key: uni.key, domains: uni.domains, sitemapUrls: all.size, candidates: ranked });
}
mkdirSync(dirname(args.out), { recursive: true });
writeFileSync(args.out, JSON.stringify(out, null, 1));
