import Link from "next/link";
import type { Metadata } from "next";
import { AlertTriangle, ArrowUpRight, Bot, CheckSquare, OctagonPause, Plug, ShieldCheck } from "lucide-react";
import { getConsoleContext } from "@/server/session";
import { loadOverview, type OverviewData } from "@/server/queries/overview";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { DemoBadge } from "@/components/ui/demo-badge";
import { StatusBadge } from "@/components/ui/status";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkButton } from "@/components/ui/link-button";
import { Countdown } from "@/components/ui/countdown";
import { TimeAgo } from "@/components/ui/time";
import { NextStepsCard } from "@/components/onboarding/checklist";
import { formatMoney } from "@/lib/utils";
import { statusTone } from "@/lib/status";
import { describeRequest, OUTCOME_GROUPS, outcomeGroup, outcomeLabel, type OutcomeGroup } from "@/lib/describe-request";

export const metadata: Metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

const GROUP_TONE: Record<OutcomeGroup, "allow" | "approval" | "deny" | "critical"> = { allowed: "allow", approved: "approval", blocked: "deny", unresolved: "critical" };

function AttentionRow({ href, icon, title, detail, trailing }: { href: string; icon: React.ReactNode; title: React.ReactNode; detail?: React.ReactNode; trailing?: React.ReactNode }) {
  return (
    <li>
      <Link href={href} className="flex flex-wrap items-center gap-3 px-4 py-2.5 transition-colors duration-150 hover:bg-bg-elev-2/60 focus-visible:bg-bg-elev-2 focus-visible:outline-none">
        <span className="shrink-0">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="text-sm text-fg">{title}</div>
          {detail ? <div className="truncate text-xs text-fg-muted">{detail}</div> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2 text-xs text-fg-muted">
          {trailing}
          <span className="inline-flex items-center gap-0.5 text-accent">
            Open <ArrowUpRight className="h-3 w-3" aria-hidden />
          </span>
        </div>
      </Link>
    </li>
  );
}

function NeedsAttention({ o, canApprove }: { o: OverviewData; canApprove: boolean }) {
  const a = o.attention;
  const total = a.approvals.length + a.unresolved.length + a.alerts.length + a.suspended.length;
  return (
    <Panel title="Needs your attention" description={total === 0 ? "Nothing is waiting on you right now." : `${total} item${total === 1 ? "" : "s"} waiting on a person.`} padded={false} data-testid="needs-attention" actions={a.openApprovalsTotal > a.approvals.length ? <Link href="/approvals" className="text-xs text-accent hover:underline">{a.openApprovalsTotal} pending in total</Link> : undefined}>
      {total === 0 ? (
        <EmptyState icon={ShieldCheck} title="All clear" description={canApprove ? "Approvals you can decide, stalled executions, high alerts and suspended agents appear here." : "Stalled executions, high alerts and suspended agents appear here."} />
      ) : (
        <ul className="divide-y divide-line">
          {a.approvals.map((p) => (
            <AttentionRow
              key={p.id}
              href={`/approvals/${p.id}`}
              icon={<CheckSquare className="h-4 w-4 text-approval" aria-hidden />}
              title={
                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="font-medium">{describeRequest(p.toolKey, p.action, p.params)}</span>
                  {p.amount !== null ? <span className="font-semibold tabular">{formatMoney(p.amount, p.currency ?? "AED")}</span> : null}
                  <StatusBadge status={p.status} label={p.status === "pending" ? "Awaiting your decision" : undefined} />
                </span>
              }
              detail={
                <>
                  {p.agentName}
                  {p.justification ? ` asked: "${p.justification}"` : ""}
                </>
              }
              trailing={
                <span>
                  expires in <Countdown until={p.expiresAt} className="font-medium" />
                </span>
              }
            />
          ))}
          {a.unresolved.map((r) => (
            <AttentionRow key={r.id} href={`/gateway/${r.id}`} icon={<AlertTriangle className="h-4 w-4 text-critical" aria-hidden />} title={<span className="flex flex-wrap items-center gap-2"><span className="font-medium">{describeRequest(r.toolKey, r.action, r.params)}</span><StatusBadge status={r.status} /></span>} detail={r.status === "unknown" ? `${r.agentName}: the downstream system did not confirm the outcome. A person must check it and settle the result.` : `${r.agentName}: execution started and has not been confirmed for more than five minutes.`} trailing={<TimeAgo value={r.updatedAt} />} />
          ))}
          {a.alerts.map((al) => (
            <AttentionRow key={al.id} href={`/alerts?focus=${al.id}`} icon={<AlertTriangle className={`h-4 w-4 ${al.severity === "critical" ? "text-critical" : "text-approval"}`} aria-hidden />} title={<span className="flex flex-wrap items-center gap-2"><span className="font-medium">{al.title}</span><Badge tone={statusTone(al.severity)}>{al.severity} alert</Badge></span>} detail="Open alert from risk monitoring" trailing={<TimeAgo value={al.createdAt} />} />
          ))}
          {a.suspended.map((s) => (
            <AttentionRow key={s.id} href={`/agents/${s.id}`} icon={<Bot className="h-4 w-4 text-approval" aria-hidden />} title={<span className="flex flex-wrap items-center gap-2"><span className="font-medium">{s.name}</span><StatusBadge status="suspended" /></span>} detail={s.reason || "Suspended without a recorded reason"} trailing={s.since ? <TimeAgo value={s.since} /> : undefined} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Health({ o }: { o: OverviewData }) {
  const ag = o.agents;
  const ints = o.integrations.items;
  return (
    <Panel title="Agent and integration health" description="Who can act, and which systems they can reach." data-testid="health">
      {o.gateway.paused ? (
        <div role="alert" className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-deny bg-deny/15 px-3 py-2 text-xs text-fg">
          <OctagonPause className="h-4 w-4 text-deny" aria-hidden />
          <span className="font-semibold text-deny">Gateway paused.</span>
          <span className="text-fg-muted">
            Every new request is denied and approved actions do not run.{o.gateway.reason ? ` Reason: ${o.gateway.reason}.` : ""}
          </span>
          <Link href="/org/settings" className="ms-auto text-accent hover:underline">
            Resume in Settings
          </Link>
        </div>
      ) : null}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "Active agents", value: ag.active, tone: "text-allow", href: "/agents?status=active" },
          { label: "Suspended", value: ag.suspended, tone: ag.suspended > 0 ? "text-approval" : "text-fg", href: "/agents?status=suspended" },
          { label: "Revoked", value: ag.revoked, tone: ag.revoked > 0 ? "text-deny" : "text-fg", href: "/agents?status=revoked" },
        ].map((s) =>
          ag.canView ? (
            <Link key={s.label} href={s.href} className="rounded-md border border-line bg-bg px-3 py-2 transition-colors duration-150 hover:border-line-strong">
              <div className="text-[11px] text-fg-muted">{s.label}</div>
              <div className={`text-xl font-semibold tabular ${s.tone}`}>{s.value}</div>
            </Link>
          ) : (
            <div key={s.label} className="rounded-md border border-line bg-bg px-3 py-2">
              <div className="text-[11px] text-fg-muted">{s.label}</div>
              <div className={`text-xl font-semibold tabular ${s.tone}`}>{s.value}</div>
            </div>
          ),
        )}
      </div>
      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between text-xs text-fg-muted">
          <span>Integrations</span>
          {o.integrations.canView ? (
            <Link href="/integrations" className="text-accent hover:underline">
              Manage
            </Link>
          ) : null}
        </div>
        {!o.integrations.canView ? (
          <p className="text-xs text-fg-dim">Requires integrations:read.</p>
        ) : ints.length === 0 ? (
          <p className="text-xs text-fg-dim">
            No integrations yet.{" "}
            <Link href="/getting-started" className="text-accent hover:underline">
              Connect a sandbox system
            </Link>{" "}
            to let an agent reach a real test environment.
          </p>
        ) : (
          <ul className="divide-y divide-line rounded-md border border-line">
            {ints.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-xs">
                <Plug className="h-3.5 w-3.5 shrink-0 text-fg-dim" aria-hidden />
                <Link href={`/integrations/${i.id}`} className="min-w-0 flex-1 truncate text-fg hover:underline">
                  {i.name}
                </Link>
                <Badge tone={i.kind === "sandbox" ? "info" : i.kind === "live" ? "allow" : "neutral"}>{i.kind}</Badge>
                <StatusBadge status={i.status} />
                {i.lastHealthOk === null ? <span className="text-fg-dim">health unchecked</span> : <span className={i.lastHealthOk ? "text-allow" : "text-deny"}>{i.lastHealthOk ? "healthy" : "unhealthy"}</span>}
                {i.lastHealthAt ? (
                  <span className="text-fg-dim">
                    checked <TimeAgo value={i.lastHealthAt} />
                  </span>
                ) : null}
                {i.liveCredentials === 0 ? <span className="text-deny">no live credential</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

function RecentActions({ o }: { o: OverviewData }) {
  const items = o.recent.items;
  const now = Date.now();
  const groups = OUTCOME_GROUPS.map((g) => ({ ...g, rows: items.filter((r) => outcomeGroup(r.status, r.hasApproval, r.createdAt, now) === g.id) }));
  return (
    <Panel title="Recent actions" description="The last 20 requests agents made, grouped by what happened." padded={false} data-testid="recent-actions" actions={o.recent.canView ? <Link href="/activity" className="text-xs text-accent hover:underline">All activity</Link> : undefined}>
      {!o.recent.canView ? (
        <EmptyState title="Requires gateway:read" description="Ask an administrator for access to action requests." />
      ) : items.length === 0 ? (
        <EmptyState title="No actions yet" description="Run the sample refund workflow to see how allowed, approved and blocked actions look." action={<LinkButton href="/gateway/demos" size="sm">Explore a sample workflow</LinkButton>} />
      ) : (
        <div className="divide-y divide-line">
          {groups.map((g) => (
            <section key={g.id} aria-label={g.label} data-outcome-group={g.id}>
              <div className="flex items-center gap-2 bg-bg-elev-2/50 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
                <Badge tone={GROUP_TONE[g.id]}>{g.rows.length}</Badge>
                {g.label}
              </div>
              {g.rows.length === 0 ? (
                <p className="px-4 py-2 text-xs text-fg-dim">None in the last 20.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {g.rows.map((r) => (
                    <li key={r.id}>
                      <Link href={`/gateway/${r.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-xs transition-colors duration-150 hover:bg-bg-elev-2/60 focus-visible:bg-bg-elev-2 focus-visible:outline-none">
                        <span className="w-40 shrink-0 truncate text-fg">{r.agentName}</span>
                        <span className="min-w-0 flex-1 truncate text-fg-muted" title={`${r.toolKey} / ${r.action}`}>
                          {describeRequest(r.toolKey, r.action, r.params)}
                        </span>
                        {r.amount !== null ? <span className="shrink-0 font-semibold tabular text-fg">{formatMoney(r.amount, r.currency ?? "AED")}</span> : null}
                        <StatusBadge status={r.status} label={outcomeLabel(r.status, r.hasApproval)} />
                        <span className="shrink-0 text-fg-dim">
                          <TimeAgo value={r.createdAt} />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
    </Panel>
  );
}

export default async function OverviewPage() {
  const c = await getConsoleContext();
  const o = await loadOverview(c);
  const chain = o.evidence.chain;
  const showNextSteps = !o.onboarding.summary.dismissedAt;
  return (
    <div>
      <PageHeader
        title="Overview"
        description={`${c.org.name}: what needs a person, whether agents and systems are healthy, and what happened recently.`}
        badges={<DemoBadge show={c.org.demoMode} />}
        actions={
          chain ? (
            <Link href="/evidence" className="inline-flex items-center gap-1.5 rounded-md border border-line bg-bg-elev px-2.5 py-1 text-xs text-fg-muted hover:border-line-strong" title={`Hash chain recomputed over ${chain.checked} events; ${chain.checkpoints} signed checkpoints`} data-testid="chain-indicator">
              <span className={`h-2 w-2 rounded-full ${chain.valid ? "bg-allow" : "bg-deny"}`} aria-hidden />
              {chain.valid ? "Evidence chain valid" : chain.firstBadSeq ? `Evidence chain broken at seq ${chain.firstBadSeq}` : "Evidence checkpoint mismatch"}
              <span className="text-fg-dim">{o.evidence.count} events</span>
            </Link>
          ) : undefined
        }
      />
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <NeedsAttention o={o} canApprove={c.can("approvals:decide")} />
          <RecentActions o={o} />
        </div>
        <div className="space-y-4">
          <Health o={o} />
          {showNextSteps ? <NextStepsCard steps={o.onboarding.steps} summary={o.onboarding.summary} /> : null}
        </div>
      </div>
    </div>
  );
}
