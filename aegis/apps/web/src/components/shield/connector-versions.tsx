"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { reviewToolDefinitionAction } from "@/server/actions/shield";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormError, Textarea } from "@/components/ui/input";
import { Panel } from "@/components/ui/panel";

export interface PinnedToolRow {
  id: string;
  key: string;
  name: string;
  enabled: boolean;
  pinned: { server: string | null; version: string | null; at: string; by: string | null } | null;
  pending: { server: string | null; version: string | null; at: string; changed: string[]; description: string | null } | null;
}

const fmt = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
const ver = (s: { server: string | null; version: string | null } | null) => (s ? [s.server, s.version].filter(Boolean).join(" ") || "unnamed connector" : "not pinned");

export function ConnectorVersions({ rows, canReview }: { rows: PinnedToolRow[]; canReview: boolean }) {
  const router = useRouter();
  const [review, setReview] = React.useState<{ row: PinnedToolRow; verdict: "approve" | "reject" } | null>(null);
  const [reason, setReason] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const waiting = rows.filter((r) => r.pending);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!review || reason.trim().length < 5) return;
    setPending(true);
    setError(null);
    const r = await reviewToolDefinitionAction(review.row.id, review.verdict, reason);
    setPending(false);
    if (!r.ok) return setError(r.error);
    toast.success(review.verdict === "approve" ? "New version approved: the tool can be used again" : "New version rejected: the tool stays disabled");
    setReview(null);
    router.refresh();
  }

  return (
    <Panel title="Connector versions" description="AEGIS keeps a fingerprint of each tool's definition and the connector version it came from. When a connector changes, the tool is blocked until a person reviews the change here." padded>
      {rows.length === 0 ? <p className="text-sm text-fg-muted">No connector has reported its tools yet. The AEGIS MCP gateway reports them when it starts.</p> : null}
      {rows.length > 0 && waiting.length === 0 ? <p className="mb-2 text-sm text-fg-muted">Every reported tool matches its approved version.</p> : null}
      <ul className="space-y-2">
        {[...waiting, ...rows.filter((r) => !r.pending)].map((r) => (
          <li key={r.id} className="rounded-md border border-line p-2.5 text-sm" data-testid="pinned-tool">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-fg">{r.key}</span>
              {r.pending ? <Badge tone="deny">Changed, blocked until reviewed</Badge> : <Badge tone="allow">Matches approved version</Badge>}
              {!r.enabled ? <Badge>Disabled</Badge> : null}
            </div>
            <p className="mt-1 text-xs text-fg-dim">
              Approved: {ver(r.pinned)}
              {r.pinned ? ` · ${fmt(r.pinned.at)}${r.pinned.by ? ` by ${r.pinned.by}` : ""}` : ""}
            </p>
            {r.pending ? (
              <div className="mt-2 space-y-1">
                <p className="text-xs text-fg-muted">
                  Now serving {ver(r.pending)} since {fmt(r.pending.at)}. What changed: {r.pending.changed.join(", ")}.
                </p>
                {r.pending.changed.includes("definition") && r.pending.description ? (
                  <p className="rounded bg-bg-elev p-2 text-xs text-fg">
                    <span className="text-fg-dim">New description: </span>
                    {r.pending.description}
                  </p>
                ) : null}
                <div className="flex gap-2 pt-1">
                  <Button size="sm" variant="primary" onClick={() => { setReason(""); setError(null); setReview({ row: r, verdict: "approve" }); }} disabled={!canReview} disabledReason="Requires security:write">
                    Approve new version
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => { setReason(""); setError(null); setReview({ row: r, verdict: "reject" }); }} disabled={!canReview} disabledReason="Requires security:write">
                    Reject
                  </Button>
                </div>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <Dialog
        open={review !== null}
        onOpenChange={(o) => !o && setReview(null)}
        title={review?.verdict === "approve" ? `Approve the new version of ${review.row.key}` : `Reject the new version of ${review?.row.key ?? ""}`}
        description={review?.verdict === "approve" ? "The new version becomes the approved one and agents can use the tool again. Approve only after checking what changed." : "The approved version stays pinned and the tool is disabled, because the connector is still serving the rejected version."}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setReview(null)} disabled={pending}>
              Cancel
            </Button>
            <Button form="pin-review-form" type="submit" variant={review?.verdict === "approve" ? "primary" : "danger"} loading={pending} disabled={reason.trim().length < 5} disabledReason="Give a reason of at least 5 characters">
              {review?.verdict === "approve" ? "Approve" : "Reject"}
            </Button>
          </>
        }
      >
        <form id="pin-review-form" onSubmit={submit} className="space-y-3">
          <Field label="Reason" htmlFor="pin-reason" hint="required, kept in the evidence record">
            <Textarea id="pin-reason" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus placeholder="What you checked and why" />
          </Field>
          <FormError error={error} />
        </form>
      </Dialog>
    </Panel>
  );
}
