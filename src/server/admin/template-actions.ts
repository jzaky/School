"use server";

import { revalidatePath } from "next/cache";
import type { DocumentOutput } from "@prisma/client";
import { getCtx } from "@/server/context";
import { audit } from "@/server/audit/audit";
import { MERGE_FIELD_KEYS } from "@/server/documents/merge";

export type TemplateInput = {
  id?: string;
  nameEn: string;
  nameAr: string;
  descEn?: string;
  descAr?: string;
  bodyEn: string;
  bodyAr: string;
  signatoryEn?: string;
  signatoryAr?: string;
  output: DocumentOutput;
};

/** Merge fields a template body uses that the system does not know. */
function unknownFields(body: string) {
  const used = [...body.matchAll(/\{\{([\w.]+)\}\}/g)].map((m) => m[1]);
  return used.filter((f) => !(MERGE_FIELD_KEYS as readonly string[]).includes(f));
}

export async function saveTemplateAction(input: TemplateInput) {
  const ctx = await getCtx();
  if (!ctx.can("documents.templates")) return { ok: false as const, error: "FORBIDDEN" };
  if (!input.nameEn.trim() || !input.nameAr.trim()) return { ok: false as const, error: "NAME" };
  if (!input.bodyEn.trim() && input.output !== "AR") return { ok: false as const, error: "BODY_EN" };
  if (!input.bodyAr.trim() && input.output !== "EN") return { ok: false as const, error: "BODY_AR" };
  const unknown = [...unknownFields(input.bodyEn), ...unknownFields(input.bodyAr)];
  if (unknown.length) return { ok: false as const, error: "FIELDS", fields: [...new Set(unknown)] };
  if (!["EN", "AR", "BILINGUAL"].includes(input.output)) return { ok: false as const, error: "OUTPUT" };
  const used = [...new Set([...input.bodyEn.matchAll(/\{\{([\w.]+)\}\}/g), ...input.bodyAr.matchAll(/\{\{([\w.]+)\}\}/g)].map((m) => m[1]))];
  const data = {
    nameEn: input.nameEn.trim(),
    nameAr: input.nameAr.trim(),
    descEn: input.descEn?.trim() || null,
    descAr: input.descAr?.trim() || null,
    bodyEn: input.bodyEn,
    bodyAr: input.bodyAr,
    signatoryEn: input.signatoryEn?.trim() || null,
    signatoryAr: input.signatoryAr?.trim() || null,
    output: input.output,
    mergeFields: used,
  };
  let id = input.id;
  if (id) {
    const existing = await ctx.db.documentTemplate.findUnique({ where: { id } });
    if (!existing) return { ok: false as const, error: "NOT_FOUND" };
    await ctx.db.documentTemplate.update({ where: { id }, data });
  } else {
    const base = input.nameEn.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "template";
    const clash = await ctx.db.documentTemplate.count({ where: { key: { startsWith: base } } });
    const created = await ctx.db.documentTemplate.create({ data: { orgId: ctx.orgId, key: clash ? `${base}_${clash + 1}` : base, ...data } });
    id = created.id;
  }
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "template.update", entityType: "DocumentTemplate", entityId: id, meta: { created: !input.id } });
  revalidatePath("/[locale]/admin/templates", "page");
  return { ok: true as const, id };
}
