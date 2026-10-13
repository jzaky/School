"use server";
import { revalidatePath } from "next/cache";
import { withTenant } from "@aegis/db";
import { injectionResponseSchema, runAttackSimulation, startLabRunSchema, updateInjectionResponse } from "@aegis/core";
import { getConsoleContext } from "@/server/session";
import { act } from "./util";

export async function startLabRunAction(input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    const data = startLabRunSchema.parse(input);
    const out = await runAttackSimulation((fn) => withTenant(c.ctx.orgId, fn), c.ctx, data);
    revalidatePath("/security/lab");
    return out;
  });
}

export async function updateInjectionResponseAction(input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    const data = injectionResponseSchema.parse(input);
    const saved = await withTenant(c.ctx.orgId, (db) => updateInjectionResponse(db, c.ctx, data));
    revalidatePath("/security/data-protection");
    return saved;
  });
}
