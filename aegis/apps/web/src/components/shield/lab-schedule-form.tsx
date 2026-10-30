"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { setLabScheduleAction } from "@/server/actions/lab";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/switch";
import type { LabTarget } from "./lab-run-form";

export interface LabScheduleView {
  enabled: boolean;
  agentIds: string[];
  everyHours: 24 | 168;
  setBy: string | null;
  setAt: string | null;
}

/** Turns continuous attack simulation on or off for chosen agents. Runs happen in the worker, decision-only. */
export function LabScheduleForm({ targets, schedule, canEdit }: { targets: LabTarget[]; schedule: LabScheduleView; canEdit: boolean }) {
  const router = useRouter();
  const [agentIds, setAgentIds] = React.useState<string[]>(schedule.agentIds.filter((id) => targets.some((t) => t.id === id)));
  const [everyHours, setEveryHours] = React.useState<string>(String(schedule.everyHours));
  const [pending, setPending] = React.useState(false);
  const save = async (enabled: boolean) => {
    setPending(true);
    const r = await setLabScheduleAction({ enabled, agentIds, everyHours: Number(everyHours) });
    setPending(false);
    if (!r.ok) return toast.error(r.error);
    toast.success(enabled ? "Scheduled runs are on" : "Scheduled runs are off");
    router.refresh();
  };
  const reason = !canEdit ? "Requires the security:write permission" : agentIds.length === 0 ? "Choose at least one agent" : undefined;
  return (
    <div className="space-y-3" data-testid="lab-schedule">
      <p className="text-sm" data-testid="lab-schedule-state">
        {schedule.enabled ? `On: ${schedule.everyHours === 24 ? "every day" : "every week"} for ${schedule.agentIds.length} agent${schedule.agentIds.length === 1 ? "" : "s"}.` : "Off."}
        {schedule.setBy ? <span className="text-fg-muted"> Last changed by {schedule.setBy}.</span> : null}
      </p>
      <fieldset className="space-y-0.5" disabled={!canEdit}>
        <legend className="mb-1 text-xs text-fg-muted">Agents to test</legend>
        {targets.map((t) => (
          <Checkbox key={t.id} checked={agentIds.includes(t.id)} disabled={!canEdit || (!agentIds.includes(t.id) && agentIds.length >= 10)} onCheckedChange={(v) => setAgentIds(v ? [...agentIds, t.id] : agentIds.filter((x) => x !== t.id))} label={t.name} />
        ))}
      </fieldset>
      <label className="block text-sm">
        <span className="mb-1 block text-xs text-fg-muted">How often</span>
        <Select id="lab-every" aria-label="How often" value={everyHours} onValueChange={setEveryHours} options={[{ value: "24", label: "Every day" }, { value: "168", label: "Every week" }]} disabled={!canEdit} />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="button" loading={pending} disabled={!!reason} disabledReason={reason} onClick={() => save(true)} data-testid="lab-schedule-save">
          {schedule.enabled ? "Save schedule" : "Turn on scheduled runs"}
        </Button>
        {schedule.enabled ? (
          <Button type="button" variant="secondary" loading={pending} disabled={!canEdit} disabledReason="Requires the security:write permission" onClick={() => save(false)} data-testid="lab-schedule-off">
            Turn off
          </Button>
        ) : null}
      </div>
      <p className="text-xs text-fg-muted">A scenario the agent defended in its previous run that gets through now raises a high-severity security event.</p>
    </div>
  );
}
