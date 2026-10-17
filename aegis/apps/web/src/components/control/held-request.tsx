"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ShieldAlert } from "lucide-react";
import { releaseQuarantineAction } from "@/server/actions/gateway";
import { Button } from "@/components/ui/button";
import { Field, FormError, Textarea } from "@/components/ui/input";
import { Note } from "@/components/ui/note";

/**
 * Explains a request AEGIS held or narrowed, and gives a security reviewer the two ways out of
 * quarantine. Nothing here executes anything: release sends the request to a person for approval.
 */
export function HeldRequestPanel({ requestId, status, decision, restrictions, moreInformation, canRelease }: { requestId: string; status: string; decision: string; restrictions: string[]; moreInformation: { fields: string[]; message: string } | null; canRelease: boolean }) {
  const router = useRouter();
  const [reason, setReason] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function settle(action: "refuse" | "to_approval") {
    setPending(true);
    setError(null);
    const r = await releaseQuarantineAction(requestId, { action, reason });
    setPending(false);
    if (!r.ok) return setError(r.error);
    toast.success(action === "refuse" ? "Refused. The request will not run." : "Sent to an approver. It runs only if a person approves it.");
    router.refresh();
  }

  if (decision === "restrict" && restrictions.length) {
    return (
      <div data-testid="restrictions-note">
        <Note tone="info">Allowed with limits. Policy changed the request before it ran: {restrictions.join("; ")}. The one-time permission slip covers only the changed request.</Note>
      </div>
    );
  }
  if (status === "awaiting_information") {
    return (
      <div data-testid="more-information-note">
        <Note tone="warning">
          Waiting for the agent to resubmit with: {moreInformation?.fields.join(", ") || "the requested details"}. {moreInformation?.message}
        </Note>
      </div>
    );
  }
  if (status !== "quarantined") return null;
  const disabledReason = canRelease ? (reason.trim().length < 5 ? "Write at least five characters explaining your decision" : undefined) : "Only people who manage security (security:write) review quarantined requests";
  return (
    <div className="space-y-3 rounded-md border border-critical/40 bg-critical/5 p-3 text-xs" data-testid="quarantine-controls">
      <p className="flex items-start gap-2 text-fg">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-critical" aria-hidden />
        <span>
          <strong>Held for security review.</strong> A policy rule quarantined this request. It cannot run from here: a reviewer either refuses it, or sends it to a person who approves or rejects it as usual.
        </span>
      </p>
      <Field label="Your reason" htmlFor="quarantine-reason">
        <Textarea id="quarantine-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} disabled={!canRelease} placeholder="What you checked and why" />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => settle("to_approval")} disabled={pending || !!disabledReason} disabledReason={disabledReason} data-testid="quarantine-to-approval">
          Send to an approver
        </Button>
        <Button size="sm" variant="danger" onClick={() => settle("refuse")} disabled={pending || !!disabledReason} disabledReason={disabledReason} data-testid="quarantine-refuse">
          Refuse
        </Button>
        {error ? <FormError error={error} /> : null}
      </div>
    </div>
  );
}
