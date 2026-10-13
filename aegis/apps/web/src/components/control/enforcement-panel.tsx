"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ScanSearch } from "lucide-react";
import { auditEnforcementAction } from "@/server/actions/gateway";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/input";
import { Note } from "@/components/ui/note";

export interface EnforcementSummary {
  observable?: boolean;
  operations?: number;
  matched?: number;
  bypass?: number;
  unknownRequest?: number;
  unauthorized?: number;
  error?: string | null;
  findings?: { reference: string; kind: string; aegisRequestId: string | null; at: string; detail: string }[];
}

const KIND_LABEL: Record<string, string> = { bypass: "Made without AEGIS", unknownRequest: "Names a request that does not exist", unauthorized: "Names a request AEGIS did not authorize" };

/** Last enforcement-path audit for one integration, and a button to run it again. */
export function EnforcementPanel({ integrationId, summary, lastAuditAt, canRun }: { integrationId: string; summary: EnforcementSummary; lastAuditAt: string | null; canRun: boolean }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function runAudit() {
    setPending(true);
    setError(null);
    const r = await auditEnforcementAction(integrationId);
    setPending(false);
    if (!r.ok) return setError(r.error);
    if (!r.data.observable) toast.message(r.data.error ?? "This system cannot be checked");
    else if (r.data.outside) toast.error(`${r.data.outside} action${r.data.outside === 1 ? "" : "s"} in this system did not go through AEGIS. A security event was raised.`);
    else toast.success(`All ${r.data.operations} recent actions in this system went through AEGIS.`);
    router.refresh();
  }
  const outside = (summary.bypass ?? 0) + (summary.unknownRequest ?? 0) + (summary.unauthorized ?? 0);
  return (
    <div className="space-y-3 text-xs" data-testid="enforcement-panel">
      <p className="text-fg-muted">AEGIS can only stop actions that go through it. This check reads the system&apos;s own recent records and matches each one to a request AEGIS authorized. Anything that does not match was done around AEGIS.</p>
      {!lastAuditAt ? (
        <p className="text-fg-dim">Not checked yet. The worker checks every hour; you can check now.</p>
      ) : summary.observable === false ? (
        <Note tone="warning">Cannot be checked: {summary.error ?? "this system does not expose its records"}. Actions taken around AEGIS here would not be seen.</Note>
      ) : outside === 0 ? (
        <Note tone="info">
          Last check {new Date(lastAuditAt).toLocaleString("en-GB")}: all {summary.operations ?? 0} recent actions went through AEGIS.
        </Note>
      ) : (
        <div className="space-y-2">
          <Note tone="danger">
            Last check {new Date(lastAuditAt).toLocaleString("en-GB")}: {outside} of {summary.operations ?? 0} recent actions did not go through AEGIS.
          </Note>
          <ul className="space-y-1">
            {(summary.findings ?? []).slice(0, 10).map((f) => (
              <li key={`${f.reference}-${f.kind}`} className="rounded border border-line px-2 py-1">
                <span className="font-mono">{f.reference}</span> <span className="text-fg-muted">{KIND_LABEL[f.kind] ?? f.kind}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={runAudit} disabled={pending || !canRun} disabledReason={canRun ? undefined : "Needs permission to manage integrations or security"} data-testid="run-enforcement-audit">
          <ScanSearch className="h-3.5 w-3.5" aria-hidden /> Check now
        </Button>
        {error ? <FormError error={error} /> : null}
      </div>
    </div>
  );
}
