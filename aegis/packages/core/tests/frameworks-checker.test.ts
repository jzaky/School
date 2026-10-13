import { describe, expect, it } from "vitest";
import { loadJsonCatalogs, SHARED_FRAMEWORKS } from "../src/seed/frameworks/index.js";
import { frameworkSeedSchema } from "../src/seed/frameworks/types.js";
import { AUTOMATED_EVIDENCE_TYPES } from "../src/audit/automated-checks.js";
import { CHECKER_FRAMEWORKS, CHECKER_QUESTIONS, checkerSummaryText, scoreChecker } from "../src/audit/checker.js";

describe("shared framework catalogs", () => {
  it("has twenty catalogs (TypeScript and JSON drop-ins) with unique keys, unique codes, categories, keywords and a license note each", () => {
    expect(SHARED_FRAMEWORKS.map((f) => f.key)).toEqual(["iso-42001", "iso-27001-2022", "nist-ai-rmf-1.0", "eu-ai-act", "gdpr", "uae-pdpl", "desc-isr", "iso-23894", "iso-27701", "iso-27017", "iso-27018", "iso-42005", "iso-38507", "difc-dpl-2020", "nist-csf-2", "owasp-llm-top10", "pci-dss-4", "sdaia-ai-ethics", "sg-model-ai-governance", "soc2-tsc"]);
    for (const f of SHARED_FRAMEWORKS) {
      expect(f.licenseNote.length, f.key).toBeGreaterThan(40);
      expect(f.controls.length, f.key).toBeGreaterThan(5);
      const codes = new Set<string>();
      for (const c of f.controls) {
        expect(codes.has(c.code), `${f.key} ${c.code} duplicated`).toBe(false);
        codes.add(c.code);
        expect(c.title.length, `${f.key} ${c.code}`).toBeGreaterThan(3);
        expect(c.summary.length, `${f.key} ${c.code}`).toBeGreaterThan(20);
        expect(c.category.length, `${f.key} ${c.code}`).toBeGreaterThan(0);
        expect(c.keywords.length, `${f.key} ${c.code}`).toBeGreaterThan(0);
        if (c.automatedEvidenceType) expect(AUTOMATED_EVIDENCE_TYPES as readonly string[]).toContain(c.automatedEvidenceType);
        expect(`${c.title} ${c.summary}`.includes(String.fromCharCode(0x2014)), `${f.key} ${c.code} em dash`).toBe(false);
      }
    }
    const total = SHARED_FRAMEWORKS.reduce((n, f) => n + f.controls.length, 0);
    expect(total).toBeGreaterThan(450);
    for (const f of SHARED_FRAMEWORKS) expect(frameworkSeedSchema.safeParse(f).success, `${f.key} validates against the catalog schema`).toBe(true);
    expect(loadJsonCatalogs().length).toBe(7);
  });

  it("every checker reference points at a seeded framework control", () => {
    const byKey = new Map(SHARED_FRAMEWORKS.map((f) => [f.key, new Set(f.controls.map((c) => c.code))]));
    for (const f of CHECKER_FRAMEWORKS) expect(byKey.has(f.key), f.key).toBe(true);
    for (const q of CHECKER_QUESTIONS) {
      expect(q.refs.length, q.id).toBeGreaterThan(0);
      for (const r of q.refs) {
        const codes = byKey.get(r.framework);
        expect(codes, `${q.id} -> ${r.framework}`).toBeDefined();
        for (const code of r.codes) expect(codes!.has(code), `${q.id} -> ${r.framework} ${code}`).toBe(true);
      }
    }
  });
});

describe("public governance checker", () => {
  it("scores answers, levels them and lists gaps weakest first", () => {
    const none = scoreChecker({});
    expect(none.score).toBe(0);
    expect(none.level).toBe("starting");
    expect(none.answered).toBe(0);
    expect(none.gaps).toHaveLength(CHECKER_QUESTIONS.length);
    const all = scoreChecker(Object.fromEntries(CHECKER_QUESTIONS.map((q) => [q.id, "yes" as const])));
    expect(all.score).toBe(100);
    expect(all.level).toBe("established");
    expect(all.gaps).toHaveLength(0);
    for (const f of all.frameworks) expect(f.percent).toBe(100);
    const mixed = scoreChecker({ gate: "yes", approval: "partial", evidence: "no", stop: "unsure" });
    expect(mixed.answered).toBe(4);
    expect(mixed.score).toBe(Math.round((1.5 / CHECKER_QUESTIONS.length) * 100));
    expect(mixed.gaps[0]!.id).not.toBe("approval");
    expect(mixed.gaps.find((g) => g.id === "approval")).toBeDefined();
    const eu = mixed.frameworks.find((f) => f.key === "eu-ai-act")!;
    expect(eu.openCodes).toContain("Art. 12");
    const iso = mixed.frameworks.find((f) => f.key === "iso-27001-2022")!;
    expect(iso.openCodes).toContain("A.8.15");
    expect(iso.openCodes).not.toContain("A.5.15");
    const text = checkerSummaryText(mixed, { gate: "yes" });
    expect(text).toMatch(/self-check: \d+ of 100/);
    expect(text).toMatch(/not a compliance opinion/);
  });
});
