"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { recomputeCalibrationAction, updateToolUncertaintyPolicyAction } from "@/server/actions/uncertainty";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

export interface ToolRequirement {
  id: string;
  key: string;
  name: string;
  policy: { enabled: boolean; requiredContext: string[]; requireEvidenceFor: string[]; maxEvidenceAgeMinutes: number | null; trustedSources: string[]; minConfidence: number | null; onHigh: "require_approval" | "request_more_information" | "deny" };
}

const list = (s: string) => s.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);

export function ToolRequirementsEditor({ tools, canWrite }: { tools: ToolRequirement[]; canWrite: boolean }) {
  const router = useRouter();
  const [toolId, setToolId] = React.useState(tools[0]?.id ?? "");
  const tool = tools.find((t) => t.id === toolId);
  const [form, setForm] = React.useState(() => toForm(tool));
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => setForm(toForm(tools.find((t) => t.id === toolId))), [toolId, tools]);
  if (!tool) return <p className="text-sm text-fg-muted">No tools are registered yet.</p>;
  const disabled = !canWrite;
  async function save() {
    setPending(true);
    setError(null);
    const r = await updateToolUncertaintyPolicyAction(toolId, {
      enabled: form.enabled,
      requiredContext: list(form.requiredContext),
      requireEvidenceFor: list(form.requireEvidenceFor),
      maxEvidenceAgeMinutes: form.maxAge.trim() ? Number(form.maxAge) : null,
      trustedSources: list(form.trustedSources),
      minConfidence: form.minConfidence.trim() ? Number(form.minConfidence) : null,
      onHigh: form.onHigh,
    });
    setPending(false);
    if (!r.ok) return setError(r.error);
    toast.success(`Uncertainty requirements saved for ${tool!.name}`);
    router.refresh();
  }
  return (
    <form
      className="space-y-3"
      data-testid="uncertainty-tool-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Field label="Tool" htmlFor="unc-tool">
        <Select id="unc-tool" aria-label="Tool" value={toolId} onValueChange={setToolId} options={tools.map((t) => ({ value: t.id, label: `${t.name} (${t.key})` }))} />
      </Field>
      <div className="flex items-start gap-3">
        <Switch id="unc-enabled" checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} disabled={disabled} aria-label="Apply requirements" />
        <label htmlFor="unc-enabled" className="text-sm">
          <span className="text-fg">Apply these requirements</span>
          <span className="block text-xs text-fg-muted">Off: only contradictions and the agent&apos;s own reported gaps change a decision.</span>
        </label>
      </div>
      <Field label="Required fields" htmlFor="unc-required" hint="params.x or context.x, separated by commas">
        <Input id="unc-required" value={form.requiredContext} onChange={(e) => setForm({ ...form, requiredContext: e.target.value })} disabled={disabled} placeholder="context.ticketRef, params.orderId" />
      </Field>
      <Field label="Values that need evidence" htmlFor="unc-evidence" hint="parameter names the agent must back with an evidence item">
        <Input id="unc-evidence" value={form.requireEvidenceFor} onChange={(e) => setForm({ ...form, requireEvidenceFor: e.target.value })} disabled={disabled} placeholder="amount, customerId" />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Evidence older than (minutes) is stale" htmlFor="unc-age">
          <Input id="unc-age" inputMode="numeric" value={form.maxAge} onChange={(e) => setForm({ ...form, maxAge: e.target.value })} disabled={disabled} placeholder="no limit" />
        </Field>
        <Field label="Minimum confidence (0 to 1)" htmlFor="unc-conf">
          <Input id="unc-conf" inputMode="decimal" value={form.minConfidence} onChange={(e) => setForm({ ...form, minConfidence: e.target.value })} disabled={disabled} placeholder="none" />
        </Field>
      </div>
      <Field label="Trusted sources" htmlFor="unc-sources" hint="empty means any source">
        <Input id="unc-sources" value={form.trustedSources} onChange={(e) => setForm({ ...form, trustedSources: e.target.value })} disabled={disabled} placeholder="orders-db, crm" />
      </Field>
      <Field label="When uncertainty is high or unknown" htmlFor="unc-onhigh">
        <Select
          id="unc-onhigh"
          aria-label="When uncertainty is high or unknown"
          value={form.onHigh}
          onValueChange={(v) => setForm({ ...form, onHigh: v as typeof form.onHigh })}
          disabled={disabled}
          options={[
            { value: "require_approval", label: "Send to a person for approval" },
            { value: "request_more_information", label: "Ask the agent for the missing fields" },
            { value: "deny", label: "Refuse" },
          ]}
        />
      </Field>
      <FormError error={error} />
      <Button type="submit" size="sm" variant="primary" loading={pending} disabled={disabled} disabledReason="Requires the agents:write permission">
        Save requirements
      </Button>
    </form>
  );
}

function toForm(t: ToolRequirement | undefined) {
  const p = t?.policy;
  return {
    enabled: p?.enabled ?? false,
    requiredContext: (p?.requiredContext ?? []).join(", "),
    requireEvidenceFor: (p?.requireEvidenceFor ?? []).join(", "),
    maxAge: p?.maxEvidenceAgeMinutes == null ? "" : String(p.maxEvidenceAgeMinutes),
    trustedSources: (p?.trustedSources ?? []).join(", "),
    minConfidence: p?.minConfidence == null ? "" : String(p.minConfidence),
    onHigh: p?.onHigh ?? ("require_approval" as const),
  };
}

export function RecomputeCalibrationButton({ canWrite }: { canWrite: boolean }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  return (
    <Button
      size="sm"
      loading={pending}
      disabled={!canWrite}
      disabledReason="Requires the monitoring:write permission"
      onClick={async () => {
        setPending(true);
        const r = await recomputeCalibrationAction();
        setPending(false);
        if (!r.ok) return toast.error(r.error);
        toast.success(`${r.data.profiles} calibration profiles recomputed`);
        router.refresh();
      }}
    >
      Recompute now
    </Button>
  );
}
