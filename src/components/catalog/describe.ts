// Localized one-line descriptions of requirement lines. Takes a translator for the "catalog" namespace,
// so it works in server pages and client components alike.
import type { AdditionalLine, LanguageLine, OverallLine, SubjectLine, TestLine } from "@/server/catalog-pipeline/types";

export type Tr = (key: string, values?: Record<string, string | number>) => string;
export type SubjectNames = Record<string, string>;

const humanize = (k: string) => k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const has = (t: Tr & { has?: (k: string) => boolean }, key: string) => (typeof t.has === "function" ? t.has(key) : true);

export function subjectsText(t: Tr, keys: string[], names: SubjectNames) {
  return keys.map((k) => names[k] ?? humanize(k)).join(t("line.or"));
}

export function describeOverall(t: Tr, l: Pick<OverallLine, "field" | "value">) {
  return t(`line.${l.field}`, { value: String(l.value) });
}

export function describeSubject(t: Tr, l: Pick<SubjectLine, "type" | "keys" | "minimumGrade">, names: SubjectNames) {
  const type = has(t, `type.${l.type}`) ? t(`type.${l.type}`) : l.type;
  const subjects = subjectsText(t, l.keys, names);
  return l.minimumGrade ? t("line.subjectGrade", { type, subjects, grade: l.minimumGrade }) : t("line.subject", { type, subjects });
}

export function describeLanguage(t: Tr, l: Pick<LanguageLine, "test" | "minOverall" | "minComponent">) {
  const f = (n: number) => (l.test === "IELTS" ? n.toFixed(1) : String(n));
  return l.minComponent !== null && l.minComponent !== undefined ? t("line.languageComponent", { test: l.test, overall: f(l.minOverall), component: f(l.minComponent) }) : t("line.language", { test: l.test, overall: f(l.minOverall) });
}

export function describeTest(t: Tr, l: Pick<TestLine, "test" | "policy" | "minScore">) {
  const policy = t(`policy.${l.policy}`);
  return l.minScore !== null && l.minScore !== undefined ? t("line.testMin", { test: l.test, policy, score: l.minScore }) : t("line.test", { test: l.test, policy });
}

export function describeAdditional(t: Tr, l: Pick<AdditionalLine, "kind" | "required">) {
  return t("line.additional", { kind: t(`kind.${l.kind}`), required: t(l.required ? "line.requiredYes" : "line.requiredNo") });
}
