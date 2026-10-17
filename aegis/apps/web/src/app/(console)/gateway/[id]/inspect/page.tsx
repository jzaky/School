import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { withTenant } from "@aegis/db";
import { inspectDecision, isAegisError, type Rationale } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { Badge } from "@/components/ui/badge";
import { DemoBadge } from "@/components/ui/demo-badge";
import { Note } from "@/components/ui/note";
import { CodeBlock } from "@/components/ui/code-block";
import { InspectorActions } from "@/components/control/inspector-actions";
import { BASIS_TEXT } from "@/components/control/uncertainty-panel";
import { formatDateTime } from "@/lib/utils";
import type { Tone } from "@/lib/status";

export const metadata: Metadata = { title: "Decision Inspector" };
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS_TONE: Record<string, Tone> = { passed: "allow", changed: "approval", stopped: "deny", pending: "approval", skipped: "neutral" };
const STATUS_TEXT: Record<string, string> = { passed: "passed", changed: "made stricter", stopped: "stopped here", pending: "waiting", skipped: "skipped" };

interface IndicatorView {
  key: string;
  label: string;
  basis: keyof typeof BASIS_TEXT;
  status: string;
  detail: string;
}

export default async function InspectPage({ params }: { params: Promise<{ id: string }> }) {
  const c = await requirePermission("gateway:read");
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const view = await withTenant(
    c.ctx.orgId,
    async (db) => {
      try {
        return await inspectDecision(db, c.ctx, id);
      } catch (e) {
        if (isAegisError(e) && e.code === "not_found") return null;
        throw e;
      }
    },
    { readOnly: true },
  );
  if (!view) notFound();
  const reasoning = view.stages.find((s) => s.key === "reasoning")?.detail as { provided?: boolean; rationale?: Rationale | null; indicators?: IndicatorView[] } | undefined;
  const policy = view.stages.find((s) => s.key === "policy");
  const counterfactuals = (policy?.detail.counterfactuals as string[] | undefined) ?? [];
  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Action Gateway", href: "/gateway" }, { label: `Request ${id.slice(0, 8)}`, href: `/gateway/${id}` }, { label: "Decision Inspector" }]}
        title="Decision Inspector"
        badges={<DemoBadge show={c.org.demoMode} />}
        description={
          <>
            {view.request.agent.name} asked to {view.request.action} with <span className="font-mono">{view.request.tool}</span> on {formatDateTime(view.request.createdAt)}. Every stage below is reconstructed from what AEGIS recorded.
          </>
        }
      />
      <Note tone="info" className="mb-4">
        The inspector shows what the agent submitted and what AEGIS computed. AEGIS has no access to a model&apos;s internal reasoning; a rationale is the agent&apos;s own statement, checked against the request and its evidence.
      </Note>
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title="Stages" description="In the order the gateway ran them" className="xl:col-span-2">
          <ol className="space-y-3" data-testid="inspector-stages">
            {view.stages.map((s, i) => (
              <li key={`${s.key}-${i}`} className="rounded-md border border-line p-3" data-stage={s.key} data-status={s.status}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="tabular text-xs text-fg-dim">{i + 1}</span>
                  <span className="font-medium text-fg">{s.title}</span>
                  <Badge tone={STATUS_TONE[s.status] ?? "neutral"}>{STATUS_TEXT[s.status] ?? s.status}</Badge>
                </div>
                <p className="mt-1 text-sm text-fg-muted">{s.summary}</p>
                {Object.keys(s.detail).length ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-accent">Recorded detail</summary>
                    <CodeBlock className="mt-2 max-h-80 overflow-auto" code={JSON.stringify(s.detail, null, 2)} />
                  </details>
                ) : null}
              </li>
            ))}
          </ol>
        </Panel>
        <div className="space-y-4">
          <Panel title="Check and export" description="Re-evaluate this request's recorded input against the policies active now, or download the full decision record">
            <InspectorActions requestId={id} canRecheck={c.can("policies:read")} />
          </Panel>
          <Panel title="What would have changed the outcome" description="From the numeric comparisons the policies recorded; nothing else is inferred">
            {counterfactuals.length ? (
              <ul className="space-y-1.5 text-sm" data-testid="inspector-counterfactuals">
                {counterfactuals.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-fg-muted">No numeric comparison was recorded for this decision.</p>
            )}
          </Panel>
          <Panel title="The agent's stated reasons" description="Only what the agent chose to send">
            {!reasoning?.provided || !reasoning.rationale ? (
              <p className="text-sm text-fg-muted" data-testid="inspector-no-rationale">
                The agent sent no rationale with this request.
              </p>
            ) : (
              <div className="space-y-2 text-sm" data-testid="inspector-rationale">
                <p className="text-fg">{reasoning.rationale.summary}</p>
                {reasoning.rationale.steps.length ? (
                  <ol className="list-inside list-decimal space-y-1 text-fg-muted">
                    {reasoning.rationale.steps.map((st, i) => (
                      <li key={i}>
                        {st.statement}
                        {st.cites.length ? <span className="text-xs text-fg-dim"> (cites {st.cites.join(", ")})</span> : null}
                      </li>
                    ))}
                  </ol>
                ) : null}
                {reasoning.rationale.policyBasis.length ? <p className="text-xs text-fg-muted">Relies on: {reasoning.rationale.policyBasis.join(", ")}</p> : null}
              </div>
            )}
            {reasoning?.indicators?.length ? (
              <ul className="mt-3 space-y-1.5 border-t border-line pt-3 text-sm">
                {reasoning.indicators.map((ind) => (
                  <li key={ind.key} data-indicator={ind.key}>
                    <Badge tone={ind.status === "ok" ? "allow" : ind.status === "warning" ? "approval" : "deny"}>{ind.status}</Badge> <span className="text-fg">{ind.label}</span>
                    <span className="block text-xs text-fg-muted">
                      {ind.detail} <span className="text-fg-dim">({BASIS_TEXT[ind.basis] ?? ind.basis})</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </Panel>
          <Panel title="Evidence record" description="Ledger entries for this request">
            <ul className="space-y-1 font-mono text-[11px] text-fg-muted">
              {view.evidence.map((e) => (
                <li key={e.seq.toString()}>
                  #{e.seq.toString()} {e.type} {e.hash.slice(0, 12)}
                </li>
              ))}
            </ul>
            <Link href={`/gateway/${id}`} className="mt-2 inline-block text-xs text-accent hover:underline">
              Back to the request
            </Link>
          </Panel>
        </div>
      </div>
    </div>
  );
}
