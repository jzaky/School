// Structured diff between two requirement versions of one program and curriculum, with severity.
// Event types, severity levels and deterministic ids follow collegedata-fyi
// tools/change_intelligence/project_change_events.py (classify_field_change, severity_for_delta,
// event_id), MIT License, (c) 2026 Anthony S. and Bolewood Group, LLC. See docs/third-party.md.
// Pure: no database. Summaries are produced in English and Arabic.
import { createHash } from "node:crypto";
import { SEVERITIES, type AdditionalLine, type ChangeType, type Curriculum, type DiffEntry, type DraftGroup, type LanguageLine, type LineRef, type OverallLine, type Severity, type SubjectLine, type TestLine } from "./types";

/** Deterministic id from the key parts (sha256, 32 hex chars), so reruns never duplicate a change. */
export function changeId(parts: Array<string | number | null | undefined>) {
  return createHash("sha256")
    .update(parts.map((p) => (p === null || p === undefined ? "" : String(p))).join("|"))
    .digest("hex")
    .slice(0, 32);
}

export type SubjectLabels = Record<string, { en: string; ar: string }>;

const BINDING_SUBJECT = new Set(["REQUIRED", "ONE_OF", "TWO_OF"]);

const TYPE_WORDS: Record<string, { en: string; ar: string }> = {
  REQUIRED: { en: "required", ar: "مطلوبة" },
  ONE_OF: { en: "one of", ar: "واحدة من" },
  TWO_OF: { en: "two of", ar: "اثنتان من" },
  PREFERRED: { en: "preferred", ar: "مفضلة" },
  RECOMMENDED: { en: "recommended", ar: "موصى بها" },
  OPTIONAL: { en: "optional", ar: "اختيارية" },
};
const POLICY_WORDS: Record<string, { en: string; ar: string }> = {
  REQUIRED: { en: "required", ar: "مطلوب" },
  RECOMMENDED: { en: "recommended", ar: "موصى به" },
  OPTIONAL: { en: "test optional", ar: "اختياري" },
  NOT_CONSIDERED: { en: "not considered", ar: "لا يُؤخذ به" },
};
const ADDITIONAL_WORDS: Record<string, { en: string; ar: string }> = {
  INTERVIEW: { en: "Interview", ar: "المقابلة" },
  PERSONAL_STATEMENT: { en: "Personal statement", ar: "البيان الشخصي" },
  PORTFOLIO: { en: "Portfolio", ar: "ملف الأعمال" },
  REFERENCE: { en: "Reference", ar: "خطاب التوصية" },
  ESSAY: { en: "Essay", ar: "المقال" },
  OTHER: { en: "Additional requirement", ar: "متطلب إضافي" },
};
const OVERALL_WORDS: Record<OverallLine["field"], { en: string; ar: string }> = {
  gradeProfile: { en: "Grade profile", ar: "الدرجات المطلوبة" },
  minimumPoints: { en: "IB points", ar: "نقاط IB" },
  minimumGPA: { en: "Minimum GPA", ar: "الحد الأدنى للمعدل التراكمي" },
  minimumPercent: { en: "Minimum average", ar: "الحد الأدنى للمعدل" },
};

const LETTER_RANK: Record<string, number> = { "A*": 6, A: 5, B: 4, C: 3, D: 2, E: 1, U: 0 };

/** Rank a grade or a grade profile. Profiles sum their grades (A*AA = 16). Null when not comparable. */
export function gradeRank(g: string | number | null | undefined): number | null {
  if (g === null || g === undefined || g === "") return null;
  if (typeof g === "number") return g;
  const s = g.trim().replace(/%$/, "");
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const tokens = s.match(/A\*|[A-EU]/g);
  if (!tokens || tokens.join("") !== s) return null;
  return tokens.reduce((n, t) => n + LETTER_RANK[t], 0);
}

function subjectLabel(keys: string[], labels: SubjectLabels) {
  const en = keys.map((k) => labels[k]?.en ?? k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())).join(" or ");
  const ar = keys.map((k) => labels[k]?.ar ?? labels[k]?.en ?? k.replace(/_/g, " ")).join(" أو ");
  return { en, ar };
}

const fmt = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? null : typeof v === "number" ? (Number.isInteger(v) ? String(v) : String(v)) : v);

function severityOf(type: ChangeType, binding: boolean, becameBinding = false): Severity {
  switch (type) {
    case "ADDED":
      return binding ? "MAJOR" : "NOTABLE";
    case "REMOVED":
      return binding ? "NOTABLE" : "WATCH";
    case "THRESHOLD_RAISED":
      return binding ? "MAJOR" : "NOTABLE";
    case "THRESHOLD_LOWERED":
      return "NOTABLE";
    case "STRENGTH_CHANGED":
      return becameBinding ? "MAJOR" : "NOTABLE";
    case "SOURCE_REMOVED":
      return "NOTABLE";
    default:
      return "WATCH";
  }
}

export const maxSeverity = (list: Severity[]): Severity => list.reduce<Severity>((a, b) => (SEVERITIES.indexOf(b) > SEVERITIES.indexOf(a) ? b : a), "WATCH");

type Label = { en: string; ar: string };

function thresholdEntry(ref: LineRef, label: Label, from: string | number | null | undefined, to: string | number | null | undefined, binding: boolean): DiffEntry | null {
  const a = fmt(from);
  const b = fmt(to);
  if (a === b) return null;
  if (a === null || b === null) {
    const type: ChangeType = a === null ? "ADDED" : "REMOVED";
    return {
      type,
      ref,
      from: a,
      to: b,
      binding,
      severity: severityOf(type, binding),
      summaryEn: type === "ADDED" ? `${label.en} set to ${b}` : `${label.en} (${a}) removed`,
      summaryAr: type === "ADDED" ? `حُدد ${label.ar}: ${b}` : `أُزيل ${label.ar} (${a})`,
    };
  }
  const ra = gradeRank(from);
  const rb = gradeRank(to);
  let type: ChangeType = "STRENGTH_CHANGED";
  if (ra !== null && rb !== null && ra !== rb) type = rb > ra ? "THRESHOLD_RAISED" : "THRESHOLD_LOWERED";
  const verbEn = type === "THRESHOLD_RAISED" ? "raised" : type === "THRESHOLD_LOWERED" ? "lowered" : "changed";
  const verbAr = type === "THRESHOLD_RAISED" ? "رُفع" : type === "THRESHOLD_LOWERED" ? "خُفّض" : "تغيّر";
  return { type, ref, from: a, to: b, binding, severity: severityOf(type, binding), summaryEn: `${label.en} ${verbEn} from ${a} to ${b}`, summaryAr: `${verbAr} ${label.ar} من ${a} إلى ${b}` };
}

const subjectId = (l: SubjectLine) => [...l.keys].sort().join("|");

function diffSubjects(prev: SubjectLine[], next: SubjectLine[], labels: SubjectLabels): DiffEntry[] {
  const out: DiffEntry[] = [];
  const before = new Map(prev.map((l) => [subjectId(l), l]));
  const after = new Map(next.map((l) => [subjectId(l), l]));
  for (const [id, n] of after) {
    const p = before.get(id);
    const label = subjectLabel(n.keys, labels);
    const ref: LineRef = { section: "subject", keys: n.keys, type: n.type };
    const binding = BINDING_SUBJECT.has(n.type);
    if (!p) {
      const w = TYPE_WORDS[n.type] ?? { en: n.type.toLowerCase(), ar: n.type };
      const grade = n.minimumGrade ? ` (${n.minimumGrade})` : "";
      out.push({
        type: "ADDED",
        ref,
        from: null,
        to: `${n.type}${grade}`,
        binding,
        severity: severityOf("ADDED", binding),
        summaryEn: binding ? `${label.en}${grade} now required` : `${label.en} now ${w.en}`,
        summaryAr: binding ? `أصبحت ${label.ar}${grade} مطلوبة` : `أصبحت ${label.ar} ${w.ar}`,
      });
      continue;
    }
    if (p.type !== n.type) {
      const becameBinding = binding && !BINDING_SUBJECT.has(p.type);
      const wp = TYPE_WORDS[p.type] ?? { en: p.type, ar: p.type };
      const wn = TYPE_WORDS[n.type] ?? { en: n.type, ar: n.type };
      out.push({
        type: "STRENGTH_CHANGED",
        ref,
        from: p.type,
        to: n.type,
        binding: binding || BINDING_SUBJECT.has(p.type),
        severity: becameBinding ? "MAJOR" : "NOTABLE",
        summaryEn: `${label.en} changed from ${wp.en} to ${wn.en}`,
        summaryAr: `تغيّرت ${label.ar} من ${wp.ar} إلى ${wn.ar}`,
      });
    }
    const t = thresholdEntry(ref, { en: `${label.en} grade`, ar: `درجة ${label.ar}` }, p.minimumGrade ?? null, n.minimumGrade ?? null, binding);
    if (t) out.push(t);
  }
  for (const [id, p] of before) {
    if (after.has(id)) continue;
    const label = subjectLabel(p.keys, labels);
    const binding = BINDING_SUBJECT.has(p.type);
    out.push({ type: "REMOVED", ref: { section: "subject", keys: p.keys, type: p.type }, from: p.type, to: null, binding, severity: severityOf("REMOVED", binding), summaryEn: `${label.en} no longer listed`, summaryAr: `لم تعد ${label.ar} مدرجة` });
  }
  return out;
}

function diffLanguages(prev: LanguageLine[], next: LanguageLine[]): DiffEntry[] {
  const out: DiffEntry[] = [];
  const before = new Map(prev.map((l) => [l.test, l]));
  const after = new Map(next.map((l) => [l.test, l]));
  for (const [test, n] of after) {
    const p = before.get(test);
    if (!p) {
      const comp = n.minComponent != null ? ` (${n.minComponent} in each component)` : "";
      const compAr = n.minComponent != null ? ` (${n.minComponent} في كل مكوّن)` : "";
      out.push({ type: "ADDED", ref: { section: "language", test }, from: null, to: String(n.minOverall), binding: true, severity: "MAJOR", summaryEn: `${test} ${n.minOverall}${comp} now required`, summaryAr: `أصبح ${test} ${n.minOverall}${compAr} مطلوبا` });
      continue;
    }
    const band = (v: number | null | undefined) => (v === null || v === undefined ? null : test === "IELTS" ? v.toFixed(1) : String(v));
    const a = thresholdEntry({ section: "language", test }, { en: test, ar: test }, band(p.minOverall), band(n.minOverall), true);
    if (a) out.push(a);
    const b = thresholdEntry({ section: "language", test, part: "component" }, { en: `${test} component minimum`, ar: `الحد الأدنى لكل مكوّن في ${test}` }, band(p.minComponent), band(n.minComponent), true);
    if (b) out.push(b);
  }
  for (const [test, p] of before) {
    if (!after.has(test)) out.push({ type: "REMOVED", ref: { section: "language", test }, from: String(p.minOverall), to: null, binding: true, severity: "NOTABLE", summaryEn: `${test} no longer listed`, summaryAr: `لم يعد ${test} مدرجا` });
  }
  return out;
}

function diffTests(prev: TestLine[], next: TestLine[]): DiffEntry[] {
  const out: DiffEntry[] = [];
  const before = new Map(prev.map((l) => [l.test, l]));
  const after = new Map(next.map((l) => [l.test, l]));
  for (const [test, n] of after) {
    const p = before.get(test);
    const w = POLICY_WORDS[n.policy] ?? { en: n.policy.toLowerCase(), ar: n.policy };
    const binding = n.policy === "REQUIRED";
    if (!p) {
      out.push({ type: "ADDED", ref: { section: "test", test }, from: null, to: n.policy, binding, severity: severityOf("ADDED", binding), summaryEn: `${test} ${w.en}`, summaryAr: `${test}: ${w.ar}` });
      continue;
    }
    if (p.policy !== n.policy) {
      const wp = POLICY_WORDS[p.policy] ?? { en: p.policy, ar: p.policy };
      const becameBinding = binding && p.policy !== "REQUIRED";
      out.push({
        type: "STRENGTH_CHANGED",
        ref: { section: "test", test },
        from: p.policy,
        to: n.policy,
        binding: binding || p.policy === "REQUIRED",
        severity: becameBinding ? "MAJOR" : "NOTABLE",
        summaryEn: `${test} policy changed from ${wp.en} to ${w.en}`,
        summaryAr: `تغيّرت سياسة ${test} من ${wp.ar} إلى ${w.ar}`,
      });
    }
    const t = thresholdEntry({ section: "test", test, part: "minScore" }, { en: `${test} minimum score`, ar: `الحد الأدنى لدرجة ${test}` }, p.minScore ?? null, n.minScore ?? null, binding);
    if (t) out.push(t);
  }
  for (const [test, p] of before) {
    if (!after.has(test)) out.push({ type: "REMOVED", ref: { section: "test", test }, from: p.policy, to: null, binding: p.policy === "REQUIRED", severity: severityOf("REMOVED", p.policy === "REQUIRED"), summaryEn: `${test} no longer listed`, summaryAr: `لم يعد ${test} مدرجا` });
  }
  return out;
}

function diffAdditional(prev: AdditionalLine[], next: AdditionalLine[]): DiffEntry[] {
  const out: DiffEntry[] = [];
  const before = new Map(prev.map((l) => [l.kind, l]));
  const after = new Map(next.map((l) => [l.kind, l]));
  for (const [kind, n] of after) {
    const p = before.get(kind);
    const w = ADDITIONAL_WORDS[kind] ?? ADDITIONAL_WORDS.OTHER;
    if (!p) {
      out.push({ type: "ADDED", ref: { section: "additional", kind }, from: null, to: n.required ? "REQUIRED" : "OPTIONAL", binding: n.required, severity: severityOf("ADDED", n.required), summaryEn: `${w.en} ${n.required ? "now required" : "added"}`, summaryAr: n.required ? `أصبح ${w.ar} مطلوبا` : `أُضيف ${w.ar}` });
    } else if (p.required !== n.required) {
      out.push({ type: "STRENGTH_CHANGED", ref: { section: "additional", kind }, from: p.required ? "REQUIRED" : "OPTIONAL", to: n.required ? "REQUIRED" : "OPTIONAL", binding: true, severity: n.required ? "MAJOR" : "NOTABLE", summaryEn: `${w.en} ${n.required ? "now required" : "now optional"}`, summaryAr: n.required ? `أصبح ${w.ar} مطلوبا` : `أصبح ${w.ar} اختياريا` });
    }
  }
  for (const [kind, p] of before) {
    const w = ADDITIONAL_WORDS[kind] ?? ADDITIONAL_WORDS.OTHER;
    if (!after.has(kind)) out.push({ type: "REMOVED", ref: { section: "additional", kind }, from: p.required ? "REQUIRED" : "OPTIONAL", to: null, binding: p.required, severity: severityOf("REMOVED", p.required), summaryEn: `${w.en} no longer listed`, summaryAr: `لم يعد ${w.ar} مدرجا` });
  }
  return out;
}

function diffOverall(prev: OverallLine[], next: OverallLine[]): DiffEntry[] {
  const out: DiffEntry[] = [];
  const fields = new Set([...prev, ...next].map((l) => l.field));
  for (const field of fields) {
    const a = prev.find((l) => l.field === field)?.value ?? null;
    const b = next.find((l) => l.field === field)?.value ?? null;
    const t = thresholdEntry({ section: "overall", field }, OVERALL_WORDS[field], a, b, true);
    if (t) out.push(t);
  }
  return out;
}

export type DiffInput = {
  prev: DraftGroup | null;
  next: DraftGroup;
  prevSourceId?: string | null;
  nextSourceId?: string | null;
  /** The source kind changed (for example mirror to official): severity is capped at WATCH. */
  sourceTypeChanged?: boolean;
  labels?: SubjectLabels;
};

export type DiffResult = { entries: DiffEntry[]; severity: Severity; summaryEn: string; summaryAr: string; curriculum: Curriculum | null };

export function diffGroups(input: DiffInput): DiffResult {
  const labels = input.labels ?? {};
  const prev = input.prev;
  const next = input.next;
  const entries: DiffEntry[] = [
    ...diffOverall(prev?.overall ?? [], next.overall),
    ...diffSubjects(prev?.subjects ?? [], next.subjects, labels),
    ...diffLanguages(prev?.languages ?? [], next.languages),
    ...diffTests(prev?.tests ?? [], next.tests),
    ...diffAdditional(prev?.additional ?? [], next.additional),
  ];
  if (prev && input.prevSourceId && !input.nextSourceId) {
    entries.push({ type: "SOURCE_REMOVED", ref: { section: "source" }, from: input.prevSourceId, to: null, binding: false, severity: "NOTABLE", summaryEn: "Source page no longer linked", summaryAr: "لم تعد صفحة المصدر مرتبطة" });
  } else if (prev && input.prevSourceId && input.nextSourceId && input.prevSourceId !== input.nextSourceId) {
    entries.push({ type: "SOURCE_CHANGED", ref: { section: "source" }, from: input.prevSourceId, to: input.nextSourceId, binding: false, severity: "WATCH", summaryEn: "Source page changed", summaryAr: "تغيّرت صفحة المصدر" });
  }
  // First publication, or a change of source kind: shown for information only.
  if (!prev || input.sourceTypeChanged) for (const e of entries) e.severity = "WATCH";
  const severity = maxSeverity(entries.map((e) => e.severity));
  const ranked = [...entries].sort((a, b) => SEVERITIES.indexOf(b.severity) - SEVERITIES.indexOf(a.severity));
  const head = ranked.slice(0, 2);
  const more = ranked.length - head.length;
  const summaryEn = !prev ? "First published version" : head.length ? head.map((e) => e.summaryEn).join("; ") + (more > 0 ? `; and ${more} more` : "") : "No requirement changes";
  const summaryAr = !prev ? "أول نسخة منشورة" : head.length ? head.map((e) => e.summaryAr).join("؛ ") + (more > 0 ? `؛ و${more} تغييرات أخرى` : "") : "لا تغييرات في المتطلبات";
  return { entries, severity, summaryEn, summaryAr, curriculum: next.curriculum };
}
