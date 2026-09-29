"use server";

// Small "everything editable" gaps: subjects and notification message texts.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCtx } from "@/server/context";
import { audit } from "@/server/audit/audit";

type Result = { ok: true } | { ok: false; error: string };

const subjectSchema = z.object({
  id: z.string().optional(),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,12}$/),
  nameEn: z.string().trim().min(2).max(80),
  nameAr: z.string().trim().min(2).max(80),
  departmentId: z.string().nullable().optional(),
});

/** Add or rename a subject. Codes are unique per school. */
export async function saveSubjectAction(input: z.input<typeof subjectSchema>): Promise<Result> {
  const ctx = await getCtx();
  if (!ctx.can("school.manage")) return { ok: false, error: "FORBIDDEN" };
  const parsed = subjectSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.path[0] === "code" ? "CODE" : "NAME" };
  const d = parsed.data;
  if (d.departmentId && !(await ctx.db.department.findUnique({ where: { id: d.departmentId }, select: { id: true } }))) return { ok: false, error: "INVALID" };
  const clash = await ctx.db.subject.findFirst({ where: { code: d.code, ...(d.id ? { id: { not: d.id } } : {}) }, select: { id: true } });
  if (clash) return { ok: false, error: "CODE_TAKEN" };
  const data = { code: d.code, nameEn: d.nameEn, nameAr: d.nameAr, departmentId: d.departmentId || null };
  let id = d.id;
  if (id) {
    if (!(await ctx.db.subject.findUnique({ where: { id }, select: { id: true } }))) return { ok: false, error: "NOT_FOUND" };
    await ctx.db.subject.update({ where: { id }, data });
  } else id = (await ctx.db.subject.create({ data: { orgId: ctx.orgId, ...data } })).id;
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "org.subject_save", entityType: "Subject", entityId: id, meta: data });
  revalidatePath("/", "layout");
  return { ok: true };
}

const templateSchema = z.object({
  id: z.string().min(1),
  subjectEn: z.string().trim().max(200).nullable(),
  subjectAr: z.string().trim().max(200).nullable(),
  bodyEn: z.string().trim().min(1).max(2000),
  bodyAr: z.string().trim().min(1).max(2000),
});

const placeholders = (s: string | null) => new Set([...(s ?? "").matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]));

/** Edit the wording of a notification. Placeholders must stay the ones the platform fills in. */
export async function saveMessageTemplateAction(input: z.input<typeof templateSchema>): Promise<Result> {
  const ctx = await getCtx();
  if (!ctx.can("documents.templates")) return { ok: false, error: "FORBIDDEN" };
  const parsed = templateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID" };
  const d = parsed.data;
  const row = await ctx.db.messageTemplate.findUnique({ where: { id: d.id } });
  if (!row) return { ok: false, error: "NOT_FOUND" };
  const allowed = new Set([...placeholders(row.subjectEn), ...placeholders(row.subjectAr), ...placeholders(row.bodyEn), ...placeholders(row.bodyAr)]);
  for (const text of [d.subjectEn, d.subjectAr, d.bodyEn, d.bodyAr]) for (const p of placeholders(text)) if (!allowed.has(p)) return { ok: false, error: "PLACEHOLDER" };
  await ctx.db.messageTemplate.update({ where: { id: row.id }, data: { subjectEn: row.channel === "EMAIL" ? d.subjectEn || null : null, subjectAr: row.channel === "EMAIL" ? d.subjectAr || null : null, bodyEn: d.bodyEn, bodyAr: d.bodyAr } });
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "template.message_update", entityType: "MessageTemplate", entityId: row.id, meta: { key: row.key, channel: row.channel } });
  revalidatePath("/[locale]/admin/templates", "page");
  return { ok: true };
}
