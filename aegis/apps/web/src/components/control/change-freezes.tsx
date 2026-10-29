"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Snowflake, Users } from "lucide-react";
import { createFreezeAction, endFreezeAction, setTwoPersonRecoveryAction } from "@/server/actions/gateway";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormError, Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Panel } from "@/components/ui/panel";

export interface FreezeRow {
  id: string;
  title: string;
  reason: string;
  startsAt: string;
  endsAt: string;
  effect: "deny" | "require_approval";
  minRiskLevel: string;
  agentNames: string[];
  createdBy: string | null;
  endedAt: string | null;
  endedBy: string | null;
  endReason: string | null;
}

type Risk = "low" | "medium" | "high" | "critical";
const RISK_LABEL: Record<Risk, string> = { low: "Every tool", medium: "Medium risk and above", high: "High risk and above", critical: "Critical tools only" };

/** Local date-time for an input of type datetime-local. */
function localInput(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
const fmt = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

function stateOf(f: FreezeRow, now: number): { label: string; tone: "deny" | "approval" | "neutral" | "info" } {
  if (f.endedAt) return { label: "Ended early", tone: "neutral" };
  if (new Date(f.endsAt).getTime() <= now) return { label: "Finished", tone: "neutral" };
  if (new Date(f.startsAt).getTime() > now) return { label: "Scheduled", tone: "info" };
  return { label: "In force", tone: f.effect === "deny" ? "deny" : "approval" };
}

export function ChangeFreezes({ freezes, twoPerson, canControl, canAdmin, agents }: { freezes: FreezeRow[]; twoPerson: boolean; canControl: boolean; canAdmin: boolean; agents: { id: string; name: string }[] }) {
  const router = useRouter();
  const [now] = React.useState(() => Date.now());
  const [mode, setMode] = React.useState<null | "create" | { end: FreezeRow } | "two-person">(null);
  const [title, setTitle] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [startsAt, setStartsAt] = React.useState("");
  const [endsAt, setEndsAt] = React.useState("");
  const [effect, setEffect] = React.useState<"deny" | "require_approval">("deny");
  const [risk, setRisk] = React.useState<Risk>("medium");
  const [agentId, setAgentId] = React.useState("all");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function openCreate() {
    const start = new Date();
    setTitle("");
    setReason("");
    setStartsAt(localInput(start));
    setEndsAt(localInput(new Date(start.getTime() + 24 * 3600 * 1000)));
    setEffect("deny");
    setRisk("medium");
    setAgentId("all");
    setError(null);
    setMode("create");
  }
  function openOther(m: { end: FreezeRow } | "two-person") {
    setReason("");
    setError(null);
    setMode(m);
  }

  const ready = mode === "create" ? title.trim().length >= 3 && reason.trim().length >= 5 && !!startsAt && !!endsAt : reason.trim().length >= 5;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!mode || !ready) return;
    setPending(true);
    setError(null);
    let r: { ok: true; data: unknown } | { ok: false; error: string };
    let message: string;
    if (mode === "create") {
      r = await createFreezeAction({ title, reason, startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString(), effect, minRiskLevel: risk, agentIds: agentId === "all" ? [] : [agentId] });
      message = "Change freeze scheduled";
    } else if (mode === "two-person") {
      r = await setTwoPersonRecoveryAction(!twoPerson, reason);
      message = twoPerson ? "Two-person recovery turned off" : "Two-person recovery turned on";
    } else {
      r = await endFreezeAction(mode.end.id, reason);
      message = "Change freeze ended";
    }
    setPending(false);
    if (!r.ok) return setError(r.error);
    toast.success(message);
    setMode(null);
    router.refresh();
  }

  const live = freezes.filter((f) => !f.endedAt && new Date(f.endsAt).getTime() > now);
  const past = freezes.filter((f) => !live.includes(f)).slice(0, 5);
  const dialogTitle = mode === "create" ? "Schedule a change freeze" : mode === "two-person" ? (twoPerson ? "Turn off two-person recovery" : "Turn on two-person recovery") : mode ? `End "${mode.end.title}" early` : "";
  const dialogDescription =
    mode === "create"
      ? "During the freeze, agents cannot use tools in the chosen risk range: requests are refused, or held for a person as emergency changes. Tools that only read stay available if they are below the range. Watch-only pilots do not relax a freeze."
      : mode === "two-person"
        ? "With two-person recovery on, the person who paused the gateway or started a freeze cannot also be the one who resumes it or ends it early."
        : "Agents can make changes again as soon as the freeze ends. Your reason is kept in the evidence record.";

  return (
    <Panel
      title="Change freezes"
      description="Stop agents from making changes for a set window, such as a year-end close or a release freeze. Each freeze and its reason is kept in the evidence record."
      actions={
        <Button size="sm" onClick={openCreate} disabled={!canControl} disabledReason="Requires agents:control">
          <Snowflake className="h-3.5 w-3.5" aria-hidden />
          Schedule freeze
        </Button>
      }
    >
      {live.length === 0 ? <p className="text-sm text-fg-muted">No freeze is in force or scheduled. Agents can make changes within their policies.</p> : null}
      <ul className="space-y-2">
        {[...live, ...past].map((f) => {
          const s = stateOf(f, now);
          return (
            <li key={f.id} className="rounded-md border border-line p-2.5 text-sm" data-testid="freeze-row">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-fg">{f.title}</span>
                <Badge tone={s.tone}>{s.label}</Badge>
                <Badge>{f.effect === "deny" ? "Refuse changes" : "Hold for a person"}</Badge>
              </div>
              <p className="mt-1 text-fg-muted">{f.reason}</p>
              <p className="mt-1 text-xs text-fg-dim">
                {fmt(f.startsAt)} to {fmt(f.endsAt)} · {RISK_LABEL[f.minRiskLevel as Risk] ?? f.minRiskLevel} · {f.agentNames.length ? f.agentNames.join(", ") : "All agents"}
                {f.createdBy ? ` · by ${f.createdBy}` : ""}
              </p>
              {f.endedAt ? <p className="mt-1 text-xs text-fg-dim">Ended {fmt(f.endedAt)}{f.endedBy ? ` by ${f.endedBy}` : ""}: {f.endReason}</p> : null}
              {live.includes(f) ? (
                <div className="mt-2">
                  <Button size="sm" variant="ghost" onClick={() => openOther({ end: f })} disabled={!canControl} disabledReason="Requires agents:control">
                    End early
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-sm">
        <Users className="h-3.5 w-3.5 text-fg-dim" aria-hidden />
        <span className="text-fg-muted">Two-person recovery is {twoPerson ? "on" : "off"}.</span>
        <Button size="sm" variant="ghost" onClick={() => openOther("two-person")} disabled={!canAdmin} disabledReason="Requires org:admin">
          {twoPerson ? "Turn off" : "Turn on"}
        </Button>
      </div>
      <Dialog
        open={mode !== null}
        onOpenChange={(o) => !o && setMode(null)}
        title={dialogTitle}
        description={dialogDescription}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setMode(null)} disabled={pending}>
              Cancel
            </Button>
            <Button form="freeze-form" type="submit" variant={mode === "create" ? "danger" : "primary"} loading={pending} disabled={!ready} disabledReason={mode === "create" ? "Give a title and a reason of at least 5 characters" : "Give a reason of at least 5 characters"}>
              {mode === "create" ? "Schedule freeze" : mode === "two-person" ? "Confirm" : "End freeze"}
            </Button>
          </>
        }
      >
        <form id="freeze-form" onSubmit={submit} className="space-y-3">
          {mode === "create" ? (
            <>
              <Field label="Title" htmlFor="fz-title">
                <Input id="fz-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Year-end close" autoFocus />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Starts" htmlFor="fz-start">
                  <Input id="fz-start" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
                </Field>
                <Field label="Ends" htmlFor="fz-end">
                  <Input id="fz-end" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
                </Field>
              </div>
              <Field label="During the freeze" htmlFor="fz-effect">
                <Select id="fz-effect" value={effect} onValueChange={(v) => setEffect(v as "deny" | "require_approval")} options={[{ value: "deny", label: "Refuse changes" }, { value: "require_approval", label: "Hold changes for a person" }]} />
              </Field>
              <Field label="Tools covered" htmlFor="fz-risk">
                <Select id="fz-risk" value={risk} onValueChange={(v) => setRisk(v as Risk)} options={(Object.keys(RISK_LABEL) as Risk[]).map((k) => ({ value: k, label: RISK_LABEL[k] }))} />
              </Field>
              <Field label="Agents covered" htmlFor="fz-agent">
                <Select id="fz-agent" value={agentId} onValueChange={setAgentId} options={[{ value: "all", label: "All agents" }, ...agents.map((a) => ({ value: a.id, label: a.name }))]} />
              </Field>
            </>
          ) : null}
          <Field label="Reason" htmlFor="fz-reason" hint="required, kept in the evidence record">
            <Textarea id="fz-reason" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus={mode !== "create"} placeholder={mode === "create" ? "Why changes must stop" : "Why this is needed now"} />
          </Field>
          <FormError error={error} />
        </form>
      </Dialog>
    </Panel>
  );
}
