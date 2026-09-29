// Subject vocabulary for extraction. The allowed codes come from CanonicalSubject (global table);
// the phrases below only help the rule-based extractor find subjects in page text and map them to
// whatever keys the CanonicalSubject catalog uses (matched by key or by English name).

export type VocabEntry = { key: string; nameEn: string };

/** Alias groups; the first phrase is the display name. The id is our default key. */
export const SUBJECT_ALIASES: Array<{ id: string; phrases: string[] }> = [
  { id: "further_mathematics", phrases: ["further mathematics", "further maths", "further math"] },
  { id: "computer_science", phrases: ["computer science", "computing"] },
  { id: "mathematics", phrases: ["mathematics", "mathematics: analysis and approaches", "maths", "math"] },
  { id: "calculus", phrases: ["calculus"] },
  { id: "statistics", phrases: ["statistics"] },
  { id: "physics", phrases: ["physics"] },
  { id: "chemistry", phrases: ["chemistry"] },
  { id: "biology", phrases: ["biology"] },
  { id: "economics", phrases: ["economics"] },
  { id: "english_literature", phrases: ["english literature"] },
  { id: "english", phrases: ["english", "english language"] },
  { id: "history", phrases: ["history"] },
  { id: "geography", phrases: ["geography"] },
  { id: "psychology", phrases: ["psychology"] },
  { id: "design_technology", phrases: ["design and technology", "design technology"] },
  { id: "art", phrases: ["art and design", "fine art"] },
  { id: "business", phrases: ["business studies", "business"] },
  { id: "arabic", phrases: ["arabic"] },
  { id: "french", phrases: ["french"] },
];

/** Used when the CanonicalSubject catalog is empty (tests, fresh databases). */
export const DEFAULT_VOCAB: VocabEntry[] = SUBJECT_ALIASES.map((a) => ({ key: a.id, nameEn: a.phrases[0].replace(/\b\w/g, (c) => c.toUpperCase()) }));

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Map an alias group id to a key that exists in the vocabulary, or null. */
export function resolveSubjectKey(aliasId: string, vocab: VocabEntry[]): string | null {
  const group = SUBJECT_ALIASES.find((a) => a.id === aliasId);
  const candidates = new Set([norm(aliasId), ...(group?.phrases ?? []).map(norm)]);
  const byKey = vocab.find((v) => candidates.has(norm(v.key)));
  if (byKey) return byKey.key;
  const byName = vocab.find((v) => candidates.has(norm(v.nameEn)));
  return byName?.key ?? null;
}

export type SubjectMention = { aliasId: string; index: number; phrase: string };

/** Subjects named in a piece of text, in order, longest phrase first so "Further Mathematics" is not also "Mathematics". */
export function findSubjects(text: string): SubjectMention[] {
  const lower = text.toLowerCase();
  const taken: Array<[number, number]> = [];
  const found: SubjectMention[] = [];
  const all = SUBJECT_ALIASES.flatMap((a) => a.phrases.map((p) => ({ id: a.id, p }))).sort((a, b) => b.p.length - a.p.length);
  for (const { id, p } of all) {
    const re = new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(lower))) {
      const s = m.index;
      const e = s + p.length;
      if (taken.some(([a, b]) => s < b && e > a)) continue;
      taken.push([s, e]);
      found.push({ aliasId: id, index: s, phrase: text.slice(s, e) });
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

/** True when the evidence names the subject (by any alias or by its catalog English name). */
export function subjectInText(key: string, evidence: string, vocab: VocabEntry[]): boolean {
  const lower = evidence.toLowerCase();
  const entry = vocab.find((v) => v.key === key);
  if (entry && lower.includes(entry.nameEn.toLowerCase())) return true;
  const group = SUBJECT_ALIASES.find((a) => resolveSubjectKey(a.id, vocab) === key || a.id === key);
  return !!group && group.phrases.some((p) => new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(lower));
}
