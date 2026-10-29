import type { Prisma, TenantDb } from "@aegis/db";
import { z } from "zod";
import { appendEvidence } from "../evidence/ledger.js";
import type { OrgContext } from "../lib/context.js";
import { AegisError, forbidden, notFound } from "../lib/errors.js";
import { assertPermission } from "../orgs/orgs.js";

/**
 * Change freezes (docs/CHANGE_FREEZE.md). For a set window, agents may not make changes: requests to
 * tools at or above a risk level are refused at the door, before any policy, or held for a person.
 * Reading stays possible, so work that only looks at data continues. A freeze is an order a person
 * gave, so watch-only pilots and policy exceptions never relax it.
 *
 * Freezes live in organization.settings.changeFreezes. Creating one needs agents:control. Ending one
 * early loosens control, so it needs a reason, and with two-person recovery on, a different person
 * from the one who started it (the same rule applies to resuming a paused gateway).
 */
export const RISK_ORDER = ["low", "medium", "high", "critical"] as const;
export type RiskLevel = (typeof RISK_ORDER)[number];

export interface ChangeFreeze {
  id: string;
  title: string;
  reason: string;
  startsAt: string;
  endsAt: string;
  /** deny: refused outright. require_approval: held for a person, as an emergency change. */
  effect: "deny" | "require_approval";
  /** Tools at or above this risk level are frozen. */
  minRiskLevel: RiskLevel;
  /** Only these tools, when set; otherwise every tool in the risk scope. */
  toolKeys: string[];
  /** Only these agents, when set; otherwise every agent. */
  agentIds: string[];
  createdBy: { id: string | null; label: string | null };
  createdAt: string;
  endedAt?: string;
  endedBy?: { id: string | null; label: string | null };
  endReason?: string;
}

export const freezeInput = z
  .object({
    title: z.string().trim().min(3).max(120),
    reason: z.string().trim().min(5).max(500),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    effect: z.enum(["deny", "require_approval"]).default("deny"),
    minRiskLevel: z.enum(RISK_ORDER).default("medium"),
    toolKeys: z.array(z.string().min(1).max(200)).max(100).default([]),
    agentIds: z.array(z.string().uuid()).max(200).default([]),
  })
  .refine((v) => v.endsAt > v.startsAt, { error: "The freeze must end after it starts", path: ["endsAt"] });

export function readFreezes(settings: unknown): ChangeFreeze[] {
  const list = (settings as { changeFreezes?: unknown } | null)?.changeFreezes;
  return Array.isArray(list) ? (list as ChangeFreeze[]) : [];
}

export function twoPersonRecovery(settings: unknown): boolean {
  return (settings as { twoPersonRecovery?: unknown } | null)?.twoPersonRecovery === true;
}

export function freezeIsActive(f: ChangeFreeze, now: Date): boolean {
  return !f.endedAt && new Date(f.startsAt) <= now && now < new Date(f.endsAt);
}

/** The freeze that applies to this request, the strictest first (a refusal beats a hold). */
export function activeFreezeFor(freezes: ChangeFreeze[], q: { now: Date; toolKey: string; toolRisk: string; agentId: string }): ChangeFreeze | null {
  const risk = RISK_ORDER.indexOf(q.toolRisk as RiskLevel);
  const matching = freezes.filter((f) => {
    if (!freezeIsActive(f, q.now)) return false;
    if (f.agentIds.length && !f.agentIds.includes(q.agentId)) return false;
    if (f.toolKeys.length) return f.toolKeys.includes(q.toolKey);
    // An unknown risk level is treated as in scope: fail closed.
    return risk < 0 || risk >= RISK_ORDER.indexOf(f.minRiskLevel);
  });
  return matching.find((f) => f.effect === "deny") ?? matching[0] ?? null;
}

export function freezeMessage(f: ChangeFreeze): string {
  return `Change freeze "${f.title}" is in force until ${f.endsAt.slice(0, 16).replace("T", " ")} UTC: ${f.reason}`;
}

async function loadSettings(db: TenantDb, orgId: string) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  return (org.settings ?? {}) as Record<string, unknown>;
}

export async function listFreezes(db: TenantDb, ctx: OrgContext): Promise<ChangeFreeze[]> {
  assertPermission(ctx, "gateway:read");
  return readFreezes(await loadSettings(db, ctx.orgId)).sort((a, b) => b.startsAt.localeCompare(a.startsAt));
}

export async function createFreeze(db: TenantDb, ctx: OrgContext, input: unknown): Promise<ChangeFreeze> {
  assertPermission(ctx, "agents:control");
  const v = freezeInput.parse(input);
  const now = ctx.now ?? new Date();
  if (v.endsAt <= now) throw new AegisError("validation", "The freeze has already ended");
  const settings = await loadSettings(db, ctx.orgId);
  const freezes = readFreezes(settings);
  if (v.agentIds.length) {
    const found = await db.agent.count({ where: { orgId: ctx.orgId, id: { in: v.agentIds } } });
    if (found !== v.agentIds.length) throw notFound("Agent");
  }
  const freeze: ChangeFreeze = {
    id: crypto.randomUUID(),
    title: v.title,
    reason: v.reason,
    startsAt: v.startsAt.toISOString(),
    endsAt: v.endsAt.toISOString(),
    effect: v.effect,
    minRiskLevel: v.minRiskLevel,
    toolKeys: v.toolKeys,
    agentIds: v.agentIds,
    createdBy: { id: ctx.actor.id ?? null, label: ctx.actor.label ?? null },
    createdAt: now.toISOString(),
  };
  // Keep the list bounded: drop freezes that ended more than a year ago (their evidence stays in the ledger).
  const cutoff = new Date(now.getTime() - 365 * 24 * 3600 * 1000);
  const kept = freezes.filter((f) => new Date(f.endedAt ?? f.endsAt) > cutoff);
  await db.organization.update({ where: { id: ctx.orgId }, data: { settings: { ...settings, changeFreezes: [...kept, freeze] } as unknown as Prisma.InputJsonValue } });
  await appendEvidence(db, ctx, { type: "gateway.freeze_created", subjectType: "organization", subjectId: ctx.orgId, payload: { freezeId: freeze.id, title: freeze.title, reason: freeze.reason, startsAt: freeze.startsAt, endsAt: freeze.endsAt, effect: freeze.effect, minRiskLevel: freeze.minRiskLevel, toolKeys: freeze.toolKeys, agentIds: freeze.agentIds } });
  return freeze;
}

/** Ends a freeze before its scheduled end. Loosens control, so it is recorded with a reason. */
export async function endFreeze(db: TenantDb, ctx: OrgContext, freezeId: string, reason: string): Promise<ChangeFreeze> {
  assertPermission(ctx, "agents:control");
  if (reason.trim().length < 5) throw new AegisError("validation", "A reason of at least 5 characters is required");
  const now = ctx.now ?? new Date();
  const settings = await loadSettings(db, ctx.orgId);
  const freezes = readFreezes(settings);
  const f = freezes.find((x) => x.id === freezeId);
  if (!f) throw notFound("Change freeze");
  if (f.endedAt || new Date(f.endsAt) <= now) throw new AegisError("conflict", "This freeze has already ended");
  if (twoPersonRecovery(settings) && f.createdBy.id && f.createdBy.id === ctx.actor.id) throw forbidden("Two-person recovery is on: a different person must end the freeze");
  const ended: ChangeFreeze = { ...f, endedAt: now.toISOString(), endedBy: { id: ctx.actor.id ?? null, label: ctx.actor.label ?? null }, endReason: reason.trim() };
  await db.organization.update({ where: { id: ctx.orgId }, data: { settings: { ...settings, changeFreezes: freezes.map((x) => (x.id === freezeId ? ended : x)) } as unknown as Prisma.InputJsonValue } });
  await appendEvidence(db, ctx, { type: "gateway.freeze_ended", subjectType: "organization", subjectId: ctx.orgId, payload: { freezeId, title: f.title, reason: ended.endReason, scheduledEnd: f.endsAt } });
  return ended;
}

/** Turns two-person recovery on or off. Turning it off loosens control, so it needs org:admin and a reason either way. */
export async function setTwoPersonRecovery(db: TenantDb, ctx: OrgContext, input: { enabled: boolean; reason: string }) {
  assertPermission(ctx, "org:admin");
  if (input.reason.trim().length < 5) throw new AegisError("validation", "A reason of at least 5 characters is required");
  const settings = await loadSettings(db, ctx.orgId);
  await db.organization.update({ where: { id: ctx.orgId }, data: { settings: { ...settings, twoPersonRecovery: input.enabled } as unknown as Prisma.InputJsonValue } });
  await appendEvidence(db, ctx, { type: "gateway.two_person_recovery_set", subjectType: "organization", subjectId: ctx.orgId, payload: { enabled: input.enabled, reason: input.reason.trim() } });
  return { enabled: input.enabled };
}
