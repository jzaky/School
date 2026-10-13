import type { TenantDb } from "@aegis/db";
import type { OrgContext } from "../lib/context.js";
import { assertPermission } from "../orgs/orgs.js";

export interface PrivilegeRecommendation {
  kind: "unused_tool" | "unused_resource_action" | "unused_resource" | "classification_above_need" | "no_expiry_on_sensitive";
  agentId: string;
  agentSlug: string;
  detail: string;
  /** What to change, in plain words. Nothing is changed automatically. */
  suggestion: string;
  toolId?: string;
  permissionId?: string;
}

const CLASS_ORDER = ["public", "internal", "confidential", "restricted"];

/**
 * Narrower access, worked out from the last `days` of gateway traffic. These are suggestions for a
 * person: a tool used once a quarter may still be needed. Agents with no traffic at all in the
 * window get no suggestions (there is nothing to compare with).
 */
export async function leastPrivilegeRecommendations(db: TenantDb, ctx: OrgContext, opts: { agentId?: string; days?: number } = {}): Promise<PrivilegeRecommendation[]> {
  assertPermission(ctx, "agents:read");
  const days = opts.days ?? 30;
  const since = new Date((ctx.now ?? new Date()).getTime() - days * 86400_000);
  const agents = await db.agent.findMany({ where: { orgId: ctx.orgId, status: "active", ...(opts.agentId ? { id: opts.agentId } : {}) }, include: { tools: { where: { enabled: true, revokedAt: null }, include: { tool: true } }, permissions: { where: { revokedAt: null } } } });
  const out: PrivilegeRecommendation[] = [];
  for (const a of agents) {
    const used = await db.actionRequest.groupBy({ by: ["toolKey", "resourceKey", "action"], where: { agentId: a.id, createdAt: { gte: since } }, _count: { _all: true } });
    if (used.length === 0) continue;
    const toolsUsed = new Set(used.map((u) => u.toolKey));
    for (const t of a.tools) {
      if (!toolsUsed.has(t.tool.key)) out.push({ kind: "unused_tool", agentId: a.id, agentSlug: a.slug, toolId: t.toolId, detail: `${t.tool.key} was not requested in ${days} days`, suggestion: `Remove the grant for ${t.tool.key}; ask for temporary access if it is needed again` });
    }
    const resources = await db.resource.findMany({ where: { id: { in: a.permissions.map((p) => p.resourceId) } } });
    const byId = new Map(resources.map((r) => [r.id, r]));
    let highestUsed = 0;
    for (const p of a.permissions) {
      const r = byId.get(p.resourceId);
      if (!r) continue;
      const onResource = used.filter((u) => u.resourceKey === r.key);
      if (onResource.length === 0) {
        out.push({ kind: "unused_resource", agentId: a.id, agentSlug: a.slug, permissionId: p.id, detail: `No request touched ${r.key} in ${days} days`, suggestion: `Remove the permission on ${r.key}` });
        continue;
      }
      highestUsed = Math.max(highestUsed, CLASS_ORDER.indexOf(r.classification));
      const actionsUsed = new Set(onResource.map((u) => u.action));
      const unused = p.actions.filter((x) => x !== "*" && !actionsUsed.has(x));
      if (p.actions.includes("*")) out.push({ kind: "unused_resource_action", agentId: a.id, agentSlug: a.slug, permissionId: p.id, detail: `All actions are allowed on ${r.key}; only ${[...actionsUsed].join(", ")} were used`, suggestion: `Replace "*" on ${r.key} with ${[...actionsUsed].join(", ")}` });
      else if (unused.length) out.push({ kind: "unused_resource_action", agentId: a.id, agentSlug: a.slug, permissionId: p.id, detail: `${unused.join(", ")} on ${r.key} not used in ${days} days`, suggestion: `Limit ${r.key} to ${[...actionsUsed].join(", ")}` });
      if ((r.classification === "restricted" || r.classification === "confidential") && !p.expiresAt) out.push({ kind: "no_expiry_on_sensitive", agentId: a.id, agentSlug: a.slug, permissionId: p.id, detail: `Permission on ${r.classification} ${r.key} never expires`, suggestion: "Give it an end date and renew it through temporary access" });
    }
    const limit = CLASS_ORDER.indexOf(a.dataClassificationLimit);
    if (a.permissions.length && limit > highestUsed) out.push({ kind: "classification_above_need", agentId: a.id, agentSlug: a.slug, detail: `Limited to ${a.dataClassificationLimit} data but used nothing above ${CLASS_ORDER[highestUsed]} in ${days} days`, suggestion: `Lower the data classification limit to ${CLASS_ORDER[highestUsed]}` });
  }
  return out;
}
