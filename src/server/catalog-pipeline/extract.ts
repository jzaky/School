// Turn normalized page text into a draft requirement set for human review.
// - With an AI model: the caller passes an ExtractLlm built on generateAi (feature "requirement_extract",
//   not sensitive data) in src/server/catalog-pipeline/actions.ts. The model's JSON is validated line by
//   line (validate.ts); anything without verbatim evidence is rejected with a reason.
// - Without a model (no API key, or the worker): the rule-based extractor (extract-rules.ts), validated the same way.
// - Cache: an extraction for the same (source, contentHash, model, prompt version) is never created twice.
// Result: a RequirementExtraction in PENDING_REVIEW with a confidence score and rejected-line reasons.
// No "server-only" marker: the worker runs this.
import type { Prisma } from "@prisma/client";
import { sha256 } from "./fetch";
import { extractByRules } from "./extract-rules";
import { validateDraft } from "./validate";
import { ADDITIONAL_KINDS, ADMISSION_TESTS, LANGUAGE_TESTS, LEVELS, SUBJECT_TYPES, TEST_POLICIES, type DraftSet } from "./types";
import { DEFAULT_VOCAB, type VocabEntry } from "./vocab";

export const PROMPT_VERSION = "req-extract-v1";
export const RULES_MODEL = "rules-v1";
const RULES_BASE_CONFIDENCE = 0.7;
const MAX_TEXT = 60_000;

export const EXTRACT_INSTRUCTIONS =
  "Extract the undergraduate entry requirements from the university web page text in the facts. " +
  "Only report what the text states. For every line give evidenceQuote: an exact, verbatim sentence or phrase copied from the text that contains the value. " +
  "Use only subject keys from facts.vocabulary. Group lines by curriculum (BRITISH for A-Levels, IB, AMERICAN for SAT/ACT/AP/GPA, or null for general lines such as English language tests). " +
  "Do not guess missing values. Do not translate the quotes.";

export const OUTPUT_SHAPE = `{"groups":[{"curriculum":"BRITISH|IB|AMERICAN|UAE_MOE|JORDAN_TAWJIHI|CBSE|ISC|SABIS|OTHER|null",
"overall":[{"field":"gradeProfile|minimumPoints|minimumGPA|minimumPercent","value":"A*AA or number","evidenceQuote":"..."}],
"subjects":[{"type":"${SUBJECT_TYPES.join("|")}","keys":["vocabulary key"],"minimumLevel":"${LEVELS.join("|")}|null","minimumGrade":"A*|A|7|null","evidenceQuote":"..."}],
"languages":[{"test":"${LANGUAGE_TESTS.join("|")}","minOverall":7.0,"minComponent":6.5,"evidenceQuote":"..."}],
"tests":[{"test":"${ADMISSION_TESTS.join("|")}","policy":"${TEST_POLICIES.join("|")}","minScore":null,"evidenceQuote":"..."}],
"additional":[{"kind":"${ADDITIONAL_KINDS.join("|")}","required":true,"noteEn":"short note","evidenceQuote":"..."}]}]}`;

/** Loose structural check for model output; line-level checks happen in validateDraft. */
export function isRawDraft(v: unknown): v is { groups: unknown[] } {
  return !!v && typeof v === "object" && Array.isArray((v as { groups?: unknown }).groups);
}

export type LlmResult = { output: unknown; model: string; provider: string; interactionId?: string | null };
/** AI extraction hook. `model` is the configured model id; run returns null when no model answered. */
export type ExtractLlm = { model: string; run: (input: { text: string; vocab: VocabEntry[] }) => Promise<LlmResult | null> };

export const cacheKeyFor = (sourceId: string, contentHash: string, model: string, promptVersion = PROMPT_VERSION) => sha256(`${sourceId}|${contentHash}|${model}|${promptVersion}`);

type ExtractDb = Pick<Prisma.TransactionClient, "requirementSource" | "requirementExtraction" | "canonicalSubject">;

export async function loadVocab(db: Pick<Prisma.TransactionClient, "canonicalSubject">): Promise<VocabEntry[]> {
  const rows = await db.canonicalSubject.findMany({ select: { key: true, nameEn: true } });
  return rows.length ? rows : DEFAULT_VOCAB;
}

/** Confidence: share of lines that passed validation, scaled by the extractor's base confidence. */
export function confidenceOf(accepted: number, rejected: number, base: number) {
  if (accepted === 0) return 0;
  return Math.round(base * (accepted / (accepted + rejected)) * 100) / 100;
}

/** Build a validated draft from text (no database). */
export function draftFromText(text: string, vocab: VocabEntry[], raw?: unknown) {
  const input = raw ?? extractByRules(text, vocab);
  return validateDraft(input, text, vocab);
}

export type ExtractResult = { status: "cached" | "created" | "skipped"; extractionId: string | null; accepted: number; rejected: number };

/**
 * Create a PENDING_REVIEW extraction for a source's current text. Idempotent per
 * (source, contentHash, model, prompt version).
 */
export async function extractForSource(
  db: ExtractDb,
  input: { sourceId: string; text: string; contentHash: string; finalUrl?: string | null; llm?: ExtractLlm | null; vocab?: VocabEntry[] },
): Promise<ExtractResult> {
  const source = await db.requirementSource.findUnique({ where: { id: input.sourceId } });
  if (!source) return { status: "skipped", extractionId: null, accepted: 0, rejected: 0 };
  const text = input.text.slice(0, MAX_TEXT);
  const vocab = input.vocab ?? (await loadVocab(db));

  const cached = async (model: string) => {
    const key = cacheKeyFor(source.id, input.contentHash, model);
    const hit = await db.requirementExtraction.findFirst({ where: { sourceId: source.id, normalizedJson: { path: ["meta", "cacheKey"], equals: key } }, select: { id: true } });
    return { key, hit };
  };

  let model = input.llm?.model ?? RULES_MODEL;
  let c = await cached(model);
  if (c.hit) return { status: "cached", extractionId: c.hit.id, accepted: 0, rejected: 0 };

  let raw: unknown = undefined;
  let provider = "built-in";
  let interactionId: string | null = null;
  let base = RULES_BASE_CONFIDENCE;
  if (input.llm) {
    const res = await input.llm.run({ text, vocab }).catch(() => null);
    if (res && isRawDraft(res.output) && res.provider !== "built-in") {
      raw = res.output;
      model = res.model;
      provider = res.provider;
      interactionId = res.interactionId ?? null;
      base = 0.85;
    } else {
      // No model answered: fall back to the rules, which have their own cache key.
      model = RULES_MODEL;
      interactionId = res?.interactionId ?? null;
      c = await cached(model);
      if (c.hit) return { status: "cached", extractionId: c.hit.id, accepted: 0, rejected: 0 };
    }
  }
  const result = draftFromText(text, vocab, raw);
  const draft: DraftSet = {
    groups: result.groups,
    rejected: result.rejected,
    meta: { contentHash: input.contentHash, model, promptVersion: PROMPT_VERSION, cacheKey: c.key, provider, interactionId, ...(input.finalUrl ? { finalUrl: input.finalUrl } : {}) } as DraftSet["meta"],
  };
  const row = await db.requirementExtraction.create({
    data: {
      orgId: source.orgId,
      sourceId: source.id,
      rawText: text,
      normalizedJson: draft as unknown as Prisma.InputJsonValue,
      confidence: confidenceOf(result.accepted, result.rejected.length, base),
      model,
      status: "PENDING_REVIEW",
    },
  });
  return { status: "created", extractionId: row.id, accepted: result.accepted, rejected: result.rejected.length };
}
