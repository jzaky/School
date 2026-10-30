"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant, type AgentStatus } from "@aegis/db";
import { addAgentVersion, AGENT_TRANSITIONS, agentInputSchema, agentListFilter, createAgent, forbidden, notFound, validation, grantResourcePermission, issueApiKey, listAgents, revokeAgentTool, revokeApiKey, revokeResourcePermission, setAgentTool, transitionAgent, updateAgent, parsePatch } from "@aegis/core";
import { getConsoleContext } from "@/server/session";
import { act } from "./util";
import { userNames } from "@/server/queries/users";

const statusSchema = z.enum(["draft", "registered", "active", "suspended", "revoked", "archived"]);

export async function createAgentAction(input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    const data = agentInputSchema.parse(input);
    const agent = await withTenant(c.ctx.orgId, (db) => createAgent(db, c.ctx, data));
    revalidatePath("/agents");
    revalidatePath("/overview");
    return { id: agent.id };
  });
}

export async function updateAgentAction(agentId: string, input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    const data = parsePatch(agentInputSchema, input);
    await withTenant(c.ctx.orgId, (db) => updateAgent(db, c.ctx, z.string().uuid().parse(agentId), data));
    revalidatePath(`/agents/${agentId}`);
    revalidatePath("/agents");
  });
}

export async function transitionAgentAction(agentId: string, to: AgentStatus, reason: string) {
  return act(async () => {
    const c = await getConsoleContext();
    const target = statusSchema.parse(to);
    const id = z.string().uuid().parse(agentId);
    await withTenant(c.ctx.orgId, (db) => transitionAgent(db, c.ctx, id, target, z.string().max(1000).parse(reason)));
    revalidatePath(`/agents/${agentId}`);
    revalidatePath("/agents");
    revalidatePath("/overview");
    return { to: target, allowedNext: AGENT_TRANSITIONS[target] };
  });
}

export async function grantToolAction(agentId: string, toolId: string) {
  return act(async () => {
    const c = await getConsoleContext();
    await withTenant(c.ctx.orgId, (db) => setAgentTool(db, c.ctx, z.string().uuid().parse(agentId), z.string().uuid().parse(toolId), true));
    revalidatePath(`/agents/${agentId}`);
  });
}

export async function setAgentToolEnabledAction(agentId: string, toolId: string, enabled: boolean) {
  return act(async () => {
    const c = await getConsoleContext();
    await withTenant(c.ctx.orgId, (db) => setAgentTool(db, c.ctx, z.string().uuid().parse(agentId), z.string().uuid().parse(toolId), enabled));
    revalidatePath(`/agents/${agentId}`);
  });
}

export async function revokeToolAction(agentId: string, toolId: string, reason: string) {
  return act(async () => {
    const c = await getConsoleContext();
    await withTenant(c.ctx.orgId, (db) => revokeAgentTool(db, c.ctx, z.string().uuid().parse(agentId), z.string().uuid().parse(toolId), z.string().min(3).max(1000).parse(reason)));
    revalidatePath(`/agents/${agentId}`);
  });
}

const grantSchema = z.object({ resourceId: z.string().uuid(), actions: z.array(z.string().min(1).max(40)).min(1), expiresAt: z.string().datetime().nullable().optional() });

export async function grantPermissionAction(agentId: string, input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    const data = grantSchema.parse(input);
    await withTenant(c.ctx.orgId, (db) => grantResourcePermission(db, c.ctx, z.string().uuid().parse(agentId), data.resourceId, data.actions, {}, data.expiresAt ? new Date(data.expiresAt) : null));
    revalidatePath(`/agents/${agentId}`);
  });
}

export async function revokePermissionAction(agentId: string, permissionId: string, reason: string) {
  return act(async () => {
    const c = await getConsoleContext();
    await withTenant(c.ctx.orgId, (db) => revokeResourcePermission(db, c.ctx, z.string().uuid().parse(permissionId), z.string().min(3).max(1000).parse(reason)));
    revalidatePath(`/agents/${agentId}`);
  });
}

const versionSchema = z.object({ manifest: z.string().min(2), notes: z.string().max(2000).default(""), deploy: z.boolean().default(false) });

export async function addVersionAction(agentId: string, input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    const data = versionSchema.parse(input);
    let manifest: unknown;
    try {
      manifest = JSON.parse(data.manifest);
    } catch {
      throw validation("Manifest must be valid JSON");
    }
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw validation("Manifest must be a JSON object");
    await withTenant(c.ctx.orgId, (db) => addAgentVersion(db, c.ctx, z.string().uuid().parse(agentId), { manifest: manifest as Record<string, unknown>, notes: data.notes, deploy: data.deploy }));
    revalidatePath(`/agents/${agentId}`);
  });
}

const keySchema = z.object({ name: z.string().min(2).max(120), expiresInDays: z.coerce.number().int().min(0).max(3650).default(0) });

export async function issueAgentKeyAction(agentId: string, input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    if (!c.can("agents:write")) throw forbidden("Missing permission agents:write");
    const data = keySchema.parse(input);
    const id = z.string().uuid().parse(agentId);
    const r = await withTenant(c.ctx.orgId, async (db) => {
      const agent = await db.agent.findUnique({ where: { id } });
      if (!agent) throw notFound("Agent");
      if (agent.status === "revoked" || agent.status === "archived") throw validation(`Keys cannot be issued for a ${agent.status} agent`);
      return issueApiKey(db, c.ctx, { name: data.name, subjectType: "agent", subjectId: id, expiresAt: data.expiresInDays > 0 ? new Date(Date.now() + data.expiresInDays * 86400_000) : null });
    });
    revalidatePath(`/agents/${agentId}`);
    // The full key is returned to the caller exactly once and never persisted in clear.
    return { key: r.key, prefix: r.record.prefix, id: r.record.id };
  });
}

export async function revokeAgentKeyAction(agentId: string, apiKeyId: string, reason: string) {
  return act(async () => {
    const c = await getConsoleContext();
    if (!c.can("agents:write") && !c.can("agents:control")) throw forbidden("Missing permission agents:write");
    const id = z.string().uuid().parse(apiKeyId);
    await withTenant(c.ctx.orgId, async (db) => {
      const row = await db.apiKey.findUnique({ where: { id } });
      if (!row || row.subjectId !== agentId) throw notFound("API key");
      if (row.revokedAt) throw validation("Key is already revoked");
      return revokeApiKey(db, c.ctx, id, z.string().min(3).max(1000).parse(reason));
    });
    revalidatePath(`/agents/${agentId}`);
  });
}

/** CSV of the current filter, all pages. */
export async function exportAgentsCsvAction(filter: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    const f = agentListFilter.parse({ ...(filter as object), page: 1, pageSize: 200 });
    const page = await withTenant(c.ctx.orgId, (db) => listAgents(db, c.ctx, f));
    const names = await userNames(page.items.flatMap((a) => [a.businessOwnerId, a.technicalOwnerId]));
    const header = ["name", "slug", "status", "environment", "risk_tier", "model_provider", "model_id", "tools", "business_owner", "technical_owner", "requests", "last_activity_at", "created_at"];
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = page.items.map((a) => [a.name, a.slug, a.status, a.environment, a.riskTier, a.modelProvider, a.modelId, a.tools.filter((t) => !t.revokedAt).length, names.get(a.businessOwnerId ?? "") ?? "", names.get(a.technicalOwnerId ?? "") ?? "", a._count.requests, a.lastActivityAt?.toISOString() ?? "", a.createdAt.toISOString()].map(esc).join(","));
    return { csv: [header.join(","), ...lines].join("\n"), count: page.items.length, total: page.total };
  });
}
