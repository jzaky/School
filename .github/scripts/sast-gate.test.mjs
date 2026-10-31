// Run with: node --test .github/scripts/sast-gate.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gate, highFindings } from "./sast-gate.mjs";

const dir = mkdtempSync(join(tmpdir(), "sast-gate-"));
const file = (name, obj) => {
  const p = join(dir, name);
  writeFileSync(p, typeof obj === "string" ? obj : JSON.stringify(obj));
  return p;
};
const codeql = (results, ok = true) => ({ runs: [{ tool: { driver: { name: "CodeQL", rules: [{ id: "js/high", properties: { "security-severity": "7.5" } }, { id: "js/low", properties: { "security-severity": "4.0" } }] } }, invocations: [{ executionSuccessful: ok }], results }] });
const at = (ruleId, uri) => ({ ruleId, message: { text: "m" }, locations: [{ physicalLocation: { artifactLocation: { uri }, region: { startLine: 3 } } }] });

test("a high CodeQL finding blocks; a low one does not", () => {
  const r = gate([file("a.sarif", codeql([at("js/high", "src/a.ts"), at("js/low", "src/b.ts")]))], { findings: [] });
  assert.equal(r.blocking.length, 1);
  assert.equal(r.blocking[0].ruleId, "js/high");
});

test("a reviewed baseline entry passes only for its exact tool, rule and file", () => {
  const base = { findings: [{ tool: "codeql", ruleId: "js/high", path: "src/a.ts", reason: "reviewed" }] };
  assert.equal(gate([file("b.sarif", codeql([at("js/high", "src/a.ts")]))], base).blocking.length, 0);
  assert.equal(gate([file("c.sarif", codeql([at("js/high", "src/other.ts")]))], base).blocking.length, 1);
});

test("an in-source suppression counts as reviewed; one under review or rejected still blocks", () => {
  const sup = (status) => ({ ...at("js/high", "src/a.ts"), suppressions: [{ kind: "inSource", ...(status ? { status } : {}) }] });
  const r = gate([file("s.sarif", codeql([sup(), sup("accepted")]))], { findings: [] });
  assert.equal(r.blocking.length, 0);
  assert.equal(r.suppressed, 2);
  assert.equal(gate([file("t.sarif", codeql([sup("underReview")]))], { findings: [] }).blocking.length, 1);
  assert.equal(gate([file("u.sarif", codeql([sup("rejected")]))], { findings: [] }).blocking.length, 1);
});

test("Semgrep results at level error block", () => {
  const sg = { runs: [{ tool: { driver: { name: "Semgrep OSS", rules: [] } }, results: [{ ...at("x.rule", "a.yml"), level: "error" }, { ...at("y.rule", "a.yml"), level: "warning" }] }] };
  assert.deepEqual(highFindings(sg).map((h) => h.ruleId), ["x.rule"]);
});

test("a scan that did not run cannot pass: missing file, unreadable file, no runs, failed execution", () => {
  assert.ok(gate([join(dir, "missing.sarif")], {}).problems.length > 0);
  assert.ok(gate([file("bad.sarif", "{not json")], {}).problems.length > 0);
  assert.ok(gate([file("empty.sarif", { runs: [] })], {}).problems.length > 0);
  assert.ok(gate([file("failed.sarif", codeql([], false))], {}).problems.length > 0);
});
