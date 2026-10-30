import type { Prisma, TenantDb } from "@aegis/db";
import { z } from "zod";
import { appendEvidence } from "../evidence/ledger.js";
import type { OrgContext } from "../lib/context.js";
import { hashObject } from "../lib/crypto.js";
import { AegisError, conflict, forbidden, notFound } from "../lib/errors.js";
import { assertPermission } from "../orgs/orgs.js";
import { createSecurityEvent } from "./security-events.js";

/**
 * Tool definition pinning (docs/TOOL_PINNING.md). A connector (an MCP server, a plug-in) can change
 * under an agent: a new version that quietly copies every email to an attacker, or a tool description
 * rewritten to steer the model. AEGIS keeps a fingerprint of each tool's definition and the connector
 * name and version it came from. The first report pins them; any later difference is held as a pending
 * change and the tool is refused at the gateway until a person approves the new version or rejects it.
 *
 * AEGIS does not read the connector's code. What it guarantees is that a changed connector or tool
 * definition is not used until a person has looked at it, and that the change is in the evidence record.
 *
 * Reports come from the MCP gateway (with the agent's key, for tools that agent was granted), from a
 * downstream system's integration key (for its own tools), or from a person with agents:write. A report
 * can only pin a new tool or raise a change; it can never clear one. Only a person with security:write can.
 */
export interface DefinitionSnapshot {
  hash: string;
  server: string | null;
  version: string | null;
  at: string;
}
export interface DefinitionPin {
  pinned?: DefinitionSnapshot & { by: string | null };
  pending?: DefinitionSnapshot & { definition: ToolDefinition; changed: ("definition" | "version" | "server")[] };
}
export interface ToolDefinition {
  name: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: Record<string, unknown>;
}

export const reportDefinitionsSchema = z.object({
  server: z.object({ name: z.string().max(200).nullable().default(null), version: z.string().max(100).nullable().default(null) }).default({ name: null, version: null }),
  tools: z
    .array(
      z.object({
        key: z.string().min(1).max(200),
        name: z.string().min(1).max(200),
        description: z.string().max(20_000).optional(),
        inputSchema: z.unknown().optional(),
        annotations: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .min(1)
    .max(500),
});

export function readPin(v: unknown): DefinitionPin {
  return v && typeof v === "object" ? (v as DefinitionPin) : {};
}

/** The fingerprint of what the model is shown and what the tool accepts. */
export function definitionHash(d: ToolDefinition): string {
  return hashObject({ name: d.name, description: d.description ?? "", inputSchema: d.inputSchema ?? {}, annotations: d.annotations ?? {} });
}

/** A pending change blocks the tool at the gateway (baseline check "tool_definition_changed"). */
export function pendingDefinitionChange(v: unknown): string | null {
  const p = readPin(v).pending;
  if (!p) return null;
  return `The tool's ${p.changed.join(" and ")} changed${p.version ? ` (now ${p.server ?? "connector"} ${p.version})` : ""} since it was approved; a person must review the change before it can be used`;
}

export type ReportOutcome = "pinned" | "unchanged" | "changed" | "already_pending" | "not_registered";

export async function reportToolDefinitions(db: TenantDb, ctx: OrgContext, input: unknown): Promise<{ results: { key: string; outcome: ReportOutcome }[] }> {
  const body = reportDefinitionsSchema.parse(input);
  const keys = body.tools.map((t) => t.key);
  const tools = await db.tool.findMany({ where: { orgId: ctx.orgId, key: { in: keys } }, select: { id: true, key: true, integrationId: true, definitionPin: true } });
  // Who may report for which tools.
  let allowed: Set<string>;
  if (ctx.actor.type === "agent") {
    const grants = await db.agentTool.findMany({ where: { agentId: ctx.actor.id!, revokedAt: null, toolId: { in: tools.map((t) => t.id) } }, select: { toolId: true } });
    allowed = new Set(grants.map((g) => g.toolId));
  } else if (ctx.actor.type === "integration") {
    allowed = new Set(tools.filter((t) => t.integrationId === ctx.actor.id).map((t) => t.id));
  } else {
    assertPermission(ctx, "agents:write");
    allowed = new Set(tools.map((t) => t.id));
  }
  const now = (ctx.now ?? new Date()).toISOString();
  const by = ctx.actor.label ?? ctx.actor.id ?? null;
  const results: { key: string; outcome: ReportOutcome }[] = [];
  for (const def of body.tools) {
    const tool = tools.find((t) => t.key === def.key);
    if (!tool || !allowed.has(tool.id)) {
      results.push({ key: def.key, outcome: "not_registered" });
      continue;
    }
    const pin = readPin(tool.definitionPin);
    const snap: DefinitionSnapshot = { hash: definitionHash(def), server: body.server.name, version: body.server.version, at: now };
    if (!pin.pinned) {
      await db.tool.update({ where: { id: tool.id }, data: { definitionPin: { pinned: { ...snap, by } } as unknown as Prisma.InputJsonValue } });
      await appendEvidence(db, ctx, { type: "tool.definition_pinned", subjectType: "tool", subjectId: tool.id, payload: { key: tool.key, hash: snap.hash, server: snap.server, version: snap.version } });
      results.push({ key: def.key, outcome: "pinned" });
      continue;
    }
    const changed: ("definition" | "version" | "server")[] = [];
    if (pin.pinned.hash !== snap.hash) changed.push("definition");
    if (pin.pinned.version !== snap.version) changed.push("version");
    if (pin.pinned.server !== snap.server) changed.push("server");
    if (!changed.length) {
      // Matching the approved version again never clears a pending change: only a person can.
      results.push({ key: def.key, outcome: pin.pending ? "already_pending" : "unchanged" });
      continue;
    }
    if (pin.pending && pin.pending.hash === snap.hash && pin.pending.version === snap.version && pin.pending.server === snap.server) {
      results.push({ key: def.key, outcome: "already_pending" });
      continue;
    }
    const pending = { ...snap, definition: { name: def.name, description: def.description, inputSchema: def.inputSchema, annotations: def.annotations }, changed };
    await db.tool.update({ where: { id: tool.id }, data: { definitionPin: { ...pin, pending } as unknown as Prisma.InputJsonValue } });
    await appendEvidence(db, ctx, { type: "tool.definition_changed", subjectType: "tool", subjectId: tool.id, payload: { key: tool.key, changed, pinnedHash: pin.pinned.hash, newHash: snap.hash, pinnedVersion: pin.pinned.version, newVersion: snap.version, server: snap.server } });
    await createSecurityEvent(db, ctx, { type: "tool.definition_changed", severity: "high", title: `Tool ${tool.key} changed since it was approved (${changed.join(", ")})`, agentId: ctx.actor.type === "agent" ? ctx.actor.id : null, detail: { toolKey: tool.key, changed, pinnedVersion: pin.pinned.version, newVersion: snap.version, server: snap.server } });
    results.push({ key: def.key, outcome: "changed" });
  }
  return { results };
}

/** Approve the pending version: it becomes the pinned one and the tool can be used again. */
export async function approveToolDefinition(db: TenantDb, ctx: OrgContext, toolId: string, reason: string) {
  assertPermission(ctx, "security:write");
  if (ctx.actor.type !== "user") throw forbidden("Only a person can approve a changed tool");
  if (reason.trim().length < 5) throw new AegisError("validation", "A reason of at least 5 characters is required");
  const tool = await db.tool.findFirst({ where: { id: toolId, orgId: ctx.orgId } });
  if (!tool) throw notFound("Tool");
  const pin = readPin(tool.definitionPin);
  if (!pin.pending) throw conflict("This tool has no change waiting for review");
  const { definition: _definition, changed, ...snap } = pin.pending;
  const next: DefinitionPin = { pinned: { ...snap, by: ctx.actor.label ?? ctx.actor.id ?? null } };
  await db.tool.update({ where: { id: tool.id }, data: { definitionPin: next as unknown as Prisma.InputJsonValue } });
  await appendEvidence(db, ctx, { type: "tool.definition_approved", subjectType: "tool", subjectId: tool.id, payload: { key: tool.key, changed, hash: snap.hash, version: snap.version, reason: reason.trim() } });
  return next;
}

/**
 * Reject the pending version: the approved pin stays and the tool is disabled, because the connector is
 * still serving the version that was rejected. Re-enable it once the connector is back on an approved version.
 */
export async function rejectToolDefinition(db: TenantDb, ctx: OrgContext, toolId: string, reason: string) {
  assertPermission(ctx, "security:write");
  if (ctx.actor.type !== "user") throw forbidden("Only a person can reject a changed tool");
  if (reason.trim().length < 5) throw new AegisError("validation", "A reason of at least 5 characters is required");
  const tool = await db.tool.findFirst({ where: { id: toolId, orgId: ctx.orgId } });
  if (!tool) throw notFound("Tool");
  const pin = readPin(tool.definitionPin);
  if (!pin.pending) throw conflict("This tool has no change waiting for review");
  const next: DefinitionPin = { pinned: pin.pinned };
  await db.tool.update({ where: { id: tool.id }, data: { definitionPin: next as unknown as Prisma.InputJsonValue, enabled: false, disabledReason: `Changed connector version rejected: ${reason.trim()}`.slice(0, 500) } });
  await appendEvidence(db, ctx, { type: "tool.definition_rejected", subjectType: "tool", subjectId: tool.id, payload: { key: tool.key, changed: pin.pending.changed, rejectedHash: pin.pending.hash, rejectedVersion: pin.pending.version, reason: reason.trim() } });
  return next;
}

/** Tools with a change waiting for review, for the console. */
export async function listPendingToolChanges(db: TenantDb, ctx: OrgContext) {
  assertPermission(ctx, "security:read");
  const tools = await db.tool.findMany({ where: { orgId: ctx.orgId }, select: { id: true, key: true, name: true, definitionPin: true, enabled: true }, orderBy: { key: "asc" } });
  return tools.map((t) => ({ id: t.id, key: t.key, name: t.name, enabled: t.enabled, pin: readPin(t.definitionPin) })).filter((t) => t.pin.pinned || t.pin.pending);
}
