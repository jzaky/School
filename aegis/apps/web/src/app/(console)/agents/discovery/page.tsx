import type { Metadata } from "next";
import { withTenant } from "@aegis/db";
import { listDiscoveredAgents } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { DemoBadge } from "@/components/ui/demo-badge";
import { DiscoveryTable } from "@/components/agents/discovery-table";

export const metadata: Metadata = { title: "Agent discovery" };
export const dynamic = "force-dynamic";

export default async function DiscoveryPage() {
  const c = await requirePermission("agents:read");
  const { rows, agents } = await withTenant(c.ctx.orgId, async (db) => ({ rows: await listDiscoveredAgents(db, c.ctx), agents: await db.agent.findMany({ where: { orgId: c.ctx.orgId, status: { not: "archived" } }, select: { id: true, name: true }, orderBy: { name: "asc" } }) }), { readOnly: true });
  const unregistered = rows.filter((r) => r.status === "unregistered").length;
  return (
    <div>
      <PageHeader title="Agent discovery" badges={<DemoBadge show={c.org.demoMode} />} description="AI agents your systems have reported seeing. Ones that match a registered agent are linked; the rest need a person to register, link or dismiss them. Agents no system reports stay invisible here." />
      <Panel title={unregistered ? `${unregistered} not in the registry` : "Everything reported is accounted for"} description="Systems report agents with an integration key (POST /v1/identity/discovery/agents). AEGIS also records agents that show up in enforcement checks." padded={false}>
        <DiscoveryTable canWrite={c.can("agents:write")} agents={agents} rows={rows.map((r) => ({ id: r.id, name: r.name, platform: r.platform, source: r.source.replace(/^integration:[0-9a-f-]{36}:/, ""), externalId: r.externalId, status: r.status, observations: r.observations, firstSeenAt: r.firstSeenAt.toISOString(), lastSeenAt: r.lastSeenAt.toISOString(), linkedAgent: agents.find((a) => a.id === r.linkedAgentId)?.name ?? null, note: r.note }))} />
      </Panel>
    </div>
  );
}
