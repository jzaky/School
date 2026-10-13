import type { Metadata } from "next";
import Link from "next/link";
import { withTenant } from "@aegis/db";
import { autonomyAnalytics, readAutonomySettings, AUTONOMY_LEVEL_INFO, type AutonomyLevel } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { DemoBadge } from "@/components/ui/demo-badge";
import { Badge } from "@/components/ui/badge";
import { Timeline } from "@/components/ui/timeline";
import { AutonomySettingsForm } from "@/components/agents/autonomy-settings";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Autonomy" };
export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = { lowered: "lowered", raised: "raised after a second person approved", automatic_downgrade: "lowered automatically" };
const EFFECT_LABEL: Record<string, string> = {
  autonomy_observe_only: "Not executed (level 0, observe only)",
  autonomy_every_action: "Sent to approval (level 1)",
  autonomy_tool_risk: "Sent to approval (tool risk above the level)",
  autonomy_above_ceiling: "Sent to approval (amount above the ceiling)",
  autonomy_no_ceiling: "Sent to approval (level 2, no ceiling set)",
  autonomy_currency: "Sent to approval (amount in another currency)",
};

export default async function AutonomyPage() {
  const c = await requirePermission("agents:read");
  const stats = await withTenant(c.ctx.orgId, (db) => autonomyAnalytics(db, c.ctx, 30), { readOnly: true });
  const settings = readAutonomySettings(c.org.settings);
  const active = stats.byLevel.reduce((n, l) => n + l.agents, 0);
  return (
    <div>
      <PageHeader
        title="Autonomy"
        badges={<DemoBadge show={c.org.demoMode} />}
        description="How much each agent may do without a person, as levels 0 to 4 that the Action Gateway enforces after the policies decide. A level only ever makes a decision stricter. Lowering is immediate; raising needs a second person."
      />
      <div className="mb-4 grid gap-4 lg:grid-cols-5" data-testid="autonomy-levels">
        {stats.byLevel.map((l) => (
          <Panel key={l.level} title={`Level ${l.level}`} description={l.name}>
            <p className="text-2xl font-semibold tabular text-fg" data-level-count={l.level}>
              {l.agents}
            </p>
            <p className="text-xs text-fg-muted">{l.agents === 1 ? "active agent" : "active agents"}</p>
          </Panel>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Panel title="Agents" description={`${active} active. Open an agent to change its level, simulate a change or decide a raise.`} padded={false}>
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line text-start text-xs text-fg-muted">
                  <th className="h-9 px-3 text-start font-medium">Agent</th>
                  <th className="h-9 px-3 text-start font-medium">Level</th>
                  <th className="h-9 px-3 text-end font-medium">Ceiling</th>
                  <th className="h-9 px-3 text-end font-medium">Changed</th>
                </tr>
              </thead>
              <tbody>
                {stats.agents.map((a) => (
                  <tr key={a.id} className="border-b border-line last:border-0" data-agent-row={a.name}>
                    <td className="h-9 px-3">
                      <Link href={`/agents/${a.id}?tab=autonomy`} className="text-accent hover:underline">
                        {a.name}
                      </Link>
                      {a.status !== "active" ? <span className="ms-2 text-xs text-fg-muted">({a.status})</span> : null}
                    </td>
                    <td className="h-9 px-3">
                      <Badge tone={a.autonomyLevel >= 3 ? "allow" : a.autonomyLevel >= 1 ? "approval" : "deny"}>{`Level ${a.autonomyLevel}: ${AUTONOMY_LEVEL_INFO[a.autonomyLevel as AutonomyLevel]?.name ?? ""}`}</Badge>
                    </td>
                    <td className="h-9 px-3 text-end tabular">{a.autonomyCeilingAmount == null ? "none" : a.autonomyCeilingAmount.toLocaleString("en-US")}</td>
                    <td className="h-9 px-3 text-end text-xs text-fg-muted">{a.autonomyChangedAt ? formatDateTime(a.autonomyChangedAt) : "never"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
          <Panel title="What the levels did, last 30 days" description="Decisions where an agent's level made the outcome stricter than the policies alone">
            <p className="text-sm text-fg" data-testid="autonomy-effects">
              {stats.decisions.changedByLevel} of {stats.decisions.total} decisions were made stricter by an autonomy level.
            </p>
            {Object.keys(stats.decisions.effects).length ? (
              <ul className="mt-2 space-y-1 text-sm">
                {Object.entries(stats.decisions.effects).map(([k, n]) => (
                  <li key={k} className="flex justify-between gap-3">
                    <span className="text-fg-muted">{EFFECT_LABEL[k] ?? k}</span>
                    <span className="tabular">{n}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </Panel>
          <Panel title="Changes, last 30 days" description={`${stats.transitionCounts.lowered ?? 0} lowered, ${stats.transitionCounts.raised ?? 0} raised, ${stats.transitionCounts.automatic_downgrade ?? 0} lowered automatically`}>
            <Timeline
              emptyText="No agent's level changed in the last 30 days."
              items={stats.transitions.slice(0, 20).map((t) => ({ id: t.id, tone: t.toLevel < t.fromLevel ? "deny" : "allow", title: `${t.agentName}: level ${t.fromLevel} to ${t.toLevel}, ${KIND_LABEL[t.kind] ?? t.kind}`, meta: t.reason, time: formatDateTime(t.createdAt) }))}
            />
          </Panel>
        </div>
        <div className="space-y-4">
          <Panel title="Waiting for a second person" description="Raise requests open now">
            {stats.pending.length === 0 ? (
              <p className="text-sm text-fg-muted">No raise is waiting.</p>
            ) : (
              <ul className="space-y-2 text-sm" data-testid="autonomy-pending">
                {stats.pending.map((p) => (
                  <li key={p.id}>
                    <Link href={`/agents/${p.agentId}?tab=autonomy`} className="text-accent hover:underline">
                      {p.agentName}
                    </Link>
                    : level {p.fromLevel} to {p.toLevel}
                    <span className="block text-xs text-fg-muted">{p.reason}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Automatic downgrades" description="Rules that lower an agent's level by themselves. Off until an administrator turns them on.">
            <AutonomySettingsForm initial={settings} canAdmin={c.can("org:admin")} />
          </Panel>
        </div>
      </div>
    </div>
  );
}
