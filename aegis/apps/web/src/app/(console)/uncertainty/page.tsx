import type { Metadata } from "next";
import { withTenant } from "@aegis/db";
import { MIN_CALIBRATION_SAMPLES, readReasoningPolicy, readUncertaintyPolicy, uncertaintyOverview } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { DemoBadge } from "@/components/ui/demo-badge";
import { Badge } from "@/components/ui/badge";
import { Note } from "@/components/ui/note";
import { RecomputeCalibrationButton, ToolRequirementsEditor } from "@/components/control/uncertainty-tools";
import { BASIS_TEXT } from "@/components/control/uncertainty-panel";
import { ReasoningRequirementsEditor } from "@/components/control/reasoning-tools";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Uncertainty" };
export const dynamic = "force-dynamic";

const pct = (v: number | null) => (v === null ? "n/a" : `${(v * 100).toFixed(1)}%`);

export default async function UncertaintyPage() {
  const c = await requirePermission("monitoring:read");
  const { overview, tools } = await withTenant(
    c.ctx.orgId,
    async (db) => ({
      overview: await uncertaintyOverview(db, c.ctx, 30),
      tools: await db.tool.findMany({ where: { orgId: c.ctx.orgId }, select: { id: true, key: true, name: true, uncertaintyPolicy: true, reasoningPolicy: true }, orderBy: { name: "asc" } }),
    }),
    { readOnly: true },
  );
  const levels = [
    { key: "low", label: "Low", tone: "allow" as const },
    { key: "elevated", label: "Elevated", tone: "approval" as const },
    { key: "high", label: "High", tone: "deny" as const },
    { key: "unknown", label: "Unknown", tone: "deny" as const },
  ];
  return (
    <div>
      <PageHeader
        title="Uncertainty"
        badges={<DemoBadge show={c.org.demoMode} />}
        description="What AEGIS can check about the facts behind each request: missing information, evidence that disagrees, stale or untrusted sources, and how far an agent's own confidence holds up against real outcomes. AEGIS does not invent a confidence score; every check says whether it is a measured fact, a heuristic or the agent's own figure."
      />
      <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="uncertainty-levels">
        {levels.map((l) => (
          <Panel key={l.key} title={l.label} description="decisions, last 30 days">
            <p className="text-2xl font-semibold tabular text-fg">{overview.byLevel[l.key as keyof typeof overview.byLevel]}</p>
          </Panel>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Panel title="What raised concerns" description={`${overview.assessed} decisions assessed; ${overview.escalated} made stricter because of uncertainty`}>
            {overview.indicators.length === 0 ? (
              <p className="text-sm text-fg-muted">No check raised a concern in the last 30 days.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {overview.indicators.map((i) => (
                  <li key={i.key} className="flex justify-between gap-3">
                    <span>
                      <span className="text-fg">{i.label}</span> <span className="text-xs text-fg-dim">({BASIS_TEXT[i.basis as keyof typeof BASIS_TEXT] ?? i.basis})</span>
                    </span>
                    <span className="tabular">{i.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Calibration of agents' confidence" description={`From ${overview.labels} outcome labels in the last 30 days (and up to 90 days for calibration). Called calibrated only with at least ${MIN_CALIBRATION_SAMPLES} labelled outcomes.`} actions={<RecomputeCalibrationButton canWrite={c.can("monitoring:write")} />}>
            {overview.profiles.length === 0 ? (
              <p className="text-sm text-fg-muted">No agent has reported a confidence on a request that was later labelled. Labels come from approvers, from people on a request&apos;s page, and from customer systems with an outcomes key.</p>
            ) : (
              <div className="space-y-4" data-testid="calibration-profiles">
                {overview.profiles
                  .filter((p) => p.toolKey === "*")
                  .map((p) => (
                    <div key={p.id} data-profile={p.agentName}>
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-medium text-fg">{p.agentName}</span>
                        <Badge tone={p.sampleSize >= MIN_CALIBRATION_SAMPLES ? "info" : "neutral"}>{p.sampleSize >= MIN_CALIBRATION_SAMPLES ? `Calibrated on ${p.sampleSize} outcomes` : `${p.sampleSize} outcomes, not enough to calibrate`}</Badge>
                        <span className="text-xs text-fg-muted">
                          Expected calibration error {pct(p.ece)}, Brier score {p.brier === null ? "n/a" : p.brier.toFixed(3)}, overall accuracy {pct(p.accuracy)}. Computed {formatDateTime(p.computedAt)}.
                        </span>
                      </div>
                      <table className="mt-2 w-full text-[12px]">
                        <thead>
                          <tr className="border-b border-line text-fg-muted">
                            <th className="h-7 px-2 text-start font-medium">Reported confidence</th>
                            <th className="h-7 px-2 text-end font-medium">Requests</th>
                            <th className="h-7 px-2 text-end font-medium">Mean reported</th>
                            <th className="h-7 px-2 text-end font-medium">Actually right</th>
                          </tr>
                        </thead>
                        <tbody>
                          {p.bins
                            .filter((b) => b.count > 0)
                            .map((b) => (
                              <tr key={b.lower} className="border-b border-line last:border-0">
                                <td className="h-7 px-2">
                                  {b.lower.toFixed(1)} to {b.upper.toFixed(1)}
                                </td>
                                <td className="h-7 px-2 text-end tabular">{b.count}</td>
                                <td className="h-7 px-2 text-end tabular">{pct(b.meanConfidence)}</td>
                                <td className="h-7 px-2 text-end tabular">{pct(b.accuracy)}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
              </div>
            )}
          </Panel>
        </div>
        <div className="space-y-4">
          <Panel title="Tool requirements" description="What a request must carry before AEGIS treats its facts as known. Unknown is never treated as safe.">
            <ToolRequirementsEditor canWrite={c.can("agents:write")} tools={tools.map((t) => ({ id: t.id, key: t.key, name: t.name, policy: readUncertaintyPolicy(t.uncertaintyPolicy) }))} />
          </Panel>
          <Panel title="Rationale requirements" description="Whether an agent must state why it acts, and cite its evidence. AEGIS checks only what the agent states; it has no access to a model's internal reasoning.">
            <ReasoningRequirementsEditor canWrite={c.can("agents:write")} tools={tools.map((t) => ({ id: t.id, key: t.key, name: t.name, policy: readReasoningPolicy(t.reasoningPolicy) }))} />
          </Panel>
          <Note tone="info">Agents send evidence as context.evidence (field, value, source, observedAt), their confidence as context.confidence between 0 and 1, and anything they could not determine as context.missing, and their reasons as context.rationale (summary, steps with citations, assumptions, the policies they rely on).</Note>
        </div>
      </div>
    </div>
  );
}
