"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowUpRight, Check, MessageSquare, Share2, UserRound, X } from "lucide-react";
import { decideApprovalAction, provideApprovalInfoAction, type DecisionOutcome } from "@/server/actions/approvals";
import { Button } from "@/components/ui/button";
import { Field, FormError, Textarea } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { Panel } from "@/components/ui/panel";
import { Note } from "@/components/ui/note";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status";
import { CodeBlock } from "@/components/ui/code-block";

type Decision = "approve" | "reject" | "request_info" | "escalate" | "reassign";

export function ApprovalDecisionForm({ approvalId, requestId, requestHash, canDecide, eligibilityReasons, canReassign, approvers, status, isOpen }: { approvalId: string; requestId: string; requestHash: string; canDecide: boolean; eligibilityReasons: string[]; canReassign: boolean; approvers: { userId: string; name: string; roleName: string }[]; status: string; isOpen: boolean }) {
  const router = useRouter();
  const [decision, setDecision] = React.useState<Decision>("approve");
  const [comment, setComment] = React.useState("");
  const [target, setTarget] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [outcome, setOutcome] = React.useState<DecisionOutcome | null>(null);
  const [info, setInfo] = React.useState("");

  const needsComment = decision !== "approve" && decision !== "reassign";
  const needsTarget = decision === "escalate" || decision === "reassign";
  const allowedHere = decision === "reassign" ? canReassign : canDecide;
  const ready = allowedHere && (!needsComment || comment.trim().length >= 3) && (!needsTarget || !!target);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setPending(true);
    setError(null);
    const r = await decideApprovalAction(approvalId, { decision, comment, targetUserId: target ?? undefined, requestHash });
    setPending(false);
    if (!r.ok) return setError(r.error);
    setOutcome(r.data);
    toast.success(r.data.executed ? "Approved and executed" : `Recorded: ${r.data.status}`);
    router.refresh();
  }
  async function sendInfo(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const r = await provideApprovalInfoAction(approvalId, info);
    setPending(false);
    if (!r.ok) return setError(r.error);
    toast.success("Information recorded; the request is pending again");
    setInfo("");
    router.refresh();
  }

  if (outcome) {
    return (
      <Panel title="Decision recorded">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={outcome.status} />
          {outcome.executed ? <Badge tone="allow">executed downstream</Badge> : null}
          {outcome.approvalsSoFar ? <Badge tone="approval">{outcome.approvalsSoFar} approval(s) so far</Badge> : null}
          {outcome.grantIssued ? <Badge tone="info">grant issued for the agent</Badge> : null}
        </div>
        {outcome.receipt ? (
          <div className="mt-3 rounded-md border border-line bg-bg p-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={outcome.receipt.status === "succeeded" ? "executed" : outcome.receipt.status} />
              <span className="text-fg-muted">via</span>
              <span className="font-mono">{outcome.receipt.downstreamSystem}</span>
              {outcome.receipt.reference ? (
                <>
                  <span className="text-fg-muted">reference</span>
                  <span className="font-mono text-fg" data-testid="receipt-reference">
                    {outcome.receipt.reference}
                  </span>
                </>
              ) : null}
            </div>
            <CodeBlock className="mt-2" code={JSON.stringify(outcome.receipt.summary, null, 2)} copy={false} />
          </div>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href={`/gateway/${requestId}`} className="inline-flex items-center gap-0.5 text-sm text-accent hover:underline">
            Open the action request <ArrowUpRight className="h-3 w-3" aria-hidden />
          </Link>
          <Link href="/approvals" className="inline-flex items-center gap-0.5 text-sm text-accent hover:underline">
            Back to pending approvals <ArrowUpRight className="h-3 w-3" aria-hidden />
          </Link>
        </div>
      </Panel>
    );
  }

  if (!isOpen) {
    return (
      <Panel title="Decision">
        <Note>
          This request is <strong>{status}</strong>. No further decisions can be recorded. {status === "expired" ? "An expired approval can never be used to execute." : ""}
        </Note>
      </Panel>
    );
  }

  return (
    <Panel title="Your decision" description="Approval executes the exact parameters shown; the request hash is checked again before anything runs.">
      {!canDecide ? (
        <Note tone="warning" className="mb-3">
          <strong>You cannot decide this request.</strong>
          <ul className="mt-1 list-inside list-disc">
            {eligibilityReasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          {canReassign ? <span className="mt-1 block">You can still reassign it to another approver.</span> : null}
        </Note>
      ) : null}
      {status === "more_info" ? (
        <form onSubmit={sendInfo} className="mb-4 space-y-2 rounded-md border border-approval/30 bg-approval/5 p-3">
          <div className="text-xs font-medium text-fg">An approver asked for more information</div>
          <Field label="Provide the information on behalf of the agent or its owner" htmlFor="info-text">
            <Textarea id="info-text" value={info} onChange={(e) => setInfo(e.target.value)} placeholder="Answer the approver's question" />
          </Field>
          <Button type="submit" size="sm" loading={pending} disabled={info.trim().length < 3} disabledReason="Write at least 3 characters">
            Send information
          </Button>
        </form>
      ) : null}
      <form onSubmit={submit} className="space-y-3">
        <div role="radiogroup" aria-label="Decision" className="grid gap-2 sm:grid-cols-5">
          {(
            [
              { id: "approve", label: "Approve", icon: Check, cls: "data-[on=true]:border-allow data-[on=true]:text-allow" },
              { id: "reject", label: "Reject", icon: X, cls: "data-[on=true]:border-deny data-[on=true]:text-deny" },
              { id: "request_info", label: "Request information", icon: MessageSquare, cls: "data-[on=true]:border-approval data-[on=true]:text-approval" },
              { id: "escalate", label: "Escalate", icon: Share2, cls: "data-[on=true]:border-critical data-[on=true]:text-critical" },
              { id: "reassign", label: "Reassign", icon: UserRound, cls: "data-[on=true]:border-info data-[on=true]:text-info" },
            ] as const
          ).map((o) => {
            const Icon = o.icon;
            const disabled = o.id === "reassign" ? !canReassign : !canDecide;
            return (
              <button key={o.id} type="button" role="radio" aria-checked={decision === o.id} data-on={decision === o.id} disabled={disabled} title={disabled ? (o.id === "reassign" ? "Only administrators or the assigned approver can reassign" : eligibilityReasons[0]) : undefined} onClick={() => setDecision(o.id)} className={`flex h-9 items-center justify-center gap-1.5 rounded-md border border-line bg-bg px-2 text-xs text-fg-muted transition-colors duration-150 hover:bg-bg-elev-2 disabled:cursor-not-allowed disabled:opacity-50 ${o.cls}`}>
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {o.label}
              </button>
            );
          })}
        </div>
        {needsTarget ? (
          <Field label={decision === "escalate" ? "Escalate to" : "Reassign to"} htmlFor="decision-target" hint="members with approvals:decide">
            <Combobox id="decision-target" value={target} onChange={setTarget} options={approvers.map((a) => ({ value: a.userId, label: a.name, description: a.roleName }))} placeholder="Choose a person" />
          </Field>
        ) : null}
        <Field label="Comment" htmlFor="decision-comment" hint={needsComment ? "required, recorded in evidence" : "optional, recorded in evidence"}>
          <Textarea id="decision-comment" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} placeholder={decision === "approve" ? "What you verified before approving" : decision === "reject" ? "Why this action must not run" : "What you need to know"} />
        </Field>
        <input type="hidden" name="requestHash" value={requestHash} />
        <FormError error={error} />
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[11px] text-fg-dim" title="Request hash bound to this decision">
            hash {requestHash.slice(0, 16)}
          </span>
          <Button type="submit" variant={decision === "reject" ? "danger" : "primary"} loading={pending} disabled={!ready} disabledReason={!allowedHere ? eligibilityReasons[0] ?? "Not permitted" : needsTarget && !target ? "Choose a person" : "A comment of at least 3 characters is required"}>
            {decision === "approve" ? "Approve and execute" : decision === "reject" ? "Reject" : decision === "request_info" ? "Request information" : decision === "escalate" ? "Escalate" : "Reassign"}
          </Button>
        </div>
      </form>
    </Panel>
  );
}
