"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ShieldOff } from "lucide-react";
import { updateAgentAction } from "@/server/actions/agents";
import { createDelegationAction, decideAccessRequestAction, emergencyRevokeAction, requestAccessAction, revokeAccessAction, revokeDelegationAction } from "@/server/actions/agent-access";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Textarea } from "@/components/ui/input";
import { Note } from "@/components/ui/note";
import { Panel } from "@/components/ui/panel";
import { Select } from "@/components/ui/select";

export interface AccessTabProps {
  agentId: string;
  workloadId: string;
  canWrite: boolean;
  canControl: boolean;
  editable: boolean;
  currentUserId: string;
  identity: { purpose: string; allowedDestinations: string[]; credentialExpiresAt: string | null };
  tools: { id: string; key: string; name: string }[];
  resources: { id: string; key: string; name: string }[];
  otherAgents: { id: string; name: string }[];
  heldToolKeys: string[];
  accessRequests: { id: string; target: string; actions: string[]; reason: string; durationHours: number; status: string; requestedBy: string; requestedById: string; expiresAt: string | null; createdAt: string }[];
  delegations: { id: string; direction: "given" | "received"; other: string; toolKeys: string[]; maxAmount: number | null; expiresAt: string; revokedAt: string | null; reason: string }[];
  recommendations: { kind: string; detail: string; suggestion: string }[];
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "never");

function useRun() {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function run<T>(fn: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>, success: string | ((d: T) => string)) {
    setPending(true);
    setError(null);
    const r = await fn();
    setPending(false);
    if (!r.ok) {
      setError(r.error);
      return null;
    }
    toast.success(typeof success === "function" ? success(r.data) : success);
    router.refresh();
    return r.data;
  }
  return { pending, error, run };
}

function IdentityPanel(p: AccessTabProps) {
  const [purpose, setPurpose] = React.useState(p.identity.purpose);
  const [destinations, setDestinations] = React.useState(p.identity.allowedDestinations.join(", "));
  const [expires, setExpires] = React.useState(p.identity.credentialExpiresAt ? p.identity.credentialExpiresAt.slice(0, 10) : "");
  const { pending, error, run } = useRun();
  const can = p.canWrite && p.editable;
  return (
    <Panel title="Identity and limits" description="Enforced by the Action Gateway on every request from this agent">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => updateAgentAction(p.agentId, { purpose, allowedDestinations: destinations.split(/[,\s]+/).map((d) => d.trim()).filter(Boolean), credentialExpiresAt: expires ? new Date(`${expires}T23:59:59Z`).toISOString() : null }), "Identity and limits saved");
        }}
      >
        <p className="text-xs text-fg-muted">
          Workload identity: <span className="font-mono">{p.workloadId}</span>
        </p>
        <Field label="Business purpose" htmlFor="agent-purpose" hint="what this agent is for; shown to approvers">
          <Textarea id="agent-purpose" rows={2} value={purpose} onChange={(e) => setPurpose(e.target.value)} disabled={!can} maxLength={1000} />
        </Field>
        <Field label="Allowed destinations" htmlFor="agent-destinations" hint="domains this agent may send to, across all its tools; empty means each tool's own list applies">
          <Input id="agent-destinations" value={destinations} onChange={(e) => setDestinations(e.target.value)} disabled={!can} placeholder="for example payments.meridian-demo.example, *.meridian-demo.example" />
        </Field>
        <Field label="Authority ends on" htmlFor="agent-expiry" hint="after this date every request is refused until someone sets a new date (re-certification)">
          <Input id="agent-expiry" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} disabled={!can} />
        </Field>
        <FormError error={error} />
        <div className="flex justify-end">
          <Button type="submit" variant="primary" loading={pending} disabled={!can} disabledReason={!p.editable ? "This agent can no longer be edited" : "Requires agents:write"}>
            Save
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function TemporaryAccessPanel(p: AccessTabProps) {
  const [kind, setKind] = React.useState<"tool" | "resource">("tool");
  const [target, setTarget] = React.useState("");
  const [actions, setActions] = React.useState("read");
  const [reason, setReason] = React.useState("");
  const [hours, setHours] = React.useState("8");
  const [note, setNote] = React.useState<Record<string, string>>({});
  const { pending, error, run } = useRun();
  const canRequest = p.canWrite && p.editable;
  return (
    <Panel title="Temporary access" description="Access for a stated reason and a limited time. Someone other than the requester approves it, and it ends on its own.">
      <form
        className="grid gap-3 md:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => requestAccessAction({ agentId: p.agentId, ...(kind === "tool" ? { toolId: target } : { resourceId: target, actions: actions.split(/[,\s]+/).filter(Boolean) }), reason, durationHours: Number(hours) }), "Request sent for approval");
        }}
      >
        <Field label="Access to" htmlFor="ta-kind">
          <Select id="ta-kind" value={kind} onValueChange={(v) => { setKind(v as "tool" | "resource"); setTarget(""); }} options={[{ value: "tool", label: "A tool" }, { value: "resource", label: "A resource" }]} disabled={!canRequest} />
        </Field>
        <Field label={kind === "tool" ? "Tool" : "Resource"} htmlFor="ta-target">
          <Select id="ta-target" value={target} onValueChange={setTarget} options={(kind === "tool" ? p.tools : p.resources).map((x) => ({ value: x.id, label: `${x.name} (${x.key})` }))} placeholder="Choose" disabled={!canRequest} />
        </Field>
        {kind === "resource" ? (
          <Field label="Actions" htmlFor="ta-actions" hint="comma separated, for example read, write">
            <Input id="ta-actions" value={actions} onChange={(e) => setActions(e.target.value)} disabled={!canRequest} />
          </Field>
        ) : null}
        <Field label="Hours" htmlFor="ta-hours" hint="1 to 336 (14 days)">
          <Input id="ta-hours" type="number" min={1} max={336} value={hours} onChange={(e) => setHours(e.target.value)} disabled={!canRequest} />
        </Field>
        <Field label="Reason" htmlFor="ta-reason" className="md:col-span-2">
          <Textarea id="ta-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} disabled={!canRequest} minLength={10} />
        </Field>
        <div className="flex items-center justify-end gap-2 md:col-span-2">
          <FormError error={error} />
          <Button type="submit" loading={pending} disabled={!canRequest || !target || reason.trim().length < 10} disabledReason={!canRequest ? "Requires agents:write" : !target ? "Choose what access is needed" : "Write a reason of at least ten characters"} data-testid="request-access">
            Request access
          </Button>
        </div>
      </form>
      {p.accessRequests.length ? (
        <ul className="mt-4 space-y-2 text-xs" data-testid="access-requests">
          {p.accessRequests.map((r) => {
            const own = r.requestedById === p.currentUserId;
            const decideReason = !p.canControl ? "Requires agents:control" : own ? "Separation of duties: you asked for this" : undefined;
            return (
              <li key={r.id} className="rounded-md border border-line p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={r.status === "approved" ? "allow" : r.status === "pending" ? "approval" : "neutral"}>{r.status}</Badge>
                  <span className="font-mono">{r.target}</span>
                  {r.actions.length ? <span className="text-fg-muted">{r.actions.join(", ")}</span> : null}
                  <span className="text-fg-muted">
                    {r.durationHours} h, asked by {r.requestedBy}
                    {r.expiresAt ? `, ends ${when(r.expiresAt)}` : ""}
                  </span>
                </div>
                <p className="mt-1 text-fg-muted">{r.reason}</p>
                {r.status === "pending" ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Input aria-label="Decision note" className="h-7 max-w-xs text-xs" value={note[r.id] ?? ""} onChange={(e) => setNote({ ...note, [r.id]: e.target.value })} placeholder="Note (needed to reject)" disabled={!!decideReason} />
                    <Button size="sm" variant="primary" disabled={!!decideReason || pending} disabledReason={decideReason} onClick={() => void run(() => decideAccessRequestAction(r.id, p.agentId, { decision: "approve", note: note[r.id] ?? "" }), "Approved")}>
                      Approve
                    </Button>
                    <Button size="sm" variant="danger" disabled={!!decideReason || pending || (note[r.id] ?? "").trim().length < 3} disabledReason={decideReason ?? "Write a note to reject"} onClick={() => void run(() => decideAccessRequestAction(r.id, p.agentId, { decision: "reject", note: note[r.id] ?? "" }), "Rejected")}>
                      Reject
                    </Button>
                  </div>
                ) : r.status === "approved" ? (
                  <div className="mt-2">
                    <Button size="sm" variant="ghost" disabled={!p.canControl || pending} disabledReason="Requires agents:control" onClick={() => void run(() => revokeAccessAction(r.id, p.agentId, "ended early from the console"), "Access ended")}>
                      End now
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-4 text-xs text-fg-dim">No temporary access has been requested for this agent.</p>
      )}
    </Panel>
  );
}

function DelegationPanel(p: AccessTabProps) {
  const [delegate, setDelegate] = React.useState("");
  const [tools, setTools] = React.useState<string[]>([]);
  const [maxAmount, setMaxAmount] = React.useState("");
  const [hours, setHours] = React.useState("8");
  const [reason, setReason] = React.useState("");
  const { pending, error, run } = useRun();
  const can = p.canWrite && p.editable;
  return (
    <Panel title="Delegation" description="Let another agent act for this one. The other agent never gets more than both agents hold, and both agents' policies apply.">
      <form
        className="grid gap-3 md:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => createDelegationAction({ delegatorAgentId: p.agentId, delegateAgentId: delegate, toolKeys: tools, constraints: maxAmount ? { maxAmount: Number(maxAmount) } : {}, reason, expiresInHours: Number(hours) }), "Delegation created");
        }}
      >
        <Field label="Agent that may act for this one" htmlFor="dg-delegate">
          <Select id="dg-delegate" value={delegate} onValueChange={setDelegate} options={p.otherAgents.map((a) => ({ value: a.id, label: a.name }))} placeholder="Choose" disabled={!can} />
        </Field>
        <Field label="Hours" htmlFor="dg-hours" hint="up to 720 (30 days)">
          <Input id="dg-hours" type="number" min={1} max={720} value={hours} onChange={(e) => setHours(e.target.value)} disabled={!can} />
        </Field>
        <fieldset className="md:col-span-2">
          <legend className="mb-1 text-xs font-medium text-fg-muted">Tools it may use (none ticked means every tool both agents hold)</legend>
          <div className="flex flex-wrap gap-3 text-xs">
            {p.heldToolKeys.map((k) => (
              <label key={k} className="flex items-center gap-1">
                <input type="checkbox" checked={tools.includes(k)} onChange={(e) => setTools(e.target.checked ? [...tools, k] : tools.filter((x) => x !== k))} disabled={!can} />
                <span className="font-mono">{k}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <Field label="Largest amount per request" htmlFor="dg-max" hint="optional">
          <Input id="dg-max" type="number" min={1} value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} disabled={!can} />
        </Field>
        <Field label="Reason" htmlFor="dg-reason">
          <Input id="dg-reason" value={reason} onChange={(e) => setReason(e.target.value)} disabled={!can} />
        </Field>
        <div className="flex items-center justify-end gap-2 md:col-span-2">
          <FormError error={error} />
          <Button type="submit" loading={pending} disabled={!can || !delegate || reason.trim().length < 5} disabledReason={!can ? "Requires agents:write" : !delegate ? "Choose an agent" : "Write a reason of at least five characters"}>
            Create delegation
          </Button>
        </div>
      </form>
      {p.delegations.length ? (
        <ul className="mt-4 space-y-2 text-xs" data-testid="delegations">
          {p.delegations.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-2 rounded-md border border-line p-2">
              <Badge tone={d.revokedAt ? "neutral" : new Date(d.expiresAt) < new Date() ? "neutral" : "allow"}>{d.revokedAt ? "revoked" : new Date(d.expiresAt) < new Date() ? "expired" : "active"}</Badge>
              <span>{d.direction === "given" ? `${d.other} may act for this agent` : `This agent may act for ${d.other}`}</span>
              <span className="text-fg-muted">
                {d.toolKeys.length ? d.toolKeys.join(", ") : "all shared tools"}
                {d.maxAmount ? `, up to ${d.maxAmount.toLocaleString("en-GB")}` : ""}, until {when(d.expiresAt)}
              </span>
              {!d.revokedAt && new Date(d.expiresAt) > new Date() ? (
                <Button size="sm" variant="ghost" className="ms-auto" disabled={!p.canControl || pending} disabledReason="Requires agents:control" onClick={() => void run(() => revokeDelegationAction(d.id, p.agentId, "revoked from the console"), "Delegation revoked")}>
                  Revoke
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </Panel>
  );
}

function EmergencyPanel(p: AccessTabProps) {
  const [mode, setMode] = React.useState<"suspend" | "revoke">("suspend");
  const [reason, setReason] = React.useState("");
  const [report, setReport] = React.useState<{ grantsVoided: number; apiKeysRevoked: number; delegationsRevoked: number; temporaryAccessRevoked: number; approvalsClosed: number; heldRequestsClosed: number; inFlight: { requestId: string; tool: string }[] } | null>(null);
  const { pending, error, run } = useRun();
  const disabledReason = !p.canControl ? "Requires agents:control" : !p.editable ? "This agent is already revoked or archived" : reason.trim().length < 5 ? "Write a reason of at least five characters" : undefined;
  return (
    <Panel title="Emergency revocation" description="Stops every route to future action at once. Actions that already ran are not undone.">
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="What to do" htmlFor="er-mode">
          <Select id="er-mode" value={mode} onValueChange={(v) => setMode(v as "suspend" | "revoke")} options={[{ value: "suspend", label: "Suspend (can be resumed)" }, { value: "revoke", label: "Revoke (permanent, keys revoked)" }]} disabled={!p.canControl || !p.editable} />
        </Field>
        <Field label="Reason" htmlFor="er-reason">
          <Input id="er-reason" value={reason} onChange={(e) => setReason(e.target.value)} disabled={!p.canControl || !p.editable} />
        </Field>
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        <FormError error={error} />
        <Button
          variant="danger"
          loading={pending}
          disabled={!!disabledReason}
          disabledReason={disabledReason}
          data-testid="emergency-revoke"
          onClick={async () => {
            const r = await run(() => emergencyRevokeAction(p.agentId, { mode, reason }), mode === "revoke" ? "Agent revoked" : "Agent suspended");
            if (r) setReport(r);
          }}
        >
          <ShieldOff className="h-3.5 w-3.5" aria-hidden /> {mode === "revoke" ? "Revoke now" : "Suspend now"}
        </Button>
      </div>
      {report ? (
        <div className="mt-3" data-testid="revocation-report">
          <Note tone={report.inFlight.length ? "warning" : "info"}>
            Done. {report.grantsVoided} permission slips voided, {report.approvalsClosed} approvals and {report.heldRequestsClosed} held requests closed, {report.delegationsRevoked} delegations and {report.temporaryAccessRevoked} temporary grants ended, {report.apiKeysRevoked} keys revoked.
            {report.inFlight.length ? ` ${report.inFlight.length} action(s) were already running in other systems and must be checked there: ${report.inFlight.map((x) => x.tool).join(", ")}.` : ""}
          </Note>
        </div>
      ) : null}
    </Panel>
  );
}

export function AccessTab(p: AccessTabProps) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <IdentityPanel {...p} />
      <Panel title="Narrower access" description="Suggestions from the last 30 days of this agent's requests. Nothing changes until a person acts on them.">
        {p.recommendations.length ? (
          <ul className="space-y-2 text-xs" data-testid="least-privilege">
            {p.recommendations.map((r, i) => (
              <li key={i} className="rounded-md border border-line p-2">
                <p className="text-fg">{r.suggestion}</p>
                <p className="text-fg-muted">{r.detail}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-fg-dim">No suggestions: everything this agent holds was used recently, or it made no requests to compare with.</p>
        )}
      </Panel>
      <TemporaryAccessPanel {...p} />
      <DelegationPanel {...p} />
      <EmergencyPanel {...p} />
    </div>
  );
}
