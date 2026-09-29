"use server";

// Server actions for catalog review. Reads happen in pages through ctx.db; writes to global catalog rows go
// through the platform catalog client after the access check (src/server/platform/catalog-db.ts).
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCtx } from "@/server/context";
import { audit } from "@/server/audit/audit";
import { generateAi } from "@/server/ai/provider";
import { queue } from "@/server/queue";
import { CatalogAccessError, assertCatalogWrite, catalogDb } from "@/server/platform/catalog-db";
import { actorFromCtx } from "./access";
import { reviewChange } from "./changes";
import { EXTRACT_INSTRUCTIONS, OUTPUT_SHAPE, RULES_MODEL, extractForSource, isRawDraft, type ExtractLlm } from "./extract";
import { extractByRules } from "./extract-rules";
import { CATALOG_QUEUE, REFRESH_JOB, SCORECARD_JOB, runCatalogScorecard } from "./jobs";
import { approveExtraction, markVersionVerified, rejectExtraction } from "./publish";
import { isSourceType, upsertSource } from "./sources";
import type { DraftGroup } from "./types";

type Ok<T = object> = ({ ok: true } & T) | { ok: false; error: string; reasons?: string[] };
const done = () => revalidatePath("/", "layout");

async function writeDeps() {
  const ctx = await getCtx();
  const actor = actorFromCtx(ctx);
  try {
    assertCatalogWrite(actor);
  } catch (e) {
    if (e instanceof CatalogAccessError) return { error: e.code } as const;
    throw e;
  }
  const catalog = catalogDb();
  if (!catalog) return { error: "no_owner_url" } as const;
  return { ctx, actor, catalog, deps: { catalog, tenant: ctx.db, actor } };
}

const id = z.string().min(1).max(64);

export async function approveExtractionAction(extractionId: string, edits: DraftGroup[] | null, note: string | null): Promise<Ok<{ versions: number }>> {
  if (!id.safeParse(extractionId).success) return { ok: false, error: "invalid" };
  const w = await writeDeps();
  if ("error" in w) return { ok: false, error: w.error! };
  const res = await approveExtraction(w.deps, { extractionId, edits, note: note?.slice(0, 1000) ?? null });
  done();
  if (!res.ok) return { ok: false, error: res.error, reasons: res.rejected?.map((r) => r.reason) };
  return { ok: true, versions: res.versions.length };
}

export async function rejectExtractionAction(extractionId: string, note: string): Promise<Ok> {
  if (!id.safeParse(extractionId).success) return { ok: false, error: "invalid" };
  const w = await writeDeps();
  if ("error" in w) return { ok: false, error: w.error! };
  const res = await rejectExtraction(w.deps, { extractionId, note: String(note ?? "") });
  done();
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

export async function verifyRequirementAction(requirementId: string): Promise<Ok> {
  if (!id.safeParse(requirementId).success) return { ok: false, error: "invalid" };
  const w = await writeDeps();
  if ("error" in w) return { ok: false, error: w.error! };
  const res = await markVersionVerified(w.deps, { requirementId });
  done();
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

export async function reviewChangeAction(changeId: string, outcome: "REVIEWED" | "DISMISSED", note: string | null): Promise<Ok<{ notified: number }>> {
  if (!id.safeParse(changeId).success || !["REVIEWED", "DISMISSED"].includes(outcome)) return { ok: false, error: "invalid" };
  const w = await writeDeps();
  if ("error" in w) return { ok: false, error: w.error! };
  const res = await reviewChange(w.deps, { changeId, outcome, note });
  done();
  return res.ok ? { ok: true, notified: res.notified } : { ok: false, error: res.error };
}

const sourceInput = z.object({ programId: id, url: z.string().trim().min(8).max(500), sourceType: z.string(), title: z.string().trim().max(200).optional().nullable() });

export async function addSourceAction(raw: z.infer<typeof sourceInput>): Promise<Ok<{ created: boolean }>> {
  const parsed = sourceInput.safeParse(raw);
  if (!parsed.success || !isSourceType(parsed.data.sourceType)) return { ok: false, error: "invalid" };
  const w = await writeDeps();
  if ("error" in w) return { ok: false, error: w.error! };
  const { ctx, catalog } = w;
  // Visible to this school (global or its own), checked through the tenant client.
  const program = await ctx.db.universityProgram.findUnique({ where: { id: parsed.data.programId }, select: { id: true, orgId: true, universityId: true, nameEn: true } });
  if (!program || (program.orgId !== null && program.orgId !== ctx.orgId)) return { ok: false, error: "not_found" };
  const res = await upsertSource(catalog, { orgId: program.orgId, universityId: program.universityId, programId: program.id, url: parsed.data.url, title: parsed.data.title || program.nameEn, sourceType: parsed.data.sourceType });
  if (!res) return { ok: false, error: "invalid_url" };
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "catalog.source.add", entityType: "RequirementSource", entityId: res.source.id, meta: { programId: program.id, sourceType: parsed.data.sourceType, created: res.created } });
  done();
  return { ok: true, created: res.created };
}

export async function checkSourceNowAction(sourceId: string): Promise<Ok> {
  if (!id.safeParse(sourceId).success) return { ok: false, error: "invalid" };
  const w = await writeDeps();
  if ("error" in w) return { ok: false, error: w.error! };
  const q = queue(CATALOG_QUEUE);
  if (!q) return { ok: false, error: "no_redis" };
  const { ctx } = w;
  const source = await ctx.db.requirementSource.findUnique({ where: { id: sourceId }, select: { id: true } });
  if (!source) return { ok: false, error: "not_found" };
  // One check per source per minute, whoever asks.
  const bucket = Math.floor(Date.now() / 60_000);
  try {
    await q.add(REFRESH_JOB, { sourceIds: [sourceId] }, { jobId: `catalog.check:${sourceId}:${bucket}`, attempts: 1 });
  } catch {
    return { ok: false, error: "no_redis" };
  }
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "catalog.source.check", entityType: "RequirementSource", entityId: sourceId });
  done();
  return { ok: true };
}

/** Run the extraction again with the AI model (rule-based without an API key). Uses the stored page text. */
export async function reextractWithAiAction(extractionId: string): Promise<Ok<{ status: string }>> {
  if (!id.safeParse(extractionId).success) return { ok: false, error: "invalid" };
  const w = await writeDeps();
  if ("error" in w) return { ok: false, error: w.error! };
  const { ctx, catalog } = w;
  const ext = await ctx.db.requirementExtraction.findUnique({ where: { id: extractionId }, select: { id: true, sourceId: true, rawText: true, normalizedJson: true } });
  if (!ext) return { ok: false, error: "not_found" };
  const meta = (ext.normalizedJson as { meta?: { contentHash?: string } }).meta;
  if (!meta?.contentHash) return { ok: false, error: "invalid" };
  const configured = process.env.AI_MODEL || "claude-opus-5";
  const llm: ExtractLlm = {
    model: `anthropic:${configured}`,
    run: async ({ text, vocab }) => {
      const r = await generateAi(ctx, {
        feature: "requirement_extract",
        sensitive: false,
        subjectType: "RequirementSource",
        subjectId: ext.sourceId,
        instructions: EXTRACT_INSTRUCTIONS,
        facts: { text, vocabulary: vocab.map((v) => ({ key: v.key, nameEn: v.nameEn })) },
        outputShape: OUTPUT_SHAPE,
        fallback: () => extractByRules(text, vocab),
        validate: isRawDraft,
      });
      if (r.status !== "ok") return null;
      return { output: r.output, model: r.provider.startsWith("anthropic") ? r.provider : RULES_MODEL, provider: r.provider, interactionId: r.interactionId };
    },
  };
  const res = await extractForSource(catalog, { sourceId: ext.sourceId, text: ext.rawText, contentHash: meta.contentHash, llm });
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "catalog.extraction.rerun", entityType: "RequirementSource", entityId: ext.sourceId, meta: { status: res.status, extractionId: res.extractionId } });
  done();
  return { ok: true, status: res.status };
}

export async function runScorecardCatalogAction(): Promise<Ok<{ queued: boolean }>> {
  const w = await writeDeps();
  if ("error" in w) return { ok: false, error: w.error! };
  if (!process.env.COLLEGE_SCORECARD_API_KEY) return { ok: false, error: "no_api_key" };
  const { ctx } = w;
  const run = await ctx.db.jobRun.create({ data: { orgId: ctx.orgId, queue: CATALOG_QUEUE, name: SCORECARD_JOB, idempotencyKey: `catalog.scorecard:${Date.now()}`, status: "RUNNING" } });
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "catalog.scorecard.run", entityType: "JobRun", entityId: run.id });
  const q = queue(CATALOG_QUEUE);
  if (q) {
    try {
      await q.add(SCORECARD_JOB, { requestedByOrgId: ctx.orgId, runId: run.id }, { jobId: `catalog.scorecard:${run.id}`, attempts: 1 });
      done();
      return { ok: true, queued: true };
    } catch {
      // Redis unavailable: fall through and run here.
    }
  }
  try {
    await runCatalogScorecard({ requestedByOrgId: ctx.orgId, runId: run.id });
  } catch {
    done();
    return { ok: false, error: "import_failed" };
  }
  done();
  return { ok: true, queued: false };
}
