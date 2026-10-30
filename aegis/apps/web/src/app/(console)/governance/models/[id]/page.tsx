import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { withTenant } from "@aegis/db";
import { getModel, isAegisError } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { Badge } from "@/components/ui/badge";
import { DemoBadge } from "@/components/ui/demo-badge";
import { KeyValue } from "@/components/ui/key-value";
import { Note } from "@/components/ui/note";
import { EvaluationForm, ModelLifecycleActions } from "@/components/governance/model-forms";
import { RESULT_TONE, STAGE_TONE } from "@/components/governance/format";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Model" };
export const dynamic = "force-dynamic";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ModelPage({ params }: { params: Promise<{ id: string }> }) {
  const c = await requirePermission("agents:read");
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const view = await withTenant(
    c.ctx.orgId,
    async (db) => {
      try {
        return await getModel(db, c.ctx, id);
      } catch (e) {
        if (isAegisError(e) && e.code === "not_found") return null;
        throw e;
      }
    },
    { readOnly: true },
  );
  if (!view) notFound();
  const m = view.model;
  const canDecide = c.can("policies:activate") && m.approvalRequestedBy !== c.ctx.actor.id;
  return (
    <div>
      <PageHeader breadcrumbs={[{ label: "Models", href: "/governance/models" }, { label: m.name }]} title={m.name} badges={<><Badge tone={STAGE_TONE[m.stage] ?? "neutral"}>{m.stage}</Badge><DemoBadge show={c.org.demoMode} /></>} description={`${m.provider} ${m.providerModelId}${m.version ? ` (version ${m.version})` : ""}`} />
      {view.gate.reason ? (
        <Note tone={view.gate.enforce ? "warning" : "info"} className="mb-4">
          {view.gate.reason}. {view.gate.enforce ? "With model enforcement on, agents using it are held or refused." : "Recorded on each decision; it does not change decisions by itself."}
        </Note>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Panel title="Details">
            <KeyValue
              columns={2}
              items={[
                { label: "Risk tier", value: m.riskTier },
                { label: "Hosting region", value: m.hostingRegion ? `${m.hostingRegion} (declared)` : "Not recorded" },
                { label: "Data it may receive", value: m.dataCategories.join(", ") || "Not recorded" },
                { label: "Approved", value: m.approvedAt ? formatDateTime(m.approvedAt) : "Not approved" },
                { label: "Review due", value: m.reviewDueAt ? formatDateTime(m.reviewDueAt) : "No periodic review" },
                { label: "Agents using it", value: view.agents.length ? view.agents.map((a) => a.name).join(", ") : "None" },
                { label: "Intended use", value: m.intendedUse || "Not recorded" },
                { label: "Known limitations", value: m.limitations || "Not recorded" },
              ]}
            />
          </Panel>
          <Panel title="Evaluations" description="Recorded by people, append-only. Approval needs at least one, and the latest of each kind must not have failed.">
            {view.evaluations.length === 0 ? (
              <p className="text-sm text-fg-muted">No evaluation recorded yet.</p>
            ) : (
              <ul className="divide-y divide-line text-sm" data-testid="model-evaluations">
                {view.evaluations.map((e) => (
                  <li key={e.id} className="py-2">
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge tone={RESULT_TONE[e.result] ?? "neutral"}>{e.result}</Badge>
                      <span className="font-medium text-fg">{e.kind}</span>
                      <span className="text-xs text-fg-dim">{formatDateTime(e.createdAt)}</span>
                    </span>
                    <span className="mt-1 block text-fg-muted">{e.summary}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 border-t border-line pt-4">
              <EvaluationForm modelId={m.id} canWrite={c.can("agents:write") && m.stage !== "retired"} />
            </div>
          </Panel>
        </div>
        <div className="space-y-4">
          <Panel title="Lifecycle" description="proposed, evaluating, approved, deprecated, retired">
            {view.approvalBlockers.length && m.stage === "proposed" ? <p className="mb-2 text-xs text-fg-muted">Before approval: {view.approvalBlockers.join("; ")}.</p> : null}
            <ModelLifecycleActions modelId={m.id} stage={m.stage} canRequest={c.can("agents:write")} canDecide={canDecide} blockers={view.approvalBlockers} />
          </Panel>
          <Panel title="History">
            <ul className="space-y-2 text-sm" data-testid="model-history">
              {view.stageChanges.map((s) => (
                <li key={s.id}>
                  <span className="text-fg">
                    {s.fromStage} to {s.toStage}
                  </span>{" "}
                  <span className="text-xs text-fg-dim">{formatDateTime(s.createdAt)}</span>
                  <span className="block text-xs text-fg-muted">{s.reason}</span>
                </li>
              ))}
              <li className="text-xs text-fg-dim">Registered {formatDateTime(m.createdAt)}</li>
            </ul>
            <Link href="/governance/models" className="mt-3 inline-block text-xs text-accent hover:underline">
              Back to models
            </Link>
          </Panel>
        </div>
      </div>
    </div>
  );
}
