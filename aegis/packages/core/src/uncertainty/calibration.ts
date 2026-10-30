import { MIN_CALIBRATION_SAMPLES, type CalibrationLookup } from "./assess.js";

/**
 * Calibration of an agent's self-reported confidence against labelled outcomes (Guo et al. 2017,
 * "On Calibration of Modern Neural Networks"). Pure: equal-width bins, expected calibration error (ECE)
 * and the Brier score. AEGIS reports these figures with their sample size; it never extrapolates beyond
 * the outcomes it has seen.
 */

export interface CalibrationBin {
  lower: number;
  upper: number;
  count: number;
  meanConfidence: number | null;
  accuracy: number | null;
}

export interface CalibrationReport {
  sampleSize: number;
  bins: CalibrationBin[];
  /** Weighted mean gap between confidence and accuracy over the bins; null without outcomes. */
  ece: number | null;
  /** Mean squared error of confidence against the 0/1 outcome; null without outcomes. */
  brier: number | null;
  /** Share of outcomes that were correct. */
  accuracy: number | null;
  meanConfidence: number | null;
  status: "no_outcomes" | "insufficient" | "calibrated";
}

/** A bin must hold at least this many outcomes before its accuracy is used for a single request. */
export const MIN_BIN_COUNT = 5;

export function computeCalibration(pairs: { confidence: number; correct: boolean }[], binCount = 10): CalibrationReport {
  const valid = pairs.filter((p) => Number.isFinite(p.confidence) && p.confidence >= 0 && p.confidence <= 1);
  const bins: CalibrationBin[] = Array.from({ length: binCount }, (_, i) => ({ lower: i / binCount, upper: (i + 1) / binCount, count: 0, meanConfidence: null, accuracy: null }));
  const sums = bins.map(() => ({ conf: 0, correct: 0 }));
  for (const p of valid) {
    const idx = Math.min(binCount - 1, Math.floor(p.confidence * binCount));
    bins[idx]!.count++;
    sums[idx]!.conf += p.confidence;
    sums[idx]!.correct += p.correct ? 1 : 0;
  }
  bins.forEach((b, i) => {
    if (b.count) {
      b.meanConfidence = round(sums[i]!.conf / b.count);
      b.accuracy = round(sums[i]!.correct / b.count);
    }
  });
  const n = valid.length;
  if (!n) return { sampleSize: 0, bins, ece: null, brier: null, accuracy: null, meanConfidence: null, status: "no_outcomes" };
  const ece = bins.reduce((acc, b, i) => (b.count ? acc + (b.count / n) * Math.abs(sums[i]!.correct / b.count - sums[i]!.conf / b.count) : acc), 0);
  const brier = valid.reduce((acc, p) => acc + (p.confidence - (p.correct ? 1 : 0)) ** 2, 0) / n;
  const correct = valid.filter((p) => p.correct).length;
  return {
    sampleSize: n,
    bins,
    ece: round(ece),
    brier: round(brier),
    accuracy: round(correct / n),
    meanConfidence: round(valid.reduce((a, p) => a + p.confidence, 0) / n),
    status: n >= MIN_CALIBRATION_SAMPLES ? "calibrated" : "insufficient",
  };
}

/** The lookup the assessment uses: a bin's observed accuracy, only for bins with enough outcomes. */
export function lookupFromReport(report: Pick<CalibrationReport, "sampleSize" | "bins">): CalibrationLookup {
  const binCount = report.bins.length || 10;
  return {
    sampleSize: report.sampleSize,
    accuracyFor: (confidence) => {
      const b = report.bins[Math.min(binCount - 1, Math.floor(confidence * binCount))];
      return b && b.count >= MIN_BIN_COUNT && b.accuracy !== null ? b.accuracy : null;
    },
  };
}

function round(v: number): number {
  return Math.round(v * 10_000) / 10_000;
}
