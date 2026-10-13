"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowUpRight, Activity } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status";
import { TimeAgo } from "@/components/ui/time";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkButton } from "@/components/ui/link-button";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { cn, formatMoney } from "@/lib/utils";
import { describeRequest, OUTCOME_GROUPS, outcomeLabel, type OutcomeGroup } from "@/lib/describe-request";
import type { ActivityRow } from "@/server/queries/activity";

const GROUP_TONE: Record<OutcomeGroup, "allow" | "approval" | "deny" | "critical"> = { allowed: "allow", approved: "approval", blocked: "deny", unresolved: "critical" };
const FILTERS: { id: string; label: string }[] = [
  { id: "", label: "All outcomes" },
  { id: "allowed", label: "Allowed" },
  { id: "approval", label: "Approval" },
  { id: "blocked", label: "Blocked" },
  { id: "unresolved", label: "Failed or unresolved" },
];

export function ActivityTable({ rows, total, agents, outcome, agentId, currency }: { rows: ActivityRow[]; total: number; agents: { id: string; name: string }[]; outcome: string; agentId: string; currency: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  function apply(patch: Record<string, string | null>) {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }
  const filtered = !!(outcome || agentId);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Activity filters">
        <div role="group" aria-label="Outcome" className="flex flex-wrap gap-1">
          {FILTERS.map((f) => {
            const on = (outcome || "") === f.id;
            return (
              <button key={f.id} type="button" aria-pressed={on} onClick={() => apply({ outcome: f.id || null })} className={cn("inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors duration-150", on ? "border-line-strong bg-bg-elev text-fg" : "border-transparent bg-transparent text-fg-dim hover:text-fg-muted")}>
                {f.label}
              </button>
            );
          })}
        </div>
        <div className="ms-auto flex items-center gap-2">
          <Select aria-label="Agent" size="sm" className="w-56" value={agentId || "all"} onValueChange={(v) => apply({ agentId: v === "all" ? null : v })} options={[{ value: "all", label: "All agents" }, ...agents.map((a) => ({ value: a.id, label: a.name }))]} />
          {filtered ? (
            <Button size="sm" variant="ghost" onClick={() => apply({ outcome: null, agentId: null })}>
              Clear
            </Button>
          ) : null}
        </div>
      </div>
      <div className="overflow-hidden rounded-panel border border-line bg-bg-elev" data-testid="activity-list">
        {rows.length === 0 ? (
          <EmptyState icon={Activity} title={filtered ? "No actions match these filters" : "No actions recorded yet"} description={filtered ? "Try another outcome or agent." : "Every request an agent makes lands here with its outcome. Run the sample refund workflow to see allowed, approved and blocked actions."} action={filtered ? <Button size="sm" onClick={() => apply({ outcome: null, agentId: null })}>Clear filters</Button> : <LinkButton href="/gateway/demos" size="sm">Explore a sample workflow</LinkButton>} />
        ) : (
          <div className="relative overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Recent actions</caption>
            <thead className="bg-bg-elev-2/60 text-start text-xs text-fg-muted">
              <tr>
                <th scope="col" className="px-3 py-2 text-start font-medium">
                  Agent
                </th>
                <th scope="col" className="px-3 py-2 text-start font-medium">
                  What
                </th>
                <th scope="col" className="px-3 py-2 text-end font-medium">
                  Amount
                </th>
                <th scope="col" className="px-3 py-2 text-start font-medium">
                  Outcome
                </th>
                <th scope="col" className="px-3 py-2 text-start font-medium">
                  When
                </th>
                <th scope="col" className="px-3 py-2">
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id} className="transition-colors duration-150 hover:bg-bg-elev-2/60" data-outcome-group={r.group}>
                  <td className="px-3 py-2 text-fg">
                    <Link href={`/agents/${r.agentId}`} className="hover:underline">
                      {r.agentName}
                    </Link>
                  </td>
                  <td className="max-w-md px-3 py-2">
                    <div className="truncate text-fg" title={`${r.toolKey} / ${r.action}`}>
                      {describeRequest(r.toolKey, r.action, r.params, currency)}
                    </div>
                    {r.justification ? <div className="truncate text-xs text-fg-muted">&ldquo;{r.justification}&rdquo;</div> : null}
                  </td>
                  <td className="px-3 py-2 text-end tabular text-fg">{r.amount !== null ? formatMoney(r.amount, r.currency ?? currency) : <span className="text-fg-dim">n/a</span>}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={GROUP_TONE[r.group]}>{OUTCOME_GROUPS.find((g) => g.id === r.group)?.label}</Badge>
                      <StatusBadge status={r.status} label={outcomeLabel(r.status, r.hasApproval)} />
                      {r.reference ? <span className="font-mono text-[11px] text-fg-dim">{r.reference}</span> : null}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-fg-muted">
                    <TimeAgo value={r.createdAt} />
                  </td>
                  <td className="px-3 py-2 text-end">
                    <Link href={r.status === "pending_approval" && r.approvalId ? `/approvals/${r.approvalId}` : `/gateway/${r.id}`} className="inline-flex items-center gap-0.5 text-xs text-accent hover:underline">
                      {r.status === "pending_approval" ? "Decide" : "Open"} <ArrowUpRight className="h-3 w-3" aria-hidden />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
      <p className="text-[11px] text-fg-dim">
        Showing {rows.length} of {total} matching actions. Every row links to the full decision trace and evidence.
      </p>
    </div>
  );
}
