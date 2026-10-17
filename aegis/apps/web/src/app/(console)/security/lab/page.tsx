import type { Metadata } from "next";
import Link from "next/link";
import { FlaskConical } from "lucide-react";
import { withTenant } from "@aegis/db";
import { LAB_SCENARIOS, listLabRuns } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { Badge } from "@/components/ui/badge";
import { DemoBadge } from "@/components/ui/demo-badge";
import { Note } from "@/components/ui/note";
import { EmptyState } from "@/components/ui/empty-state";
import { SimpleTable, Td, Th } from "@/components/ui/simple-table";
import { LabRunForm } from "@/components/shield/lab-run-form";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Attack Simulation Lab" };
export const dynamic = "force-dynamic";

export default async function LabPage() {
  const c = await requirePermission("security:read");
  const { runs, targets } = await withTenant(
    c.ctx.orgId,
    async (db) => {
      const runs = await listLabRuns(db, c.ctx, 20);
      const agents = await db.agent.findMany({ where: { isLab: false, status: "active" }, orderBy: { name: "asc" }, select: { id: true, name: true, tools: { where: { revokedAt: null, enabled: true }, select: { tool: { select: { key: true, name: true } } } } } });
      return { runs, targets: agents.filter((a) => a.tools.length > 0).map((a) => ({ id: a.id, name: a.name, tools: a.tools.map((t) => t.tool) })) };
    },
    { readOnly: true },
  );
  return (
    <div>
      <PageHeader title="Attack Simulation Lab" description="Clone an agent with its exact grants, limits and policies, send it known attacks through the Action Gateway, and see which ones your configuration stops. Decision-only: nothing reaches a downstream system." badges={<DemoBadge show={c.org.demoMode} />} />
      <Note tone="info" className="mb-4">
        This checks your own AEGIS configuration against a fixed set of attack patterns. It is not a penetration test: it does not test your network, your models, the console or the systems your agents call. A gap means AEGIS allowed the attack with your current settings, and each one comes with what would close it.
      </Note>
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Panel title="Runs" description="Most recent first">
            {runs.length === 0 ? (
              <EmptyState icon={FlaskConical} title="No lab runs yet" description="Pick an agent and run the lab. Results stay on the evidence record." />
            ) : (
              <SimpleTable caption="Lab runs">
                <thead>
                  <tr>
                    <Th>Started</Th>
                    <Th>Agent</Th>
                    <Th>Tool</Th>
                    <Th>Result</Th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => {
                    const s = r.summary as { counts?: Record<string, number>; tool?: string };
                    return (
                      <tr key={r.id} className="border-b border-line last:border-0" data-testid="lab-run-row">
                        <Td>
                          <Link href={`/security/lab/${r.id}`} className="text-accent hover:underline">
                            {formatDateTime(r.startedAt)}
                          </Link>
                        </Td>
                        <Td>{r.target?.name ?? "Unknown agent"}</Td>
                        <Td mono>{s.tool ?? ""}</Td>
                        <Td>
                          {r.status === "running" ? (
                            <Badge tone="info">running</Badge>
                          ) : r.status === "failed" ? (
                            <Badge tone="deny">failed</Badge>
                          ) : (
                            <span className="flex flex-wrap gap-1">
                              <Badge tone="allow">{s.counts?.defended ?? 0} defended</Badge>
                              <Badge tone={(s.counts?.gap ?? 0) > 0 ? "deny" : "neutral"}>{s.counts?.gap ?? 0} gaps</Badge>
                              {(s.counts?.inconclusive ?? 0) > 0 ? <Badge tone="approval">{s.counts?.inconclusive} inconclusive</Badge> : null}
                              {(s.counts?.error ?? 0) > 0 ? <Badge tone="deny">{s.counts?.error} errors</Badge> : null}
                            </span>
                          )}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </SimpleTable>
            )}
          </Panel>
          <Panel title="Scenarios" description={`${LAB_SCENARIOS.length} attacks, each mapped by AEGIS to the OWASP Top 10 for LLM Applications 2025 and, where one fits, MITRE ATLAS`}>
            <ul className="divide-y divide-line text-sm" data-testid="lab-scenarios">
              {LAB_SCENARIOS.map((s) => (
                <li key={s.key} className="py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-fg">{s.title}</span>
                    {s.references.map((ref) => (
                      <Badge key={ref} mono>
                        {ref}
                      </Badge>
                    ))}
                  </div>
                  <p className="text-xs text-fg-muted">{s.attack}</p>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
        <Panel title="Run the lab" description="The clone gets the agent's tools, resource permissions, team, limits, autonomy settings and agent policies">
          {targets.length === 0 ? <p className="text-sm text-fg-muted">No active agent holds a tool, so there is nothing to clone.</p> : <LabRunForm targets={targets} canRun={c.can("security:write")} />}
        </Panel>
      </div>
    </div>
  );
}
