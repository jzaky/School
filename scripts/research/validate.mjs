// Validates extracted university requirements against the fetched official page text.
// Every value must come with a quote that appears word for word on the cited page, and the value
// itself must appear inside that quote. Anything else is rejected, so nothing is invented.
//
// Usage: node scripts/research/validate.mjs --data <extracted json> --pages <decrypted pages folder> [--json]
// Exit code 1 when there are errors. Warnings do not fail.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, v, i, all) => (v.startsWith("--") ? [...acc, [v.slice(2), all[i + 1]?.startsWith("--") ? "true" : all[i + 1]]] : acc), []),
);
const data = JSON.parse(readFileSync(args.data, "utf8"));
const index = JSON.parse(readFileSync(join(args.pages, "index.json"), "utf8"));

export const CURRICULA = ["BRITISH", "IB", "AMERICAN", "UAE_MOE", "JORDAN_TAWJIHI", "CBSE", "ISC", "SABIS"];
export const SUBJECT_TYPES = ["REQUIRED", "RECOMMENDED", "PREFERRED", "OPTIONAL", "ONE_OF", "TWO_OF"];
export const LEVELS = ["FOUNDATION", "STANDARD", "ADVANCED", "HIGHER"];
export const POLICIES = ["REQUIRED", "OPTIONAL", "RECOMMENDED", "BLIND", "NOT_CONSIDERED"];
export const ADDITIONAL = ["ADMISSIONS_TEST", "INTERVIEW", "PORTFOLIO", "PERSONAL_STATEMENT", "REFERENCE", "WORK_EXPERIENCE", "AUDITION", "HEALTH_CHECK", "FOUNDATION_REQUIRED", "NOT_ACCEPTED", "OTHER"];
export const DEADLINE_KINDS = ["UCAS_EQUAL_CONSIDERATION", "UCAS_OXBRIDGE_MEDICINE", "EARLY_DECISION", "EARLY_DECISION_II", "EARLY_ACTION", "RESTRICTIVE_EARLY_ACTION", "REGULAR_DECISION", "PRIORITY", "FINAL", "ROLLING", "SCHOLARSHIP", "OTHER"];
export const ENGLISH_TESTS = ["IELTS", "TOEFL", "DUOLINGO", "PTE", "CAMBRIDGE", "LANGUAGECERT", "OXFORD_TEST", "EMSAT_ENGLISH", "IGCSE_ENGLISH", "IB_ENGLISH", "OTHER"];
const SUBJECT_KEYS = new Set(
  "mathematics algebra geometry precalculus calculus statistics further_mathematics applied_mathematics discrete_mathematics science physics chemistry biology combined_science environmental_science earth_science health_science anatomy_physiology computer_science information_technology robotics engineering_science design_technology english_language english_literature arabic second_language french spanish german chinese hindi islamic_studies moral_education uae_social_studies social_studies history geography economics business accounting psychology sociology global_politics philosophy law theory_of_knowledge art music drama media_studies film_studies physical_education sports_science entrepreneurship marketing biotechnology data_science electronics".split(" "),
);

const errors = [];
const warnings = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);
const warn = (where, msg) => warnings.push(`${where}: ${msg}`);

/** Normalize text for quote matching: unify quotes, dashes, spaces and table separators. */
export function norm(s) {
  return String(s ?? "")
    .normalize("NFKC")
    .replace(/[‘’ʼ′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/\s*\|\s*/g, " | ")
    .replace(/[\s ​]+/g, " ")
    .trim();
}
const pageCache = new Map();
function pageText(url, wayback) {
  const k = `${url}|${wayback ? "w" : ""}`;
  if (pageCache.has(k)) return pageCache.get(k);
  const entry = index[url];
  let text = null;
  if (entry) {
    const file = wayback ? entry.wayback?.file : entry.file;
    if (file && existsSync(join(args.pages, file))) {
      const raw = readFileSync(join(args.pages, file), "utf8");
      text = norm(raw.slice(raw.indexOf("\n---\n") + 5));
    }
  }
  pageCache.set(k, text);
  return text;
}
const numberVariants = (n) => {
  const v = Number(n);
  const out = new Set([String(v)]);
  if (Number.isInteger(v)) out.add(`${v}.0`);
  else out.add(v.toFixed(1));
  return [...out];
};
const hasNumber = (quote, n) => numberVariants(n).some((s) => new RegExp(`(^|[^0-9.])${s.replace(".", "\\.")}(?![0-9])`).test(quote));
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
function hasDate(quote, iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const q = quote.toLowerCase();
  const month = MONTHS[m - 1];
  const dayRe = new RegExp(`(^|[^0-9])0?${d}(st|nd|rd|th)?([^0-9]|$)`);
  const hasMonth = q.includes(month) || q.includes(month.slice(0, 3));
  const numeric = [`${d}/${m}/${y}`, `${m}/${d}/${y}`, `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`, iso].some((s) => q.includes(s));
  return (hasMonth && dayRe.test(q)) || numeric;
}

function checkQuote(where, item, sources, opts = {}) {
  if (!item) return false;
  if (!item.quote || typeof item.quote !== "string") {
    err(where, "missing quote");
    return false;
  }
  const q = norm(item.quote);
  if (q.length < 8) err(where, "quote too short");
  if (q.length > 500) warn(where, `quote is long (${q.length} chars); keep quotes to the sentence that supports the value`);
  const src = sources.get(item.source);
  if (!src) {
    err(where, `unknown source "${item.source}"`);
    return false;
  }
  const text = pageText(src.url, item.wayback === true || opts.wayback);
  if (text === null) {
    err(where, `no fetched text for ${item.wayback ? "the archived copy of " : ""}${src.url}`);
    return false;
  }
  if (!text.includes(q)) {
    if (text.toLowerCase().includes(q.toLowerCase())) warn(where, "quote matches only when ignoring case");
    else {
      err(where, `quote not found on the page: "${item.quote.slice(0, 120)}"`);
      return false;
    }
  }
  return q;
}

function checkSubjects(where, subjects, sources, ctx) {
  for (const [i, s] of (subjects ?? []).entries()) {
    const w = `${where}.subjects[${i}]`;
    if (!SUBJECT_TYPES.includes(s.type)) err(w, `bad type ${s.type}`);
    if (!Array.isArray(s.keys) || !s.keys.length) err(w, "keys missing");
    for (const k of s.keys ?? []) if (!SUBJECT_KEYS.has(k)) err(w, `unknown subject key ${k}`);
    if (s.minimumLevel && !LEVELS.includes(s.minimumLevel)) err(w, `bad minimumLevel ${s.minimumLevel}`);
    if ((s.type === "TWO_OF") && (s.keys ?? []).length < 2) err(w, "TWO_OF needs at least two keys");
    if (s.noteEn && !s.noteAr) warn(w, "noteEn without noteAr");
    const q = checkQuote(w, { ...s, source: s.source ?? ctx.source, wayback: ctx.wayback }, sources);
    if (q && s.minimumGrade) {
      const g = String(s.minimumGrade);
      if (/^\d+(\.\d+)?$/.test(g) ? !hasNumber(q, g) : !q.replace(/\s/g, "").includes(g.replace(/\s/g, ""))) err(w, `minimumGrade ${g} not in quote`);
    }
  }
}

function checkCurriculum(where, c, row, sources, ctx = {}) {
  if (!CURRICULA.includes(c)) err(where, `unknown curriculum ${c}`);
  const q = checkQuote(where, { ...row, wayback: ctx.wayback }, sources);
  if (q) {
    if (row.gradeProfile && !q.replace(/\s/g, "").includes(String(row.gradeProfile).replace(/\s/g, ""))) err(where, `gradeProfile ${row.gradeProfile} not in quote`);
    if (row.minimumPoints != null && !hasNumber(q, row.minimumPoints)) err(where, `minimumPoints ${row.minimumPoints} not in quote`);
    if (row.minimumPercent != null && !hasNumber(q, row.minimumPercent)) err(where, `minimumPercent ${row.minimumPercent} not in quote`);
    if (row.minimumGPA != null && !hasNumber(q, row.minimumGPA)) err(where, `minimumGPA ${row.minimumGPA} not in quote`);
  }
  if (row.accepted === false && !row.notesEn) err(where, "not accepted: explain in notesEn");
  if (row.notesEn && !row.notesAr) warn(where, "notesEn without notesAr");
  checkSubjects(where, row.subjects, sources, { source: row.source, wayback: ctx.wayback });
}

function checkEnglish(where, list, sources, ctx = {}) {
  for (const [i, e] of (list ?? []).entries()) {
    const w = `${where}.english[${i}]`;
    if (!ENGLISH_TESTS.includes(e.test)) err(w, `unknown English test ${e.test}`);
    if (typeof e.minOverall !== "number") err(w, "minOverall must be a number");
    const q = checkQuote(w, { ...e, wayback: ctx.wayback }, sources);
    if (q && typeof e.minOverall === "number" && !hasNumber(q, e.minOverall)) err(w, `minOverall ${e.minOverall} not in quote`);
    if (q && e.minComponent != null && !hasNumber(q, e.minComponent)) err(w, `minComponent ${e.minComponent} not in quote`);
  }
}
function checkTests(where, list, sources, ctx = {}) {
  for (const [i, t] of (list ?? []).entries()) {
    const w = `${where}.tests[${i}]`;
    if (!t.test) err(w, "test missing");
    if (!POLICIES.includes(t.policy)) err(w, `bad policy ${t.policy}`);
    const q = checkQuote(w, { ...t, wayback: ctx.wayback }, sources);
    if (q && t.minScore != null && !hasNumber(q, t.minScore)) err(w, `minScore ${t.minScore} not in quote`);
  }
}
function checkAdditional(where, list, sources, ctx = {}) {
  for (const [i, a] of (list ?? []).entries()) {
    const w = `${where}.additional[${i}]`;
    if (!ADDITIONAL.includes(a.kind)) err(w, `bad kind ${a.kind}`);
    if (!a.noteEn) err(w, "noteEn missing");
    if (a.noteEn && !a.noteAr) warn(w, "noteEn without noteAr");
    checkQuote(w, { ...a, wayback: ctx.wayback }, sources);
  }
}

let programs = 0;
let lines = 0;
for (const u of data.universities ?? []) {
  const uw = u.key;
  const sources = new Map((u.sources ?? []).map((s) => [s.id, s]));
  for (const s of u.sources ?? []) {
    const e = index[s.url];
    if (!e) err(`${uw}.sources.${s.id}`, `page was not fetched: ${s.url}`);
    else if (!(e.status >= 200 && e.status < 400) || !e.chars) err(`${uw}.sources.${s.id}`, `page fetch failed (${e.status}): ${s.url}`);
  }
  checkEnglish(uw, u.english, sources);
  checkTests(uw, u.tests, sources);
  checkAdditional(uw, u.additional, sources);
  for (const [i, d] of (u.deadlines ?? []).entries()) {
    const w = `${uw}.deadlines[${i}]`;
    if (!DEADLINE_KINDS.includes(d.kind)) err(w, `bad kind ${d.kind}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date ?? "")) err(w, "date must be YYYY-MM-DD");
    const q = checkQuote(w, d, sources);
    if (q && d.date && !hasDate(q, d.date)) err(w, `date ${d.date} not in quote`);
  }
  for (const [c, row] of Object.entries(u.curriculumRules ?? {})) checkCurriculum(`${uw}.curriculumRules.${c}`, c, row, sources);
  for (const p of u.programs ?? []) {
    const pw = `${uw}/${p.key}`;
    programs++;
    if (!["EXISTS", "REPLACED", "DROP"].includes(p.status)) err(pw, `bad status ${p.status}`);
    if (p.status === "DROP") continue;
    if (!p.nameEn || !p.nameAr) err(pw, "nameEn and nameAr are required");
    if (!p.url) err(pw, "url missing");
    else if (!index[p.url]) warn(pw, `programme page was not fetched: ${p.url}`);
    for (const [c, row] of Object.entries(p.curricula ?? {})) {
      checkCurriculum(`${pw}.curricula.${c}`, c, row, sources);
      lines++;
    }
    if (p.general) {
      checkSubjects(`${pw}.general`, p.general.subjects, sources, { source: p.general.source });
      checkEnglish(`${pw}.general`, p.general.english, sources);
      checkTests(`${pw}.general`, p.general.tests, sources);
      checkAdditional(`${pw}.general`, p.general.additional, sources);
    }
    if (p.previous) {
      const pv = p.previous;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(pv.asOf ?? "")) err(`${pw}.previous`, "asOf must be YYYY-MM-DD");
      for (const [c, row] of Object.entries(pv.curricula ?? {})) checkCurriculum(`${pw}.previous.curricula.${c}`, c, row, sources, { wayback: true });
      if (pv.general) {
        checkEnglish(`${pw}.previous.general`, pv.general.english, sources, { wayback: true });
        checkTests(`${pw}.previous.general`, pv.general.tests, sources, { wayback: true });
      }
    }
  }
}

if (args.json) console.log(JSON.stringify({ errors, warnings, programs, lines }, null, 2));
else {
  for (const e of errors) console.log(`ERROR ${e}`);
  for (const w of warnings) console.log(`warn  ${w}`);
  console.log(`\n${programs} programmes, ${lines} curriculum rows checked: ${errors.length} errors, ${warnings.length} warnings`);
}
process.exit(errors.length ? 1 : 0);
