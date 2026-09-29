// The only path to an AI model (CLAUDE.md rule 8).
// - WELLBEING, SAFEGUARDING and medical context is never sent unless org.aiSensitiveDataEnabled is true.
// - Every call is recorded as an AiInteraction. Output is always a draft that a person reviews.
// - Without an API key the built-in drafter produces a deterministic draft from the same facts.
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { Ctx } from "@/server/context";

export type AiFeature = "case_brief" | "referral_draft" | "action_plan" | "form_draft" | "workflow_draft" | "admin_question" | "career_summary" | "lesson_plan" | "curriculum_import" | "pathway_advice" | "requirement_extract";

export type AiRequest<T> = {
  feature: AiFeature;
  /** True when the facts include wellbeing, safeguarding or medical information. */
  sensitive: boolean;
  subjectType?: string;
  subjectId?: string;
  /** Task instructions for the model. */
  instructions: string;
  /** Facts the model may use. Keep to what the task needs. */
  facts: Record<string, unknown>;
  /** Shape the JSON answer must follow, described in plain words. */
  outputShape: string;
  /** Deterministic draft used when no model is configured or the call fails. */
  fallback: () => T;
  validate: (v: unknown) => v is T;
};

export type AiResult<T> =
  | { status: "ok"; output: T; interactionId: string; provider: string; sensitive: boolean }
  | { status: "blocked"; reason: "sensitive" | "disabled"; interactionId: string };

const MODEL = process.env.AI_MODEL || "claude-opus-5";

let client: Anthropic | null = null;
function anthropic() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  client ??= new Anthropic({ timeout: 45_000, maxRetries: 1 });
  return client;
}

export const aiProviderName = () => (process.env.ANTHROPIC_API_KEY ? "anthropic" : "built-in");

function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

export async function generateAi<T>(ctx: Ctx, req: AiRequest<T>): Promise<AiResult<T>> {
  const { db, orgId, org, locale } = ctx;
  const base = { orgId, membershipId: ctx.membershipId, feature: req.feature, locale, sensitive: req.sensitive, subjectType: req.subjectType ?? null, subjectId: req.subjectId ?? null };
  if (!org.aiEnabled) {
    const row = await db.aiInteraction.create({ data: { ...base, status: "BLOCKED", provider: "none", output: { reason: "disabled" } as never } });
    return { status: "blocked", reason: "disabled", interactionId: row.id };
  }
  if (req.sensitive && !org.aiSensitiveDataEnabled) {
    const row = await db.aiInteraction.create({ data: { ...base, status: "BLOCKED", provider: "none", output: { reason: "sensitive" } as never } });
    return { status: "blocked", reason: "sensitive", interactionId: row.id };
  }

  let output: T | null = null;
  let provider = "built-in";
  const c = anthropic();
  if (c) {
    try {
      const language = locale === "ar" ? "Modern Standard Arabic, natural and warm, as written by a UAE school professional" : "British English";
      const response = await c.beta.messages.create({
        model: MODEL,
        max_tokens: 4000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low" },
        system:
          "You assist staff at an international school in the UAE. You write drafts that a staff member will review before anything is shared. " +
          "Be factual, kind and specific. Never invent facts that are not in the input. Never use em dashes. " +
          `Write every human-readable string in ${language}. Respond with a single JSON object only, no prose around it.`,
        messages: [
          {
            role: "user",
            content: `${req.instructions}\n\nReturn JSON with this shape:\n${req.outputShape}\n\nFacts:\n${JSON.stringify(req.facts, null, 2)}`,
          },
        ],
      } as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming);
      if (response.stop_reason !== "refusal") {
        const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
        const parsed = extractJson(text);
        if (req.validate(parsed)) {
          output = parsed;
          provider = `anthropic:${response.model}`;
        }
      }
    } catch (e) {
      // Do not log facts: they may contain student personal data.
      console.error(`[ai] ${req.feature} call failed: ${e instanceof Error ? e.name : "error"}`);
    }
  }
  if (!output) output = req.fallback();
  const row = await db.aiInteraction.create({ data: { ...base, status: "DRAFT", provider, model: provider.startsWith("anthropic") ? MODEL : null, output: output as never } });
  return { status: "ok", output, interactionId: row.id, provider, sensitive: req.sensitive };
}

/** Record that a person reviewed a draft and accepted or discarded it. */
export async function reviewAi(ctx: Ctx, interactionId: string, accepted: boolean) {
  await ctx.db.aiInteraction.updateMany({
    where: { id: interactionId, membershipId: ctx.membershipId },
    data: { status: accepted ? "ACCEPTED" : "DISCARDED", reviewedById: ctx.membershipId, reviewedAt: new Date() },
  });
}
