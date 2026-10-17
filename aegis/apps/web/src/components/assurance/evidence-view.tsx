"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { ArrowUpRight, Download, ScrollText, Search, ShieldCheck, X } from "lucide-react";
import { exportEvidenceAction, getEvidenceEventAction, verifyChainAction, type EvidenceDetail } from "@/server/actions/assurance";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { CodeBlock, CopyButton } from "@/components/ui/code-block";
import { KeyValue } from "@/components/ui/key-value";
import { EmptyState } from "@/components/ui/empty-state";
import { TimeAgo, DateTime } from "@/components/ui/time";
import { Note } from "@/components/ui/note";
import { Skeleton } from "@/components/ui/skeleton";
import { downloadText } from "@/components/ui/download";

export interface EvidenceRow {
  id: string;
  seq: string;
  occurredAt: string;
  type: string;
  actor: string;
  actorType: string;
  subjectType: string;
  subjectId: string | null;
  subjectLabel: string | null;
  href: string | null;
  correlationId: string | null;
  hash: string;
}

export interface EvidenceFilters {
  type: string;
  subjectType: string;
  correlationId: string;
  since: string;
  until: string;
  q: string;
}

const columns: ColumnDef<EvidenceRow, unknown>[] = [
  { id: "seq", header: "Seq", enableHiding: false, cell: ({ row }) => <span className="font-mono text-xs tabular">{row.original.seq}</span>, meta: { width: 80 } },
  { id: "time", header: "Time", cell: ({ row }) => <TimeAgo value={row.original.occurredAt} />, meta: { width: 100 } },
  { id: "type", header: "Type", cell: ({ row }) => <span className="font-mono text-xs">{row.original.type}</span> },
  { id: "actor", header: "Actor", cell: ({ row }) => <span>{row.original.actor}</span> },
  {
    id: "subject",
    header: "Subject",
    cell: ({ row }) =>
      row.original.href ? (
        <Link href={row.original.href} className="inline-flex items-center gap-0.5 text-accent hover:underline" data-no-row-click>
          {row.original.subjectLabel ?? row.original.subjectType.replace(/_/g, " ")}
          {!row.original.subjectLabel && row.original.subjectId ? <span className="font-mono text-[11px]"> {row.original.subjectId.slice(0, 8)}</span> : null}
          <ArrowUpRight className="h-3 w-3" aria-hidden />
        </Link>
      ) : (
        <span className="text-fg-muted">
          {row.original.subjectType.replace(/_/g, " ")}
          {row.original.subjectId ? <span className="font-mono text-[11px]"> {row.original.subjectId.slice(0, 8)}</span> : null}
        </span>
      ),
  },
  { id: "correlation", header: "Correlation", cell: ({ row }) => (row.original.correlationId ? <span className="font-mono text-[11px] text-fg-muted" title={row.original.correlationId}>{row.original.correlationId.slice(0, 14)}</span> : <span className="text-fg-dim">none</span>) },
  {
    id: "hash",
    header: "Hash",
    cell: ({ row }) => (
      <span className="inline-flex items-center gap-1" data-no-row-click>
        <span className="font-mono text-[11px] text-fg-muted" title={row.original.hash}>
          {row.original.hash.slice(0, 12)}
        </span>
        <CopyButton value={row.original.hash} label="Copy hash" />
      </span>
    ),
  },
];

export function EvidenceView({ rows, pagination, filters, types, subjectTypes, initialChain }: { rows: EvidenceRow[]; pagination: { page: number; pageSize: number; total: number }; filters: EvidenceFilters; types: { type: string; count: number }[]; subjectTypes: string[]; initialChain: { valid: boolean; checked: number; firstBadSeq: string | null; reason: string | null; checkpoints: number } }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [local, setLocal] = React.useState(filters);
  React.useEffect(() => setLocal(filters), [filters]);
  const [verifying, setVerifying] = React.useState(false);
  const [chain, setChain] = React.useState(initialChain);
  const [exporting, setExporting] = React.useState<string | null>(null);
  const [lastExport, setLastExport] = React.useState<{ filename: string; sha256: string; count: number; valid: boolean } | null>(null);
  const [openSeq, setOpenSeq] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<EvidenceDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = React.useState(false);

  function apply(patch: Partial<EvidenceFilters>) {
    const next = new URLSearchParams(sp.toString());
    const merged = { ...local, ...patch };
    for (const [k, v] of Object.entries(merged)) {
      if (!v) next.delete(k);
      else next.set(k, v);
    }
    next.delete("page");
    router.push(`${pathname}?${next.toString()}`);
  }
  const hasFilters = Object.values(filters).some(Boolean);

  async function verify() {
    setVerifying(true);
    const r = await verifyChainAction();
    setVerifying(false);
    if (!r.ok) return toast.error(r.error);
    setChain({ valid: r.data.valid, checked: r.data.checked, firstBadSeq: r.data.firstBadSeq, reason: r.data.reason, checkpoints: r.data.checkpoints.length });
    if (r.data.valid) toast.success(`Chain valid: ${r.data.checked} events recomputed, ${r.data.checkpoints.length} checkpoints checked`);
    else toast.error(`Chain invalid at seq ${r.data.firstBadSeq ?? "checkpoint"}: ${r.data.reason}`);
    router.refresh();
  }
  async function doExport(format: "jsonl" | "csv") {
    setExporting(format);
    const r = await exportEvidenceAction({ format, type: filters.type, subjectType: filters.subjectType, correlationId: filters.correlationId, since: filters.since, until: filters.until });
    setExporting(null);
    if (!r.ok) return toast.error(r.error);
    downloadText(r.data.filename, r.data.body, r.data.contentType);
    setLastExport({ filename: r.data.filename, sha256: r.data.sha256, count: r.data.count, valid: r.data.valid });
    toast.success(`Exported ${r.data.count} events`);
  }
  async function openEvent(seq: string) {
    setOpenSeq(seq);
    setDetail(null);
    setLoadingDetail(true);
    const r = await getEvidenceEventAction(seq);
    setLoadingDetail(false);
    if (!r.ok) {
      toast.error(r.error);
      setOpenSeq(null);
      return;
    }
    setDetail(r.data);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" loading={verifying} onClick={verify}>
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
          Verify chain now
        </Button>
        <span data-testid="chain-status">
          <Badge tone={chain.valid ? "allow" : "deny"}>{chain.valid ? `Chain valid: ${chain.checked} events, ${chain.checkpoints} checkpoints` : `Chain invalid${chain.firstBadSeq ? ` at seq ${chain.firstBadSeq}` : ""}: ${chain.reason}`}</Badge>
        </span>
        <div className="ms-auto flex items-center gap-2">
          <Button size="sm" loading={exporting === "jsonl"} disabled={exporting !== null} onClick={() => doExport("jsonl")}>
            <Download className="h-3.5 w-3.5" aria-hidden />
            Export JSON Lines
          </Button>
          <Button size="sm" loading={exporting === "csv"} disabled={exporting !== null} onClick={() => doExport("csv")}>
            <Download className="h-3.5 w-3.5" aria-hidden />
            Export CSV
          </Button>
        </div>
      </div>
      {lastExport ? (
        <Note>
          Exported <span className="font-mono">{lastExport.filename}</span> with {lastExport.count} events. File fingerprint (SHA-256) <span className="font-mono">{lastExport.sha256}</span>. The chain was {lastExport.valid ? "valid" : "invalid"} at export time, and the export itself is recorded in the ledger.
        </Note>
      ) : null}
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(r) => r.id}
        onRowClick={(r) => void openEvent(r.seq)}
        pagination={pagination}
        storageKey="evidence"
        caption="Evidence events"
        emptyState={<EmptyState icon={ScrollText} title={hasFilters ? "No events match these filters" : "No evidence yet"} action={hasFilters ? <Button size="sm" onClick={() => router.push(pathname)}>Clear filters</Button> : undefined} />}
        toolbar={
          <form
            role="search"
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              apply({});
            }}
          >
            <div className="relative">
              <Search className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-dim" aria-hidden />
              <Input aria-label="Search evidence" placeholder="Search by type, subject or the start of a hash" value={local.q} onChange={(e) => setLocal({ ...local, q: e.target.value })} className="w-56 ps-8" />
            </div>
            <Input aria-label="Event type" list="evidence-types" placeholder="Event type (prefix* allowed)" value={local.type} onChange={(e) => setLocal({ ...local, type: e.target.value })} className="w-52 font-mono text-xs" />
            <datalist id="evidence-types">
              {types.map((t) => (
                <option key={t.type} value={t.type}>
                  {t.count}
                </option>
              ))}
            </datalist>
            <select aria-label="Subject type" value={local.subjectType} onChange={(e) => apply({ subjectType: e.target.value })} className="h-8 rounded-md border border-line bg-bg px-2 text-sm text-fg outline-none focus:border-accent">
              <option value="">All subjects</option>
              {subjectTypes.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, " ")}
                </option>
              ))}
            </select>
            <Input aria-label="Correlation id" placeholder="Correlation id" value={local.correlationId} onChange={(e) => setLocal({ ...local, correlationId: e.target.value })} className="w-44 font-mono text-xs" />
            <Input type="date" aria-label="Since" value={local.since} onChange={(e) => apply({ since: e.target.value })} className="w-36" />
            <Input type="date" aria-label="Until" value={local.until} onChange={(e) => apply({ until: e.target.value })} className="w-36" />
            <Button type="submit" size="sm">
              Apply
            </Button>
            {hasFilters ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => router.push(pathname)}>
                <X className="h-3.5 w-3.5" aria-hidden />
                Clear
              </Button>
            ) : null}
          </form>
        }
      />
      <Sheet open={openSeq !== null} onOpenChange={(o) => !o && setOpenSeq(null)} title={detail ? `Event #${detail.event.seq}` : `Event #${openSeq ?? ""}`} description={detail?.event.type} width="lg">
        {loadingDetail || !detail ? (
          <div className="space-y-3" role="status" aria-label="Loading">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-24" />
            <Skeleton className="h-40" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={detail.verified ? "allow" : "deny"}>{detail.verified ? "Hash recomputed and verified" : "Hash check failed: this record does not match its fingerprint"}</Badge>
              {detail.event.subjectHref ? (
                <Link href={detail.event.subjectHref} className="inline-flex items-center gap-0.5 text-sm text-accent hover:underline">
                  Open {detail.event.subjectType.replace(/_/g, " ")} <ArrowUpRight className="h-3 w-3" aria-hidden />
                </Link>
              ) : null}
            </div>
            <KeyValue
              items={[
                { label: "Occurred", value: <DateTime value={detail.event.occurredAt} /> },
                { label: "Actor", value: `${detail.event.actor} (${detail.event.actorType})` },
                { label: "Subject", value: `${detail.event.subjectType}${detail.event.subjectId ? ` ${detail.event.subjectId}` : ""}`, mono: true },
                { label: "Correlation id", value: detail.event.correlationId, mono: true },
                { label: "Previous hash", value: detail.event.prevHash, mono: true },
                { label: "Hash", value: detail.event.hash, mono: true },
              ]}
            />
            <CodeBlock label="Payload" code={detail.event.payload} wrap />
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">Related events (same request, by correlation id)</h3>
              {detail.related.length <= 1 ? (
                <p className="text-xs text-fg-dim">No other events belong to the same request (correlation id).</p>
              ) : (
                <ul className="divide-y divide-line rounded-md border border-line">
                  {detail.related.map((r) => (
                    <li key={r.id} className={`flex items-center gap-3 px-3 py-1.5 text-xs ${r.seq === detail.event.seq ? "bg-accent/10" : ""}`}>
                      <button type="button" className="font-mono tabular text-accent hover:underline" onClick={() => void openEvent(r.seq)} disabled={r.seq === detail.event.seq}>
                        #{r.seq}
                      </button>
                      <span className="font-mono">{r.type}</span>
                      <span className="text-fg-muted">{r.actor}</span>
                      <span className="ms-auto text-fg-dim">
                        <TimeAgo value={r.occurredAt} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Sheet>
    </div>
  );
}
