/**
 * Deterministic lexical retrieval for the assessment engine.
 *
 * This is Okapi BM25 implemented from the public formula (Robertson and Zaragoza, 2009), with
 * k1 = 1.5 and b = 0.75, over document chunks held in memory for one assessment run. It needs no
 * embeddings provider and never sends text outside the process.
 *
 * IMPORTANT: `normalisedScore` is a lexical similarity between a control's wording and a chunk of
 * text, scaled to 0..1 by the maximum weight the query terms could contribute. It is NOT a
 * measure of compliance, and it is NOT a probability. A high score means the document talks about
 * the same things as the control; a human must confirm that what it says satisfies the control.
 */

export const BM25_K1 = 1.5;
export const BM25_B = 0.75;

/** Common English function words plus boilerplate that carries no signal in policy documents. */
export const STOPWORDS = new Set<string>(
  (
    "a an and are as at be been being by for from has have had he her his how i if in into is it its of on or " +
    "that the their them then there these they this those to was we were what when where which who whom why will with " +
    "would you your yours our ours us also any all both each either more most other some such than too very can could " +
    "may might shall should must not no nor only own same so about above after again against before below between " +
    "but do does did doing down during further here once out over under until up while through just now " +
    "ensure ensures ensured ensuring including include includes included within without where appropriate relevant related"
  ).split(/\s+/),
);

/**
 * Light suffix-stripping stemmer. Deliberately simple and deterministic: it does not try to be
 * linguistically correct, only to make "policies" and "policy", "reviewed" and "review" collide.
 */
export function stem(word: string): string {
  let w = word;
  if (w.length > 4 && w.endsWith("ies")) w = w.slice(0, -3) + "y";
  else if (w.length > 5 && w.endsWith("sses")) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us") && !w.endsWith("is") && !w.endsWith("as")) w = w.slice(0, -1);
  if (w.length > 6 && w.endsWith("ment")) w = w.slice(0, -4);
  else if (w.length > 6 && w.endsWith("ness")) w = w.slice(0, -4);
  else if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
  else if (w.length > 4 && w.endsWith("ly")) w = w.slice(0, -2);
  // Strip a trailing e consistently so "manage", "managing" and "management" collide.
  if (w.length > 4 && w.endsWith("e")) w = w.slice(0, -1);
  return w;
}

/** Lowercases, strips punctuation, drops stopwords and short tokens, stems. */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").split(" ")) {
    if (raw.length < 2 || STOPWORDS.has(raw)) continue;
    if (/^\d+$/.test(raw)) continue;
    const s = stem(raw);
    if (s.length >= 2) out.push(s);
  }
  return out;
}

export interface IndexedChunk {
  id: string;
  text: string;
}

export interface SearchHit {
  chunkId: string;
  /** Raw BM25 score. */
  score: number;
  /** Lexical similarity scaled 0..1. Not compliance, not probability. */
  normalisedScore: number;
  /** Fraction of distinct query terms present in the chunk. */
  termCoverage: number;
}

export class Bm25Index {
  private readonly docs: { id: string; tf: Map<string, number>; length: number }[] = [];
  private readonly df = new Map<string, number>();
  private avgdl = 0;

  constructor(chunks: IndexedChunk[]) {
    let total = 0;
    for (const c of chunks) {
      const tokens = tokenize(c.text);
      const tf = new Map<string, number>();
      for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      this.docs.push({ id: c.id, tf, length: tokens.length });
      total += tokens.length;
    }
    this.avgdl = this.docs.length ? total / this.docs.length : 0;
  }

  get size(): number {
    return this.docs.length;
  }

  /** idf(t) = ln(1 + (N - n(t) + 0.5) / (n(t) + 0.5)) */
  idf(term: string): number {
    const n = this.df.get(term) ?? 0;
    const N = this.docs.length;
    return Math.log(1 + (N - n + 0.5) / (n + 0.5));
  }

  /**
   * Scores every chunk against the query and returns the best `topK`, deterministic for equal
   * scores (ties broken by insertion order). Query terms are de-duplicated so a repeated word in a
   * control's title and keywords does not dominate.
   */
  search(query: string, topK = 5): SearchHit[] {
    if (this.docs.length === 0) return [];
    const terms = [...new Set(tokenize(query))];
    if (terms.length === 0) return [];
    // Upper bound used for normalisation: a chunk of average length containing every query
    // term exactly once scores sum(idf). Scores can exceed it slightly with repeated terms, so the
    // result is clamped to 1.
    const maxWeight = terms.reduce((acc, t) => acc + this.idf(t), 0) || 1;
    const hits: SearchHit[] = [];
    for (const d of this.docs) {
      let score = 0;
      let matched = 0;
      const norm = BM25_K1 * (1 - BM25_B + (BM25_B * d.length) / (this.avgdl || 1));
      for (const t of terms) {
        const tf = d.tf.get(t);
        if (!tf) continue;
        matched++;
        score += this.idf(t) * ((tf * (BM25_K1 + 1)) / (tf + norm));
      }
      if (score > 0) hits.push({ chunkId: d.id, score, normalisedScore: Math.min(1, score / maxWeight), termCoverage: matched / terms.length });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, topK).map((h) => ({ ...h, score: round(h.score), normalisedScore: round(h.normalisedScore), termCoverage: round(h.termCoverage) }));
  }
}

/**
 * Fraction of control keywords (each possibly multi-word) whose stemmed tokens all occur in the
 * chunk. 0 when there are no keywords.
 */
export function lexicalOverlap(controlKeywords: string[], chunkText: string): number {
  const keywords = controlKeywords.map((k) => tokenize(k)).filter((k) => k.length > 0);
  if (keywords.length === 0) return 0;
  const present = new Set(tokenize(chunkText));
  let hit = 0;
  for (const kw of keywords) if (kw.every((t) => present.has(t))) hit++;
  return round(hit / keywords.length);
}

/** Phrases that signal normative policy language rather than descriptive prose. */
export const POLICY_PHRASES = ["shall", "must", "is responsible", "are responsible", "reviewed annually", "reviewed at least annually", "approved by", "is required", "are required", "at a minimum", "prohibited"];

/** Returns the policy-style phrases found in the text (lowercase match). */
export function policyPhrasesIn(text: string): string[] {
  const lower = text.toLowerCase();
  return POLICY_PHRASES.filter((p) => lower.includes(p));
}

function round(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
