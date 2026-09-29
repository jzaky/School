import { describe, expect, it } from "vitest";
import { DEFAULT_BANDS, bandFor, parsePasted, parseScore, runningAverages, validateBands, weightedAverage } from "@/server/grades/calc";

describe("weightedAverage", () => {
  it("weights each assessment's percentage", () => {
    // 50% with weight 1 and 100% with weight 3 -> (50 + 300) / 4 = 87.5
    expect(weightedAverage([{ score: 10, maxScore: 20, weight: 1 }, { score: 100, maxScore: 100, weight: 3 }])).toBeCloseTo(87.5);
  });
  it("ignores excused and missing scores", () => {
    expect(weightedAverage([{ score: 8, maxScore: 10, weight: 1 }, { score: null, maxScore: 10, weight: 5 }, { score: 0, maxScore: 10, weight: 5, excused: true }])).toBeCloseTo(80);
  });
  it("counts a zero score", () => {
    expect(weightedAverage([{ score: 0, maxScore: 10, weight: 1 }, { score: 10, maxScore: 10, weight: 1 }])).toBeCloseTo(50);
  });
  it("returns null when nothing counts", () => {
    expect(weightedAverage([])).toBeNull();
    expect(weightedAverage([{ score: 5, maxScore: 10, weight: 0 }])).toBeNull();
  });
});

describe("bandFor", () => {
  it("uses the default bands", () => {
    expect(bandFor(95)).toBe("A*");
    expect(bandFor(90)).toBe("A*");
    expect(bandFor(89.99)).toBe("A");
    expect(bandFor(70)).toBe("B");
    expect(bandFor(45)).toBe("E");
    expect(bandFor(12)).toBe("U");
    expect(bandFor(null)).toBeNull();
  });
  it("uses school bands in any order", () => {
    const bands = [{ label: "Pass", minPercent: 50 }, { label: "Distinction", minPercent: 85 }, { label: "Fail", minPercent: 0 }];
    expect(bandFor(86, bands)).toBe("Distinction");
    expect(bandFor(60, bands)).toBe("Pass");
    expect(bandFor(49, bands)).toBe("Fail");
  });
});

describe("validateBands", () => {
  it("accepts the defaults and rejects bad sets", () => {
    expect(validateBands(DEFAULT_BANDS)).toBeNull();
    expect(validateBands([{ label: "A", minPercent: 50 }, { label: "B", minPercent: 20 }])).toBe("bandZero");
    expect(validateBands([{ label: "A", minPercent: 50 }, { label: "a", minPercent: 0 }])).toBe("bandDuplicate");
    expect(validateBands([{ label: "A", minPercent: 150 }, { label: "B", minPercent: 0 }])).toBe("bandRange");
  });
});

describe("parsing", () => {
  it("parses Excel columns and Arabic digits", () => {
    expect(parsePasted("12\n15.5\n\n")).toEqual([["12"], ["15.5"]]);
    expect(parsePasted("1\t2\r\n3\t4")).toEqual([["1", "2"], ["3", "4"]]);
    expect(parseScore("١٧٫٥")).toEqual({ ok: true, value: 17.5 });
    expect(parseScore("")).toEqual({ ok: true, value: null });
    expect(parseScore("abc").ok).toBe(false);
  });
  it("builds a running average trend", () => {
    const pts = runningAverages([
      { at: "2026-09-01", score: 5, maxScore: 10, weight: 1 },
      { at: "2026-09-08", score: 10, maxScore: 10, weight: 1 },
    ]);
    expect(pts.map((p) => p.avg)).toEqual([50, 75]);
  });
});
