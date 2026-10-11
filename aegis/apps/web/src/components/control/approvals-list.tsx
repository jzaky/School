"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowUpRight, CheckSquare } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status";
import { Countdown } from "@/components/ui/countdown";
import { EmptyState } from "@/components/ui/empty-state";
import { TimeAgo } from "@/components/ui/time";
import { IconButton } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatMoney } from "@/lib/utils";
import { statusTone } from "@/lib/status";

export interface ApprovalRow {
  id: string;
  status: string;
  requestId: string;
  agentId: string;
  agentName: string;
  agentSlug: string;
  riskTier: string;
  toolKey: string;
  action: string;
  targetSystem: string | null;
  amount: number | null;
  currency: string | null;
  destination: string | null;
  orderId: string | null;
  toAccount: string | null;
  triggeringRule: string | null;
  riskIndicators: string[];
  justification: string;
  expiresAt: string;
  createdAt: string;
  decidedAt: string | null;
  assignedTo: string | null;
  escalatedTo: string | null;
  requiredRoles: string[];
  responses: number;
}

const TABS = [
  { id: "pending", label: "Pending" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
  { id: "expired", label: "Expired" },
  { id: "all", label: "All" },
];

export function ApprovalsList({ rows, status, mine, counts, pagination }: { rows: ApprovalRow[]; status: string; mine: boolean; counts: Record<string, number>; pagination: { page: number; pageSize: number; total: number } }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  function apply(patch: Record<string, string | null>) {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    router.push(`${pathname}?${next.toString()}`);
  }
  const pageCount = Math.max(1, Math.ceil(pagination.total / pagination.pageSize));
  const open = (s: string) => ["pending", "more_info", "escalated"].includes(s);
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={status} onValueChange={(v) => apply({ status: v, page: null })}>
          <TabsList aria-label="Approval status" className="mb-0 border-b-0">
            {TABS.map((t) => (
              <TabsTrigger key={t.id} value={t.id} count={counts[t.id]}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <label className="flex items-center gap-2 text-xs text-fg-muted">
          <Switch checked={mine} onCheckedChange={(v) => apply({ mine: v ? "1" : null, page: null })} aria-label="Only approvals assigned to me or unassigned" />
          Mine
        </label>
      </div>
      <div className="mt-3 overflow-hidden rounded-panel border border-line bg-bg-elev">
        {rows.length === 0 ? (
          <EmptyState icon={CheckSquare} title={status === "pending" ? "Nothing waiting for a decision" : "No approvals in this state"} description={status === "pending" ? "Approval requests appear here the moment a policy requires a human." : undefined} />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.id}>
                <Link href={`/approvals/${r.id}`} className="block px-4 py-3 transition-colors duration-150 hover:bg-bg-elev-2/60 focus-visible:bg-bg-elev-2 focus-visible:outline-none">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge status={r.status} />
                        <span className="text-sm font-medium text-fg">{r.agentName}</span>
                        <span className="text-fg-dim">wants to</span>
                        <span className="font-mono text-xs text-fg">
                          {r.toolKey} / {r.action}
                        </span>
                        {r.targetSystem ? <span className="text-xs text-fg-muted">on {r.targetSystem}</span> : null}
                        <Badge tone={statusTone(r.riskTier)}>{r.riskTier} risk agent</Badge>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted">
                        {r.amount !== null ? <span className="text-sm font-semibold tabular text-fg">{formatMoney(r.amount, r.currency ?? "AED")}</span> : null}
                        {r.toAccount ? <span className="font-mono">to {r.toAccount}</span> : null}
                        {r.destination ? <span className="font-mono">to {r.destination}</span> : null}
                        {r.orderId ? <span className="font-mono">order {r.orderId}</span> : null}
                        {r.triggeringRule ? <span className="font-mono">rule {r.triggeringRule}</span> : null}
                      </div>
                      {r.justification ? <p className="mt-1 truncate text-xs text-fg-muted">&ldquo;{r.justification}&rdquo;</p> : null}
                      {r.riskIndicators.length ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {r.riskIndicators.map((i) => (
                            <Badge key={i} tone="approval" mono>
                              {i}
                            </Badge>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1 text-xs text-fg-muted">
                      {open(r.status) ? (
                        <span>
                          Expires in <Countdown until={r.expiresAt} className="font-medium" />
                        </span>
                      ) : r.decidedAt ? (
                        <span>
                          Decided <TimeAgo value={r.decidedAt} />
                        </span>
                      ) : (
                        <span>
                          Expired <TimeAgo value={r.expiresAt} />
                        </span>
                      )}
                      <span>
                        Requested <TimeAgo value={r.createdAt} />
                      </span>
                      {r.escalatedTo ? <Badge tone="critical">escalated to {r.escalatedTo}</Badge> : r.assignedTo ? <Badge tone="info">assigned to {r.assignedTo}</Badge> : r.requiredRoles.length ? <span className="text-fg-dim">roles: {r.requiredRoles.join(", ")}</span> : null}
                      <span className="inline-flex items-center gap-0.5 text-accent">
                        Review <ArrowUpRight className="h-3 w-3" aria-hidden />
                      </span>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      {pagination.total > pagination.pageSize ? (
        <div className="mt-3 flex items-center justify-end gap-2 text-xs text-fg-muted">
          <IconButton label="Previous page" size="sm" disabled={pagination.page <= 1} onClick={() => apply({ page: String(pagination.page - 1) })}>
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </IconButton>
          <span className="tabular">
            Page {pagination.page} of {pageCount}
          </span>
          <IconButton label="Next page" size="sm" disabled={pagination.page >= pageCount} onClick={() => apply({ page: String(pagination.page + 1) })}>
            <ChevronRight className="h-4 w-4" aria-hidden />
          </IconButton>
        </div>
      ) : null}
    </div>
  );
}
