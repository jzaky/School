"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@aegis/db";
import { autonomySettingsSchema, cancelAutonomyRaise, decideAutonomyRaise, lowerAutonomy, requestAutonomyRaise, simulateAutonomy, updateAutonomySettings } from "@aegis/core";
import { getConsoleContext } from "@/server/session";
import { act } from "./util";

const uuid = z.string().uuid();
const change = z.object({ level: z.number().int().min(0).max(4), ceilingAmount: z.number().nonnegative().max(1e15).nullable(), reason: z.string() });

function refresh(agentId?: string) {
  if (agentId) revalidatePath(`/agents/${agentId}`);
  revalidatePath("/agents");
  revalidatePath("/agents/autonomy");
}

export async function lowerAutonomyAction(agentId: string, input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    const id = uuid.parse(agentId);
    const data = change.parse(input);
    await withTenant(c.ctx.orgId, (db) => lowerAutonomy(db, c.ctx, id, data));
    refresh(id);
  });
}

export async function requestAutonomyRaiseAction(agentId: string, input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    const id = uuid.parse(agentId);
    const data = change.parse(input);
    const row = await withTenant(c.ctx.orgId, (db) => requestAutonomyRaise(db, c.ctx, id, data));
    refresh(id);
    return { id: row.id };
  });
}

export async function decideAutonomyRaiseAction(requestId: string, agentId: string, input: { approve: boolean; note: string }) {
  return act(async () => {
    const c = await getConsoleContext();
    const data = z.object({ approve: z.boolean(), note: z.string().max(1000) }).parse(input);
    await withTenant(c.ctx.orgId, (db) => decideAutonomyRaise(db, c.ctx, uuid.parse(requestId), data));
    refresh(uuid.parse(agentId));
  });
}

export async function cancelAutonomyRaiseAction(requestId: string, agentId: string) {
  return act(async () => {
    const c = await getConsoleContext();
    await withTenant(c.ctx.orgId, (db) => cancelAutonomyRaise(db, c.ctx, uuid.parse(requestId)));
    refresh(uuid.parse(agentId));
  });
}

export async function simulateAutonomyAction(agentId: string, input: { level: number; ceilingAmount: number | null }) {
  return act(async () => {
    const c = await getConsoleContext();
    const data = z.object({ level: z.number().int().min(0).max(4), ceilingAmount: z.number().nonnegative().nullable() }).parse(input);
    const r = await withTenant(c.ctx.orgId, (db) => simulateAutonomy(db, c.ctx, uuid.parse(agentId), { level: data.level, ceilingAmount: data.ceilingAmount, days: 30 }), { readOnly: true });
    return { ...r, changed: r.changed.map((x) => ({ ...x, createdAt: x.createdAt.toISOString() })) };
  });
}

export async function updateAutonomySettingsAction(input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    const data = autonomySettingsSchema.parse(input);
    await withTenant(c.ctx.orgId, (db) => updateAutonomySettings(db, c.ctx, data));
    revalidatePath("/agents/autonomy");
  });
}
