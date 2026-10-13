import "server-only";
import { withTenant } from "@aegis/db";
import { approverEligibility, computeOnboarding, summarizeOnboarding, verifyChain } from "@aegis/core";
import type { ConsoleContext } from "@/server/session";
import { keyParams } from "@/lib/describe-request";

const STALE_EXECUTING_MS = 5 * 60_000;

export type OverviewData = Awaited<ReturnType<typeof loadOverview>>;

/** Everything the Overview shows, in one tenant transaction. Read-only. */
export async function loadOverview(c: ConsoleContext) {
  const orgId = c.ctx.orgId;
  const now = new Date();
  const staleBefore = new Date(now.getTime() - STALE_EXECUTING_MS);
  const canGateway = c.can("gateway:read");
  const canMonitoring = c.can("monitoring:read");
  const canIntegrations = c.can("integrations:read");
  return withTenant(
    orgId,
    async (db) => {
      const [agentsByStatus, openApprovals, staleRequests, alerts, suspended, integrations, recent, steps, evidenceCount] = await Promise.all([
        db.agent.groupBy({ by: ["status"], where: { isLab: false, orgId }, _count: { _all: true } }),
        canGateway
          ? db.approvalRequest.findMany({
              where: { orgId, status: { in: ["pending", "more_info", "escalated"] }, expiresAt: { gt: now } },
              orderBy: { expiresAt: "asc" },
              take: 12,
              include: { request: { include: { agent: { select: { id: true, name: true, businessOwnerId: true, technicalOwnerId: true } } } }, responses: { select: { userId: true, decision: true } } },
            })
          : [],
        canGateway
          ? db.actionRequest.findMany({ where: { orgId, OR: [{ status: "unknown" }, { status: "executing", updatedAt: { lt: staleBefore } }] }, orderBy: { updatedAt: "asc" }, take: 10, select: { id: true, status: true, toolKey: true, action: true, params: true, updatedAt: true, agent: { select: { id: true, name: true } } } })
          : [],
        canMonitoring ? db.alert.findMany({ where: { orgId, status: "open", severity: { in: ["high", "critical"] } }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, severity: true, title: true, createdAt: true, agentId: true } }) : [],
        db.agent.findMany({ where: { isLab: false, orgId, status: "suspended" }, orderBy: { statusChangedAt: "desc" }, take: 10, select: { id: true, name: true, statusReason: true, statusChangedAt: true } }),
        canIntegrations ? db.integration.findMany({ where: { orgId }, orderBy: { name: "asc" }, select: { id: true, name: true, status: true, settings: true, lastHealthAt: true, lastHealthOk: true, credentials: { where: { revokedAt: null }, select: { id: true } } } }) : [],
        canGateway ? db.actionRequest.findMany({ where: { orgId }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, status: true, toolKey: true, action: true, params: true, createdAt: true, agent: { select: { id: true, name: true } }, approvals: { select: { id: true }, take: 1 }, receipts: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true, downstreamReference: true } } } }) : [],
        computeOnboarding(db, c.ctx),
        db.evidenceEvent.count({ where: { orgId } }),
      ]);
      const chain = c.can("evidence:read") ? await verifyChain(db, orgId) : null;
      // Only approvals the signed-in person may decide belong under "Needs your attention".
      const decidable = [];
      for (const a of openApprovals) {
        const elig = await approverEligibility(db, c.ctx, a);
        if (!elig.canDecide) continue;
        const kp = keyParams(a.request.params);
        decidable.push({ id: a.id, requestId: a.actionRequestId, status: a.status, agentId: a.request.agent.id, agentName: a.request.agent.name, toolKey: a.request.toolKey, action: a.request.action, params: a.request.params, amount: kp.amount, currency: kp.currency, justification: a.request.justification, expiresAt: a.expiresAt.toISOString() });
      }
      const statusCount = Object.fromEntries(agentsByStatus.map((r) => [r.status, r._count._all])) as Partial<Record<string, number>>;
      const settings = c.org.settings as { gatewayPaused?: boolean; gatewayPausedReason?: string; gatewayPausedBy?: string };
      return {
        attention: {
          approvals: decidable,
          openApprovalsTotal: openApprovals.length,
          unresolved: staleRequests.map((r) => ({ id: r.id, status: r.status, agentId: r.agent.id, agentName: r.agent.name, toolKey: r.toolKey, action: r.action, params: r.params, updatedAt: r.updatedAt.toISOString() })),
          alerts: alerts.map((a) => ({ id: a.id, severity: a.severity, title: a.title, createdAt: a.createdAt.toISOString(), agentId: a.agentId })),
          suspended: suspended.map((a) => ({ id: a.id, name: a.name, reason: a.statusReason, since: a.statusChangedAt?.toISOString() ?? null })),
        },
        agents: { active: statusCount.active ?? 0, suspended: statusCount.suspended ?? 0, revoked: statusCount.revoked ?? 0, draft: (statusCount.draft ?? 0) + (statusCount.registered ?? 0), canView: c.can("agents:read") },
        integrations: {
          canView: canIntegrations,
          items: integrations.map((i) => {
            const s = (i.settings as { kind?: string; simulated?: boolean } | null) ?? {};
            const kind = s.kind === "sandbox" || s.kind === "simulated" || s.kind === "live" ? s.kind : s.simulated ? "simulated" : "unknown";
            return { id: i.id, name: i.name, status: i.status, kind, lastHealthAt: i.lastHealthAt?.toISOString() ?? null, lastHealthOk: i.lastHealthOk, liveCredentials: i.credentials.length };
          }),
        },
        gateway: { paused: !!settings.gatewayPaused, reason: settings.gatewayPausedReason ?? null, by: settings.gatewayPausedBy ?? null },
        recent: {
          canView: canGateway,
          items: recent.map((r) => {
            const kp = keyParams(r.params);
            return { id: r.id, status: r.status, agentId: r.agent.id, agentName: r.agent.name, toolKey: r.toolKey, action: r.action, params: r.params, amount: kp.amount, currency: kp.currency, createdAt: r.createdAt.toISOString(), hasApproval: r.approvals.length > 0, reference: r.receipts[0]?.downstreamReference ?? null };
          }),
        },
        onboarding: { steps, summary: summarizeOnboarding(steps, c.org.settings) },
        evidence: { count: evidenceCount, chain: chain ? { valid: chain.valid, checked: chain.checked, firstBadSeq: chain.firstBadSeq ?? null, checkpoints: chain.checkpoints.length } : null },
      };
    },
    { readOnly: true },
  );
}
