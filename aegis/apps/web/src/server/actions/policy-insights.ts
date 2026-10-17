"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@aegis/db";
import { buildSectorTemplate, createPolicy, decidePolicyException, exceptionRequestSchema, forbidden, requestPolicyException, revokePolicyException, runPolicyTests, SECTOR_TEMPLATES, slugSchema, type SectorTemplateId } from "@aegis/core";
import { getConsoleContext } from "@/server/session";
import { act } from "./util";

const templateId = z.enum(SECTOR_TEMPLATES.map((t) => t.id) as [SectorTemplateId, ...SectorTemplateId[]]);

export async function previewSectorTemplateAction(id: string, settings: unknown) {
  return act(async () => {
    await getConsoleContext();
    const document = buildSectorTemplate(templateId.parse(id), settings);
    return { rules: document.rules.map((r) => ({ id: r.id, effect: r.effect, description: r.description })), tests: runPolicyTests(document) };
  });
}

/** Creates a draft policy from a sector template. It is reviewed and activated like any other policy. */
export async function createFromSectorTemplateAction(id: string, settings: unknown, meta: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    if (!c.can("policies:write")) throw forbidden("Missing permission policies:write");
    const tid = templateId.parse(id);
    const m = z.object({ key: slugSchema, name: z.string().trim().min(2).max(120) }).parse(meta);
    const info = SECTOR_TEMPLATES.find((t) => t.id === tid)!;
    const document = buildSectorTemplate(tid, settings);
    const r = await withTenant(c.ctx.orgId, (db) => createPolicy(db, c.ctx, { key: m.key, name: m.name, description: `${info.summary} Created from the ${info.name} template.`, category: "authorization", document, changeNote: `From the ${info.name} template` }));
    revalidatePath("/policies");
    return { id: r.policy.id };
  });
}

export async function requestPolicyExceptionAction(input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    const data = exceptionRequestSchema.parse(input);
    await withTenant(c.ctx.orgId, (db) => requestPolicyException(db, c.ctx, data));
    revalidatePath("/policies");
    revalidatePath(`/policies/${data.policyId}`);
  });
}

export async function decidePolicyExceptionAction(id: string, approve: boolean, note: string) {
  return act(async () => {
    const c = await getConsoleContext();
    await withTenant(c.ctx.orgId, (db) => decidePolicyException(db, c.ctx, z.string().uuid().parse(id), { approve, note }));
    revalidatePath("/policies");
  });
}

export async function revokePolicyExceptionAction(id: string, reason: string) {
  return act(async () => {
    const c = await getConsoleContext();
    await withTenant(c.ctx.orgId, (db) => revokePolicyException(db, c.ctx, z.string().uuid().parse(id), reason));
    revalidatePath("/policies");
  });
}
