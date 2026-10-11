import "server-only";
import { withTenant } from "@aegis/db";
import { verifyChain } from "@aegis/core";
import type { ConsoleContext } from "@/server/session";
import { userNames } from "./users";

export async function loadOverview(c: ConsoleContext) {
  const orgId = c.ctx.orgId;
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000);
  return withTenant(orgId, async (db) => {
    const [agentsByStatus, requests, decisions, awaiting, openAlerts, openIncidents, evidenceCount, members, recentEvidence, attention] = await Promise.all([
      db.agent.groupBy({ by: ["status"], where: { orgId }, _count: { _all: true } }),
      db.actionRequest.count({ where: { orgId } }),
      db.authorizationDecision.groupBy({ by: ["result"], where: { orgId }, _count: { _all: true } }),
      db.actionRequest.count({ where: { orgId, status: "pending_approval" } }),
      db.alert.count({ where: { orgId, status: "open" } }),
      db.incident.count({ where: { orgId, status: { not: "resolved" } } }),
      db.evidenceEvent.count({ where: { orgId } }),
      db.membership.count({ where: { orgId, status: "active" } }),
      db.evidenceEvent.findMany({ where: { orgId }, orderBy: { seq: "desc" }, take: 15 }),
      db.agent.findMany({ where: { orgId, OR: [{ status: "suspended" }, { status: "draft", createdAt: { lt: sevenDaysAgo } }] }, orderBy: { statusChangedAt: "desc" }, select: { id: true, name: true, slug: true, status: true, statusReason: true, statusChangedAt: true, createdAt: true, riskTier: true } }),
    ]);
    const chain = await verifyChain(db, orgId);
    const statusCount = Object.fromEntries(agentsByStatus.map((r) => [r.status, r._count._all])) as Partial<Record<string, number>>;
    const decisionCount = Object.fromEntries(decisions.map((r) => [r.result, r._count._all])) as Partial<Record<string, number>>;
    const subjectAgentIds = recentEvidence.filter((e) => e.subjectType === "agent" && e.subjectId).map((e) => e.subjectId!);
    const actorAgentIds = recentEvidence.filter((e) => e.actorType === "agent" && e.actorId).map((e) => e.actorId!);
    const agents = subjectAgentIds.length + actorAgentIds.length ? await db.agent.findMany({ where: { id: { in: [...new Set([...subjectAgentIds, ...actorAgentIds])] } }, select: { id: true, name: true } }) : [];
    const agentName = new Map(agents.map((a) => [a.id, a.name]));
    const names = await userNames(recentEvidence.filter((e) => e.actorType === "user").map((e) => e.actorId));
    return {
      agents: {
        registered: Object.entries(statusCount).reduce((n, [s, v]) => (s === "archived" ? n : n + (v ?? 0)), 0),
        active: statusCount.active ?? 0,
        suspended: statusCount.suspended ?? 0,
        byStatus: (["draft", "registered", "active", "suspended", "revoked", "archived"] as const).map((s) => ({ status: s, count: statusCount[s] ?? 0 })),
      },
      requests: { total: requests, allowed: decisionCount.allow ?? 0, denied: decisionCount.deny ?? 0, awaiting },
      openAlerts,
      openIncidents,
      evidence: { count: evidenceCount, chain },
      members,
      recentEvidence: recentEvidence.map((e) => ({
        id: e.id,
        seq: e.seq.toString(),
        type: e.type,
        actorType: e.actorType,
        actor: e.actorType === "user" ? (names.get(e.actorId ?? "") ?? "User") : e.actorType === "agent" ? (agentName.get(e.actorId ?? "") ?? "Agent") : e.actorType,
        subjectType: e.subjectType,
        subjectId: e.subjectId,
        subjectLabel: e.subjectType === "agent" ? (agentName.get(e.subjectId ?? "") ?? null) : null,
        occurredAt: e.occurredAt.toISOString(),
      })),
      attention: attention.map((a) => ({ ...a, statusChangedAt: a.statusChangedAt?.toISOString() ?? null, createdAt: a.createdAt.toISOString() })),
    };
  });
}
