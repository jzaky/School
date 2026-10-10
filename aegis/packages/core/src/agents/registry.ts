import type { AgentStatus, DataClassification, Environment, Prisma, TenantDb } from "@aegis/db";
import { z } from "zod";
import { appendEvidence } from "../evidence/ledger.js";
import type { OrgContext } from "../lib/context.js";
import { conflict, notFound, validation } from "../lib/errors.js";
import { pageSchema, skipTake, toPage, type PageInput } from "../lib/pagination.js";
import { assertPermission, slugSchema } from "../orgs/orgs.js";

export const agentInputSchema = z.object({
  slug: slugSchema,
  name: z.string().min(2).max(120),
  description: z.string().max(2000).default(""),
  environment: z.enum(["development", "staging", "production"]).default("development"),
  modelProvider: z.string().max(80).default(""),
  modelId: z.string().max(120).default(""),
  businessOwnerId: z.string().uuid().nullable().optional(),
  technicalOwnerId: z.string().uuid().nullable().optional(),
  teamId: z.string().uuid().nullable().optional(),
  dataClassificationLimit: z.enum(["public", "internal", "confidential", "restricted"]).default("internal"),
  riskTier: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  metadata: z.record(z.unknown()).default({}),
});
export type AgentInput = z.infer<typeof agentInputSchema>;

/** Allowed lifecycle transitions. Anything not listed is rejected. */
export const AGENT_TRANSITIONS: Record<AgentStatus, AgentStatus[]> = {
  draft: ["registered", "archived"],
  registered: ["active", "archived", "draft"],
  active: ["suspended", "revoked", "archived"],
  suspended: ["active", "revoked", "archived"],
  revoked: ["archived"],
  archived: [],
};

export const agentListFilter = pageSchema.extend({
  q: z.string().max(120).optional(),
  status: z.enum(["draft", "registered", "active", "suspended", "revoked", "archived"]).optional(),
  environment: z.enum(["development", "staging", "production"]).optional(),
  riskTier: z.string().optional(),
});

export async function listAgents(db: TenantDb, ctx: OrgContext, filter: z.infer<typeof agentListFilter>) {
  assertPermission(ctx, "agents:read");
  const where: Prisma.AgentWhereInput = {
    orgId: ctx.orgId,
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.environment ? { environment: filter.environment } : {}),
    ...(filter.riskTier ? { riskTier: filter.riskTier } : {}),
    ...(filter.q ? { OR: [{ name: { contains: filter.q, mode: "insensitive" } }, { slug: { contains: filter.q, mode: "insensitive" } }, { description: { contains: filter.q, mode: "insensitive" } }] } : {}),
  };
  const [items, total] = await Promise.all([
    db.agent.findMany({ where, orderBy: [{ status: "asc" }, { name: "asc" }], ...skipTake(filter), include: { tools: { include: { tool: true } }, _count: { select: { requests: true } } } }),
    db.agent.count({ where }),
  ]);
  return toPage(items, total, filter as PageInput);
}

export async function getAgent(db: TenantDb, ctx: OrgContext, agentId: string) {
  assertPermission(ctx, "agents:read");
  const agent = await db.agent.findUnique({
    where: { id: agentId },
    include: {
      versions: { orderBy: { version: "desc" } },
      tools: { include: { tool: { include: { integration: true } } } },
      permissions: { include: { resource: true } },
    },
  });
  if (!agent || agent.orgId !== ctx.orgId) throw notFound("Agent");
  const [assignments, recentRequests, decisionsAgg] = await Promise.all([
    db.policyAssignment.findMany({ where: { orgId: ctx.orgId, OR: [{ targetType: "org" }, { targetType: "agent", targetId: agentId }, ...(agent.teamId ? [{ targetType: "team" as const, targetId: agent.teamId }] : [])] }, include: { policy: { include: { versions: { where: { state: "active" }, take: 1 } } } } }),
    db.actionRequest.findMany({ where: { agentId }, orderBy: { createdAt: "desc" }, take: 10, include: { decisions: { take: 1, orderBy: { createdAt: "desc" } } } }),
    db.actionRequest.groupBy({ by: ["status"], where: { agentId }, _count: { _all: true } }),
  ]);
  const apiKeys = await db.apiKey.findMany({ where: { subjectType: "agent", subjectId: agentId }, orderBy: { createdAt: "desc" } });
  return { ...agent, assignments, recentRequests, statusCounts: Object.fromEntries(decisionsAgg.map((d) => [d.status, d._count._all])), apiKeys };
}

export async function createAgent(db: TenantDb, ctx: OrgContext, input: AgentInput) {
  assertPermission(ctx, "agents:write");
  const dup = await db.agent.findUnique({ where: { orgId_slug: { orgId: ctx.orgId, slug: input.slug } } });
  if (dup) throw conflict("An agent with this slug already exists");
  const agent = await db.agent.create({ data: { orgId: ctx.orgId, ...input, metadata: input.metadata as Prisma.InputJsonValue } });
  await db.agentVersion.create({ data: { orgId: ctx.orgId, agentId: agent.id, version: 1, manifest: { modelProvider: input.modelProvider, modelId: input.modelId, environment: input.environment }, notes: "Initial registration", createdBy: ctx.actor.id } });
  await appendEvidence(db, ctx, { type: "agent.created", subjectType: "agent", subjectId: agent.id, payload: { slug: agent.slug, name: agent.name, environment: agent.environment, riskTier: agent.riskTier } });
  return agent;
}

export async function updateAgent(db: TenantDb, ctx: OrgContext, agentId: string, patch: Partial<AgentInput>) {
  assertPermission(ctx, "agents:write");
  const current = await db.agent.findUnique({ where: { id: agentId } });
  if (!current) throw notFound("Agent");
  if (current.status === "revoked" || current.status === "archived") throw validation(`A ${current.status} agent cannot be edited`);
  const { slug: _slug, metadata, ...rest } = patch;
  const agent = await db.agent.update({ where: { id: agentId }, data: { ...rest, ...(metadata ? { metadata: metadata as Prisma.InputJsonValue } : {}) } });
  await appendEvidence(db, ctx, { type: "agent.updated", subjectType: "agent", subjectId: agentId, payload: { fields: Object.keys(patch) } });
  return agent;
}

export async function transitionAgent(db: TenantDb, ctx: OrgContext, agentId: string, to: AgentStatus, reason: string) {
  const needsControl = to === "suspended" || to === "revoked" || (to === "active" && reason.startsWith("resume"));
  assertPermission(ctx, needsControl ? "agents:control" : "agents:write");
  const agent = await db.agent.findUnique({ where: { id: agentId } });
  if (!agent) throw notFound("Agent");
  if (!AGENT_TRANSITIONS[agent.status].includes(to)) throw validation(`Cannot move an agent from ${agent.status} to ${to}`);
  if ((to === "suspended" || to === "revoked") && reason.trim().length < 3) throw validation("A reason is required");
  const updated = await db.agent.update({ where: { id: agentId }, data: { status: to, statusReason: reason, statusChangedAt: new Date() } });
  if (to === "revoked") {
    // Revocation kills every credential path immediately.
    await db.apiKey.updateMany({ where: { subjectType: "agent", subjectId: agentId, revokedAt: null }, data: { revokedAt: new Date() } });
    await db.permission.updateMany({ where: { agentId, revokedAt: null }, data: { revokedAt: new Date() } });
    await db.agentTool.updateMany({ where: { agentId, revokedAt: null }, data: { revokedAt: new Date(), enabled: false, revokedReason: `agent revoked: ${reason}` } });
    // Pending approvals for this agent can no longer execute.
    const pending = await db.approvalRequest.findMany({ where: { status: "pending", request: { agentId } }, select: { id: true, actionRequestId: true } });
    for (const p of pending) {
      await db.approvalRequest.update({ where: { id: p.id }, data: { status: "expired", decidedAt: new Date(), reason: "agent revoked" } });
      await db.actionRequest.update({ where: { id: p.actionRequestId }, data: { status: "expired", completedAt: new Date() } });
    }
  }
  await appendEvidence(db, ctx, { type: `agent.${to}`, subjectType: "agent", subjectId: agentId, payload: { from: agent.status, to, reason } });
  return updated;
}

export async function addAgentVersion(db: TenantDb, ctx: OrgContext, agentId: string, input: { manifest: Record<string, unknown>; notes: string; deploy?: boolean }) {
  assertPermission(ctx, "agents:write");
  const agent = await db.agent.findUnique({ where: { id: agentId }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
  if (!agent) throw notFound("Agent");
  const version = (agent.versions[0]?.version ?? 0) + 1;
  const row = await db.agentVersion.create({ data: { orgId: ctx.orgId, agentId, version, manifest: input.manifest as Prisma.InputJsonValue, notes: input.notes, deployedAt: input.deploy ? new Date() : null, createdBy: ctx.actor.id } });
  if (input.deploy) await db.agent.update({ where: { id: agentId }, data: { currentVersion: version } });
  await appendEvidence(db, ctx, { type: "agent.version_added", subjectType: "agent", subjectId: agentId, payload: { version, deployed: !!input.deploy } });
  return row;
}

// ---------- Tools and permissions ----------

export async function setAgentTool(db: TenantDb, ctx: OrgContext, agentId: string, toolId: string, enabled: boolean, scope: Record<string, unknown> = {}) {
  assertPermission(ctx, "agents:write");
  const [agent, tool] = await Promise.all([db.agent.findUnique({ where: { id: agentId } }), db.tool.findUnique({ where: { id: toolId } })]);
  if (!agent) throw notFound("Agent");
  if (!tool) throw notFound("Tool");
  const row = await db.agentTool.upsert({
    where: { agentId_toolId: { agentId, toolId } },
    create: { orgId: ctx.orgId, agentId, toolId, enabled, scope: scope as Prisma.InputJsonValue },
    update: { enabled, scope: scope as Prisma.InputJsonValue, revokedAt: enabled ? null : undefined },
  });
  await appendEvidence(db, ctx, { type: enabled ? "agent.tool_granted" : "agent.tool_disabled", subjectType: "agent", subjectId: agentId, payload: { tool: tool.key } });
  return row;
}

/** Emergency control: revokes a tool from an agent. Takes effect on the next gateway call. */
export async function revokeAgentTool(db: TenantDb, ctx: OrgContext, agentId: string, toolId: string, reason: string) {
  assertPermission(ctx, "agents:control");
  const link = await db.agentTool.findUnique({ where: { agentId_toolId: { agentId, toolId } }, include: { tool: true } });
  if (!link) throw notFound("Tool grant");
  const row = await db.agentTool.update({ where: { id: link.id }, data: { enabled: false, revokedAt: new Date(), revokedReason: reason } });
  await appendEvidence(db, ctx, { type: "agent.tool_revoked", subjectType: "agent", subjectId: agentId, payload: { tool: link.tool.key, reason } });
  return row;
}

export async function grantResourcePermission(db: TenantDb, ctx: OrgContext, agentId: string, resourceId: string, actions: string[], constraints: Record<string, unknown> = {}, expiresAt?: Date | null) {
  assertPermission(ctx, "agents:write");
  const [agent, resource] = await Promise.all([db.agent.findUnique({ where: { id: agentId } }), db.resource.findUnique({ where: { id: resourceId } })]);
  if (!agent) throw notFound("Agent");
  if (!resource) throw notFound("Resource");
  const order: DataClassification[] = ["public", "internal", "confidential", "restricted"];
  if (order.indexOf(resource.classification) > order.indexOf(agent.dataClassificationLimit)) {
    throw validation(`Agent is limited to ${agent.dataClassificationLimit} data; ${resource.key} is ${resource.classification}`);
  }
  const row = await db.permission.upsert({
    where: { agentId_resourceId: { agentId, resourceId } },
    create: { orgId: ctx.orgId, agentId, resourceId, actions, constraints: constraints as Prisma.InputJsonValue, grantedBy: ctx.actor.id, expiresAt: expiresAt ?? null },
    update: { actions, constraints: constraints as Prisma.InputJsonValue, grantedBy: ctx.actor.id, expiresAt: expiresAt ?? null, revokedAt: null },
  });
  await appendEvidence(db, ctx, { type: "agent.permission_granted", subjectType: "agent", subjectId: agentId, payload: { resource: resource.key, actions } });
  return row;
}

export async function revokeResourcePermission(db: TenantDb, ctx: OrgContext, permissionId: string, reason: string) {
  assertPermission(ctx, "agents:write");
  const p = await db.permission.findUnique({ where: { id: permissionId }, include: { resource: true } });
  if (!p) throw notFound("Permission");
  await db.permission.update({ where: { id: permissionId }, data: { revokedAt: new Date() } });
  await appendEvidence(db, ctx, { type: "agent.permission_revoked", subjectType: "agent", subjectId: p.agentId, payload: { resource: p.resource.key, reason } });
}

// ---------- Tools and resources catalog ----------

export const toolInputSchema = z.object({
  key: slugSchema,
  name: z.string().min(2).max(120),
  description: z.string().max(1000).default(""),
  integrationId: z.string().uuid().nullable().optional(),
  parameterSchema: z.record(z.unknown()).default({}),
  destinationRules: z.object({ allowedDomains: z.array(z.string()).default([]), allowedResourceKeys: z.array(z.string()).default([]) }).default({ allowedDomains: [], allowedResourceKeys: [] }),
  riskLevel: z.enum(["low", "medium", "high", "critical"]).default("medium"),
});

export async function listTools(db: TenantDb, ctx: OrgContext) {
  assertPermission(ctx, "agents:read");
  return db.tool.findMany({ where: { orgId: ctx.orgId }, include: { integration: true, _count: { select: { agentTools: true } } }, orderBy: { name: "asc" } });
}

export async function upsertTool(db: TenantDb, ctx: OrgContext, input: z.infer<typeof toolInputSchema>) {
  assertPermission(ctx, "agents:write");
  const data = { ...input, parameterSchema: input.parameterSchema as Prisma.InputJsonValue, destinationRules: input.destinationRules as Prisma.InputJsonValue };
  const row = await db.tool.upsert({ where: { orgId_key: { orgId: ctx.orgId, key: input.key } }, create: { orgId: ctx.orgId, ...data }, update: data });
  await appendEvidence(db, ctx, { type: "tool.upserted", subjectType: "tool", subjectId: row.id, payload: { key: row.key, riskLevel: row.riskLevel } });
  return row;
}

export async function setToolEnabled(db: TenantDb, ctx: OrgContext, toolId: string, enabled: boolean, reason: string) {
  assertPermission(ctx, "agents:control");
  const row = await db.tool.update({ where: { id: toolId }, data: { enabled, disabledReason: enabled ? null : reason } });
  await appendEvidence(db, ctx, { type: enabled ? "tool.enabled" : "tool.disabled", subjectType: "tool", subjectId: toolId, payload: { key: row.key, reason } });
  return row;
}

export const resourceInputSchema = z.object({
  key: slugSchema,
  name: z.string().min(2).max(120),
  type: z.string().min(2).max(60),
  classification: z.enum(["public", "internal", "confidential", "restricted"]).default("internal"),
  ownerTeamId: z.string().uuid().nullable().optional(),
  attributes: z.record(z.unknown()).default({}),
});

export async function listResources(db: TenantDb, ctx: OrgContext) {
  assertPermission(ctx, "agents:read");
  return db.resource.findMany({ where: { orgId: ctx.orgId }, orderBy: { name: "asc" }, include: { _count: { select: { permissions: true } } } });
}

export async function upsertResource(db: TenantDb, ctx: OrgContext, input: z.infer<typeof resourceInputSchema>) {
  assertPermission(ctx, "agents:write");
  const data = { ...input, attributes: input.attributes as Prisma.InputJsonValue };
  const row = await db.resource.upsert({ where: { orgId_key: { orgId: ctx.orgId, key: input.key } }, create: { orgId: ctx.orgId, ...data }, update: data });
  await appendEvidence(db, ctx, { type: "resource.upserted", subjectType: "resource", subjectId: row.id, payload: { key: row.key, classification: row.classification } });
  return row;
}

export type { Environment };
