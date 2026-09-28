"use server";

import { revalidatePath } from "next/cache";
import { getCtx } from "@/server/context";
import { audit } from "@/server/audit/audit";
import { tenantTx } from "@/lib/tenant-db";
import { generateAi, reviewAi } from "@/server/ai/provider";
import { FIELD_TYPES, type I18nText } from "@/server/forms/schema";
import { draftFormFromPrompt, fieldCount, sanitizeSchema, schemaIssues, type FormDraftResult } from "@/server/forms/builder";

type Meta = { nameEn: string; nameAr: string; descEn?: string; descAr?: string; categoryEn?: string; categoryAr?: string };
type Fail = { ok: false; error: string };

async function formsCtx() {
  const ctx = await getCtx();
  if (!ctx.can("forms.manage")) return null;
  return ctx;
}

function cleanMeta(m: Meta) {
  const s = (v: string | undefined, max = 300) => (v ?? "").trim().slice(0, max);
  return {
    nameEn: s(m.nameEn, 160),
    nameAr: s(m.nameAr, 160),
    descEn: s(m.descEn, 1000) || null,
    descAr: s(m.descAr, 1000) || null,
    categoryEn: s(m.categoryEn, 120) || null,
    categoryAr: s(m.categoryAr, 120) || null,
  };
}

function slug(s: string) {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "form"
  );
}

function revalidate(formId?: string) {
  revalidatePath("/[locale]/admin/forms", "page");
  if (formId) revalidatePath("/[locale]/admin/forms/[id]", "page");
  revalidatePath("/[locale]/admin/services", "page");
  revalidatePath("/[locale]/services/[key]", "page");
}

/** Save the working draft. Creates the form on first save. Publishing is a separate, explicit step. */
export async function saveFormDraftAction(input: { formId: string | null; meta: Meta; schema: unknown; aiInteractionId?: string | null }): Promise<{ ok: true; formId: string } | Fail> {
  const ctx = await formsCtx();
  if (!ctx) return { ok: false, error: "FORBIDDEN" };
  const meta = cleanMeta(input.meta);
  if (!meta.nameEn || !meta.nameAr) return { ok: false, error: "NAME" };
  const schema = sanitizeSchema(input.schema);
  if (!schema) return { ok: false, error: "SCHEMA" };
  const { db, orgId } = ctx;

  let formId = input.formId;
  if (formId) {
    const form = await db.form.findUnique({ where: { id: formId } });
    if (!form) return { ok: false, error: "NOT_FOUND" };
    await db.form.update({ where: { id: formId }, data: { ...meta, draftSchema: schema as never } });
    await audit(db, orgId, { actorId: ctx.membershipId, action: "form.save_draft", entityType: "Form", entityId: formId, meta: { fields: fieldCount(schema) } });
  } else {
    let key = slug(meta.nameEn);
    for (let i = 2; await db.form.findUnique({ where: { orgId_key: { orgId, key } } }); i++) key = `${slug(meta.nameEn)}_${i}`;
    const form = await db.form.create({ data: { orgId, key, ...meta, status: "DRAFT", draftSchema: schema as never, createdById: ctx.membershipId } });
    formId = form.id;
    await audit(db, orgId, { actorId: ctx.membershipId, action: "form.create", entityType: "Form", entityId: formId, meta: { fields: fieldCount(schema), fromAi: Boolean(input.aiInteractionId) } });
  }
  if (input.aiInteractionId) await reviewAi(ctx, input.aiInteractionId, true);
  revalidate(formId);
  return { ok: true, formId };
}

/**
 * Publish the current draft as a new immutable FormVersion. Earlier versions and the submissions
 * made against them are never changed; services pick up the new version for new requests.
 */
export async function publishFormAction(input: { formId: string | null; meta: Meta; schema: unknown; aiInteractionId?: string | null }): Promise<{ ok: true; formId: string; version: number } | Fail> {
  const saved = await saveFormDraftAction(input);
  if (!saved.ok) return saved;
  const ctx = await formsCtx();
  if (!ctx) return { ok: false, error: "FORBIDDEN" };
  const schema = sanitizeSchema(input.schema)!;
  if (schemaIssues(schema).length) return { ok: false, error: "ISSUES" };
  const formId = saved.formId;
  const version = await tenantTx(ctx.orgId, async (tx) => {
    const last = await tx.formVersion.findFirst({ where: { formId }, orderBy: { version: "desc" } });
    const next = (last?.version ?? 0) + 1;
    const row = await tx.formVersion.create({ data: { orgId: ctx.orgId, formId, version: next, schema: schema as never, publishedById: ctx.membershipId } });
    await tx.form.update({ where: { id: formId }, data: { status: "PUBLISHED", publishedVersionId: row.id, draftSchema: schema as never } });
    await audit(tx, ctx.orgId, { actorId: ctx.membershipId, action: "form.publish", entityType: "Form", entityId: formId, meta: { version: next, versionId: row.id, fields: fieldCount(schema) } });
    return next;
  });
  revalidate(formId);
  return { ok: true, formId, version };
}

/** Throw away unpublished changes and go back to the published version. */
export async function discardFormDraftAction(input: { formId: string }): Promise<{ ok: true } | Fail> {
  const ctx = await formsCtx();
  if (!ctx) return { ok: false, error: "FORBIDDEN" };
  const form = await ctx.db.form.findUnique({ where: { id: input.formId } });
  if (!form?.publishedVersionId) return { ok: false, error: "NOT_FOUND" };
  const v = await ctx.db.formVersion.findUnique({ where: { id: form.publishedVersionId } });
  if (!v) return { ok: false, error: "NOT_FOUND" };
  await ctx.db.form.update({ where: { id: form.id }, data: { draftSchema: v.schema as never } });
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, action: "form.discard_draft", entityType: "Form", entityId: form.id, meta: { version: v.version } });
  revalidate(form.id);
  return { ok: true };
}

const isText = (v: unknown): v is I18nText => typeof v === "object" && v !== null && typeof (v as I18nText).en === "string" && typeof (v as I18nText).ar === "string";

/**
 * Draft a form from a plain description. The result is only loaded into the builder as an unsaved
 * draft: it is never saved or published without the admin doing so.
 */
export async function draftFormWithAiAction(input: { prompt: string }): Promise<{ ok: true; draft: FormDraftResult; interactionId: string; provider: string } | Fail> {
  const ctx = await formsCtx();
  if (!ctx) return { ok: false, error: "FORBIDDEN" };
  const prompt = input.prompt.trim().slice(0, 2000);
  if (prompt.length < 8) return { ok: false, error: "PROMPT" };
  const res = await generateAi<FormDraftResult>(ctx, {
    feature: "form_draft",
    sensitive: false,
    subjectType: "Form",
    instructions:
      "Design a school service form from the administrator's description. Use between 4 and 12 fields, grouped in one step with one or two sections. " +
      "Every label must be given in both English and Modern Standard Arabic, whatever the interface language. " +
      "Use a student_picker field when the request is about a student. Add conditional follow-up questions with showIf where they help, for example a text field shown only when a choice is 'other'. " +
      "Field ids are short camelCase words, unique in the form. Do not ask for medical, wellbeing or safeguarding details unless the description asks for them.",
    facts: { description: prompt, allowedFieldTypes: FIELD_TYPES },
    outputShape:
      '{"name":{"en":string,"ar":string},"description":{"en":string,"ar":string},"schema":{"version":1,"steps":[{"id":string,"title":{"en","ar"},"sections":[{"id":string,"title"?:{"en","ar"},"fields":[{"id":string,"type":one of allowedFieldTypes,"label":{"en","ar"},"help"?:{"en","ar"},"required"?:boolean,"width"?:"full"|"half","options"?:[{"value":string,"label":{"en","ar"}}],"min"?:number,"max"?:number,"maxLength"?:number,"showIf"?:{"fieldId":string,"op":"eq"|"neq"|"contains"|"empty"|"not_empty"|"gt"|"lt","value"?:string|number|boolean}}]}]}]}}',
    fallback: () => draftFormFromPrompt(prompt),
    validate: (v): v is FormDraftResult => {
      const o = v as FormDraftResult;
      return Boolean(o) && isText(o.name) && isText(o.description) && sanitizeSchema(o.schema) !== null;
    },
  });
  if (res.status === "blocked") return { ok: false, error: res.reason === "disabled" ? "AI_DISABLED" : "AI_BLOCKED" };
  const schema = sanitizeSchema(res.output.schema);
  if (!schema) return { ok: false, error: "SCHEMA" };
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, action: "form.ai_draft", entityType: "AiInteraction", entityId: res.interactionId, meta: { provider: res.provider, fields: fieldCount(schema) } });
  return { ok: true, draft: { name: res.output.name, description: res.output.description, schema }, interactionId: res.interactionId, provider: res.provider };
}

/** Record that the admin threw an AI draft away without saving it. */
export async function discardAiDraftAction(input: { interactionId: string }): Promise<{ ok: true } | Fail> {
  const ctx = await formsCtx();
  if (!ctx) return { ok: false, error: "FORBIDDEN" };
  await reviewAi(ctx, input.interactionId, false);
  return { ok: true };
}
