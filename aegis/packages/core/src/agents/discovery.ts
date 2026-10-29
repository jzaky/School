import type { Prisma, TenantDb } from "@aegis/db";
import { z } from "zod";
import { appendEvidence } from "../evidence/ledger.js";
import type { OrgContext } from "../lib/context.js";
import { conflict, forbidden, notFound } from "../lib/errors.js";
import { hasPermission } from "../identity/permissions.js";
import { assertPermission } from "../orgs/orgs.js";
import { createSecurityEvent } from "../shield/security-events.js";

/**
 * Agent discovery. Integrations, deployment pipelines and telemetry report the AI agents they see;
 * AEGIS keeps one row per (source, external id), matches it to the registry where it can, and flags
 * the rest as unregistered. A person registers, links or dismisses each one. Discovery depends on
 * what is reported: an agent no source mentions stays invisible here.
 */
export const observationSchema = z.object({
  source: z.string().min(2).max(60),
  externalId: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  platform: z.string().max(80).default(""),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export async function recordAgentObservation(db: TenantDb, ctx: OrgContext, input: z.infer<typeof observationSchema>) {
  const allowed = ctx.actor.type === "integration" || ctx.actor.type === "system" || (ctx.actor.type === "user" && hasPermission(ctx.actor.permissions, "agents:write"));
  if (!allowed) throw forbidden("Only integrations, AEGIS or people who manage agents can report discovered agents");
  const now = ctx.now ?? new Date();
  const source = ctx.actor.type === "integration" ? `integration:${ctx.actor.id}:${input.source}` : input.source;
  const existing = await db.discoveredAgent.findUnique({ where: { orgId_source_externalId: { orgId: ctx.orgId, source, externalId: input.externalId } } });
  if (existing) {
    return db.discoveredAgent.update({ where: { id: existing.id }, data: { lastSeenAt: now, observations: { increment: 1 }, name: input.name, platform: input.platform || existing.platform, metadata: { ...(existing.metadata as object), ...input.metadata } as Prisma.InputJsonValue } });
  }
  // Match by slug or name to the registry first: a known agent seen somewhere new is linked, not flagged.
  const slug = input.externalId.toLowerCase();
  const match = await db.agent.findFirst({ where: { orgId: ctx.orgId, OR: [{ slug }, { name: input.name }] }, select: { id: true } });
  const row = await db.discoveredAgent.create({ data: { orgId: ctx.orgId, source, externalId: input.externalId, name: input.name, platform: input.platform, metadata: input.metadata as Prisma.InputJsonValue, firstSeenAt: now, lastSeenAt: now, status: match ? "linked" : "unregistered", linkedAgentId: match?.id ?? null } });
  await appendEvidence(db, ctx, { type: match ? "discovery.agent_matched" : "discovery.agent_unregistered", subjectType: "discovered_agent", subjectId: row.id, payload: { source, externalId: input.externalId, name: input.name, platform: input.platform, linkedAgentId: match?.id ?? null } });
  if (!match) await createSecurityEvent(db, ctx, { type: "discovery.unregistered_agent", severity: "medium", title: `Unregistered AI agent seen: ${input.name.slice(0, 80)}`, detail: { source, externalId: input.externalId, platform: input.platform }, escalate: false });
  return row;
}

export async function listDiscoveredAgents(db: TenantDb, ctx: OrgContext, filter: { status?: "unregistered" | "linked" | "ignored" } = {}) {
  assertPermission(ctx, "agents:read");
  return db.discoveredAgent.findMany({ where: { orgId: ctx.orgId, ...(filter.status ? { status: filter.status } : {}) }, orderBy: [{ status: "asc" }, { lastSeenAt: "desc" }], take: 200 });
}

export async function resolveDiscoveredAgent(db: TenantDb, ctx: OrgContext, id: string, input: { action: "link"; agentId: string } | { action: "ignore"; note: string }) {
  assertPermission(ctx, "agents:write");
  const row = await db.discoveredAgent.findUnique({ where: { id } });
  if (!row) throw notFound("Discovered agent");
  if (row.status !== "unregistered") throw conflict(`Already ${row.status}`);
  if (input.action === "link") {
    const agent = await db.agent.findUnique({ where: { id: input.agentId } });
    if (!agent) throw notFound("Agent");
    const updated = await db.discoveredAgent.update({ where: { id }, data: { status: "linked", linkedAgentId: agent.id, decidedBy: ctx.actor.id } });
    await appendEvidence(db, ctx, { type: "discovery.agent_linked", subjectType: "discovered_agent", subjectId: id, payload: { agentId: agent.id } });
    return updated;
  }
  const updated = await db.discoveredAgent.update({ where: { id }, data: { status: "ignored", note: input.note, decidedBy: ctx.actor.id } });
  await appendEvidence(db, ctx, { type: "discovery.agent_ignored", subjectType: "discovered_agent", subjectId: id, payload: { note: input.note } });
  return updated;
}
