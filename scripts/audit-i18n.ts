// Arabic and i18n audit. Fails (exit 1) when:
// - en and ar message files have different keys
// - an Arabic message has no Arabic letters (except allowed technical values)
// - ICU placeholders differ between en and ar
// - any message, component or doc contains an em dash
// - a component renders hard-coded English text in JSX
// - physical direction classes (ml, pr, left-, text-right...) are used
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { findPhysicalClasses } from "./direction-classes";

type Tree = { [k: string]: string | Tree };
const root = process.cwd();
const en = JSON.parse(readFileSync(path.join(root, "messages/en.json"), "utf8")) as Tree;
const ar = JSON.parse(readFileSync(path.join(root, "messages/ar.json"), "utf8")) as Tree;

function flat(t: Tree, prefix = "", out = new Map<string, string>()) {
  for (const [k, v] of Object.entries(t)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out.set(key, v);
    else flat(v, key, out);
  }
  return out;
}

const problems: string[] = [];
const E = flat(en);
const A = flat(ar);
for (const k of E.keys()) if (!A.has(k)) problems.push(`missing in ar: ${k}`);
for (const k of A.keys()) if (!E.has(k)) problems.push(`missing in en: ${k}`);

// Values that are fine without Arabic letters: digits, codes, brand-neutral symbols, language names shown in their own script.
const ALLOW = /^([\d\s.,:%+\-/()#|·]*|[A-Z]{2,6}(-\d)?|English|Google|Microsoft|123|CSV|PDF|me-central-1|horizon\.school\/home|SUB-2026-0041)$/;
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)[,}]/g)].map((m) => m[1]).sort().join(",");
for (const [k, v] of A) {
  if (!v.trim()) problems.push(`empty ar: ${k}`);
  else if (!/[؀-ۿ]/.test(v) && !ALLOW.test(v.trim()) && !/\{\w+\}/.test(v)) problems.push(`no Arabic text in ar: ${k} = ${v}`);
  const e = E.get(k);
  if (e !== undefined && placeholders(e) !== placeholders(v)) problems.push(`placeholder mismatch: ${k} (en: ${placeholders(e)} / ar: ${placeholders(v)})`);
}

function walk(dir: string, exts: string[], out: string[] = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) continue;
    if (statSync(p).isDirectory()) walk(p, exts, out);
    else if (exts.some((e) => name.endsWith(e))) out.push(p);
  }
  return out;
}

const EM = "—";
for (const f of [...walk(path.join(root, "src"), [".ts", ".tsx"]), ...walk(path.join(root, "messages"), [".json"]), ...walk(path.join(root, "docs"), [".md"]), ...walk(path.join(root, "prisma"), [".ts"]), path.join(root, "CLAUDE.md")]) {
  const text = readFileSync(f, "utf8");
  if (text.includes(EM)) problems.push(`em dash in ${path.relative(root, f)}`);
}

// Hard-coded English in JSX text nodes: >Some words< outside of braces.
for (const f of walk(path.join(root, "src"), [".tsx"])) {
  const lines = readFileSync(f, "utf8").split("\n");
  lines.forEach((line, i) => {
    const m = line.match(/>\s*([A-Za-z][A-Za-z ,.'!?]{2,})\s*<\//);
    if (m && !/^(PDF|CSV|AI|OK|ID|English)$/.test(m[1].trim())) problems.push(`hard-coded text ${path.relative(root, f)}:${i + 1}: "${m[1].trim()}"`);
  });
}

// PDF drawing, recharts margins and AI prompt text use "left"/"right" as values, not classes.
const NOT_CLASSES = /src\/server\/documents\/pdf\.ts|src\/server\/ai\/features\.ts|trend-chart\.tsx/;
for (const f of walk(path.join(root, "src"), [".ts", ".tsx"])) {
  if (NOT_CLASSES.test(f)) continue;
  for (const h of findPhysicalClasses(readFileSync(f, "utf8"))) problems.push(`direction class ${path.relative(root, f)}:${h.line} ${h.match}`);
}

console.log(`Messages: ${E.size} keys in English, ${A.size} in Arabic.`);
if (problems.length) {
  console.log(problems.join("\n"));
  console.log(`\n${problems.length} problem(s).`);
  process.exit(1);
}
console.log("i18n audit passed.");
