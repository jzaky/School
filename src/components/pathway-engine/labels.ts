// Text for engine results. Pure: works with next-intl translators on the server and the client.
import type { LineResult, MatchStatus, RequirementRow } from "@/server/pathway-engine/types";
import type { LevelClass, LevelGuide } from "@/server/pathway-engine/level-guide";

export type Tr = { (key: string, values?: Record<string, string | number>): string; has: (key: string) => boolean };
const opt = (t: Tr, key: string, fallback: string) => (t.has(key) ? t(key) : fallback);
export type SubjectNames = Record<string, { en: string; ar: string }>;

export const STATUS_TONE: Record<MatchStatus, "success" | "brand" | "info" | "danger" | "warning" | "neutral"> = {
  ELIGIBLE: "success",
  ON_TRACK: "brand",
  POSSIBLY_ELIGIBLE: "info",
  MISSING_REQUIREMENTS: "danger",
  NEEDS_MANUAL_REVIEW: "warning",
  UNKNOWN_DATA: "neutral",
};
export const STATUS_ORDER: MatchStatus[] = ["ELIGIBLE", "ON_TRACK", "POSSIBLY_ELIGIBLE", "NEEDS_MANUAL_REVIEW", "MISSING_REQUIREMENTS", "UNKNOWN_DATA"];

export function subjectList(keys: string[] | undefined, names: SubjectNames, locale: string, t: Tr): string {
  return (keys ?? []).map((k) => (names[k] ? (locale === "ar" ? names[k].ar : names[k].en) : k)).join(t("line.or"));
}

export function testName(t: Tr, code: string): string {
  return opt(t, `test.${code}`, code.replace(/_/g, " "));
}

/** Tone per level class: the advanced course stands out, "any level" reads as good news. */
export const LEVEL_TONE: Record<LevelClass, "violet" | "info" | "gold" | "success" | "neutral"> = {
  AP_REQUIRED: "violet",
  AP_OR_REGULAR: "info",
  SENIOR: "gold",
  ANY_LEVEL: "success",
  A_LEVEL: "violet",
  AS_LEVEL: "info",
  GCSE: "info",
  IB_HL: "violet",
  IB_SL: "info",
  LEVEL: "neutral",
};

/** The level in the curriculum's own words: "AP required", "A Level", "Higher Level (HL)", "Any level". Null when there is nothing to say. */
export function levelLabel(t: Tr, guide: LevelGuide | undefined, advisory = false): string | null {
  if (!guide) return null;
  if (guide.cls === "LEVEL") return guide.storedLevel ? t(`guide.level.${guide.storedLevel}`) : null;
  if (advisory && guide.cls === "AP_REQUIRED") return t("guide.cls.AP_ADVICE");
  return t(`guide.cls.${guide.cls}`);
}

/** A longer explanation of the level, for a hover hint. */
export function levelHint(t: Tr, guide: LevelGuide | undefined): string | null {
  if (!guide) return null;
  if (guide.cls === "SENIOR") return t("guide.hint.SENIOR", { grade: guide.fromGrade ?? 12 });
  if (guide.cls === "AP_REQUIRED" && guide.onlyCodes?.length === 1 && guide.onlyCodes[0] === "AP_CALC_BC") return t("guide.hint.BC_ONLY");
  return t.has(`guide.hint.${guide.cls}`) ? t(`guide.hint.${guide.cls}`) : null;
}

/** One sentence describing a requirement line. rows lets language lines list every accepted test.
 * opts.level false leaves the level out (when a level chip is shown next to it). */
export function lineText(t: Tr, l: LineResult, names: SubjectNames, locale: string, rows: RequirementRow[] = [], opts: { level?: boolean } = {}): string {
  switch (l.kind) {
    case "subject": {
      const subjects = subjectList(l.keys, names, locale, t);
      const level = opts.level === false ? null : l.guide ? levelLabel(t, l.guide, l.advisory) : l.minimumLevel ? t(`level.${l.minimumLevel}`) : null;
      const grade = l.required ? t("line.minGrade", { grade: String(l.required) }) : null;
      const detail = [level, grade].filter(Boolean).join(t("line.sep"));
      const head = l.type === "TWO_OF" ? t("line.twoOf", { subjects }) : l.type === "ONE_OF" || (l.keys?.length ?? 0) > 1 ? t("line.oneOf", { subjects }) : subjects;
      const body = detail ? t("line.withDetail", { subject: head, detail }) : head;
      return l.advisory ? t("line.recommended", { text: body }) : body;
    }
    case "gpa":
      return t("line.gpa", { min: Number(l.required) });
    case "percent":
      return t("line.percent", { min: Number(l.required) });
    case "points":
      return t("line.points", { min: Number(l.required) });
    case "gradeProfile":
      return t("line.profile", { profile: String(l.required) });
    case "stream":
      return t("line.stream", { streams: (l.alternatives ?? []).map((s) => opt(t, `stream.${s}`, s)).join(t("line.or")) });
    case "language": {
      const ids = l.id.replace(/^lang:/, "").split("+");
      const opts = rows.flatMap((r) => r.languages).filter((x) => ids.includes(x.id));
      const list = opts.length ? opts.map((o) => `${testName(t, o.test)} ${o.minOverall}`).join(t("line.or")) : `${testName(t, l.keys?.[0] ?? "")} ${l.required ?? ""}`;
      return t("line.language", { tests: list });
    }
    case "test": {
      const tests = (l.alternatives ?? l.keys ?? []).map((x) => testName(t, x)).join(t("line.or"));
      const policy = t(`testPolicy.${l.type}`);
      return l.required ? t("line.testMin", { tests, min: Number(l.required), policy }) : t("line.test", { tests, policy });
    }
    case "additional":
      return opt(t, `additional.${l.type}`, l.type);
  }
}
