"use server";
import { revalidatePath } from "next/cache";
import { withTenant } from "@aegis/db";
import { archiveLabScenario, createLabScenario, injectionResponseSchema, runAttackSimulation, setLabSchedule, startLabRunSchema, updateInjectionResponse, updateLabScenario } from "@aegis/core";
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

export async function setLabScheduleAction(input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    const saved = await withTenant(c.ctx.orgId, (db) => setLabSchedule(db, c.ctx, input));
    revalidatePath("/security/lab");
    return saved;
  });
}

export async function createLabScenarioAction(input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    const s = await withTenant(c.ctx.orgId, (db) => createLabScenario(db, c.ctx, input));
    revalidatePath("/security/lab");
    return { id: s.id, key: s.key };
  });
}

export async function updateLabScenarioAction(id: string, input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    const s = await withTenant(c.ctx.orgId, (db) => updateLabScenario(db, c.ctx, id, input));
    revalidatePath("/security/lab");
    return { id: s.id, version: s.currentVersion };
  });
}

export async function archiveLabScenarioAction(id: string, reason: string) {
  return act(async () => {
    const c = await getConsoleContext();
    await withTenant(c.ctx.orgId, (db) => archiveLabScenario(db, c.ctx, id, reason));
    revalidatePath("/security/lab");
    return { ok: true };
  });
}
