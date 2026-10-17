"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AUTONOMY_LEVEL_INFO, compareAutonomy, type AutonomyLevel } from "@aegis/core/autonomy/levels";
import { cancelAutonomyRaiseAction, decideAutonomyRaiseAction, lowerAutonomyAction, requestAutonomyRaiseAction, simulateAutonomyAction } from "@/server/actions/autonomy";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Textarea } from "@/components/ui/input";
import { Note } from "@/components/ui/note";
import { Panel } from "@/components/ui/panel";
import { Select } from "@/components/ui/select";
import { Timeline } from "@/components/ui/timeline";
import { cn } from "@/lib/utils";

export interface AutonomyTabProps {
  agentId: string;
  agentStatus: string;
  currency: string;
  canControl: boolean;
  currentUserId: string;
  level: AutonomyLevel;
  ceiling: number | null;
  changedAt: string | null;
  history: { id: string; fromLevel: number; toLevel: number; kind: string; reason: string; actorName: string | null; actorType: string; createdAt: string }[];
  requests: { id: string; fromLevel: number; toLevel: number; ceilingAmount: number | null; reason: string; status: string; requestedBy: string; requestedByName: string | null; decidedByName: string | null; decisionNote: string | null; expiresAt: string; createdAt: string }[];
  eligibility: { eligible: boolean; checks: { key: string; label: string; value: string; met: boolean }[] };
}

type SimResult = { total: number; recorded: { autonomous: number; approval: number; refused: number }; simulated: { autonomous: number; approval: number; refused: number }; changed: { requestId: string; createdAt: string; tool: string; amount: number | null; recorded: string; simulated: string }[] };

const LEVELS: AutonomyLevel[] = [0, 1, 2, 3, 4];
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "never");
const money = (n: number | null, currency: string) => (n == null ? "none" : `${currency} ${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`);
const levelLabel = (l: number) => `Level ${l}: ${AUTONOMY_LEVEL_INFO[l as AutonomyLevel].name}`;
const KIND_LABEL: Record<string, string> = { lowered: "Lowered", raised: "Raised (approved by a second person)", automatic_downgrade: "Lowered automatically" };
const OUTCOME_LABEL: Record<string, string> = { allow: "runs", restrict: "runs narrowed", require_approval: "waits for approval", deny: "refused", quarantine: "quarantined", request_more_information: "asks for information", error: "refused (error)" };

export function AutonomyTab(p: AutonomyTabProps) {
  const router = useRouter();
  const [target, setTarget] = React.useState<string>(String(p.level));
  const [ceiling, setCeiling] = React.useState<string>(p.ceiling == null ? "" : String(p.ceiling));
  const [reason, setReason] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [sim, setSim] = React.useState<SimResult | null>(null);
  const [simPending, setSimPending] = React.useState(false);

  const targetLevel = Number(target) as AutonomyLevel;
  const ceilingValue = ceiling.trim() === "" ? null : Number(ceiling);
  const ceilingValid = ceilingValue == null || (Number.isFinite(ceilingValue) && ceilingValue >= 0);
  const direction = ceilingValid ? compareAutonomy({ level: targetLevel, ceiling: ceilingValue }, { level: p.level, ceiling: p.ceiling }) : "same";
  const openRequest = p.requests.find((r) => r.status === "pending");
  const active = p.agentStatus === "active";

  let submitReason: string | undefined;
  if (!p.canControl) submitReason = "Requires the agents:control permission";
  else if (!ceilingValid) submitReason = "The ceiling must be a number of zero or more";
  else if (direction === "same") submitReason = "Choose a different level or ceiling";
  else if (direction === "looser" && openRequest) submitReason = "A raise request is already waiting for a decision";
  else if (direction === "looser" && !active) submitReason = `The agent is ${p.agentStatus}; resume it before raising its autonomy`;
  else if (reason.trim().length < 5) submitReason = "Give a reason of at least 5 characters";

  async function submit() {
    setPending(true);
    setError(null);
    const input = { level: targetLevel, ceilingAmount: ceilingValue, reason };
    const r = direction === "stricter" ? await lowerAutonomyAction(p.agentId, input) : await requestAutonomyRaiseAction(p.agentId, input);
    setPending(false);
    if (!r.ok) return setError(r.error);
    toast.success(direction === "stricter" ? `Autonomy lowered to level ${targetLevel}` : "Raise requested; a second person with agents:control decides");
    setReason("");
    router.refresh();
  }

  async function simulate() {
    setSimPending(true);
    const r = await simulateAutonomyAction(p.agentId, { level: targetLevel, ceilingAmount: ceilingValue });
    setSimPending(false);
    if (!r.ok) return toast.error(r.error);
    setSim(r.data);
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Current autonomy" description="Enforced by the Action Gateway after the policies decide. A level can only make a decision stricter.">
          <div data-testid="autonomy-level" data-level={p.level}>
            <Badge tone={p.level >= 3 ? "allow" : p.level >= 1 ? "approval" : "deny"}>{levelLabel(p.level)}</Badge>
            <p className="mt-2 text-sm text-fg">{AUTONOMY_LEVEL_INFO[p.level].enforces}</p>
            <p className="mt-2 text-xs text-fg-muted">
              Amount ceiling: {money(p.ceiling, p.currency)}. Last changed: {when(p.changedAt)}.
            </p>
          </div>
          <ol className="mt-3 space-y-1.5" aria-label="Autonomy levels">
            {LEVELS.map((l) => (
              <li key={l} className={cn("rounded-md border px-2.5 py-1.5 text-xs", l === p.level ? "border-accent bg-bg-elev" : "border-line")}>
                <span className="font-medium text-fg">{levelLabel(l)}</span>
                <span className="block text-fg-muted">{AUTONOMY_LEVEL_INFO[l].enforces}</span>
              </li>
            ))}
          </ol>
        </Panel>

        <Panel title="Change autonomy" description="Lowering takes effect at once and voids unused execution grants. Raising needs a second person.">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <Field label="Level" htmlFor="autonomy-target">
              <Select id="autonomy-target" aria-label="Target level" value={target} onValueChange={setTarget} options={LEVELS.map((l) => ({ value: String(l), label: levelLabel(l) }))} disabled={!p.canControl} />
            </Field>
            <Field label={`Amount ceiling (${p.currency})`} htmlFor="autonomy-ceiling" hint="used at levels 2 and 3; empty means no ceiling (at level 2, actions with an amount then need approval)">
              <Input id="autonomy-ceiling" inputMode="decimal" value={ceiling} onChange={(e) => setCeiling(e.target.value)} disabled={!p.canControl} placeholder="for example 500" />
            </Field>
            <Field label="Reason" htmlFor="autonomy-reason" hint="recorded with the change and shown to whoever decides a raise">
              <Textarea id="autonomy-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} disabled={!p.canControl} maxLength={1000} />
            </Field>
            <p className="text-xs text-fg-muted" data-testid="autonomy-direction">
              {direction === "stricter" ? "This lowers the agent's autonomy. It applies immediately." : direction === "looser" ? "This raises the agent's autonomy. It applies only after a different person with agents:control approves." : "No change selected."}
            </p>
            <FormError error={error} />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant={direction === "stricter" ? "danger" : "primary"} size="sm" loading={pending} disabled={!!submitReason} disabledReason={submitReason} data-testid="autonomy-submit">
                {direction === "looser" ? "Ask for approval" : "Lower now"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void simulate()} loading={simPending} disabled={!ceilingValid} disabledReason="The ceiling must be a number of zero or more" data-testid="autonomy-simulate">
                Simulate the last 30 days
              </Button>
            </div>
          </form>
          {sim ? (
            <div className="mt-3 space-y-2" data-testid="autonomy-simulation">
              <p className="text-sm text-fg">
                At {levelLabel(targetLevel)}, of {sim.total} recorded requests: {sim.simulated.autonomous} would run on their own (recorded: {sim.recorded.autonomous}), {sim.simulated.approval} would wait for approval (recorded: {sim.recorded.approval}), {sim.simulated.refused} would be refused or held (recorded: {sim.recorded.refused}).
              </p>
              {sim.changed.length ? (
                <ul className="space-y-1 text-xs text-fg-muted">
                  {sim.changed.slice(0, 8).map((c) => (
                    <li key={c.requestId}>
                      {when(c.createdAt)}: {c.tool}
                      {c.amount != null ? ` (${money(c.amount, p.currency)})` : ""} {OUTCOME_LABEL[c.recorded] ?? c.recorded} today, {OUTCOME_LABEL[c.simulated] ?? c.simulated} at this level
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-fg-muted">No recorded request would have been decided differently.</p>
              )}
              <p className="text-[11px] text-fg-dim">Replays the policy outcome stored with each decision; it does not re-run policies that have changed since.</p>
            </div>
          ) : null}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Raise requests" description="Each raise is decided by someone other than the person who asked">
          {p.requests.length === 0 ? (
            <p className="text-sm text-fg-muted">No raise has been requested for this agent.</p>
          ) : (
            <ul className="space-y-2" data-testid="autonomy-requests">
              {p.requests.map((r) => (
                <RaiseRow key={r.id} r={r} p={p} />
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Readiness for more autonomy" description="Measured over the last 30 days. A guide for the people deciding, never an automatic raise.">
          <ul className="space-y-1.5 text-sm" data-testid="autonomy-eligibility">
            {p.eligibility.checks.map((c) => (
              <li key={c.key} className="flex items-start justify-between gap-3">
                <span className={c.met ? "text-fg" : "text-fg-muted"}>
                  <span aria-hidden className={c.met ? "text-allow" : "text-deny"}>
                    {c.met ? "Met" : "Not met"}
                  </span>
                  <span className="sr-only">{c.met ? "met" : "not met"}</span> {c.label}
                </span>
                <span className="tabular text-xs text-fg-muted">{c.value}</span>
              </li>
            ))}
          </ul>
          <Note tone={p.eligibility.eligible ? "info" : "warning"} className="mt-3">
            {p.eligibility.eligible ? "Every measure is met. A raise still needs two people." : "Not every measure is met. A raise is still possible, and the decider sees these figures."}
          </Note>
        </Panel>
      </div>

      <Panel title="History" description="Every change of level, append-only and in the evidence record">
        <Timeline
          emptyText="The level has not changed since the agent was registered (level 4 applies policy as written)."
          items={p.history.map((h) => ({
            id: h.id,
            tone: h.toLevel < h.fromLevel ? "deny" : "allow",
            title: `${KIND_LABEL[h.kind] ?? h.kind}: level ${h.fromLevel} to ${h.toLevel}`,
            meta: `${h.reason} By ${h.actorType === "system" ? "AEGIS" : (h.actorName ?? "a person")}.`,
            time: when(h.createdAt),
          }))}
        />
      </Panel>
    </div>
  );
}

function RaiseRow({ r, p }: { r: AutonomyTabProps["requests"][number]; p: AutonomyTabProps }) {
  const router = useRouter();
  const [note, setNote] = React.useState("");
  const [pending, setPending] = React.useState<"approve" | "reject" | "cancel" | null>(null);
  const mine = r.requestedBy === p.currentUserId;
  async function decide(approve: boolean) {
    setPending(approve ? "approve" : "reject");
    const res = await decideAutonomyRaiseAction(r.id, p.agentId, { approve, note });
    setPending(null);
    if (!res.ok) return toast.error(res.error);
    toast.success(approve ? `Approved: level ${r.toLevel} applies now` : "Raise rejected");
    router.refresh();
  }
  async function cancel() {
    setPending("cancel");
    const res = await cancelAutonomyRaiseAction(r.id, p.agentId);
    setPending(null);
    if (!res.ok) return toast.error(res.error);
    toast.success("Request withdrawn");
    router.refresh();
  }
  const decideReason = !p.canControl ? "Requires the agents:control permission" : mine ? "You asked for this raise; a different person must decide it" : undefined;
  return (
    <li className="rounded-md border border-line p-2.5 text-sm" data-request-status={r.status}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-fg">
          Level {r.fromLevel} to {r.toLevel}
          {r.ceilingAmount != null ? `, ceiling ${money(r.ceilingAmount, p.currency)}` : ""}
        </span>
        <Badge tone={r.status === "approved" ? "allow" : r.status === "pending" ? "approval" : r.status === "rejected" ? "deny" : "neutral"}>{r.status}</Badge>
      </div>
      <p className="mt-1 text-xs text-fg-muted">
        {r.reason} Asked by {r.requestedByName ?? "a person"} on {when(r.createdAt)}
        {r.status === "pending" ? `; open until ${when(r.expiresAt)}` : r.decidedByName ? `; decided by ${r.decidedByName}` : ""}
        {r.decisionNote ? `: ${r.decisionNote}` : ""}.
      </p>
      {r.status === "pending" ? (
        <div className="mt-2 space-y-2">
          <Input aria-label="Decision note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (required to reject)" disabled={!!decideReason} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="primary" loading={pending === "approve"} disabled={!!decideReason || pending !== null} disabledReason={decideReason} onClick={() => void decide(true)}>
              Approve
            </Button>
            <Button size="sm" variant="ghost" loading={pending === "reject"} disabled={!!decideReason || note.trim().length < 3 || pending !== null} disabledReason={decideReason ?? "Write a note of at least 3 characters to reject"} onClick={() => void decide(false)}>
              Reject
            </Button>
            {mine ? (
              <Button size="sm" variant="ghost" loading={pending === "cancel"} disabled={pending !== null} onClick={() => void cancel()}>
                Withdraw
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </li>
  );
}
