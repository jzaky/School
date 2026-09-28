import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { findPhysicalClasses } from "./direction-classes";

function walk(dir: string, acc: string[] = []) {
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(tsx|ts)$/.test(f)) acc.push(p);
  }
  return acc;
}
let n = 0;
for (const file of walk(process.argv[2] ?? "src")) {
  for (const hit of findPhysicalClasses(readFileSync(file, "utf8"))) {
    console.log(`${file}:${hit.line} ${hit.match}`);
    n++;
  }
}
console.log(`${n} physical direction classes`);
process.exit(n ? 1 : 0);
