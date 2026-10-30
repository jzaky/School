"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { setContinuousGovernanceAction } from "@/server/actions/org";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/input";
import { Note } from "@/components/ui/note";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { statusLabel, statusTone } from "@/lib/status";

type Mode = "assisted" | "continuous";
type Action = "notify" | "suspend_agent" | "pause_gateway" | "disable_integration";

const LABELS: Record<Action, string> = {
  notify: "Notify people only",
  suspend_agent: "Suspend the agent",
  pause_gateway: "Pause the gateway",
  disable_integration: "Disable the integration",
};

export interface GovernanceRule {
  key: string;
  name: string;
  description: string;
  severity: string;
  options: Action[];
}

/**
 * Settings panel for continuous governance: a mode switch and one response per monitoring rule.
 * Nothing is saved until the person presses Save; the save is recorded in evidence.
 */
export function ContinuousGovernancePanel({ initial, rules, defaults, canAdmin }: { initial: { mode: Mode; responses: Record<string, Action> }; rules: GovernanceRule[]; defaults: Record<string, Action>; canAdmin: boolean }) {
  const router = useRouter();
  const [mode, setMode] = React.useState<Mode>(initial.mode);
  const [responses, setResponses] = React.useState<Record<string, Action>>(initial.responses);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const dirty = mode !== initial.mode || JSON.stringify(responses) !== JSON.stringify(initial.responses);
  const continuous = mode === "continuous";
  const active = rules.filter((r) => (responses[r.key] ?? "notify") !== "notify");

  function toggle(on: boolean) {
    setMode(on ? "continuous" : "assisted");
    // First switch on: offer the shipped starting point so the mode does something from the first alert.
    if (on && Object.keys(responses).length === 0) setResponses(defaults);
  }

  async function save() {
    setPending(true);
    setError(null);
    const r = await setContinuousGovernanceAction({ mode, responses });
    setPending(false);
    if (!r.ok) return setError(r.error);
    toast.success(mode === "continuous" ? "Continuous governance is on: the responses below run automatically" : "Continuous governance is off: alerts only notify people");
    router.refresh();
  }

  return (
    <div className="space-y-4" data-testid="continuous-governance">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-line bg-bg p-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-fg">Mode</span>
            <span data-testid="cg-mode-badge">
              <Badge tone={continuous ? "allow" : "neutral"}>{continuous ? "Continuous" : "Assisted"}</Badge>
            </span>
          </div>
          <p className="mt-1 text-xs text-fg-muted">
            {continuous
              ? "When a monitoring rule raises an alert, AEGIS runs the response chosen for that rule right away, keeps a record of it in the evidence ledger and notifies the administrators. Responses only ever reduce what agents may do; a person can reverse each one."
              : "Alerts notify people. Every containment step (suspending an agent, pausing the gateway, disabling an integration) is a human decision."}
          </p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-sm">
          <span className="text-fg-muted">Continuous</span>
          <Switch checked={continuous} onCheckedChange={toggle} disabled={!canAdmin} aria-label="Continuous governance" id="cg-mode" />
        </label>
      </div>
      {continuous && active.length === 0 ? <Note tone="warning">Continuous mode is on but every rule is set to notify only, so nothing runs automatically. Choose a response for at least one rule.</Note> : null}
      <div className="overflow-x-auto rounded-md border border-line">
        <table className="w-full text-sm">
          <thead className="bg-bg-elev-2/60 text-start text-xs text-fg-muted">
            <tr>
              <th scope="col" className="px-3 py-2 text-start font-medium">Rule</th>
              <th scope="col" className="px-3 py-2 text-start font-medium">Severity</th>
              <th scope="col" className="px-3 py-2 text-start font-medium">Automatic response</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rules.map((r) => {
              const value = responses[r.key] ?? "notify";
              return (
                <tr key={r.key}>
                  <td className="px-3 py-2 align-top">
                    <span className="block font-medium text-fg">
                      <span className="me-2 font-mono text-xs text-fg-dim">{r.key}</span>
                      {r.name}
                    </span>
                    <span className="block text-xs text-fg-muted">{r.description}</span>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <Badge tone={statusTone(r.severity)}>{statusLabel(r.severity)}</Badge>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <Select size="sm" value={value} onValueChange={(v) => setResponses({ ...responses, [r.key]: v as Action })} disabled={!canAdmin || !continuous} options={r.options.map((o) => ({ value: o, label: LABELS[o] }))} aria-label={`Response for ${r.key}`} className="min-w-[200px]" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <FormError error={error} />
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={save} disabled={!canAdmin || !dirty || pending} disabledReason={!canAdmin ? "Needs org:admin" : !dirty ? "Nothing changed" : undefined} data-testid="cg-save">
          {pending ? "Saving" : continuous && initial.mode !== "continuous" ? "Turn on continuous governance" : "Save"}
        </Button>
        <span className="text-xs text-fg-muted">Every save is kept in the evidence record (event type governance.mode_changed).</span>
      </div>
    </div>
  );
}
