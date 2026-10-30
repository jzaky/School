import type { Prisma, TenantDb } from "@aegis/db";
import { appendEvidence } from "../evidence/ledger.js";
import type { OrgContext } from "../lib/context.js";
import { notFound, validation } from "../lib/errors.js";
import { assertPermission } from "../orgs/orgs.js";

/**
 * Watch-only mode for pilots (docs/PILOTS.md). The gateway still decides every action and records the
 * decision, but an agent in watch-only mode is not held or refused by its policies: the action proceeds
 * and the record says what AEGIS would have done. Hard controls are never relaxed: identity and tool
 * grants, a paused gateway, tampered policies, data protection blocks and evaluation errors still refuse.
 *
 * Turning it on loosens enforcement, so it needs policies:activate; turning it off only tightens, so
 * agents:control is enough. Both are recorded. The flag lives in agent.metadata.watchOnly and is
 * preserved across ordinary agent edits so it cannot be set through them.
 */
export const WATCH_ONLY_KEY = "watchOnly";

export interface WatchOnlyState {
  enabled: true;
  since: string;
  by: string | null;
  reason: string;
}

export function readWatchOnly(metadata: unknown): WatchOnlyState | null {
  const v = (metadata as Record<string, unknown> | null)?.[WATCH_ONLY_KEY] as Partial<WatchOnlyState> | undefined;
  return v && v.enabled === true && typeof v.since === "string" ? { enabled: true, since: v.since, by: v.by ?? null, reason: v.reason ?? "" } : null;
}

/** Ordinary agent edits keep whatever watch-only state the agent already has. */
export function preserveWatchOnly(next: Record<string, unknown>, current: unknown): Record<string, unknown> {
  const { [WATCH_ONLY_KEY]: _ignored, ...rest } = next;
  const kept = (current as Record<string, unknown> | null)?.[WATCH_ONLY_KEY];
  return kept === undefined ? rest : { ...rest, [WATCH_ONLY_KEY]: kept };
}

export async function setWatchOnly(db: TenantDb, ctx: OrgContext, agentId: string, input: { enabled: boolean; reason: string }) {
  assertPermission(ctx, input.enabled ? "policies:activate" : "agents:control");
  const reason = input.reason.trim();
  if (input.enabled && reason.length < 5) throw validation("Give a reason for watch-only mode (at least 5 characters)");
  const agent = await db.agent.findUnique({ where: { id: agentId }, select: { id: true, slug: true, metadata: true, isLab: true } });
  if (!agent) throw notFound("Agent");
  if (agent.isLab) throw validation("Attack Simulation Lab agents cannot be put in watch-only mode");
  const meta = { ...((agent.metadata ?? {}) as Record<string, unknown>) };
  if (input.enabled) meta[WATCH_ONLY_KEY] = { enabled: true, since: (ctx.now ?? new Date()).toISOString(), by: ctx.actor.id, reason: reason.slice(0, 500) } satisfies WatchOnlyState;
  else delete meta[WATCH_ONLY_KEY];
  await db.agent.update({ where: { id: agentId }, data: { metadata: meta as Prisma.InputJsonValue } });
  await appendEvidence(db, ctx, { type: input.enabled ? "agent.watch_only_enabled" : "agent.watch_only_disabled", subjectType: "agent", subjectId: agentId, payload: { slug: agent.slug, reason: reason.slice(0, 500) } });
  return { agentId, watchOnly: readWatchOnly(meta) };
}
