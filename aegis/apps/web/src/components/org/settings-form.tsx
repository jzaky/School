"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { updateOrganizationAction } from "@/server/actions/org";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input } from "@/components/ui/input";

export function OrganizationSettingsForm({ initial, canAdmin }: { initial: { name: string; currency: string; timezone: string; approvalDefaultExpiryMinutes: number }; canAdmin: boolean }) {
  const router = useRouter();
  const [name, setName] = React.useState(initial.name);
  const [currency, setCurrency] = React.useState(initial.currency);
  const [timezone, setTimezone] = React.useState(initial.timezone);
  const [expiry, setExpiry] = React.useState(String(initial.approvalDefaultExpiryMinutes));
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const dirty = name !== initial.name || currency !== initial.currency || timezone !== initial.timezone || expiry !== String(initial.approvalDefaultExpiryMinutes);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setError(null);
        const r = await updateOrganizationAction({ name, currency: currency.toUpperCase(), timezone, approvalDefaultExpiryMinutes: expiry });
        setPending(false);
        if (!r.ok) return setError(r.error);
        toast.success("Organization settings saved");
        router.refresh();
      }}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Organization name" htmlFor="org-name" className="md:col-span-2">
          <Input id="org-name" value={name} onChange={(e) => setName(e.target.value)} disabled={!canAdmin} minLength={2} maxLength={120} required />
        </Field>
        <Field label="Currency" htmlFor="org-currency" hint="three-letter currency code (ISO 4217); amount limits in policies use this currency">
          <Input id="org-currency" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} disabled={!canAdmin} maxLength={3} pattern="[A-Za-z]{3}" className="font-mono uppercase" required />
        </Field>
        <Field label="Timezone" htmlFor="org-tz" hint="time zone name, for example Asia/Dubai (IANA format)">
          <Input id="org-tz" value={timezone} onChange={(e) => setTimezone(e.target.value)} disabled={!canAdmin} maxLength={64} required />
        </Field>
        <Field label="Default approval expiry" htmlFor="org-expiry" hint="in minutes, from 5 to 10080 (7 days); how long an approval request waits before it lapses">
          <Input id="org-expiry" type="number" min={5} max={10080} value={expiry} onChange={(e) => setExpiry(e.target.value)} disabled={!canAdmin} required />
        </Field>
      </div>
      <FormError error={error} />
      <div className="flex justify-end">
        <Button type="submit" variant="primary" loading={pending} disabled={!canAdmin || !dirty} disabledReason={!canAdmin ? "Requires org:admin" : "No changes to save"}>
          Save settings
        </Button>
      </div>
    </form>
  );
}
