"use client";
import * as React from "react";
import Link from "next/link";
import { ArrowRight, Play } from "lucide-react";
import type { ReplayResult } from "@aegis/core";
import type { PolicyDocument } from "@aegis/core/policy/schema";
import { replayPolicyAction } from "@/server/actions/policies";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/input";
import { Note } from "@/components/ui/note";
import { Panel } from "@/components/ui/panel";
import { Select } from "@/components/ui/select";
import { StatPanel } from "@/components/ui/stat-panel";
import { StatusBadge } from "@/components/ui/status";
import { SimpleTable, Td, Th, Tr } from "@/components/ui/simple-table";
import { formatDateTime, formatMoney } from "@/lib/utils";

const PERIODS = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
];

/**
 * Replay calibration: what this version (or an unsaved document) would have done to the organization's
 * recent requests. Runs on demand, never automatically, and records nothing.
 */
export function PolicyReplayPanel({ policyId, versionId, versionLabel, document, title = "Replay against recent requests", description }: { policyId: string | null; versionId?: string; versionLabel?: string; document?: PolicyDocument | null; title?: string; description?: string }) {
  const [days, setDays] = React.useState("30");
  const [result, setResult] = React.useState<ReplayResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const canRun = !!versionId || !!document;

  async function run() {
    setLoading(true);
    setError(null);
    const r = await replayPolicyAction({ policyId, versionId: document ? undefined : versionId, document: document ?? undefined, days });
    setLoading(false);
    if (!r.ok) return setError(r.error);
    setResult(r.data);
  }

  const outcome = (k: "allow" | "require_approval" | "deny") => (k === "allow" ? "Allowed" : k === "require_approval" ? "Approval required" : "Denied");

  return (
    <div className="space-y-4" data-testid="policy-replay">
      <Panel
        title={title}
        description={description ?? `Re-evaluates every recorded request for this policy's tools with ${versionLabel ?? "this document"} in place of the active policy. Nothing is recorded.`}
        actions={
          <div className="flex items-center gap-2">
            <Select value={days} onValueChange={setDays} options={PERIODS} size="sm" aria-label="Replay period" />
            <Button size="sm" variant="primary" onClick={run} loading={loading} disabled={!canRun} disabledReason={canRun ? undefined : "Fix the highlighted fields first"} data-testid="replay-run">
              <Play className="h-3.5 w-3.5" aria-hidden />
              Replay
            </Button>
          </div>
        }
      >
        <FormError error={error} />
        {!result ? (
          <p className="py-6 text-center text-sm text-fg-muted">Press Replay to see how many of the last {days} days of requests would have been allowed, sent to a person or refused under this document, and which ones change.</p>
        ) : (
          <div className="space-y-4" aria-live="polite">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatPanel label="Requests replayed" value={result.replayed} footer={`${result.considered} in the window${result.skipped.beforePolicy ? `, ${result.skipped.beforePolicy} refused before policy` : ""}`} />
              <StatPanel label="Outcomes that change" value={result.changed} tone={result.changed > 0 ? "approval" : "allow"} footer={result.changed === 0 ? "Same decisions as recorded" : `${Math.round((result.changed / Math.max(1, result.replayed)) * 100)}% of replayed requests`} />
              <StatPanel label="Approvals per day" value={result.approvalsPerDayAfter} footer={`was ${result.approvalsPerDayBefore}`} tone={result.approvalsPerDayAfter > result.approvalsPerDayBefore ? "approval" : undefined} />
              <StatPanel label="Refused" value={result.after.deny} footer={`was ${result.before.deny}`} tone={result.after.deny > result.before.deny ? "deny" : undefined} />
            </div>
            <SimpleTable caption="Outcomes before and after">
              <thead>
                <tr>
                  <Th>Outcome</Th>
                  <Th align="end">Recorded</Th>
                  <Th align="end">With this document</Th>
                </tr>
              </thead>
              <tbody>
                {(["allow", "require_approval", "deny"] as const).map((k) => (
                  <Tr key={k} data-outcome={k}>
                    <Td>
                      <StatusBadge status={k} />
                    </Td>
                    <Td className="text-end tabular">{result.before[k]}</Td>
                    <Td className="text-end tabular font-medium text-fg">{result.after[k]}</Td>
                  </Tr>
                ))}
              </tbody>
            </SimpleTable>
            {result.changes.length ? (
              <div className="relative overflow-x-auto">
                <SimpleTable caption="Requests whose outcome changes">
                  <thead>
                    <tr>
                      <Th>When</Th>
                      <Th>Agent and request</Th>
                      <Th>Amount</Th>
                      <Th>Change</Th>
                      <Th>Deciding rule</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.changes.map((c) => (
                      <Tr key={c.requestId}>
                        <Td className="whitespace-nowrap text-xs text-fg-muted">{formatDateTime(c.createdAt)}</Td>
                        <Td>
                          <span className="block text-fg">{c.agentName}</span>
                          <Link href={`/gateway/${c.requestId}`} className="font-mono text-xs text-accent hover:underline">
                            {c.tool} / {c.action}
                          </Link>
                        </Td>
                        <Td className="tabular">{c.amount !== null ? formatMoney(c.amount, c.currency ?? "AED") : <span className="text-fg-dim">none</span>}</Td>
                        <Td>
                          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                            <StatusBadge status={c.before} />
                            <ArrowRight className="h-3 w-3 text-fg-dim" aria-label="becomes" />
                            <StatusBadge status={c.after} />
                          </span>
                        </Td>
                        <Td className="text-xs text-fg-muted">
                          {c.decidingRule ? <span className="font-mono text-fg">{c.decidingRule}</span> : <span className="text-fg-dim">default deny</span>}
                          {c.reasons[0] ? <span className="block">{c.reasons[0]}</span> : null}
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </SimpleTable>
                {result.changed > result.changes.length ? <p className="mt-1 text-xs text-fg-muted">Showing the {result.changes.length} most recent of {result.changed} changes.</p> : null}
              </div>
            ) : (
              <p className="text-sm text-fg-muted">{result.replayed === 0 ? "No request for these tools reached policy evaluation in the window." : `All ${result.replayed} replayed requests would receive the same outcome as recorded: ${outcome("allow").toLowerCase()} ${result.after.allow}, ${outcome("require_approval").toLowerCase()} ${result.after.require_approval}, ${outcome("deny").toLowerCase()} ${result.after.deny}.`}</p>
            )}
            <Note>
              <ul className="list-disc space-y-0.5 ps-4">
                {result.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </Note>
          </div>
        )}
      </Panel>
    </div>
  );
}
