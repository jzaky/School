#!/usr/bin/env node
/**
 * SAST gate. Reads SARIF files from CodeQL and Semgrep and fails (exit 1) when:
 *   - a file is missing, unreadable, has no runs, or reports a failed tool execution (a scan that did not
 *     really run must never pass as "no findings"), or
 *   - any high or critical finding is not in the reviewed baseline.
 * High or critical: CodeQL rules with security-severity >= 7.0; Semgrep results at level "error" (ERROR).
 * The baseline (.github/sast-baseline.json) lists reviewed false positives by tool, rule and file, each with a
 * reason. It does not dismiss them: they stay visible in GitHub's Security tab.
 *
 *   node .github/scripts/sast-gate.mjs --baseline .github/sast-baseline.json file1.sarif [file2.sarif ...]
 */
import { readFileSync } from "node:fs";

export function highFindings(sarif) {
  const out = [];
  for (const run of sarif.runs ?? []) {
    const tool = (run.tool?.driver?.name ?? "unknown").toLowerCase().includes("codeql") ? "codeql" : (run.tool?.driver?.name ?? "unknown").toLowerCase().includes("semgrep") ? "semgrep" : (run.tool?.driver?.name ?? "unknown");
    const severity = new Map();
    const rules = [...(run.tool?.driver?.rules ?? []), ...(run.tool?.extensions ?? []).flatMap((e) => e.rules ?? [])];
    for (const r of rules) severity.set(r.id, Number(r.properties?.["security-severity"] ?? 0));
    for (const res of run.results ?? []) {
      const high = tool === "codeql" ? (severity.get(res.ruleId) ?? 0) >= 7 : res.level === "error";
      if (!high) continue;
      const loc = res.locations?.[0]?.physicalLocation;
      out.push({ tool, ruleId: res.ruleId, path: loc?.artifactLocation?.uri ?? "?", line: loc?.region?.startLine ?? 0, message: (res.message?.text ?? "").split("\n")[0].slice(0, 200) });
    }
  }
  return out;
}

export function scanProblems(sarif, name) {
  const problems = [];
  if (!Array.isArray(sarif.runs) || sarif.runs.length === 0) problems.push(`${name}: no runs in the SARIF file`);
  for (const run of sarif.runs ?? []) {
    for (const inv of run.invocations ?? []) if (inv.executionSuccessful === false) problems.push(`${name}: the tool reported a failed execution`);
  }
  return problems;
}

export function gate(files, baseline) {
  const allowed = new Set((baseline.findings ?? []).map((b) => `${b.tool}|${b.ruleId}|${b.path}`));
  const problems = [];
  const blocking = [];
  let accepted = 0;
  for (const f of files) {
    let sarif;
    try {
      sarif = JSON.parse(readFileSync(f, "utf8"));
    } catch (e) {
      problems.push(`${f}: cannot be read (${e.message})`);
      continue;
    }
    problems.push(...scanProblems(sarif, f));
    for (const h of highFindings(sarif)) {
      if (allowed.has(`${h.tool}|${h.ruleId}|${h.path}`)) accepted++;
      else blocking.push(h);
    }
  }
  return { problems, blocking, accepted };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const bi = args.indexOf("--baseline");
  const baseline = bi >= 0 ? JSON.parse(readFileSync(args[bi + 1], "utf8")) : { findings: [] };
  const files = args.filter((a, i) => a !== "--baseline" && i !== bi + 1);
  if (files.length === 0) {
    console.error("sast-gate: no SARIF files given; a scan that produced nothing cannot pass");
    process.exit(1);
  }
  const { problems, blocking, accepted } = gate(files, baseline);
  for (const p of problems) console.error(`SCAN PROBLEM  ${p}`);
  for (const b of blocking) console.error(`BLOCKING  [${b.tool}] ${b.ruleId}  ${b.path}:${b.line}  ${b.message}`);
  console.log(`sast-gate: ${files.length} file(s), ${blocking.length} blocking high/critical finding(s), ${accepted} reviewed in the baseline, ${problems.length} scan problem(s)`);
  process.exit(problems.length || blocking.length ? 1 : 0);
}
