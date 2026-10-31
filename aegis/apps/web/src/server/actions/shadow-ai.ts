"use server";
import { revalidatePath } from "next/cache";
import { withTenant } from "@aegis/db";
import { addCustomShadowAiApp, connectEntra, disconnectEntra, forbidden, importDiscoveryFile, reviewShadowAiApp, syncEntra, testEntraConnection } from "@aegis/core";
import { z } from "zod";
import { getConsoleContext } from "@/server/session";
import { act } from "./util";

const PATH = "/security/shadow-ai";

export async function importDiscoveryFileAction(input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    const r = await withTenant(c.ctx.orgId, (db) => importDiscoveryFile(db, c.ctx, input as never));
    revalidatePath(PATH);
    return r;
  });
}

export async function reviewShadowAiAppAction(input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    await withTenant(c.ctx.orgId, (db) => reviewShadowAiApp(db, c.ctx, input as never));
    revalidatePath(PATH);
    return { ok: true };
  });
}

export async function addCustomShadowAiAppAction(input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    await withTenant(c.ctx.orgId, (db) => addCustomShadowAiApp(db, c.ctx, input as never));
    revalidatePath(PATH);
    return { ok: true };
  });
}

export async function connectEntraAction(input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    await withTenant(c.ctx.orgId, (db) => connectEntra(db, c.ctx, input as never));
    revalidatePath(PATH);
    return { ok: true };
  });
}

export async function testEntraAction() {
  return act(async () => {
    const c = await getConsoleContext();
    return testEntraConnection((fn) => withTenant(c.ctx.orgId, fn), c.ctx);
  });
}

export async function syncEntraAction() {
  return act(async () => {
    const c = await getConsoleContext();
    if (!c.can("integrations:write")) throw forbidden("Needs the integrations:write permission");
    const r = await syncEntra((fn) => withTenant(c.ctx.orgId, fn, { lock: "lazy", timeout: 120_000 }), c.ctx);
    revalidatePath(PATH);
    return r;
  });
}

export async function disconnectEntraAction(input: unknown) {
  return act(async () => {
    const { reason } = z.object({ reason: z.string().max(300) }).parse(input);
    const c = await getConsoleContext();
    await withTenant(c.ctx.orgId, (db) => disconnectEntra(db, c.ctx, reason));
    revalidatePath(PATH);
    return { ok: true };
  });
}
