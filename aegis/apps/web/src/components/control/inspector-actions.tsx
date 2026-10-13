"use client";
import * as React from "react";
import { toast } from "sonner";
import { decisionRecordAction, recheckDecisionAction } from "@/server/actions/decisions";
import { Button } from "@/components/ui/button";
import { Note } from "@/components/ui/note";
import { downloadText } from "@/components/ui/download";

type Recheck = { comparable: false; reason: string } | { comparable: true; then: string; now: string; same: boolean; decidingRuleNow: string | null; policiesNow: string[] };

export function InspectorActions({ requestId, canRecheck }: { requestId: string; canRecheck: boolean }) {
  const [recheck, setRecheck] = React.useState<Recheck | null>(null);
  const [pending, setPending] = React.useState<"recheck" | "record" | null>(null);
  const [digest, setDigest] = React.useState<string | null>(null);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          loading={pending === "recheck"}
          disabled={!canRecheck}
          disabledReason="Requires the policies:read permission"
          data-testid="inspector-recheck"
          onClick={async () => {
            setPending("recheck");
            const r = await recheckDecisionAction(requestId);
            setPending(null);
            if (!r.ok) return toast.error(r.error);
            setRecheck(r.data as Recheck);
          }}
        >
          Recheck against today&apos;s policies
        </Button>
        <Button
          size="sm"
          loading={pending === "record"}
          data-testid="inspector-record"
          onClick={async () => {
            setPending("record");
            const r = await decisionRecordAction(requestId);
            setPending(null);
            if (!r.ok) return toast.error(r.error);
            downloadText(`decision-record-${requestId}.json`, r.data.json, "application/json");
            setDigest(r.data.sha256);
          }}
        >
          Download decision record
        </Button>
      </div>
      {recheck ? (
        <div data-testid="inspector-recheck-result">
          {recheck.comparable ? (
            <Note tone={recheck.same ? "info" : "warning"}>
              {recheck.same ? `Today's policies decide the same: ${recheck.now.replace(/_/g, " ")}.` : `Today's policies would decide differently: ${recheck.then.replace(/_/g, " ")} then, ${recheck.now.replace(/_/g, " ")} now${recheck.decidingRuleNow ? ` (rule ${recheck.decidingRuleNow})` : ""}.`} Policies applied now: {recheck.policiesNow.join(", ") || "none"}. Nothing was changed.
            </Note>
          ) : (
            <Note tone="info">{recheck.reason}</Note>
          )}
        </div>
      ) : null}
      {digest ? <p className="font-mono text-[11px] text-fg-dim" data-testid="inspector-record-digest">sha256 {digest}; the export is in the evidence record.</p> : null}
    </div>
  );
}
