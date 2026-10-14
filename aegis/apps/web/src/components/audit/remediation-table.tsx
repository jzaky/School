"use client";
import { useRegion } from "@/components/region-provider";
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { ListChecks, Paperclip, X } from "lucide-react";
import { attachEvidenceAction, transitionTaskAction, updateTaskAction } from "@/server/actions/audit";
import { DataTable } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { StatusCell } from "@/components/ui/status";
import { Sheet } from "@/components/ui/sheet";
import { KeyValue } from "@/components/ui/key-value";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { Field, FormError, Input, Textarea } from "@/components/ui/input";
import { Timeline } from "@/components/ui/timeline";
import { EmptyState } from "@/components/ui/empty-state";
import { TimeAgo } from "@/components/ui/time";
import { formatDateTime } from "@/lib/utils";
import { remediationLabel, remediationTone, toDateInput } from "./format";

export interface TaskHistoryEntry {
  at: string;
  by: string | null;
  byName: string | null;
  from: string | null;
  to: string;
  note: string;
}

export interface TaskRow {
  id: string;
  title: string;
  description: string;
  status: string;
  ownerId: string | null;
  ownerName: string | null;
  dueAt: string | null;
  overdue: boolean;
  updatedAt: string;
  createdAt: string;
  finding: { id: string; code: string; title: string; assessmentId: string; status: string } | null;
  evidenceDocumentIds: string[];
  history: TaskHistoryEntry[];
}

export interface TaskFilters {
  status: string;
  ownerId: string;
  overdue: string;
}

const ALL = "__all__";
const STATUSES = ["open", "in_progress", "review", "resolved", "reopened"];
const TRANSITIONS: Record<string, string[]> = { open: ["in_progress"], in_progress: ["review"], review: ["resolved", "in_progress"], resolved: ["reopened"], reopened: ["in_progress"] };
const TRANSITION_LABELS: Record<string, string> = { in_progress: "Start work", review: "Request review", resolved: "Mark resolved", reopened: "Reopen" };

const columns: ColumnDef<TaskRow, unknown>[] = [
  { id: "title", header: "Task", enableHiding: false, cell: ({ row }) => <span className="block truncate font-medium text-fg">{row.original.title}</span>, meta: { width: 320 } },
  {
    id: "finding",
    header: "Finding / control",
    cell: ({ row }) =>
      row.original.finding ? (
        <Link href={`/audit/assessments/${row.original.finding.assessmentId}`} className="text-accent hover:underline" data-no-row-click>
          <span className="font-mono text-xs">{row.original.finding.code}</span> {row.original.finding.title}
        </Link>
      ) : (
        <span className="text-fg-dim">not linked</span>
      ),
  },
  { id: "owner", header: "Owner", cell: ({ row }) => row.original.ownerName ?? <span className="text-fg-dim">unassigned</span> },
  {
    id: "due",
    header: "Due",
    cell: ({ row }) =>
      row.original.dueAt ? (
        <span className="inline-flex items-center gap-2">
          <span>{row.original.dueAt.slice(0, 10)}</span>
          {row.original.overdue ? <Badge tone="deny">Overdue</Badge> : null}
        </span>
      ) : (
        <span className="text-fg-dim">none</span>
      ),
    meta: { width: 170 },
  },
  { id: "status", header: "Status", cell: ({ row }) => <StatusCell status={row.original.status} label={remediationLabel(row.original.status)} />, meta: { width: 120 } },
  { id: "updated", header: "Updated", cell: ({ row }) => <TimeAgo value={row.original.updatedAt} />, meta: { width: 90 } },
];

export function RemediationTable({ rows, pagination, filters, owners, documents, canWrite, initialTaskId }: { rows: TaskRow[]; pagination: { page: number; pageSize: number; total: number }; filters: TaskFilters; owners: { userId: string; name: string; roleName: string }[]; documents: { id: string; title: string; status: string }[]; canWrite: boolean; initialTaskId?: string }) {
  const region = useRegion();
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [selectedId, setSelectedId] = React.useState<string | null>(initialTaskId ?? null);
  const selected = rows.find((r) => r.id === selectedId) ?? null;
  const [transitionTo, setTransitionTo] = React.useState<string | null>(null);
  const [note, setNote] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [docId, setDocId] = React.useState<string | null>(null);
  const [editOwner, setEditOwner] = React.useState<string | null>(null);
  const [editDue, setEditDue] = React.useState("");

  React.useEffect(() => {
    setTransitionTo(null);
    setNote("");
    setError(null);
    setDocId(null);
    setEditOwner(selected?.ownerId ?? null);
    setEditDue(toDateInput(selected?.dueAt));
  }, [selected?.id, selected?.ownerId, selected?.dueAt]);

  function apply(patch: Record<string, string>) {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (!v || v === ALL) next.delete(k);
      else next.set(k, v);
    }
    next.delete("page");
    router.push(`${pathname}?${next.toString()}`);
  }
  const hasFilters = Boolean((filters.status && filters.status !== "active") || filters.ownerId || filters.overdue === "true");
  const reason = canWrite ? undefined : "Requires audit:write";
  const needsNote = transitionTo === "reopened" || (transitionTo === "in_progress" && selected?.status === "review");

  async function doTransition() {
    if (!selected || !transitionTo) return;
    setPending(true);
    setError(null);
    const r = await transitionTaskAction(selected.id, { status: transitionTo, note });
    setPending(false);
    if (!r.ok) return setError(r.error);
    toast.success(`Task moved to ${remediationLabel(r.data.status).toLowerCase()}`);
    setTransitionTo(null);
    setNote("");
    router.refresh();
  }

  async function doAttach() {
    if (!selected || !docId) return;
    setPending(true);
    setError(null);
    const r = await attachEvidenceAction(selected.id, docId);
    setPending(false);
    if (!r.ok) return setError(r.error);
    toast.success("Evidence attached");
    setDocId(null);
    router.refresh();
  }

  async function saveDetails() {
    if (!selected) return;
    setPending(true);
    setError(null);
    const r = await updateTaskAction(selected.id, { ownerId: editOwner, dueAt: editDue ? new Date(`${editDue}T12:00:00Z`).toISOString() : null });
    setPending(false);
    if (!r.ok) return setError(r.error);
    toast.success("Task updated");
    router.refresh();
  }

  const docById = new Map(documents.map((d) => [d.id, d]));
  const detailsDirty = !!selected && (editOwner !== selected.ownerId || editDue !== toDateInput(selected.dueAt));

  return (
    <>
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(r) => r.id}
        onRowClick={(r) => setSelectedId(r.id)}
        pagination={pagination}
        storageKey="remediation"
        caption="Remediation tasks"
        emptyState={<EmptyState icon={ListChecks} title={hasFilters ? "No tasks match these filters" : "No remediation tasks"} description={hasFilters ? "Try clearing the filters." : "A remediation task tracks the work to fix a gap. Create one from an assessment finding, or directly with New task."} action={hasFilters ? <Button size="sm" onClick={() => router.push(pathname)}>Clear filters</Button> : undefined} />}
        toolbar={
          <>
            <Select aria-label="Status" value={filters.status || "active"} onValueChange={(v) => apply({ status: v })} className="w-40" options={[{ value: "active", label: "Active (not resolved)" }, { value: "all", label: "All statuses" }, ...STATUSES.map((s) => ({ value: s, label: remediationLabel(s) }))]} />
            <Select aria-label="Owner" value={filters.ownerId || ALL} onValueChange={(v) => apply({ ownerId: v })} className="w-48" options={[{ value: ALL, label: "All owners" }, ...owners.map((o) => ({ value: o.userId, label: o.name }))]} />
            <Select aria-label="Overdue" value={filters.overdue === "true" ? "true" : ALL} onValueChange={(v) => apply({ overdue: v })} className="w-36" options={[{ value: ALL, label: "Any due date" }, { value: "true", label: "Overdue only" }]} />
            {hasFilters ? (
              <Button variant="ghost" size="sm" onClick={() => router.push(pathname)}>
                <X className="h-3.5 w-3.5" aria-hidden />
                Clear
              </Button>
            ) : null}
          </>
        }
      />
      <Sheet open={selected !== null} onOpenChange={(o) => !o && setSelectedId(null)} title={selected?.title ?? ""} description={selected ? <span>{remediationLabel(selected.status)}{selected.overdue ? ", overdue" : ""}</span> : undefined} width="lg">
        {selected ? (
          <div className="space-y-5" data-testid="task-sheet">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={remediationTone(selected.status)}>{remediationLabel(selected.status)}</Badge>
              {selected.overdue ? <Badge tone="deny">Overdue</Badge> : null}
              {selected.finding ? (
                <Link href={`/audit/assessments/${selected.finding.assessmentId}`} className="text-xs text-accent hover:underline">
                  Finding {selected.finding.code}: {selected.finding.title}
                </Link>
              ) : null}
            </div>
            {selected.description ? <p className="whitespace-pre-wrap text-sm text-fg">{selected.description}</p> : <p className="text-xs text-fg-dim">No description.</p>}
            <KeyValue
              columns={2}
              items={[
                { label: "Owner", value: selected.ownerName ?? null },
                { label: "Due", value: selected.dueAt ? formatDateTime(selected.dueAt, region) : null },
                { label: "Created", value: formatDateTime(selected.createdAt, region) },
                { label: "Updated", value: formatDateTime(selected.updatedAt, region) },
              ]}
            />

            <section className="space-y-2">
              <h3 className="text-xs font-medium uppercase tracking-wide text-fg-muted">Change status</h3>
              <div className="flex flex-wrap gap-2">
                {(TRANSITIONS[selected.status] ?? []).map((to) => (
                  <Button key={to} size="sm" variant={transitionTo === to ? "primary" : "secondary"} disabled={!canWrite} disabledReason={reason} onClick={() => setTransitionTo(transitionTo === to ? null : to)}>
                    {TRANSITION_LABELS[to] ?? remediationLabel(to)}
                  </Button>
                ))}
                {(TRANSITIONS[selected.status] ?? []).length === 0 ? <span className="text-xs text-fg-dim">No further status changes are available.</span> : null}
              </div>
              {transitionTo ? (
                <div className="space-y-2 rounded-md border border-line bg-bg p-3">
                  <Field label="Note" htmlFor="task-transition-note" hint={needsNote ? "required" : "optional"}>
                    <Textarea id="task-transition-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} rows={2} autoFocus />
                  </Field>
                  <div className="flex gap-2">
                    <Button size="sm" variant="primary" loading={pending} disabled={needsNote && note.trim().length < 3} disabledReason="Enter a note of at least 3 characters" onClick={doTransition}>
                      Confirm: {TRANSITION_LABELS[transitionTo] ?? remediationLabel(transitionTo)}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setTransitionTo(null)} disabled={pending}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : null}
            </section>

            <section className="space-y-2">
              <h3 className="text-xs font-medium uppercase tracking-wide text-fg-muted">Owner and due date</h3>
              <div className="grid gap-2 md:grid-cols-[1fr_160px_auto] md:items-end">
                <Field label="Owner" htmlFor="task-owner-edit">
                  <Combobox id="task-owner-edit" value={editOwner} onChange={setEditOwner} options={owners.map((o) => ({ value: o.userId, label: o.name, description: o.roleName }))} placeholder="Unassigned" allowClear disabled={!canWrite} />
                </Field>
                <Field label="Due" htmlFor="task-due-edit">
                  <Input id="task-due-edit" type="date" value={editDue} onChange={(e) => setEditDue(e.target.value)} disabled={!canWrite} />
                </Field>
                <Button size="md" loading={pending} disabled={!canWrite || !detailsDirty} disabledReason={reason ?? "No changes to save"} onClick={saveDetails}>
                  Save
                </Button>
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="text-xs font-medium uppercase tracking-wide text-fg-muted">Evidence documents ({selected.evidenceDocumentIds.length})</h3>
              {selected.evidenceDocumentIds.length ? (
                <ul className="divide-y divide-line rounded-md border border-line">
                  {selected.evidenceDocumentIds.map((id) => (
                    <li key={id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                      <span className="truncate">{docById.get(id)?.title ?? `Document ${id.slice(0, 8)} (deleted)`}</span>
                      <Link href="/audit/documents" className="text-xs text-accent hover:underline">
                        Documents
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-fg-dim">No evidence attached.</p>
              )}
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Attach document" htmlFor="task-evidence" className="min-w-[260px] flex-1">
                  <Select id="task-evidence" value={docId ?? ""} onValueChange={setDocId} disabled={!canWrite || documents.length === 0} placeholder={documents.length === 0 ? "No documents uploaded" : "Choose a document"} options={documents.filter((d) => !selected.evidenceDocumentIds.includes(d.id)).map((d) => ({ value: d.id, label: d.title }))} />
                </Field>
                <Button size="md" loading={pending} disabled={!canWrite || !docId} disabledReason={reason ?? "Choose a document"} onClick={doAttach}>
                  <Paperclip className="h-3.5 w-3.5" aria-hidden />
                  Attach
                </Button>
              </div>
            </section>

            <section>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-muted">History</h3>
              <Timeline
                items={[...selected.history].reverse().map((h, i) => ({
                  id: `${h.at}-${i}`,
                  title: h.from && h.from !== h.to ? `${remediationLabel(h.from)} to ${remediationLabel(h.to)}` : h.note || remediationLabel(h.to),
                  meta: `${h.byName ?? "System"}${h.from && h.from !== h.to && h.note ? `: ${h.note}` : ""}`,
                  time: formatDateTime(h.at, region),
                  tone: remediationTone(h.to),
                }))}
              />
            </section>
            <FormError error={error} />
          </div>
        ) : null}
      </Sheet>
    </>
  );
}
