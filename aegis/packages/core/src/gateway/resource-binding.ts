import type { Prisma, TenantDb } from "@aegis/db";
import { z } from "zod";
import { appendEvidence } from "../evidence/ledger.js";
import type { OrgContext } from "../lib/context.js";
import { forbidden, validation } from "../lib/errors.js";
import { hasPermission } from "../identity/permissions.js";

/**
 * Resource binding (audit P2-3). An agent names the resource it acts on in the request's `resource` field; the
 * downstream system acts on whatever the parameters say. A binding rule ties the two together: the resource
 * the agent claims must be the one its parameters actually address, either exactly (the parameter holds the
 * resource key) or through an explicit mapping (parameter value to resource key).
 *
 * Optional and configured per organization, narrowed by agent, tool and action. A rule runs in audit mode
 * (recorded, never blocks) or enforce mode (a mismatch is refused at the door). It fails closed: when a rule
 * applies and the claimed resource or the parameter is missing, or the value maps to no resource, that is a
 * violation, not a pass.
 *
 * Tamper resistance: the actual resource is read only from the request parameters, which are what the grant is
 * bound to (its hash covers them) and what the downstream system receives. `context`, justification and every
 * other piece of request metadata are ignored. Rules live in organization settings that only a person with
 * policies:activate can change (setResourceBindings); ordinary settings saves cannot touch them.
 */
const ruleId = z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/, "lowercase letters, digits and hyphens");
export const resourceBindingRuleSchema = z
  .object({
    id: ruleId,
    description: z.string().max(300).default(""),
    enabled: z.boolean().default(true),
    mode: z.enum(["audit", "enforce"]).default("audit"),
    /** Empty means every agent, tool or action. */
    scope: z
      .object({
        agentIds: z.array(z.string().uuid()).max(100).default([]),
        tools: z.array(z.string().min(1).max(80)).max(100).default([]),
        actions: z.array(z.string().min(1).max(80)).max(50).default([]),
      })
      .default({ agentIds: [], tools: [], actions: [] }),
    /** Dot path into the request parameters, for example "accountId" or "target.account". */
    param: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*){0,4}$/, "a dot path of parameter names"),
    match: z.enum(["exact", "mapped"]).default("exact"),
    /** For mapped: parameter value to resource key. */
    map: z.record(z.string().min(1).max(200), z.string().min(1).max(100)).default({}),
  })
  .refine((r) => r.match !== "mapped" || Object.keys(r.map).length > 0, { message: "A mapped rule needs at least one mapping", path: ["map"] });

export type ResourceBindingRule = z.infer<typeof resourceBindingRuleSchema> & { version: number; updatedAt: string; updatedBy: string | null };
export type BindingOutcome = "match" | "mismatch" | "missing_claim" | "missing_param" | "unmapped";
export interface BindingCheck {
  ruleId: string;
  version: number;
  mode: "audit" | "enforce";
  param: string;
  claimed: string | null;
  actual: string | null;
  outcome: BindingOutcome;
}

const SETTINGS_KEY = "resourceBindings";

export function readResourceBindings(settings: unknown): ResourceBindingRule[] {
  const raw = (settings as Record<string, unknown> | null)?.[SETTINGS_KEY];
  if (!Array.isArray(raw)) return [];
  const out: ResourceBindingRule[] = [];
  for (const r of raw) {
    const p = resourceBindingRuleSchema.safeParse(r);
    const meta = r as { version?: unknown; updatedAt?: unknown; updatedBy?: unknown };
    if (p.success && typeof meta.version === "number") out.push({ ...p.data, version: meta.version, updatedAt: String(meta.updatedAt ?? ""), updatedBy: typeof meta.updatedBy === "string" ? meta.updatedBy : null });
  }
  return out;
}

function valueAt(params: Record<string, unknown>, path: string): unknown {
  let v: unknown = params;
  for (const k of path.split(".")) {
    if (v === null || typeof v !== "object" || Array.isArray(v) || !Object.prototype.hasOwnProperty.call(v, k)) return undefined;
    v = (v as Record<string, unknown>)[k];
  }
  return v;
}

/** Pure: every enabled rule that applies to this request, with what it found. */
export function evaluateResourceBindings(rules: ResourceBindingRule[], req: { agentId: string; toolKey: string; action: string; claimed: string | null; params: Record<string, unknown> }): BindingCheck[] {
  const checks: BindingCheck[] = [];
  for (const r of rules) {
    if (!r.enabled) continue;
    if (r.scope.agentIds.length && !r.scope.agentIds.includes(req.agentId)) continue;
    if (r.scope.tools.length && !r.scope.tools.includes(req.toolKey)) continue;
    if (r.scope.actions.length && !r.scope.actions.includes(req.action)) continue;
    const raw = valueAt(req.params, r.param);
    const value = typeof raw === "string" ? raw : typeof raw === "number" && Number.isFinite(raw) ? String(raw) : null;
    const actual = value === null ? null : r.match === "exact" ? value : Object.prototype.hasOwnProperty.call(r.map, value) ? r.map[value]! : null;
    const claimed = req.claimed && req.claimed.trim() ? req.claimed : null;
    const outcome: BindingOutcome = !claimed ? "missing_claim" : value === null ? "missing_param" : actual === null ? "unmapped" : actual === claimed ? "match" : "mismatch";
    checks.push({ ruleId: r.id, version: r.version, mode: r.mode, param: r.param, claimed, actual, outcome });
  }
  return checks;
}

const WHY: Record<Exclude<BindingOutcome, "match">, (c: BindingCheck) => string> = {
  mismatch: (c) => `The request claims resource ${c.claimed} but its parameter ${c.param} addresses ${c.actual}`,
  missing_claim: (c) => `Resource binding ${c.ruleId} applies and the request names no resource`,
  missing_param: (c) => `Resource binding ${c.ruleId} applies and parameter ${c.param} is missing or not a plain value`,
  unmapped: (c) => `Parameter ${c.param} does not map to any resource under binding ${c.ruleId}`,
};
export function bindingMessage(c: BindingCheck): string {
  return c.outcome === "match" ? "" : WHY[c.outcome](c);
}

/**
 * Replaces the organization's binding rules. A person with policies:activate only. Rules whose content changed
 * get a new version; unchanged rules keep theirs, so a decision records exactly which rule version applied.
 */
export async function setResourceBindings(db: TenantDb, ctx: OrgContext, raw: unknown): Promise<ResourceBindingRule[]> {
  if (ctx.actor.type !== "user" || !ctx.actor.id) throw forbidden("Only a person can change resource bindings");
  if (!hasPermission(ctx.actor.permissions, "policies:activate")) throw forbidden("Missing permission policies:activate");
  const parsed = z.array(resourceBindingRuleSchema).max(50).parse(raw);
  const ids = parsed.map((r) => r.id);
  if (new Set(ids).size !== ids.length) throw validation("Rule ids must be unique");
  await db.$queryRawUnsafe(`SELECT 1 FROM organizations WHERE id = $1::uuid FOR UPDATE`, ctx.orgId);
  const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { settings: true } });
  const settings = (org.settings ?? {}) as Record<string, unknown>;
  const before = new Map(readResourceBindings(settings).map((r) => [r.id, r]));
  const now = (ctx.now ?? new Date()).toISOString();
  const strip = (r: ResourceBindingRule | z.infer<typeof resourceBindingRuleSchema>) => JSON.stringify({ ...r, version: undefined, updatedAt: undefined, updatedBy: undefined });
  const next: ResourceBindingRule[] = parsed.map((r) => {
    const prev = before.get(r.id);
    if (prev && strip(prev) === strip(r)) return prev;
    return { ...r, version: (prev?.version ?? 0) + 1, updatedAt: now, updatedBy: ctx.actor.id };
  });
  await db.organization.update({ where: { id: ctx.orgId }, data: { settings: { ...settings, [SETTINGS_KEY]: next } as Prisma.InputJsonValue } });
  await appendEvidence(db, ctx, { type: "resource_binding.rules_set", subjectType: "organization", subjectId: ctx.orgId, payload: { rules: next.map((r) => ({ id: r.id, version: r.version, mode: r.mode, enabled: r.enabled, param: r.param, match: r.match })), removed: [...before.keys()].filter((id) => !ids.includes(id)) } });
  return next;
}
