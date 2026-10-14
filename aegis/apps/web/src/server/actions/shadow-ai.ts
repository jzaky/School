"use server";
import { revalidatePath } from "next/cache";
import { withTenant } from "@aegis/db";
import { addCustomShadowAiApp, importDiscoveryFile, reviewShadowAiApp } from "@aegis/core";
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
