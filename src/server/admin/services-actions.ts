"use server";

import { revalidatePath } from "next/cache";
import type { Sensitivity } from "@prisma/client";
import { getCtx } from "@/server/context";
import { audit } from "@/server/audit/audit";
import { STAFF_ROLE_KEYS } from "@/server/identity/permissions";

type Fail = { ok: false; error: string };
export type AudienceGroup = "student" | "parent" | "staff";

export type ServiceInput = {
  id: string | null;
  nameEn: string;
  nameAr: string;
  descEn: string;
  descAr: string;
  icon: string;
  categoryId: string;
  audience: AudienceGroup[];
  slaHours: number;
  formId: string | null;
  workflowId: string | null;
  isFeatured: boolean;
  requiresStudent: boolean;
  sensitivity?: Sensitivity;
};

// Wellbeing and safeguarding routing is part of the safeguarding design; it is not changed from this screen.
const PROTECTED: Sensitivity[] = ["WELLBEING", "SAFEGUARDING"];
const EDITABLE_SENSITIVITY: Sensitivity[] = ["STANDARD", "CONFIDENTIAL", "MEDICAL"];

function revalidate() {
  revalidatePath("/[locale]/admin/services", "page");
  revalidatePath("/[locale]/admin/forms", "page");
  revalidatePath("/[locale]/services", "page");
  revalidatePath("/[locale]/services/[key]", "page");
  revalidatePath("/[locale]/home", "page");
}

function audienceKeys(groups: AudienceGroup[]) {
  const out = new Set<string>();
  for (const g of groups) {
    if (g === "staff") STAFF_ROLE_KEYS.forEach((k) => out.add(k));
    else if (g === "student" || g === "parent") out.add(g);
  }
  return [...out];
}

function slug(s: string) {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "service"
  );
}

/** Turn a service on or off in the requester-facing services hub. Open requests are not affected. */
export async function setServiceActiveAction(input: { id: string; active: boolean }): Promise<{ ok: true } | Fail> {
  const ctx = await getCtx();
  if (!ctx.can("services.manage")) return { ok: false, error: "FORBIDDEN" };
  const svc = await ctx.db.serviceDefinition.findUnique({ where: { id: input.id } });
  if (!svc) return { ok: false, error: "NOT_FOUND" };
  if (!input.active && svc.sensitivity === "SAFEGUARDING") return { ok: false, error: "SAFEGUARDING_ALWAYS_ON" };
  await ctx.db.serviceDefinition.update({ where: { id: svc.id }, data: { isActive: input.active } });
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, action: input.active ? "service.enable" : "service.disable", entityType: "ServiceDefinition", entityId: svc.id, meta: { key: svc.key } });
  revalidate();
  return { ok: true };
}

/** Create a service or update an existing one. Linked forms and workflows must be published. */
export async function saveServiceAction(input: ServiceInput): Promise<{ ok: true; id: string } | Fail> {
  const ctx = await getCtx();
  if (!ctx.can("services.manage")) return { ok: false, error: "FORBIDDEN" };
  const { db, orgId } = ctx;
  const s = (v: string, max: number) => (v ?? "").trim().slice(0, max);
  const nameEn = s(input.nameEn, 120);
  const nameAr = s(input.nameAr, 120);
  const descEn = s(input.descEn, 600);
  const descAr = s(input.descAr, 600);
  if (!nameEn || !nameAr) return { ok: false, error: "NAME" };
  if (!descEn || !descAr) return { ok: false, error: "DESCRIPTION" };
  const slaHours = Math.round(Number(input.slaHours));
  if (!Number.isFinite(slaHours) || slaHours < 1 || slaHours > 24 * 90) return { ok: false, error: "SLA" };
  const audience = audienceKeys(input.audience);
  if (!audience.length) return { ok: false, error: "AUDIENCE" };
  const icon = /^[a-z0-9-]{2,40}$/.test(input.icon) ? input.icon : "file-text";

  const [category, form, workflow] = await Promise.all([
    db.serviceCategory.findUnique({ where: { id: input.categoryId } }),
    input.formId ? db.form.findUnique({ where: { id: input.formId } }) : null,
    input.workflowId ? db.workflow.findUnique({ where: { id: input.workflowId } }) : null,
  ]);
  if (!category) return { ok: false, error: "CATEGORY" };
  if (input.formId && !form?.publishedVersionId) return { ok: false, error: "FORM" };
  if (input.workflowId && !workflow?.publishedVersionId) return { ok: false, error: "WORKFLOW" };

  const data = {
    nameEn,
    nameAr,
    descEn,
    descAr,
    icon,
    categoryId: category.id,
    audience,
    slaHours,
    formId: form?.id ?? null,
    workflowId: workflow?.id ?? null,
    isFeatured: Boolean(input.isFeatured),
    requiresStudent: Boolean(input.requiresStudent),
  };

  if (input.id) {
    const svc = await db.serviceDefinition.findUnique({ where: { id: input.id } });
    if (!svc) return { ok: false, error: "NOT_FOUND" };
    // Keep a narrower staff audience (for example only teachers) when staff stay selected.
    const existingStaff = svc.audience.filter((k) => STAFF_ROLE_KEYS.includes(k));
    if (input.audience.includes("staff") && existingStaff.length) data.audience = [...audience.filter((k) => !STAFF_ROLE_KEYS.includes(k)), ...existingStaff];
    const sensitivity = PROTECTED.includes(svc.sensitivity) || !input.sensitivity || !EDITABLE_SENSITIVITY.includes(input.sensitivity) ? svc.sensitivity : input.sensitivity;
    await db.serviceDefinition.update({ where: { id: svc.id }, data: { ...data, sensitivity } });
    const changed = (Object.keys(data) as Array<keyof typeof data>).filter((k) => JSON.stringify(data[k]) !== JSON.stringify(svc[k]));
    if (sensitivity !== svc.sensitivity) changed.push("sensitivity" as never);
    await audit(db, orgId, { actorId: ctx.membershipId, action: "service.update", entityType: "ServiceDefinition", entityId: svc.id, meta: { key: svc.key, changed } });
    revalidate();
    return { ok: true, id: svc.id };
  }

  const sensitivity = input.sensitivity && EDITABLE_SENSITIVITY.includes(input.sensitivity) ? input.sensitivity : "STANDARD";
  let key = slug(nameEn);
  for (let i = 2; await db.serviceDefinition.findUnique({ where: { orgId_key: { orgId, key } } }); i++) key = `${slug(nameEn)}_${i}`;
  const last = await db.serviceDefinition.findFirst({ where: { categoryId: category.id }, orderBy: { sortOrder: "desc" } });
  const prefix = (nameEn.replace(/[^A-Za-z ]/g, "").split(/\s+/).filter(Boolean).map((w) => w[0]).join("").toUpperCase() || "REQ").slice(0, 4).padEnd(3, "X");
  const created = await db.serviceDefinition.create({
    data: { orgId, key, ...data, sensitivity, requestPrefix: prefix, isActive: true, sortOrder: (last?.sortOrder ?? 0) + 1 },
  });
  await audit(db, orgId, { actorId: ctx.membershipId, action: "service.create", entityType: "ServiceDefinition", entityId: created.id, meta: { key } });
  revalidate();
  return { ok: true, id: created.id };
}
