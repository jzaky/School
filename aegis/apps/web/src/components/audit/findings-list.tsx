"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, ListPlus, UserCheck, X } from "lucide-react";
import { validateFindingAction } from "@/server/actions/audit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Field, FormError, Textarea } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { cn, formatDateTime } from "@/lib/utils";
import { TONE_DOT } from "@/lib/status";
import { CreateTaskDialog, type OwnerOption } from "./create-task-dialog";
import { conclusionText, findingLabel, findingTone, remediationLabel, remediationTone } from "./format";

export interface ArtifactView {
  id: string;
  kind: "automated" | "document" | "human";
  documentTitle: string | null;
  page: number | null;
  chunkIdx: number | null;
  excerpt: string;
  score: number;
  reference: string;
}

export interface FindingView {
  id: string;
  code: string;
  title: string;
  summary: string;
  category: string;
  status: string;
  humanStatus: string | null;
  effectiveStatus: string;
  conclusion: "automated" | "human_validated";
  confidence: number;
  rationale: string;
  recommendation: string;
  validatedBy: string | null;
  validatedAt: string | null;
  validationNote: string;
  resolvedAt: string | null;
  artifacts: ArtifactView[];
  tasks: { id: string; title: string; status: string; dueAt: string | null }[];
}

export interface CategoryView {
  category: string;
  counts: Record<string, number>;
  findingIds: string[];
}

const ALL = "__all__";
const STATUSES = ["covered", "partial", "ambiguous", "missing"];

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return (
    <span className="inline-flex items-center gap-2" title={`Confidence ${pct}%`}>
      <span className="h-1.5 w-24 overflow-hidden rounded-full bg-bg-elev-2" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Confidence">
        <span className={cn("block h-full rounded-full", pct >= 70 ? "bg-allow" : pct >= 40 ? "bg-approval" : "bg-deny")} style={{ width: `${pct}%` }} />
      </span>
      <span className="tabular text-xs text-fg-muted">{pct}%</span>
    </span>
  );
}

function ValidationForm({ assessmentId, finding, canWrite }: { assessmentId: string; finding: FindingView; canWrite: boolean }) {
  const router = useRouter();
  const [status, setStatus] = React.useState(finding.humanStatus ?? finding.status);
  const [note, setNote] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const r = await validateFindingAction(assessmentId, finding.id, { humanStatus: status, note });
    setPending(false);
    if (!r.ok) return setError(r.error);
    toast.success(`${finding.code} validated as ${findingLabel(status).toLowerCase()}`);
    setNote("");
    router.refresh();
  }
  return (
    <form onSubmit={submit} className="space-y-2 rounded-md border border-line bg-bg p-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-medium uppercase tracking-wide text-fg-muted">Human validation</h4>
        {finding.validatedAt ? (
          <span className="text-xs text-fg-muted">
            Validated by {finding.validatedBy ?? "a member"} on {formatDateTime(finding.validatedAt)}
          </span>
        ) : (
          <span className="text-xs text-fg-dim">Not yet validated</span>
        )}
      </div>
      {finding.validationNote ? <p className="text-xs text-fg">{finding.validationNote}</p> : null}
      <div className="grid gap-2 md:grid-cols-[180px_1fr_auto] md:items-end">
        <Field label="Status" htmlFor={`hv-status-${finding.id}`}>
          <Select id={`hv-status-${finding.id}`} value={status} onValueChange={setStatus} disabled={!canWrite} options={STATUSES.map((s) => ({ value: s, label: findingLabel(s) }))} />
        </Field>
        <Field label="Note" htmlFor={`hv-note-${finding.id}`} hint="optional">
          <Textarea id={`hv-note-${finding.id}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} rows={1} className="min-h-[32px]" disabled={!canWrite} placeholder="What you checked and why" />
        </Field>
        <Button type="submit" variant="primary" size="md" loading={pending} disabled={!canWrite} disabledReason="Requires audit:write">
          <UserCheck className="h-3.5 w-3.5" aria-hidden />
          Validate
        </Button>
      </div>
      <FormError error={error} />
    </form>
  );
}

export function FindingsList({ assessmentId, findings, categories, canWrite, owners }: { assessmentId: string; findings: FindingView[]; categories: CategoryView[]; canWrite: boolean; owners: OwnerOption[] }) {
  const [status, setStatus] = React.useState(ALL);
  const [conclusion, setConclusion] = React.useState(ALL);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [taskFor, setTaskFor] = React.useState<FindingView | null>(null);
  const byId = new Map(findings.map((f) => [f.id, f]));
  const visible = (f: FindingView) => (status === ALL || f.effectiveStatus === status) && (conclusion === ALL || f.conclusion === conclusion);
  const total = findings.filter(visible).length;
  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const filtered = status !== ALL || conclusion !== ALL;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="Status filter" value={status} onValueChange={setStatus} className="w-44" options={[{ value: ALL, label: "All statuses" }, ...STATUSES.map((s) => ({ value: s, label: findingLabel(s) }))]} />
        <Select aria-label="Conclusion filter" value={conclusion} onValueChange={setConclusion} className="w-44" options={[{ value: ALL, label: "All conclusions" }, { value: "automated", label: "Automated" }, { value: "human_validated", label: "Human validated" }]} />
        <span className="text-xs text-fg-muted">
          {total} of {findings.length} findings
        </span>
        {filtered ? (
          <Button variant="ghost" size="sm" onClick={() => { setStatus(ALL); setConclusion(ALL); }}>
            <X className="h-3.5 w-3.5" aria-hidden />
            Clear
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" className="ms-auto" onClick={() => setExpanded(expanded.size ? new Set() : new Set(findings.map((f) => f.id)))}>
          {expanded.size ? "Collapse all" : "Expand all"}
        </Button>
      </div>
      {total === 0 ? <EmptyState title="No findings match these filters" /> : null}
      {categories.map((cat) => {
        const list = cat.findingIds.map((id) => byId.get(id)).filter((f): f is FindingView => !!f && visible(f));
        if (list.length === 0) return null;
        return (
          <section key={cat.category} className="rounded-panel border border-line bg-bg-elev">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
              <h2 className="text-sm font-semibold text-fg">{cat.category}</h2>
              <div className="flex flex-wrap gap-1.5">
                {STATUSES.map((s) => (
                  <Badge key={s} tone={findingTone(s)}>
                    {findingLabel(s)} <span className="tabular">{cat.counts[s] ?? 0}</span>
                  </Badge>
                ))}
              </div>
            </header>
            <ul className="divide-y divide-line">
              {list.map((f) => {
                const open = expanded.has(f.id);
                return (
                  <li key={f.id} data-finding={f.code}>
                    <button type="button" onClick={() => toggle(f.id)} aria-expanded={open} aria-controls={`finding-${f.id}`} className="flex w-full items-center gap-3 px-4 py-2.5 text-start transition-colors duration-150 hover:bg-bg-elev-2/60 focus-visible:bg-bg-elev-2 focus-visible:outline-none">
                      <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-fg-dim transition-transform duration-150", open && "rotate-180")} aria-hidden />
                      <span className="w-20 shrink-0 font-mono text-xs text-fg-muted">{f.code}</span>
                      <span className="min-w-0 flex-1 truncate text-sm text-fg">{f.title}</span>
                      <span className="hidden md:inline-flex">
                        <ConfidenceBar value={f.confidence} />
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <span aria-hidden className={cn("inline-block h-2 w-2 rounded-full", TONE_DOT[findingTone(f.effectiveStatus)])} />
                        <span className="w-20 text-xs text-fg">{findingLabel(f.effectiveStatus)}</span>
                      </span>
                      <Badge tone={f.conclusion === "human_validated" ? "allow" : "neutral"} className="w-[118px] justify-center">
                        {conclusionText(f.conclusion)}
                      </Badge>
                    </button>
                    {open ? (
                      <div id={`finding-${f.id}`} className="space-y-4 border-t border-line/60 bg-bg/40 px-4 py-4 md:ps-12">
                        <div className="grid gap-4 lg:grid-cols-2">
                          <div className="space-y-3">
                            <div>
                              <h3 className="text-sm font-medium text-fg">
                                {f.code} {f.title}
                              </h3>
                              {f.summary ? <p className="mt-0.5 text-xs text-fg-muted">{f.summary}</p> : null}
                            </div>
                            <dl className="grid grid-cols-[140px_1fr] gap-y-1.5 text-xs">
                              <dt className="text-fg-muted">Automated status</dt>
                              <dd>
                                <Badge tone={findingTone(f.status)}>{findingLabel(f.status)}</Badge>
                              </dd>
                              <dt className="text-fg-muted">Effective status</dt>
                              <dd className="flex items-center gap-2">
                                <Badge tone={findingTone(f.effectiveStatus)}>{findingLabel(f.effectiveStatus)}</Badge>
                                <span className="text-fg-dim">{conclusionText(f.conclusion)}</span>
                              </dd>
                              <dt className="text-fg-muted">Confidence</dt>
                              <dd>
                                <ConfidenceBar value={f.confidence} />
                              </dd>
                              {f.resolvedAt ? (
                                <>
                                  <dt className="text-fg-muted">Resolved</dt>
                                  <dd>{formatDateTime(f.resolvedAt)}</dd>
                                </>
                              ) : null}
                            </dl>
                            <div>
                              <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-fg-muted">Rationale</h4>
                              <p className="text-xs leading-5 text-fg">{f.rationale}</p>
                            </div>
                            <div>
                              <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-fg-muted">Recommendation</h4>
                              <p className="text-xs leading-5 text-fg">{f.recommendation}</p>
                            </div>
                          </div>
                          <div className="space-y-3">
                            <h4 className="text-xs font-medium uppercase tracking-wide text-fg-muted">Cited evidence ({f.artifacts.length})</h4>
                            {f.artifacts.length === 0 ? <p className="text-xs text-fg-dim">No passage scored high enough to cite.</p> : null}
                            <ol className="space-y-2">
                              {f.artifacts.map((a) => (
                                <li key={a.id} className="rounded-md border border-line bg-bg p-3" data-artifact={a.kind}>
                                  <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                                    <span className="flex flex-wrap items-center gap-1.5">
                                      {a.kind === "document" ? (
                                        <>
                                          <Badge tone="info">Document</Badge>
                                          <span className="text-fg">{a.documentTitle ?? "document"}</span>
                                          <span className="font-mono text-fg-dim">
                                            {a.page ? `p.${a.page} ` : ""}
                                            {a.chunkIdx !== null ? `chunk ${a.chunkIdx}` : ""}
                                          </span>
                                        </>
                                      ) : a.kind === "automated" ? (
                                        <>
                                          <Badge tone="approval">Automated</Badge>
                                          <span className="font-mono text-fg-muted">{a.reference}</span>
                                        </>
                                      ) : (
                                        <>
                                          <Badge tone="allow">Human validated</Badge>
                                          <span className="font-mono text-fg-muted">{a.reference}</span>
                                        </>
                                      )}
                                    </span>
                                    {a.kind === "document" ? (
                                      <span className="tabular text-fg-muted" title="BM25 normalised score">
                                        lexical similarity {a.score.toFixed(2)}
                                      </span>
                                    ) : null}
                                  </div>
                                  {a.excerpt ? <blockquote className="whitespace-pre-wrap text-xs leading-5 text-fg">{a.excerpt}</blockquote> : null}
                                </li>
                              ))}
                            </ol>
                          </div>
                        </div>
                        <ValidationForm assessmentId={assessmentId} finding={f} canWrite={canWrite} />
                        <div className="flex flex-wrap items-center gap-3">
                          <Button size="sm" disabled={!canWrite} disabledReason="Requires audit:write" onClick={() => setTaskFor(f)}>
                            <ListPlus className="h-3.5 w-3.5" aria-hidden />
                            Create remediation task
                          </Button>
                          {f.tasks.length > 0 ? (
                            <ul className="flex flex-wrap items-center gap-2 text-xs">
                              {f.tasks.map((t) => (
                                <li key={t.id} className="inline-flex items-center gap-1.5">
                                  <Link href={`/audit/remediation?task=${t.id}`} className="text-accent hover:underline">
                                    {t.title}
                                  </Link>
                                  <Badge tone={remediationTone(t.status)}>{remediationLabel(t.status)}</Badge>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <span className="text-xs text-fg-dim">No remediation tasks yet.</span>
                          )}
                        </div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      <CreateTaskDialog canWrite={canWrite} owners={owners} findings={taskFor ? [{ id: taskFor.id, code: taskFor.code, title: taskFor.title, assessmentName: "this assessment" }] : []} prefill={taskFor ? { findingId: taskFor.id, title: `${taskFor.code}: ${taskFor.title}`, description: taskFor.recommendation } : undefined} trigger={null} open={taskFor !== null} onOpenChange={(o) => !o && setTaskFor(null)} />
    </div>
  );
}
