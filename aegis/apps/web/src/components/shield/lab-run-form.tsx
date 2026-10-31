"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { startLabRunAction } from "@/server/actions/lab";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/switch";

export interface LabTarget {
  id: string;
  name: string;
  tools: { key: string; name: string }[];
}

const DEFAULT_TOOL = "__most_used__";

export function LabRunForm({ targets, canRun, customCount = 0 }: { targets: LabTarget[]; canRun: boolean; customCount?: number }) {
  const router = useRouter();
  const [agentId, setAgentId] = React.useState(targets[0]?.id ?? "");
  const [toolKey, setToolKey] = React.useState(DEFAULT_TOOL);
  const [pending, setPending] = React.useState(false);
  // Follows whether scenarios exist (they can be created after the page loads) until the person decides.
  const [choice, setChoice] = React.useState<boolean | null>(null);
  const withCustom = choice ?? customCount > 0;
  const target = targets.find((t) => t.id === agentId);
  return (
    <form
      className="space-y-3"
      data-testid="lab-run-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        const r = await startLabRunAction({ targetAgentId: agentId, ...(toolKey === DEFAULT_TOOL ? {} : { toolKey }), ...(withCustom && customCount > 0 ? { customScenarioIds: "applicable" } : {}) });
        setPending(false);
        if (!r.ok) return toast.error(r.error);
        toast.success(`Lab run ${r.data.status}`);
        router.push(`/security/lab/${r.data.runId}`);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block text-xs text-fg-muted">Agent to clone</span>
          <Select
            id="lab-agent"
            aria-label="Agent to clone"
            value={agentId}
            onValueChange={(v) => {
              setAgentId(v);
              setToolKey(DEFAULT_TOOL);
            }}
            options={targets.map((t) => ({ value: t.id, label: t.name }))}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-xs text-fg-muted">Tool the attacks use</span>
          <Select id="lab-tool" aria-label="Tool the attacks use" value={toolKey} onValueChange={setToolKey} options={[{ value: DEFAULT_TOOL, label: "The agent's most used tool" }, ...(target?.tools ?? []).map((t) => ({ value: t.key, label: `${t.name} (${t.key})` }))]} />
        </label>
      </div>
      {customCount > 0 ? <Checkbox checked={withCustom} onCheckedChange={setChoice} label="Include your scenarios" description="Every active scenario of yours that applies to this agent" disabled={!canRun} /> : null}
      <Button type="submit" loading={pending} disabled={!canRun || !agentId} disabledReason={!canRun ? "Requires the security:write permission" : "No active agent with tools to clone"} data-testid="lab-run-start">
        Run the lab
      </Button>
      <p className="text-xs text-fg-muted">Takes a few seconds. The clone is revoked and archived when the run ends.</p>
    </form>
  );
}
