"use client";
import * as React from "react";
import { CheckCircle2 } from "lucide-react";
import { requestEnterprisePricingAction } from "@/server/actions/billing";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Textarea } from "@/components/ui/input";

export function EnterprisePricingForm({ defaultName, defaultEmail }: { defaultName: string; defaultEmail: string }) {
  const [name, setName] = React.useState(defaultName);
  const [email, setEmail] = React.useState(defaultEmail);
  const [seats, setSeats] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<string | null>(null);
  if (done) {
    return (
      <div className="flex items-start gap-3 rounded-md border border-allow/30 bg-allow/10 px-3 py-3 text-sm">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-allow" aria-hidden />
        <div>
          <div className="font-medium text-fg">Request recorded</div>
          <div className="text-xs text-fg-muted">
            Reference <span className="font-mono">{done}</span>. The platform team will follow up at {email}.
          </div>
        </div>
      </div>
    );
  }
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setError(null);
        const r = await requestEnterprisePricingAction({ name, email, seats: seats ? Number(seats) : undefined, message });
        setPending(false);
        if (!r.ok) return setError(r.error);
        setDone(r.data.reference);
      }}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Your name" htmlFor="bill-name">
          <Input id="bill-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
        </Field>
        <Field label="Contact email" htmlFor="bill-email">
          <Input id="bill-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Expected seats" htmlFor="bill-seats" hint="optional">
          <Input id="bill-seats" type="number" min={1} value={seats} onChange={(e) => setSeats(e.target.value)} />
        </Field>
        <Field label="Notes" htmlFor="bill-notes" className="md:col-span-2" hint="optional">
          <Textarea id="bill-notes" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} rows={3} placeholder="Deployment model, regions, procurement timeline" />
        </Field>
      </div>
      <FormError error={error} />
      <div className="flex justify-end">
        <Button type="submit" variant="primary" loading={pending} disabled={!name || !email}>
          Request enterprise pricing
        </Button>
      </div>
    </form>
  );
}
