"use client";
import * as React from "react";
import { toast } from "sonner";
import { updateInjectionResponseAction } from "@/server/actions/lab";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

const OPTIONS = [
  { value: "off", label: "Record only (policies decide)" },
  { value: "require_approval", label: "Send to a person for approval" },
  { value: "quarantine", label: "Hold for security review" },
  { value: "deny", label: "Refuse" },
];

export function InjectionResponseForm({ initial, canWrite }: { initial: string; canWrite: boolean }) {
  const [value, setValue] = React.useState(initial);
  const [pending, setPending] = React.useState(false);
  return (
    <form
      className="space-y-3"
      data-testid="injection-response-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        const r = await updateInjectionResponseAction({ response: value, signals: [] });
        setPending(false);
        if (!r.ok) return toast.error(r.error);
        toast.success("Saved. Applies from the next request.");
      }}
    >
      <label className="block text-sm">
        <span className="mb-1 block text-xs text-fg-muted">When injection signals are found in a request</span>
        <Select id="injection-response" aria-label="Response to injection signals" value={value} onValueChange={setValue} options={OPTIONS} disabled={!canWrite} />
      </label>
      <Button type="submit" size="sm" loading={pending} disabled={!canWrite || value === initial} disabledReason={!canWrite ? "Requires the security:write permission" : "No change to save"} data-testid="injection-response-save">
        Save
      </Button>
    </form>
  );
}
