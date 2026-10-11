"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RefreshCw, Play, CheckCircle2 } from "lucide-react";
import { executeApprovedAction, reconcileExecutionAction, resolveExecutionAction } from "@/server/actions/gateway";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Note } from "@/components/ui/note";

/**
 * Operator controls for the execution phase of one request:
 * - approved but never executed (for example the gateway was paused in between): run it now
 * - executing or unresolved: ask the downstream system again
 * - unresolved after reconciliation gave up: a human settles it with a reference and a reason
 */
export function ExecutionControls({ requestId, status, canControl, canDecide, downstreamKind }: { requestId: string; status: string; canControl: boolean; canDecide: boolean; downstreamKind: string | null }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [outcome, setOutcome] = React.useState<"succeeded" | "failed">("succeeded");
  const [reference, setReference] = React.useState("");
  const [reason, setReason] = React.useState("");

  async function reconcile() {
    setPending(true);
    setError(null);
    const r = await reconcileExecutionAction(requestId);
    setPending(false);
    if (!r.ok) return setError(r.error);
    toast.success(r.data.requestStatus === "executed" ? `Resolved: executed (${r.data.reference ?? "no reference"})` : r.data.requestStatus === "failed" ? "Resolved: the downstream system has no record, marked failed" : "Still unresolved; the downstream system could not confirm either way");
    router.refresh();
  }
  async function executeNow() {
    setPending(true);
    setError(null);
    const r = await executeApprovedAction(requestId);
    setPending(false);
    if (!r.ok) return setError(r.error);
    toast.success(r.data.status === "succeeded" ? `Executed (${r.data.reference ?? "receipt written"})` : `Execution ${r.data.status}`);
    router.refresh();
  }
  async function resolve(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const r = await resolveExecutionAction(requestId, { outcome, reference, reason });
    setPending(false);
    if (!r.ok) return setError(r.error);
    toast.success(`Settled as ${outcome}`);
    router.refresh();
  }

  if (status === "approved" || status === "allowed") {
    if (!canDecide && !canControl) return null;
    return (
      <div className="rounded-md border border-approval/40 bg-approval/5 p-3 text-xs">
        <p className="text-fg">
          <strong>Approved but not executed.</strong> This happens when the gateway was paused between approval and execution, or an execution grant expired unused. Running it now issues a fresh single-use grant and executes once.
        </p>
        <div className="mt-2 flex items-center gap-2">
          <Button size="sm" onClick={executeNow} disabled={pending} data-testid="execute-now">
            <Play className="h-3.5 w-3.5" aria-hidden /> Execute now
          </Button>
          {error ? <FormError error={error} /> : null}
        </div>
      </div>
    );
  }

  if (status !== "executing" && status !== "unknown") return null;
  if (!canControl) {
    return <Note tone="warning">This request is {status === "executing" ? "executing: the downstream call has not been confirmed yet" : "unresolved: the downstream system could not confirm whether the action happened"}. An administrator with agent control can reconcile or settle it.</Note>;
  }
  return (
    <div className="space-y-3 rounded-md border border-critical/40 bg-critical/5 p-3 text-xs" data-testid="execution-controls">
      <p className="text-fg">
        {status === "executing" ? (
          <>
            <strong>Outcome not confirmed yet.</strong> The downstream call was sent but no definitive answer was recorded. AEGIS asks the downstream system for the result using the request&apos;s idempotency key; it never retries the action blindly.
          </>
        ) : (
          <>
            <strong>Outcome unresolved.</strong> Reconciliation could not determine whether the action happened{downstreamKind === "simulated" ? "" : " (the downstream system did not answer or does not support lookups)"}. Check the downstream system for this request&apos;s idempotency key and settle it here. The settlement is recorded with your name and reason.
          </>
        )}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={reconcile} disabled={pending} data-testid="reconcile-now">
          <RefreshCw className={`h-3.5 w-3.5 ${pending ? "animate-spin" : ""}`} aria-hidden /> Ask the downstream system again
        </Button>
      </div>
      {status === "unknown" ? (
        <form onSubmit={resolve} className="grid gap-2 sm:grid-cols-3">
          <Field label="What did you find downstream?">
            <Select value={outcome} onValueChange={(v) => setOutcome(v as "succeeded" | "failed")} options={[{ value: "succeeded", label: "The action happened" }, { value: "failed", label: "The action did not happen" }]} />
          </Field>
          <Field label="Downstream reference (optional)">
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="re_..., RFD-..." />
          </Field>
          <Field label="What you verified" className="sm:col-span-3">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="For example: refund re_123 visible in the Stripe dashboard with metadata aegis_request_id matching this request" />
          </Field>
          <div className="flex items-center gap-2 sm:col-span-3">
            <Button size="sm" type="submit" disabled={pending || reason.trim().length < 5} data-testid="settle-outcome">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Record settlement
            </Button>
            {error ? <FormError error={error} /> : null}
          </div>
        </form>
      ) : error ? (
        <FormError error={error} />
      ) : null}
    </div>
  );
}
