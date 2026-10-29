import type { Metadata } from "next";
import { Flag } from "lucide-react";
import { withTenant } from "@aegis/db";
import { PILOT_KITS, PILOT_MEASURES, pilotReport, readWatchOnly } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { Badge } from "@/components/ui/badge";
import { DemoBadge } from "@/components/ui/demo-badge";
import { Note } from "@/components/ui/note";
import { EmptyState } from "@/components/ui/empty-state";
import { StatPanel } from "@/components/ui/stat-panel";
import { SimpleTable, Td, Th } from "@/components/ui/simple-table";
import { PeriodSelector } from "@/components/assurance/report-actions";
import { InstallKitButton, WatchOnlyToggle } from "@/components/pilots/pilot-controls";

export const metadata: Metadata = { title: "Pilots" };
export const dynamic = "force-dynamic";

const WINDOWS = [7, 30, 90] as const;
const OUTCOME: Record<string, string> = { require_approval: "Held for a person", deny: "Refused", quarantine: "Quarantined", request_more_information: "Asked for more information", restrict: "Narrowed" };

export default async function PilotsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const c = await requirePermission("reports:read");
  const { days: raw } = await searchParams;
  const days = WINDOWS.find((d) => String(d) === raw) ?? 30;
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  const { report, agents, installed } = await withTenant(
    c.ctx.orgId,
    async (db) => {
      const agents = await db.agent.findMany({ where: { isLab: false, status: { in: ["active", "suspended"] } }, orderBy: { name: "asc" }, select: { id: true, name: true, slug: true, metadata: true } });
      const report = await pilotReport(db, c.ctx, { from, to });
      const installed = new Set(agents.map((a) => (a.metadata as { pilotKit?: string } | null)?.pilotKit).filter(Boolean) as string[]);
      return { report, agents, installed };
    },
    { readOnly: true },
  );
  const canInstall = c.can("agents:write") && c.can("policies:activate");
  const watching = agents.filter((a) => readWatchOnly(a.metadata));
  return (
    <div>
      <PageHeader title="Pilots" description="Start a pilot from a tested sector kit, run it in watch-only mode, then switch enforcement on. Every figure below comes from this organization's own records." badges={<DemoBadge show={c.org.demoMode} />} />
      <Note tone="info" className="mb-4">
        Watch-only mode lets actions proceed and records what AEGIS would have done, so an entity sees the effect on its own work before anything changes. Hard controls stay on in watch-only mode: unknown agents and tools, a paused gateway, tampered policies and data protection blocks are still refused.
      </Note>

      <Panel title="Pilot report" description={`Last ${days} days`} actions={<PeriodSelector days={days} />} className="mb-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="pilot-report">
          <StatPanel label="Actions" value={report.actions.total} hint="Actions agents asked AEGIS to authorize in this window" />
          <StatPanel label="Decided without a person" value={report.decisions.decidedWithoutPerson} tone="allow" hint="Allowed or narrowed by policy alone" />
          <StatPanel label="Would have been stopped" value={report.watchOnly.passed} tone="approval" hint="Watch-only actions AEGIS would have held, narrowed or refused" />
          <StatPanel label="Ran without permission" value={report.executedWithoutPermission} tone={report.executedWithoutPermission ? "critical" : "allow"} hint="Executions with no consumed AEGIS permission. Must be zero." />
          <StatPanel label="Approvals" value={report.approvals.total} hint={report.approvals.medianMinutesToDecision === null ? "No decided approvals yet" : `Median ${report.approvals.medianMinutesToDecision} minutes to a decision`} />
          <StatPanel label="Security events" value={report.security.total} tone={report.security.total ? "deny" : "neutral"} hint="Attacks and policy violations recorded (lab runs excluded)" />
          <StatPanel label="Evidence ledger" value={report.ledger.valid ? "Verified" : "Failed"} tone={report.ledger.valid ? "allow" : "critical"} hint={`${report.ledger.checked} records rechecked`} />
          <StatPanel label="Agents in watch-only" value={watching.length} tone="info" />
        </div>
        {Object.keys(report.watchOnly.wouldHave).length > 0 ? (
          <p className="mt-3 text-sm text-fg-muted" data-testid="pilot-would-have">
            In watch-only mode AEGIS would have:{" "}
            {Object.entries(report.watchOnly.wouldHave)
              .map(([k, v]) => `${OUTCOME[k] ?? k}: ${v}`)
              .join(", ")}
            .
          </p>
        ) : null}
      </Panel>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Panel title="Sector kits" description="Each kit is an agent, its tools and starting policies, proven in the sector validation lab. Review thresholds with the entity before enforcing.">
            <div className="grid gap-3 md:grid-cols-2" data-testid="pilot-kits">
              {PILOT_KITS.map((k) => (
                <div key={k.key} className="flex flex-col gap-2 rounded-md border border-line p-3" data-testid={`pilot-kit-${k.key}`}>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-medium">{k.name}</h3>
                    {installed.has(k.key) ? <Badge tone="allow">Installed</Badge> : null}
                  </div>
                  <p className="text-xs text-fg-muted">{k.problem}</p>
                  <p className="text-xs text-fg-dim">
                    {k.scenarios.length} tested scenarios. Evidence maps to {k.frameworks.length} frameworks, including the UAE Information Assurance Regulation and Dubai ISR.
                  </p>
                  <div className="mt-auto">
                    <InstallKitButton kitKey={k.key} kitName={k.name} canInstall={canInstall} />
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
        <div className="space-y-4">
          <Panel title="Watch-only agents" description="Switch each agent to enforcing when the entity is ready">
            {agents.length === 0 ? (
              <EmptyState icon={Flag} title="No agents yet" description="Install a sector kit, or register your own agent first." />
            ) : (
              <SimpleTable caption="Agents and their mode">
                <thead>
                  <tr>
                    <Th>Agent</Th>
                    <Th>Mode</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {agents.map((a) => {
                    const w = readWatchOnly(a.metadata);
                    return (
                      <tr key={a.id} className="border-b border-line last:border-0">
                        <Td>{a.name}</Td>
                        <Td>{w ? <Badge tone="approval">Watch-only</Badge> : <Badge tone="allow">Enforcing</Badge>}</Td>
                        <Td>
                          <WatchOnlyToggle agentId={a.id} agentName={a.name} enabled={!!w} canEnable={c.can("policies:activate")} canDisable={c.can("agents:control")} />
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </SimpleTable>
            )}
          </Panel>
          <Panel title="What every pilot measures">
            <ul className="list-disc space-y-1 ps-4 text-sm text-fg-muted">
              {PILOT_MEASURES.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
