"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@aegis/db";
import { accessRequestSchema, createDelegation, createDelegationSchema, decideAccessRequest, emergencyRevokeAgent, requestAccess, resolveDiscoveredAgent, revokeAccess, revokeDelegation } from "@aegis/core";
import { getConsoleContext } from "@/server/session";
import { act } from "./util";

const uuid = z.string().uuid();
const refresh = (agentId?: string) => {
  if (agentId) revalidatePath(`/agents/${agentId}`);
  revalidatePath("/agents");
  revalidatePath("/agents/discovery");
};

export async function requestAccessAction(input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    const data = accessRequestSchema.parse(input);
    const row = await withTenant(c.ctx.orgId, (db) => requestAccess(db, c.ctx, data));
    refresh(data.agentId);
    return { id: row.id };
  });
}

export async function decideAccessRequestAction(id: string, agentId: string, input: { decision: "approve" | "reject"; note: string }) {
  return act(async () => {
    const c = await getConsoleContext();
    const data = z.object({ decision: z.enum(["approve", "reject"]), note: z.string().max(1000) }).parse(input);
    await withTenant(c.ctx.orgId, (db) => decideAccessRequest(db, c.ctx, uuid.parse(id), data));
    refresh(uuid.parse(agentId));
  });
}

export async function revokeAccessAction(id: string, agentId: string, reason: string) {
  return act(async () => {
    const c = await getConsoleContext();
    await withTenant(c.ctx.orgId, (db) => revokeAccess(db, c.ctx, uuid.parse(id), z.string().min(3).max(500).parse(reason)));
    refresh(uuid.parse(agentId));
  });
}

export async function createDelegationAction(input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    const data = createDelegationSchema.parse(input);
    await withTenant(c.ctx.orgId, (db) => createDelegation(db, c.ctx, data));
    refresh(data.delegatorAgentId);
    refresh(data.delegateAgentId);
  });
}

export async function revokeDelegationAction(id: string, agentId: string, reason: string) {
  return act(async () => {
    const c = await getConsoleContext();
    await withTenant(c.ctx.orgId, (db) => revokeDelegation(db, c.ctx, uuid.parse(id), z.string().min(3).max(500).parse(reason)));
    refresh(uuid.parse(agentId));
  });
}

export async function emergencyRevokeAction(agentId: string, input: { mode: "suspend" | "revoke"; reason: string }) {
  return act(async () => {
    const c = await getConsoleContext();
    const data = z.object({ mode: z.enum(["suspend", "revoke"]), reason: z.string().min(5).max(1000) }).parse(input);
    const report = await withTenant(c.ctx.orgId, (db) => emergencyRevokeAgent(db, { ...c.ctx, actor: { ...c.ctx.actor, label: c.session.user.name } }, uuid.parse(agentId), data));
    refresh(agentId);
    revalidatePath("/approvals");
    revalidatePath("/gateway");
    return report;
  });
}

export async function resolveDiscoveredAgentAction(id: string, input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    const data = z.union([z.object({ action: z.literal("link"), agentId: uuid }), z.object({ action: z.literal("ignore"), note: z.string().min(3).max(500) })]).parse(input);
    await withTenant(c.ctx.orgId, (db) => resolveDiscoveredAgent(db, c.ctx, uuid.parse(id), data));
    refresh();
  });
}
