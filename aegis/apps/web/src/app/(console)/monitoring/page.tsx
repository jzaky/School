import type { Metadata } from "next";
import Link from "next/link";
import { withTenant } from "@aegis/db";
import { alertStats, DEFAULT_RULES, listMonitoringRules, topAgentsByDenials } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { DemoBadge } from "@/components/ui/demo-badge";
import { Panel } from "@/components/ui/panel";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/link-button";
import { CreateRuleDialog, MonitoringNote, MonitoringRulesTable, type RuleRow } from "@/components/assurance/monitoring-rules";
import { statusLabel, statusTone } from "@/lib/status";

export const metadata: Metadata = { title: "Risk Monitoring" };
export const dynamic = "force-dynamic";

export default async function MonitoringPage() {
  const c = await requirePermission("monitoring:read");
  const { rules, stats, topDenied } = await withTenant(c.ctx.orgId, async (db) => {
    const [rules, stats, topDenied] = await Promise.all([listMonitoringRules(db, c.ctx), alertStats(db, c.ctx), c.can("gateway:read") ? topAgentsByDenials(db, c.ctx, 30, 5) : []]);
    return { rules, stats, topDenied };
  });
  const builtIn = new Set(DEFAULT_RULES.map((r) => r.key));
  const rows: RuleRow[] = rules.map((r) => ({ id: r.id, key: r.key, name: r.name, description: r.description, severity: r.severity, enabled: r.enabled, builtIn: builtIn.has(r.key), definition: (r.definition ?? {}) as Record<string, unknown>, lastRunAt: r.lastRunAt?.toISOString() ?? null, openAlerts: r.openAlerts, totalAlerts: r.totalAlerts }));
  const bySeverity = ["critical", "high", "medium", "low"].map((s) => ({ severity: s, open: stats.filter((x) => x.severity === s && x.status === "open").reduce((n, x) => n + x.count, 0), total: stats.filter((x) => x.severity === s).reduce((n, x) => n + x.count, 0) }));
  const open = stats.filter((x) => x.status === "open").reduce((n, x) => n + x.count, 0);
  const acknowledged = stats.filter((x) => x.status === "acknowledged").reduce((n, x) => n + x.count, 0);
  const resolved = stats.filter((x) => x.status === "resolved").reduce((n, x) => n + x.count, 0);
  const canWrite = c.can("monitoring:write");
  return (
    <div>
      <PageHeader
        title="Risk Monitoring"
        description={`${rows.filter((r) => r.builtIn).length} built-in rules and ${rows.filter((r) => !r.builtIn).length} custom rules evaluated by the worker and on demand.`}
        badges={<DemoBadge show={c.org.demoMode} />}
        actions={
          <>
            <LinkButton href="/alerts">Open alerts</LinkButton>
            <CreateRuleDialog canWrite={canWrite} existingKeys={rows.map((r) => r.key)} />
          </>
        }
      />
      <div className="grid gap-4 xl:grid-cols-4">
        <div className="space-y-3 xl:col-span-3">
          <MonitoringNote />
          <MonitoringRulesTable rules={rows} canWrite={canWrite} />
        </div>
        <div className="space-y-4">
          <Panel title="Alert status" description="All time">
            <dl className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-md border border-line bg-bg p-2">
                <dt className="text-[11px] uppercase tracking-wide text-fg-dim">Open</dt>
                <dd className="text-xl font-semibold tabular text-approval">{open}</dd>
              </div>
              <div className="rounded-md border border-line bg-bg p-2">
                <dt className="text-[11px] uppercase tracking-wide text-fg-dim">Acknowledged</dt>
                <dd className="text-xl font-semibold tabular text-info">{acknowledged}</dd>
              </div>
              <div className="rounded-md border border-line bg-bg p-2">
                <dt className="text-[11px] uppercase tracking-wide text-fg-dim">Resolved</dt>
                <dd className="text-xl font-semibold tabular text-allow">{resolved}</dd>
              </div>
            </dl>
            <ul className="mt-3 space-y-1.5">
              {bySeverity.map((s) => (
                <li key={s.severity} className="flex items-center justify-between text-xs">
                  <Badge tone={statusTone(s.severity)}>{statusLabel(s.severity)}</Badge>
                  <span className="tabular text-fg-muted">
                    <span className="text-fg">{s.open}</span> open of {s.total}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="Most denied agents" description="Denied requests in the last 30 days">
            {topDenied.length === 0 ? (
              <p className="text-xs text-fg-dim">{c.can("gateway:read") ? "No denied requests in the period." : "Requires gateway:read."}</p>
            ) : (
              <ol className="space-y-1.5">
                {topDenied.map((t, i) => (
                  <li key={t.agent?.id ?? i} className="flex items-center justify-between gap-2 text-xs">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="w-4 tabular text-fg-dim">{i + 1}.</span>
                      {t.agent ? (
                        <Link href={`/agents/${t.agent.id}`} className="truncate text-accent hover:underline">
                          {t.agent.name}
                        </Link>
                      ) : (
                        <span className="text-fg-muted">Unknown agent</span>
                      )}
                      {t.agent ? <Badge tone={statusTone(t.agent.riskTier)}>{t.agent.riskTier}</Badge> : null}
                    </span>
                    <span className="tabular font-medium text-deny">{t.denied}</span>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
