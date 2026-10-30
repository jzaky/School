"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { updateToolReasoningPolicyAction } from "@/server/actions/uncertainty";
import { Button } from "@/components/ui/button";
import { Field, FormError } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

export interface ToolReasoning {
  id: string;
  key: string;
  name: string;
  policy: { enabled: boolean; requireRationale: boolean; requireCitations: boolean; onFailure: "require_approval" | "request_more_information" | "deny" };
}

export function ReasoningRequirementsEditor({ tools, canWrite }: { tools: ToolReasoning[]; canWrite: boolean }) {
  const router = useRouter();
  const [toolId, setToolId] = React.useState(tools[0]?.id ?? "");
  const [p, setP] = React.useState(tools[0]?.policy);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => setP(tools.find((t) => t.id === toolId)?.policy), [toolId, tools]);
  if (!p) return <p className="text-sm text-fg-muted">No tools are registered yet.</p>;
  const toggle = (id: string, label: string, hint: string, checked: boolean, onChange: (v: boolean) => void, disabled = false) => (
    <div className="flex items-start gap-3">
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={!canWrite || disabled} aria-label={label} />
      <label htmlFor={id} className="text-sm">
        <span className="text-fg">{label}</span>
        <span className="block text-xs text-fg-muted">{hint}</span>
      </label>
    </div>
  );
  return (
    <form
      className="space-y-3"
      data-testid="reasoning-tool-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setError(null);
        const r = await updateToolReasoningPolicyAction(toolId, p);
        setPending(false);
        if (!r.ok) return setError(r.error);
        toast.success("Rationale requirements saved");
        router.refresh();
      }}
    >
      <Field label="Tool" htmlFor="rsn-tool">
        <Select id="rsn-tool" aria-label="Tool for rationale requirements" value={toolId} onValueChange={setToolId} options={tools.map((t) => ({ value: t.id, label: `${t.name} (${t.key})` }))} />
      </Field>
      {toggle("rsn-enabled", "Apply these requirements", "Off: only a rationale that contradicts its own request changes a decision.", p.enabled, (v) => setP({ ...p, enabled: v }))}
      {toggle("rsn-required", "A rationale is required", "Without one, the response below applies.", p.requireRationale, (v) => setP({ ...p, requireRationale: v }), !p.enabled)}
      {toggle("rsn-cites", "Every step cites evidence", "Each step must point at evidence the agent supplied.", p.requireCitations, (v) => setP({ ...p, requireCitations: v }), !p.enabled)}
      <Field label="When the requirements are not met" htmlFor="rsn-onfailure">
        <Select
          id="rsn-onfailure"
          aria-label="When the rationale requirements are not met"
          value={p.onFailure}
          onValueChange={(v) => setP({ ...p, onFailure: v as typeof p.onFailure })}
          disabled={!canWrite}
          options={[
            { value: "require_approval", label: "Send to a person for approval" },
            { value: "request_more_information", label: "Ask the agent for its rationale" },
            { value: "deny", label: "Refuse" },
          ]}
        />
      </Field>
      <FormError error={error} />
      <Button type="submit" size="sm" variant="primary" loading={pending} disabled={!canWrite} disabledReason="Requires the agents:write permission">
        Save rationale requirements
      </Button>
    </form>
  );
}
