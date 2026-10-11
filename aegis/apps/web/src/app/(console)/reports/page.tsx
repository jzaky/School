import type { Metadata } from "next";
import Link from "next/link";
import { withTenant } from "@aegis/db";
import { complianceMappingSummary, governanceReport, governanceTimeSeries, observedTechnicalControls } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { DemoBadge } from "@/components/ui/demo-badge";
import { StatPanel } from "@/components/ui/stat-panel";
import { Panel } from "@/components/ui/panel";
import { Badge } from "@/components/ui/badge";
import { StatusCell } from "@/components/ui/status";
import { Note } from "@/components/ui/note";
import { SimpleTable, Td, Th, Tr } from "@/components/ui/simple-table";
import { Timeline } from "@/components/ui/timeline";
import { PeriodSelector, ReportActions } from "@/components/assurance/report-actions";
import { AlertsBySeverityChart, DecisionsChart } from "@/components/assurance/report-charts";
import { formatDateTime, timeAgo } from "@/lib/utils";
import { statusLabel, statusTone } from "@/lib/status";

export const metadata: Metadata = { title: "Governance Reports" };
export const dynamic = "force-dynamic";

const CONTROL_TONE: Record<string, "allow" | "approval" | "deny" | "neutral"> = { observed: "allow", partial: "approval", gap: "deny", failed: "deny", no_data: "neutral" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const c = await requirePermission("reports:read");
  const { days: raw } = await searchParams;
  const days = [7, 30, 90].includes(Number(raw)) ? Number(raw) : 30;
  const canGateway = c.can("gateway:read");
  const { report, series, controls, frameworks } = await withTenant(c.ctx.orgId, async (db) => {
    const [report, series, controls, frameworks] = await Promise.all([governanceReport(db, c.ctx, days), canGateway ? governanceTimeSeries(db, c.ctx, days) : [], observedTechnicalControls(db, c.ctx), complianceMappingSummary(db, c.ctx)]);
    return { report, series, controls, frameworks };
  }, { timeout: 60_000 });
  const m = report.metrics;
  const alertRows = ["critical", "high", "medium", "low"].map((s) => ({ severity: s, open: report.alerts.filter((a) => a.severity === s && a.status === "open").reduce((n, a) => n + a.count, 0), handled: report.alerts.filter((a) => a.severity === s && a.status !== "open").reduce((n, a) => n + a.count, 0) }));
  const observed = "Automatically observed";
  return (
    <div className="print-report">
      <style>{`@media print { aside, header, nav, [data-print-hide] { display: none !important; } html, body { background: #fff !important; color: #111 !important; } .print-report, .print-report * { color: #111 !important; border-color: #ccc !important; background: #fff !important; } .print-report a { text-decoration: none; } main { padding: 0 !important; } }`}</style>
      <PageHeader
        title="Governance Reports"
        description={`Generated ${formatDateTime(report.generatedAt)} for ${c.org.name}, period ${days} days. Every figure is a count over AEGIS records.`}
        badges={
          <>
            <Badge tone="info">{observed}</Badge>
            <DemoBadge show={c.org.demoMode} />
          </>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2" data-print-hide>
            <PeriodSelector days={days} />
            <ReportActions days={days} />
          </div>
        }
      />
      <Note tone="warning" className="mb-4">
        {report.disclaimer}
      </Note>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatPanel label="Actions evaluated" value={m.actions.evaluated} footer={observed} />
        <StatPanel label="Allowed" value={m.actions.allowed} tone="allow" footer={observed} />
        <StatPanel label="Denied" value={m.actions.denied} tone={m.actions.denied ? "deny" : undefined} footer={observed} />
        <StatPanel label="Approval required" value={m.actions.approvalRequired} tone={m.actions.approvalRequired ? "approval" : undefined} footer={`${m.actions.awaitingApproval} awaiting now`} />
        <StatPanel label="Executed" value={m.actions.executed} tone="allow" footer={`${m.actions.failed} failed`} />
        <StatPanel label="Policy violations" value={m.policyViolations} tone={m.policyViolations ? "deny" : undefined} footer={`${m.highRiskEvents} high or critical`} />
        <StatPanel label="Active agents" value={m.agents.active} footer={`${m.agents.suspended} suspended, ${m.agents.revoked} revoked`} />
        <StatPanel label="Active policies" value={m.activePolicies} footer={observed} />
        <StatPanel label="Open alerts" value={m.openAlerts} tone={m.openAlerts ? "approval" : undefined} footer={observed} />
        <StatPanel label="Open incidents" value={m.openIncidents} tone={m.openIncidents ? "critical" : undefined} footer={observed} />
        <StatPanel label="Failed integrations" value={m.failedIntegrations} tone={m.failedIntegrations ? "deny" : undefined} footer={`${m.failedExecutions} failed executions`} />
        <StatPanel label="Evidence events" value={m.evidence.events} footer={<span className={report.evidenceChain.valid ? "text-allow" : "text-deny"}>{report.evidenceChain.valid ? `Chain valid, ${report.evidenceChain.checkpoints} checkpoints` : "Chain invalid"}</span>} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        {canGateway ? (
          <Panel title="Decisions per day" description={`${observed} over ${days} days`} className="xl:col-span-2">
            <DecisionsChart data={series} />
          </Panel>
        ) : null}
        <Panel title="Alerts by severity" description={`Raised in the period. ${observed}.`}>
          <AlertsBySeverityChart data={alertRows} />
        </Panel>
        <Panel title="Approval turnaround" description="Decided requests in the period" padded={false}>
          {report.approvals.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-fg-dim">No decided approvals in the period.</p>
          ) : (
            <SimpleTable caption="Approval turnaround" className="rounded-none border-0">
              <thead>
                <tr>
                  <Th>Outcome</Th>
                  <Th align="end">Count</Th>
                  <Th align="end">Median</Th>
                  <Th align="end">p90</Th>
                </tr>
              </thead>
              <tbody>
                {report.approvals.map((a) => (
                  <Tr key={a.status}>
                    <Td>
                      <StatusCell status={a.status} />
                    </Td>
                    <Td align="end">{a.count}</Td>
                    <Td align="end">{a.medianMinutes === null ? "n/a" : `${Math.round(a.medianMinutes)} min`}</Td>
                    <Td align="end">{a.p90Minutes === null ? "n/a" : `${Math.round(a.p90Minutes)} min`}</Td>
                  </Tr>
                ))}
              </tbody>
            </SimpleTable>
          )}
        </Panel>
        <Panel title="Most denied agents" description={observed} padded={false}>
          {report.topDeniedAgents.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-fg-dim">No denied requests in the period.</p>
          ) : (
            <SimpleTable caption="Top denied agents" className="rounded-none border-0">
              <thead>
                <tr>
                  <Th>Agent</Th>
                  <Th>Risk tier</Th>
                  <Th align="end">Denied</Th>
                </tr>
              </thead>
              <tbody>
                {report.topDeniedAgents.map((t, i) => (
                  <Tr key={t.agent?.id ?? i}>
                    <Td>{t.agent ? <Link href={`/agents/${t.agent.id}`} className="text-accent hover:underline">{t.agent.name}</Link> : "Unknown agent"}</Td>
                    <Td>{t.agent ? <Badge tone={statusTone(t.agent.riskTier)}>{statusLabel(t.agent.riskTier)}</Badge> : null}</Td>
                    <Td align="end">{t.denied}</Td>
                  </Tr>
                ))}
              </tbody>
            </SimpleTable>
          )}
        </Panel>
        <Panel title="Incidents" description="Opened in the period" padded={false}>
          {report.incidents.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-fg-dim">No incidents opened in the period.</p>
          ) : (
            <SimpleTable caption="Incidents" className="rounded-none border-0">
              <thead>
                <tr>
                  <Th>#</Th>
                  <Th>Title</Th>
                  <Th>Severity</Th>
                  <Th>Status</Th>
                  <Th>Opened</Th>
                </tr>
              </thead>
              <tbody>
                {report.incidents.map((i) => (
                  <Tr key={i.number}>
                    <Td mono>{i.number}</Td>
                    <Td className="max-w-[280px] truncate" title={i.title}>
                      {i.title}
                    </Td>
                    <Td>
                      <Badge tone={statusTone(i.severity)}>{statusLabel(i.severity)}</Badge>
                    </Td>
                    <Td>
                      <StatusCell status={i.status} />
                    </Td>
                    <Td className="text-xs">{formatDateTime(i.createdAt)}</Td>
                  </Tr>
                ))}
              </tbody>
            </SimpleTable>
          )}
        </Panel>
        <Panel title="Policy activity" description="Versions created, submitted, activated and retired in the period" className="xl:col-span-2">
          <Timeline
            emptyText="No policy changes in the period"
            items={report.policyActivity.slice(0, 30).map((p, i) => ({
              id: `${p.policy}-${i}`,
              tone: p.type === "activated" || p.type === "created" ? ("allow" as const) : p.type === "deactivated" ? ("deny" as const) : p.type === "rolled_back" ? ("approval" as const) : ("neutral" as const),
              title: (
                <span className="flex flex-wrap items-center gap-2">
                  <Badge>{statusLabel(p.type)}</Badge>
                  <span className="font-mono text-xs">{p.policy}</span>
                </span>
              ),
              meta: p.note || undefined,
              time: <span title={formatDateTime(p.at)}>{timeAgo(p.at)}</span>,
            }))}
          />
        </Panel>
        <Panel title="Evidence chain" description="Status at generation time">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-fg-muted">Chain</dt>
              <dd className={report.evidenceChain.valid ? "text-allow" : "text-deny"}>{report.evidenceChain.valid ? "Valid" : "Invalid"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-fg-muted">Events recomputed</dt>
              <dd className="tabular">{report.evidenceChain.checked}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-fg-muted">Signed checkpoints</dt>
              <dd className="tabular">{report.evidenceChain.checkpoints}</dd>
            </div>
            <div>
              <dt className="text-fg-muted">Last hash</dt>
              <dd className="break-all font-mono text-[11px]">{report.evidenceChain.lastHash ?? "none"}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-fg-dim">Tamper-evident, not immutable. Compliance evidence sources: {report.complianceEvidence.length ? report.complianceEvidence.map((s) => `${statusLabel(s.source)} ${s.controls}`).join(", ") : "none mapped yet"}.</p>
        </Panel>
      </div>

      <h2 className="mb-1 mt-8 text-lg font-semibold tracking-tight">Compliance evidence</h2>
      <p className="mb-4 max-w-3xl text-sm text-fg-muted">What AEGIS can observe about its own technical controls, labelled by status, next to the framework mapping maintained in the Audit module. Observations are inputs to an assessment, not a statement of compliance.</p>
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title="Observed technical controls" description={`${observed}. Status reflects measurements in this tenant.`} className="xl:col-span-2" padded={false}>
          <SimpleTable caption="Observed technical controls" className="rounded-none border-0">
            <thead>
              <tr>
                <Th>Control</Th>
                <Th>Status</Th>
                <Th>Measure</Th>
                <Th>Framework references</Th>
              </tr>
            </thead>
            <tbody>
              {controls.map((ctl) => (
                <Tr key={ctl.key}>
                  <Td className="max-w-[260px]">
                    <span className="block font-medium">{ctl.name}</span>
                    <span className="block font-mono text-[11px] text-fg-dim">{ctl.key}</span>
                  </Td>
                  <Td>
                    <Badge tone={CONTROL_TONE[ctl.status] ?? "neutral"}>{statusLabel(ctl.status)}</Badge>
                  </Td>
                  <Td className="text-xs text-fg-muted">{ctl.measure}</Td>
                  <Td className="text-xs">
                    <span className="flex flex-wrap gap-1">
                      {ctl.frameworks.map((f) => (
                        <Badge key={f} mono>
                          {f}
                        </Badge>
                      ))}
                    </span>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </SimpleTable>
        </Panel>
        <Panel title="Framework mapping" description="Controls per framework by evidence source" padded={false}>
          {frameworks.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-fg-dim">No frameworks loaded.</p>
          ) : (
            <ul className="divide-y divide-line">
              {frameworks.map((f) => (
                <li key={f.frameworkId} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link href={`/reports/frameworks/${f.frameworkId}`} className="block truncate text-sm font-medium text-accent hover:underline">
                        {f.name}
                      </Link>
                      <span className="text-xs text-fg-dim">
                        {f.key} {f.version} · {f.controls} controls
                      </span>
                    </div>
                    <span className="shrink-0 text-xs tabular text-fg-muted">{f.mapped} mapped</span>
                  </div>
                  <div className="mt-2 grid grid-cols-4 gap-1 text-center text-[11px]">
                    <div className="rounded border border-line bg-bg px-1 py-1">
                      <div className="tabular text-allow">{f.automated}</div>
                      <div className="text-fg-dim">automated</div>
                    </div>
                    <div className="rounded border border-line bg-bg px-1 py-1">
                      <div className="tabular text-info">{f.customerDocument}</div>
                      <div className="text-fg-dim">document</div>
                    </div>
                    <div className="rounded border border-line bg-bg px-1 py-1">
                      <div className="tabular text-fg">{f.humanValidated}</div>
                      <div className="text-fg-dim">validated</div>
                    </div>
                    <div className="rounded border border-line bg-bg px-1 py-1">
                      <div className="tabular text-approval">{f.missing}</div>
                      <div className="text-fg-dim">missing</div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
