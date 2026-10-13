"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { updateAutonomySettingsAction } from "@/server/actions/autonomy";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

interface Settings {
  automaticDowngrades: boolean;
  onSecurityEvents: boolean;
  denialBurst: { count: number; windowMinutes: number } | null;
  onUnknownOutcome: boolean;
}

export function AutonomySettingsForm({ initial, canAdmin }: { initial: Settings; canAdmin: boolean }) {
  const router = useRouter();
  const [s, setS] = React.useState<Settings>(initial);
  const [count, setCount] = React.useState(String(initial.denialBurst?.count ?? 5));
  const [windowMinutes, setWindowMinutes] = React.useState(String(initial.denialBurst?.windowMinutes ?? 60));
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const reason = !canAdmin ? "Requires the org:admin permission" : undefined;
  const row = (id: string, label: string, hint: string, checked: boolean, onChange: (v: boolean) => void, disabled = false) => (
    <div className="flex items-start gap-3">
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={!canAdmin || disabled} aria-label={label} />
      <label htmlFor={id} className="text-sm">
        <span className="text-fg">{label}</span>
        <span className="block text-xs text-fg-muted">{hint}</span>
      </label>
    </div>
  );
  async function save() {
    setPending(true);
    setError(null);
    const burst = s.denialBurst ? { count: Number(count), windowMinutes: Number(windowMinutes) } : null;
    const r = await updateAutonomySettingsAction({ ...s, denialBurst: burst });
    setPending(false);
    if (!r.ok) return setError(r.error);
    toast.success("Automatic downgrade rules saved");
    router.refresh();
  }
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      data-testid="autonomy-settings"
    >
      {row("auto-downgrades", "Lower levels automatically", "When off, alerts and refusals never change a level by themselves.", s.automaticDowngrades, (v) => setS({ ...s, automaticDowngrades: v }))}
      {row("auto-security", "On severe security events", "A critical event about an agent lowers it to level 0, a high one to level 1.", s.onSecurityEvents, (v) => setS({ ...s, onSecurityEvents: v }), !s.automaticDowngrades)}
      {row("auto-unknown", "On unconfirmed executions", "An execution whose outcome cannot be confirmed lowers the agent to level 2 at most.", s.onUnknownOutcome, (v) => setS({ ...s, onUnknownOutcome: v }), !s.automaticDowngrades)}
      {row("auto-burst", "On a burst of refusals", "Many refused requests in a short window lower the agent by one level, never below 1, once per window.", s.denialBurst != null, (v) => setS({ ...s, denialBurst: v ? { count: Number(count) || 5, windowMinutes: Number(windowMinutes) || 60 } : null }), !s.automaticDowngrades)}
      {s.denialBurst ? (
        <div className="grid grid-cols-2 gap-2 ps-12">
          <Field label="Refusals" htmlFor="burst-count">
            <Input id="burst-count" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} disabled={!canAdmin || !s.automaticDowngrades} />
          </Field>
          <Field label="Within minutes" htmlFor="burst-window">
            <Input id="burst-window" inputMode="numeric" value={windowMinutes} onChange={(e) => setWindowMinutes(e.target.value)} disabled={!canAdmin || !s.automaticDowngrades} />
          </Field>
        </div>
      ) : null}
      <FormError error={error} />
      <Button type="submit" size="sm" variant="primary" loading={pending} disabled={!canAdmin} disabledReason={reason}>
        Save rules
      </Button>
    </form>
  );
}
