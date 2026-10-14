import type { Metadata } from "next";
import Link from "next/link";
import { Cpu } from "lucide-react";
import { withTenant } from "@aegis/db";
import { getModelGovernance, listModels } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { Badge } from "@/components/ui/badge";
import { DemoBadge } from "@/components/ui/demo-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { StatPanel } from "@/components/ui/stat-panel";
import { SimpleTable, Td, Th } from "@/components/ui/simple-table";
import { LinkAgentModel, ModelEnforcementForm, RegisterModelDialog } from "@/components/governance/model-forms";
import { STAGE_TONE } from "@/components/governance/format";

export const metadata: Metadata = { title: "Models" };
export const dynamic = "force-dynamic";

export default async function ModelsPage() {
  const c = await requirePermission("agents:read");
  const { models, unlinkedAgents, enforcement } = await withTenant(c.ctx.orgId, async (db) => ({ ...(await listModels(db, c.ctx)), enforcement: await getModelGovernance(db, c.ctx.orgId) }), { readOnly: true });
  const approved = models.filter((m) => m.stage === "approved").length;
  const attention = models.filter((m) => m.gate.status !== "ok").length;
  return (
    <div>
      <PageHeader title="Models" description="Every AI model your agents run on, its lifecycle stage, its evaluations and which agents use it. Approval needs recorded evaluations and a second person." badges={<DemoBadge show={c.org.demoMode} />} actions={<RegisterModelDialog canWrite={c.can("agents:write")} />} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatPanel label="Registered models" value={models.length} />
        <StatPanel label="Approved" value={approved} tone="allow" />
        <StatPanel label="Need attention" value={attention} tone={attention ? "approval" : "neutral"} footer="Not approved, deprecated, retired or review overdue" />
        <StatPanel label="Agents without a model" value={unlinkedAgents.length} tone={unlinkedAgents.length ? "approval" : "neutral"} />
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Panel title="Registry" padded={false}>
            {models.length === 0 ? (
              <EmptyState icon={Cpu} title="No models registered" description="Register the models your agents use. Agents that report the same provider and model id are linked automatically." />
            ) : (
              <SimpleTable caption="Registered models">
                <thead>
                  <tr>
                    <Th>Model</Th>
                    <Th>Stage</Th>
                    <Th>Risk</Th>
                    <Th align="end">Evaluations</Th>
                    <Th>Agents</Th>
                  </tr>
                </thead>
                <tbody>
                  {models.map((m) => (
                    <tr key={m.id} className="border-b border-line last:border-0" data-testid="model-row" data-model={m.key}>
                      <Td>
                        <Link href={`/governance/models/${m.id}`} className="text-accent hover:underline">
                          {m.name}
                        </Link>
                        <span className="block font-mono text-[11px] text-fg-dim">
                          {m.provider} {m.providerModelId}
                        </span>
                      </Td>
                      <Td>
                        <Badge tone={STAGE_TONE[m.stage] ?? "neutral"}>{m.stage}</Badge>
                        {m.gate.status === "review_overdue" ? (
                          <Badge tone="approval" className="ms-1">
                            review overdue
                          </Badge>
                        ) : null}
                      </Td>
                      <Td>{m.riskTier}</Td>
                      <Td align="end">{m.evaluations}</Td>
                      <Td>{m.agents.map((a) => a.name).join(", ") || <span className="text-fg-dim">none</span>}</Td>
                    </tr>
                  ))}
                </tbody>
              </SimpleTable>
            )}
          </Panel>
          {unlinkedAgents.length ? (
            <Panel title="Agents not linked to a registered model" description="With enforcement on, these agents count as running an unregistered model">
              <ul className="divide-y divide-line text-sm" data-testid="unlinked-agents">
                {unlinkedAgents.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>
                      {a.name}{" "}
                      <span className="font-mono text-[11px] text-fg-dim">
                        {a.modelProvider || "no provider"} {a.modelId}
                      </span>
                    </span>
                    <span className="w-56">
                      <LinkAgentModel agentId={a.id} models={models.filter((m) => m.stage !== "retired").map((m) => ({ id: m.id, name: m.name }))} canWrite={c.can("agents:write")} />
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>
        <Panel title="Enforcement in the gateway" description="Off by default. When on, it can only make a decision stricter, and every decision records the model check.">
          <ModelEnforcementForm initial={enforcement.enforcement} canWrite={c.can("policies:activate")} />
        </Panel>
      </div>
    </div>
  );
}
