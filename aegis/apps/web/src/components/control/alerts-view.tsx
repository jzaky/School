"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, ArrowUpRight, Check, CheckCheck, Play } from "lucide-react";
import { acknowledgeAlertAction, resolveAlertAction, runMonitoringAction } from "@/server/actions/assurance";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button, IconButton } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { StatusBadge, StatusCell } from "@/components/ui/status";
import { CodeBlock } from "@/components/ui/code-block";
import { KeyValue } from "@/components/ui/key-value";
import { EmptyState } from "@/components/ui/empty-state";
import { SimpleTable, Td, Th, Tr } from "@/components/ui/simple-table";
import { TimeAgo, DateTime } from "@/components/ui/time";
import { Note } from "@/components/ui/note";
import { statusLabel, statusTone } from "@/lib/status";
import { ChevronLeft, ChevronRight } from "lucide-react";

export interface AlertRow {
  id: string;
  severity: string;
  status: string;
  title: string;
  ruleKey: string | null;
  ruleName: string | null;
  ruleDescription: string | null;
  agentId: string | null;
  agentName: string | null;
  createdAt: string;
  acknowledgedBy: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  detail: string;
  requestIds: string[];
  approvalRequestId: string | null;
}

const TABS = [
  { id: "open", label: "Open" },
  { id: "acknowledged", label: "Acknowledged" },
  { id: "resolved", label: "Resolved" },
  { id: "all", label: "All" },
];
const ALL = "__all__";

export function AlertsView({ rows, status, severity, counts, pagination, canWrite, focus }: { rows: AlertRow[]; status: string; severity: string; counts: Record<string, number>; pagination: { page: number; pageSize: number; total: number }; canWrite: boolean; focus?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [openId, setOpenId] = React.useState<string | null>(focus ?? null);
  const [resolving, setResolving] = React.useState<AlertRow | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [running, setRunning] = React.useState(false);
  const [lastRun, setLastRun] = React.useState<{ evaluated: number; newAlerts: number; errors: string[] } | null>(null);
  const open = rows.find((r) => r.id === openId) ?? null;

  function apply(patch: Record<string, string | null>) {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "" || v === ALL) next.delete(k);
      else next.set(k, v);
    }
    router.push(`${pathname}?${next.toString()}`);
  }
  async function acknowledge(a: AlertRow) {
    setBusy(a.id);
    const r = await acknowledgeAlertAction(a.id);
    setBusy(null);
    if (!r.ok) return toast.error(r.error);
    toast.success("Alert acknowledged");
    router.refresh();
  }
  async function runNow() {
    setRunning(true);
    const r = await runMonitoringAction();
    setRunning(false);
    if (!r.ok) return toast.error(r.error);
    setLastRun(r.data);
    toast.success(`${r.data.evaluated} rules evaluated, ${r.data.newAlerts} new alert${r.data.newAlerts === 1 ? "" : "s"}`);
    router.refresh();
  }
  const pageCount = Math.max(1, Math.ceil(pagination.total / pagination.pageSize));

  const actions = (a: AlertRow, size: "sm" | "md" = "sm") => (
    <div className="flex flex-wrap justify-end gap-1" data-no-row-click>
      <Button size={size} variant="ghost" loading={busy === a.id} onClick={() => acknowledge(a)} disabled={!canWrite || a.status !== "open"} disabledReason={!canWrite ? "Requires monitoring:write" : a.status === "resolved" ? "Already resolved" : "Already acknowledged"}>
        <Check className="h-3.5 w-3.5" aria-hidden />
        Acknowledge
      </Button>
      <Button size={size} variant="ghost" onClick={() => setResolving(a)} disabled={!canWrite || a.status === "resolved"} disabledReason={!canWrite ? "Requires monitoring:write" : "Already resolved"}>
        <CheckCheck className="h-3.5 w-3.5" aria-hidden />
        Resolve
      </Button>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={status} onValueChange={(v) => apply({ status: v, page: null })}>
          <TabsList aria-label="Alert status" className="mb-0 border-b-0">
            {TABS.map((t) => (
              <TabsTrigger key={t.id} value={t.id} count={counts[t.id]}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Severity" value={severity || ALL} onChange={(e) => apply({ severity: e.target.value, page: null })} className="h-8 rounded-md border border-line bg-bg px-2 text-sm text-fg outline-none focus:border-accent">
            <option value={ALL}>All severities</option>
            {["critical", "high", "medium", "low"].map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </select>
          <Button variant="primary" size="sm" loading={running} onClick={runNow} disabled={!canWrite} disabledReason="Requires monitoring:write">
            <Play className="h-3.5 w-3.5" aria-hidden />
            Run monitoring now
          </Button>
        </div>
      </div>
      {lastRun ? (
        <Note tone={lastRun.errors.length ? "warning" : "info"}>
          Monitoring ran: {lastRun.evaluated} rules evaluated, {lastRun.newAlerts} new alert{lastRun.newAlerts === 1 ? "" : "s"}. {lastRun.newAlerts === 0 ? "Existing situations dedupe to their open alert." : ""}
          {lastRun.errors.length ? ` Errors: ${lastRun.errors.join("; ")}` : ""}
        </Note>
      ) : null}
      {rows.length === 0 ? (
        <div className="rounded-panel border border-line bg-bg-elev">
          <EmptyState icon={AlertTriangle} title={status === "open" ? "No open alerts" : "No alerts in this state"} description="Deterministic rules run on a schedule and whenever you run monitoring." />
        </div>
      ) : (
        <SimpleTable caption="Alerts">
          <thead>
            <tr>
              <Th>Severity</Th>
              <Th>Rule</Th>
              <Th>Alert</Th>
              <Th>Agent</Th>
              <Th>Status</Th>
              <Th>Created</Th>
              <Th>Handled by</Th>
              <Th align="end">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <Tr
                key={a.id}
                tabIndex={0}
                role="button"
                aria-label={`Open alert ${a.title}`}
                className="cursor-pointer focus-visible:bg-bg-elev-2 focus-visible:outline-none"
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest("button, a, [data-no-row-click]")) return;
                  setOpenId(a.id);
                }}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setOpenId(a.id);
                  }
                }}
              >
                <Td>
                  <Badge tone={statusTone(a.severity)}>{statusLabel(a.severity)}</Badge>
                </Td>
                <Td>
                  <span className="block font-mono text-xs">{a.ruleKey ?? "deleted rule"}</span>
                  <span className="block truncate text-xs text-fg-muted">{a.ruleName}</span>
                </Td>
                <Td className="max-w-[360px] truncate" title={a.title}>
                  {a.title}
                </Td>
                <Td>{a.agentId ? <Link href={`/agents/${a.agentId}`} className="text-accent hover:underline" data-no-row-click>{a.agentName ?? "agent"}</Link> : <span className="text-fg-dim">none</span>}</Td>
                <Td>
                  <StatusCell status={a.status} />
                </Td>
                <Td>
                  <TimeAgo value={a.createdAt} />
                </Td>
                <Td className="text-xs text-fg-muted">{a.resolvedBy ? `Resolved by ${a.resolvedBy}` : a.acknowledgedBy ? `Acknowledged by ${a.acknowledgedBy}` : ""}</Td>
                <Td align="end">{actions(a)}</Td>
              </Tr>
            ))}
          </tbody>
        </SimpleTable>
      )}
      {pagination.total > pagination.pageSize ? (
        <div className="flex items-center justify-end gap-2 text-xs text-fg-muted">
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

      <Sheet open={open !== null} onOpenChange={(o) => !o && setOpenId(null)} title={open?.title ?? ""} description={open ? `${open.ruleKey ?? "rule"}: ${open.ruleName ?? ""}` : undefined} width="lg" footer={open ? actions(open, "md") : undefined}>
        {open ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={statusTone(open.severity)}>{statusLabel(open.severity)}</Badge>
              <StatusBadge status={open.status} />
              {open.agentId ? (
                <Link href={`/agents/${open.agentId}`} className="inline-flex items-center gap-0.5 text-sm text-accent hover:underline">
                  {open.agentName ?? "agent"} <ArrowUpRight className="h-3 w-3" aria-hidden />
                </Link>
              ) : null}
            </div>
            {open.ruleDescription ? <p className="text-sm text-fg-muted">{open.ruleDescription}</p> : null}
            <KeyValue
              items={[
                { label: "Created", value: <DateTime value={open.createdAt} /> },
                { label: "Acknowledged by", value: open.acknowledgedBy },
                { label: "Resolved by", value: open.resolvedBy ? `${open.resolvedBy}` : null },
                { label: "Resolved at", value: open.resolvedAt ? <DateTime value={open.resolvedAt} /> : null },
              ]}
            />
            {open.requestIds.length || open.approvalRequestId ? (
              <div className="flex flex-wrap gap-1 text-xs">
                <span className="text-fg-dim">Related:</span>
                {open.requestIds.map((id) => (
                  <Link key={id} href={`/gateway/${id}`} className="font-mono text-accent hover:underline">
                    request {id.slice(0, 8)}
                  </Link>
                ))}
                {open.approvalRequestId ? (
                  <Link href={`/approvals/${open.approvalRequestId}`} className="font-mono text-accent hover:underline">
                    approval {open.approvalRequestId.slice(0, 8)}
                  </Link>
                ) : null}
              </div>
            ) : null}
            <CodeBlock label="Detail (definition that produced it, counts and references)" code={open.detail} wrap />
            <Note>Rules are deterministic: the definition above with the stored counts reproduces this alert. No scoring or prediction is involved.</Note>
          </div>
        ) : null}
      </Sheet>
      <ConfirmDialog
        open={resolving !== null}
        onOpenChange={(o) => !o && setResolving(null)}
        title="Resolve alert"
        description={resolving?.title}
        confirmLabel="Resolve"
        reason={{ label: "Resolution note", required: true, placeholder: "What was checked and why this is closed" }}
        onConfirm={async ({ reason }) => {
          if (!resolving) return;
          const r = await resolveAlertAction(resolving.id, reason);
          if (!r.ok) return r.error;
          toast.success("Alert resolved");
          setOpenId(null);
          router.refresh();
        }}
      />
    </div>
  );
}
