"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@aegis/db";
import { acceptSoftwareFinding, attachSoftwareEvidence, decideSoftware, requestSoftware, updateSoftwareSettings } from "@aegis/core";
import { getConsoleContext } from "@/server/session";
import { act } from "./util";

const uuid = z.string().uuid();

export async function requestSoftwareAction(input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    const r = await withTenant(c.ctx.orgId, (db) => requestSoftware(db, c.ctx, input as never));
    revalidatePath("/security/software");
    return { id: r.item.id };
  });
}

export async function attachSoftwareEvidenceAction(input: unknown) {
  return act(async () => {
    const { id, format, text } = z.object({ id: uuid, format: z.string(), text: z.string() }).parse(input);
    const c = await getConsoleContext();
    const r = await withTenant(c.ctx.orgId, (db) => attachSoftwareEvidence(db, c.ctx, id, { format: format as never, text }));
    revalidatePath(`/security/software/${id}`);
    return { recommended: r.assessment.recommended, score: r.assessment.score };
  });
}

export async function decideSoftwareAction(input: unknown) {
  return act(async () => {
    const { id, status, note } = z.object({ id: uuid, status: z.string(), note: z.string().max(2000) }).parse(input);
    const c = await getConsoleContext();
    await withTenant(c.ctx.orgId, (db) => decideSoftware(db, c.ctx, id, { status: status as never, note }));
    revalidatePath(`/security/software/${id}`);
    revalidatePath("/security/software");
    return { ok: true };
  });
}

export async function acceptSoftwareFindingAction(input: unknown) {
  return act(async () => {
    const { id, itemId, note } = z.object({ id: uuid, itemId: uuid, note: z.string().max(2000) }).parse(input);
    const c = await getConsoleContext();
    await withTenant(c.ctx.orgId, (db) => acceptSoftwareFinding(db, c.ctx, id, note));
    revalidatePath(`/security/software/${itemId}`);
    return { ok: true };
  });
}

export async function updateSoftwareSettingsAction(input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    await withTenant(c.ctx.orgId, (db) => updateSoftwareSettings(db, c.ctx, input as never));
    revalidatePath("/security/software");
    return { ok: true };
  });
}
