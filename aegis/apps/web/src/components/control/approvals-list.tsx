"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowUpRight, CheckSquare, ChevronLeft, ChevronRight } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status";
import { Countdown } from "@/components/ui/countdown";
import { EmptyState } from "@/components/ui/empty-state";
import { TimeAgo } from "@/components/ui/time";
import { IconButton } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";
import { formatMoney } from "@/lib/utils";

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
  /** Plain-language sentence: "Refund AED 1,450.00 for order ORD-55377 to customer CUST-88213". */
  summary: string;
  targetSystem: string | null;
  amount: number | null;
  currency: string | null;
  destination: string | null;
  orderId: string | null;
  customerId: string | null;
  reason: string | null;
  toAccount: string | null;
  triggeringRule: string | null;
  /** Why a person is needed, in words (the rule description). */
  whyApproval: string | null;
  boundary: string | null;
  policyName: string | null;
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

export function ApprovalsList({ rows, status, mine, counts, pagination, canDecide }: { rows: ApprovalRow[]; status: string; mine: boolean; counts: Record<string, number>; pagination: { page: number; pageSize: number; total: number }; canDecide: boolean }) {
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
      <div className="mt-3 overflow-hidden rounded-panel border border-line bg-bg-elev" data-testid="approvals-list">
        {rows.length === 0 ? (
          <EmptyState
            icon={CheckSquare}
            title={status === "pending" ? "Nothing waiting for a decision" : "No approvals in this state"}
            description={status === "pending" ? "Requests appear here the moment a policy requires a person. To see one now, run the sample refund workflow: it asks for approval of a mid-sized refund." : undefined}
            action={status === "pending" ? <LinkButton href="/gateway/demos" size="sm">Explore a sample workflow</LinkButton> : undefined}
          />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.id} className="px-4 py-3" data-approval-row={r.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={r.status} />
                      <Link href={`/approvals/${r.id}`} className="text-sm font-medium text-fg hover:underline" data-testid="approval-summary">
                        {r.summary}
                      </Link>
                    </div>
                    <dl className="mt-1.5 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
                      <div className="flex gap-2">
                        <dt className="shrink-0 text-fg-dim">Asked by</dt>
                        <dd className="text-fg">
                          {r.agentName}
                          {r.targetSystem ? <span className="text-fg-muted"> via {r.targetSystem}</span> : null}
                        </dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="shrink-0 text-fg-dim">Reason given</dt>
                        <dd className="text-fg">{r.justification || r.reason || <span className="text-fg-dim">none</span>}</dd>
                      </div>
                      <div className="flex gap-2 sm:col-span-2">
                        <dt className="shrink-0 text-fg-dim">Why approval</dt>
                        <dd className="text-fg">
                          {r.whyApproval ?? "Required by data protection settings"}
                          {r.policyName ? <span className="text-fg-muted"> ({r.policyName})</span> : null}
                        </dd>
                      </div>
                      {r.boundary ? (
                        <div className="flex gap-2 sm:col-span-2">
                          <dt className="shrink-0 text-fg-dim">Boundary</dt>
                          <dd className="text-fg">{r.boundary}</dd>
                        </div>
                      ) : null}
                    </dl>
                    {r.riskIndicators.length ? (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {r.riskIndicators.map((i) => (
                          <Badge key={i} tone="approval" mono>
                            {i}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5 text-xs text-fg-muted">
                    {r.amount !== null ? <span className="text-base font-semibold tabular text-fg">{formatMoney(r.amount, r.currency ?? "AED")}</span> : null}
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
                    <LinkButton href={`/approvals/${r.id}`} size="sm" variant={open(r.status) && canDecide ? "primary" : "secondary"} data-testid="approval-open">
                      {open(r.status) && canDecide ? "Review and decide" : "Open"}
                      <ArrowUpRight className="h-3 w-3" aria-hidden />
                    </LinkButton>
                  </div>
                </div>
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
