"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@aegis/db";
import { createAiProvider, issuePersonalAiKey, previewAiDecision, revokePersonalAiKey, setAiGatewayMode, setAiProviderApproval } from "@aegis/core";
import { getConsoleContext } from "@/server/session";
import { act } from "./util";

const PATH = "/security/ai-gateway";

export async function createAiProviderAction(input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    const row = await withTenant(c.ctx.orgId, (db) => createAiProvider(db, c.ctx, input as never));
    revalidatePath(PATH);
    return { id: row.id };
  });
}

export async function setAiProviderApprovalAction(input: unknown) {
  return act(async () => {
    const { id, approved, reason } = z.object({ id: z.string().uuid(), approved: z.boolean(), reason: z.string().max(500) }).parse(input);
    const c = await getConsoleContext();
    await withTenant(c.ctx.orgId, (db) => setAiProviderApproval(db, c.ctx, id, approved, reason));
    revalidatePath(PATH);
    return { ok: true };
  });
}

export async function previewAiDecisionAction(input: unknown) {
  return act(async () => {
    const { model, text } = z.object({ model: z.string().trim().min(1).max(120), text: z.string().min(1).max(20_000) }).parse(input);
    const c = await getConsoleContext();
    return withTenant(c.ctx.orgId, (db) => previewAiDecision(db, c.ctx, { model, text }), { readOnly: true });
  });
}

export async function issuePersonalAiKeyAction(input: unknown) {
  return act(async () => {
    const { name } = z.object({ name: z.string().max(80) }).parse(input);
    const c = await getConsoleContext();
    const r = await withTenant(c.ctx.orgId, (db) => issuePersonalAiKey(db, c.ctx, name));
    revalidatePath(PATH);
    // Returned exactly once; never stored in clear.
    return { key: r.key, id: r.record.id, name: r.record.name, prefix: r.record.prefix, expiresAt: r.record.expiresAt?.toISOString() ?? null };
  });
}

export async function revokePersonalAiKeyAction(input: unknown) {
  return act(async () => {
    const { id } = z.object({ id: z.string().uuid() }).parse(input);
    const c = await getConsoleContext();
    await withTenant(c.ctx.orgId, (db) => revokePersonalAiKey(db, c.ctx, id));
    revalidatePath(PATH);
    return { ok: true };
  });
}

export async function setAiGatewayModeAction(input: unknown) {
  return act(async () => {
    const { mode, reason } = z.object({ mode: z.enum(["enforce", "monitor"]), reason: z.string().max(500) }).parse(input);
    const c = await getConsoleContext();
    await withTenant(c.ctx.orgId, (db) => setAiGatewayMode(db, c.ctx, mode, reason));
    revalidatePath(PATH);
    return { mode };
  });
}
